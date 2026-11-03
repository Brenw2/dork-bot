import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChat, type ChatState } from '@/lib/chatState';
import { botBase, chatSessionId, HermesClient, mapEvent, normalizeUrl, toChatMessages, type ChatEvent, type FetchLike } from '@/lib/hermes';
import { connectionFromParams, pairingLink, validateConnection } from '@/lib/pairing';
import { SseParser } from '@/lib/sse';

// Captured from the real Hermes API server: a turn where the bot ran `date` with the terminal tool.
const fixture = readFileSync(new URL('./fixtures/chat-stream-tool.sse', import.meta.url), 'utf8');

describe('SseParser', () => {
  it('parses the real Hermes stream the same way however it is chunked', () => {
    const whole = new SseParser().push(fixture);
    const chunked = new SseParser();
    const events = [];
    for (let i = 0; i < fixture.length; i += 7) events.push(...chunked.push(fixture.slice(i, i + 7)));
    expect(events).toEqual(whole);
    expect(whole.map((e) => e.event)).toContain('assistant.delta');
    expect(whole.at(-1)?.event).toBe('done');
  });

  it('skips keepalive comments and handles CRLF', () => {
    expect(new SseParser().push(': keepalive\r\n\r\nevent: x\r\ndata: {"a":1}\r\n\r\n')).toEqual([{ event: 'x', data: '{"a":1}' }]);
  });
});

describe('mapEvent + chatReducer on the real stream', () => {
  const events = new SseParser()
    .push(fixture)
    .map((e) => mapEvent(e.event, e.data))
    .filter((e): e is ChatEvent => e !== null);

  it('maps run, tool, delta and completion events', () => {
    expect(events[0]).toEqual({ type: 'started', runId: 'run_7f89a5facc074370935234272d774090' });
    expect(events).toContainEqual({ type: 'tool', phase: 'started', name: 'terminal', preview: 'date' });
    expect(events).toContainEqual({ type: 'finished', status: 'completed' });
  });

  it('ends with the tool call and the full reply in the history', () => {
    let s: ChatState = chatReducer(initialChat, { type: 'send', text: 'What time is it?' });
    for (const event of events) s = chatReducer(s, { type: 'event', event });
    expect(s.pending).toBeNull();
    expect(s.error).toBeNull();
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'tool', 'assistant']);
    expect(s.messages[1].toolName).toBe('terminal');
    expect(s.messages[2].content).toBe('It is 4:07 PM EST on Monday, November 2, 2026.');
  });

  it('streams text into the pending reply before completion', () => {
    let s = chatReducer(initialChat, { type: 'send', text: 'hi' });
    s = chatReducer(s, { type: 'event', event: { type: 'delta', text: 'He' } });
    s = chatReducer(s, { type: 'event', event: { type: 'delta', text: 'llo' } });
    expect(s.pending?.text).toBe('Hello');
    expect(s.pending?.thinking).toBe(false);
  });

  it('keeps partial text and shows the error when the stream breaks', () => {
    let s = chatReducer(initialChat, { type: 'send', text: 'hi' });
    s = chatReducer(s, { type: 'event', event: { type: 'delta', text: 'Half a' } });
    s = chatReducer(s, { type: 'failed', message: 'network lost' });
    expect(s.pending).toBeNull();
    expect(s.error).toBe('network lost');
    expect(s.messages.at(-1)?.content).toBe('Half a');
  });
});

describe('URLs and pairing', () => {
  it('builds per-profile paths', () => {
    expect(botBase({ url: 'b-lab.tail7e27a7.ts.net/', bot: 'assistant', key: 'k' })).toBe('https://b-lab.tail7e27a7.ts.net/p/assistant');
    expect(botBase({ url: 'http://127.0.0.1:8642', bot: 'default', key: 'k' })).toBe('http://127.0.0.1:8642');
    expect(normalizeUrl(' https://x.ts.net// ')).toBe('https://x.ts.net');
    expect(chatSessionId('assistant')).toBe('dork-bot-assistant');
  });

  it('round-trips a pairing link through route params', () => {
    const conn = { url: 'https://b-lab.tail7e27a7.ts.net', bot: 'assistant', key: 'a'.repeat(64) };
    const params = Object.fromEntries(new URL(pairingLink(conn)).searchParams);
    expect(connectionFromParams(params)).toEqual(conn);
    expect(validateConnection(conn)).toBeNull();
  });

  it('rejects bad input with a readable reason', () => {
    expect(validateConnection({ url: 'https://x', bot: 'Bad Name', key: 'a'.repeat(20) })).toMatch(/lowercase/);
    expect(validateConnection({ url: 'https://x', bot: 'ok', key: 'short' })).toMatch(/too short/);
    expect(validateConnection({ bot: 'ok', key: 'a'.repeat(20) })).toMatch(/address/);
  });
});

describe('HermesClient', () => {
  const conn = { url: 'https://h.ts.net', bot: 'assistant', key: 'secret-key-1234567890' };

  function fakeFetch(handler: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Response): {
    fetch: FetchLike;
    calls: { url: string; method: string; auth?: string }[];
  } {
    const calls: { url: string; method: string; auth?: string }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', auth: init?.headers?.Authorization });
      return handler(url, init);
    };
    return { fetch, calls };
  }

  it('treats 409 as an existing chat', async () => {
    const f = fakeFetch(() => new Response('{}', { status: 409 }));
    await new HermesClient(conn, f.fetch).ensureSession('dork-bot-assistant', 't');
    expect(f.calls[0]).toEqual({ url: 'https://h.ts.net/p/assistant/api/sessions', method: 'POST', auth: 'Bearer secret-key-1234567890' });
  });

  it('retries without a title when Hermes says the title is taken', async () => {
    const bodies: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
      bodies.push(init?.body ?? '');
      return bodies.length === 1
        ? new Response('{"error":{"code":"invalid_title"}}', { status: 400 })
        : new Response('{}', { status: 201 });
    };
    await new HermesClient(conn, fetch).ensureSession('dork-bot-assistant', 'Dork Bot: assistant');
    expect(bodies.map((b) => JSON.parse(b).title)).toEqual(['Dork Bot: assistant', undefined]);
  });

  it('explains a rejected key', async () => {
    const f = fakeFetch(() => new Response('', { status: 401 }));
    await expect(new HermesClient(conn, f.fetch).check()).rejects.toThrow(/rejected/);
  });

  it('streams a chat from the response body', async () => {
    const f = fakeFetch(() => new Response(fixture, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    const seen: ChatEvent[] = [];
    await new HermesClient(conn, f.fetch).chat('dork-bot-assistant', 'hi', (e) => seen.push(e));
    expect(seen.filter((e) => e.type === 'delta').length).toBe(22);
    expect(f.calls[0].url).toBe('https://h.ts.net/p/assistant/api/sessions/dork-bot-assistant/chat/stream');
  });

  it('sends a one-turn system note only when there is one', async () => {
    const bodies: unknown[] = [];
    const fetch: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return new Response(fixture, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const client = new HermesClient(conn, fetch);
    await client.chat('dork-bot-assistant', 'hi', () => {});
    await client.chat('dork-bot-assistant', 'hi', () => {}, undefined, { instructions: undefined });
    await client.chat('dork-bot-assistant', 'hi', () => {}, undefined, { instructions: 'You have deepwiki now.' });
    expect(bodies).toEqual([
      { message: 'hi' },
      { message: 'hi' },
      { message: 'hi', system_message: 'You have deepwiki now.' },
    ]);
  });

  it('turns history into chat rows and drops empty/meta rows', () => {
    const rows = toChatMessages([
      { id: 1, role: 'user', content: 'hi' },
      { id: 2, role: 'assistant', content: '' },
      { id: 3, role: 'tool', content: 'out', tool_name: 'terminal' },
      { id: 4, role: 'assistant', content: '\n\nHello' },
      { id: 5, role: 'session_meta', content: null },
    ]);
    expect(rows).toEqual([
      { id: '1', role: 'user', content: 'hi' },
      { id: '3', role: 'tool', content: '', toolName: 'terminal' },
      { id: '4', role: 'assistant', content: 'Hello' },
    ]);
  });
});

describe('tool activity rows', () => {
  const msg = (id: string, role: 'user' | 'assistant' | 'tool', content = '', toolName?: string) => ({ id, role, content, toolName });

  it('collapses a run of tool calls into one row', async () => {
    const { chatRows } = await import('@/lib/chatState');
    const rows = chatRows({
      messages: [msg('1', 'user', 'hi'), msg('2', 'tool', '', 'terminal'), msg('3', 'tool', '', 'skill_view'), msg('4', 'tool', '', 'terminal'), msg('5', 'assistant', 'done'), msg('6', 'tool', '', 'web_search')],
      pending: null,
    });
    expect(rows.map((r) => r.kind)).toEqual(['message', 'activity', 'message', 'activity']);
    expect(rows[1].kind === 'activity' && rows[1].tools.map((t) => t.name)).toEqual(['terminal', 'skill_view', 'terminal']);
  });

  it('shows the latest step while the bot works, a summary after', async () => {
    const { activityLine, chatRows } = await import('@/lib/chatState');
    const tools = [
      { name: 'skill_view', preview: null, status: 'done' as const },
      { name: 'terminal', preview: 'ls', status: 'done' as const },
      { name: 'terminal', preview: 'cat x', status: 'running' as const },
    ];
    const rows = chatRows({ messages: [], pending: { text: '', tools, thinking: true } });
    expect(rows.map((r) => r.kind)).toEqual(['activity', 'pending']);
    expect(rows[0].kind === 'activity' && rows[0].live).toBe(true);
    expect(activityLine(tools, true)).toBe('… terminal · 3 steps');
    expect(activityLine(tools, false)).toBe('✓ skill_view, terminal · 3 steps');
    expect(activityLine([...tools, { name: 'read_file', preview: null, status: 'failed' }, { name: 'x', preview: null, status: 'done' }], false)).toBe(
      '✕ skill_view, terminal +2 · 5 steps · 1 failed',
    );
    expect(activityLine([tools[0]], false)).toBe('✓ skill_view');
  });
});

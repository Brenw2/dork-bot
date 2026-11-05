import { describe, expect, it } from 'vitest';
import { agoLabel, chatName, cleanPreview, firstChatId, isBotChat, newChatId, toChatSummaries } from '@/lib/chats';
import { chatReducer, initialChat } from '@/lib/chatState';
import { HermesClient, mapEvent, toApproval, type FetchLike, type FetchResponse } from '@/lib/hermes';

function res(status: number, body: unknown = {}): FetchResponse {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), body: null };
}

// What GET /p/assistant/api/sessions returned on b-lab (2026-11-04), trimmed: the bot's first chat,
// routine runs, and a live-test chat that isn't one of the app's.
const SESSIONS = [
  { id: 'dork-bot-assistant', source: 'api_server', title: 'Dork Bot: assistant', message_count: 95, last_active: 1793819176.26, preview: 'What model are you running?' },
  { id: 'local-b0a641a8de', source: 'cron', title: 'daily_digest · Nov 04 11:32', message_count: 12, last_active: 1793809926.8, preview: '/google-workspace' },
  { id: 'dork-bot-live-1793672803845', source: 'api_server', title: 'Respond with pong #3', message_count: 5, last_active: 1793749237.3, preview: 'Reply with exactly: pong' },
  { id: 'dork-bot-assistant--mh3x1abc1', source: 'api_server', title: 'Mets tickets', message_count: 4, last_active: 1793820000, preview: 'find me two seats' },
  { id: 'dork-bot-assistant--mh3x2zzz9', source: 'api_server', title: null, message_count: 0, last_active: 1793821000, preview: '' },
];

describe('chats', () => {
  it("lists only the bot's own chats with messages, newest first", () => {
    const chats = toChatSummaries('assistant', SESSIONS);
    expect(chats.map((c) => c.id)).toEqual(['dork-bot-assistant--mh3x1abc1', 'dork-bot-assistant']);
    expect(chats[0]).toMatchObject({ title: 'Mets tickets', messageCount: 4 });
  });

  it('tells chats apart by bot, even when one name starts like another', () => {
    expect(isBotChat('assistant', 'dork-bot-assistant')).toBe(true);
    expect(isBotChat('assistant', 'dork-bot-assistant--abc')).toBe(true);
    expect(isBotChat('assistant', 'dork-bot-assistant2')).toBe(false);
    expect(isBotChat('live', 'dork-bot-live-1793672803845')).toBe(false);
    expect(firstChatId('chief')).toBe('dork-bot-chief');
  });

  it('makes new chat ids that belong to the bot and differ', () => {
    const a = newChatId('chief', 1793820000000, () => 0.1);
    const b = newChatId('chief', 1793820000001, () => 0.1);
    expect(isBotChat('chief', a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^dork-bot-chief--[0-9a-z]+$/);
  });

  it("names a chat by its title, else how it starts; the old default title doesn't count", () => {
    expect(chatName('assistant', { title: 'Mets tickets', preview: 'x' })).toBe('Mets tickets');
    expect(chatName('assistant', { title: 'Dork Bot: assistant', preview: 'What model are you running?' })).toBe('What model are you running?');
    expect(chatName('assistant', { title: null, preview: '' })).toBe('New chat');
    expect(cleanPreview('why?\n\n[Image attached at: /x/api_aa.png]\n[screenshot]')).toBe('why?');
  });

  it('says how long ago', () => {
    const now = 1793820000 * 1000;
    expect(agoLabel(1793820000 - 10, now)).toBe('now');
    expect(agoLabel(1793820000 - 300, now)).toBe('5m');
    expect(agoLabel(1793820000 - 3 * 3600, now)).toBe('3h');
    expect(agoLabel(1793820000 - 30 * 86400, now)).toMatch(/^[A-Z][a-z]{2} \d+$/);
  });

  it('lists, renames and deletes chats through the API server', async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ method: init.method ?? 'GET', url, body: init.body });
      if (url.includes('/api/sessions?')) return res(200, { data: SESSIONS });
      if (init.method === 'PATCH') return res(200, { session: {} });
      if (init.method === 'DELETE' && url.endsWith('busy')) return res(409, { error: { code: 'session_active_turn' } });
      return res(200, { ok: true });
    };
    const c = new HermesClient({ url: 'https://b-lab.test', bot: 'assistant', key: 'k'.repeat(40) }, fetch);
    expect((await c.listChats()).length).toBe(2);
    expect(calls[0].url).toBe('https://b-lab.test/p/assistant/api/sessions?source=api_server&limit=200');
    await c.renameChat('dork-bot-assistant', '  Morning stuff ');
    expect(calls[1]).toMatchObject({ method: 'PATCH', url: 'https://b-lab.test/p/assistant/api/sessions/dork-bot-assistant', body: '{"title":"Morning stuff"}' });
    await c.renameChat('dork-bot-assistant', '');
    expect(calls[2].body).toBe('{"title":null}');
    await c.deleteChat('dork-bot-assistant--x');
    await expect(c.deleteChat('busy')).rejects.toThrow(/still running/);
  });
});

// The approval.request payload Hermes's session stream sends (gateway/platforms/api_server.py
// _approval_request_event + tools/approval.py), with a redacted command.
const APPROVAL = {
  event: 'approval.request',
  run_id: 'run_abc',
  timestamp: 1793820000.1,
  command: 'rm -rf /tmp/dork-approval-test',
  pattern_key: 'rm_rf',
  pattern_keys: ['rm_rf'],
  description: 'recursive delete',
  allow_permanent: true,
  allow_session: true,
  request_id: '9f2c',
  message_id: 'msg_1',
  choices: ['once', 'session', 'always', 'deny'],
};

describe('approvals', () => {
  it('maps the SSE approval request', () => {
    expect(mapEvent('approval.request', JSON.stringify(APPROVAL))).toEqual({
      type: 'approval',
      request: { requestId: '9f2c', command: 'rm -rf /tmp/dork-approval-test', description: 'recursive delete', choices: ['once', 'session', 'always', 'deny'] },
    });
    // A smart-mode denial offers only once/deny.
    expect(toApproval({ ...APPROVAL, choices: ['once', 'deny'] })?.choices).toEqual(['once', 'deny']);
    expect(toApproval(null)).toBeNull();
    expect(toApproval({})).toBeNull();
  });

  it('shows the request until a tool reports back or the run ends', () => {
    let s = chatReducer(initialChat, { type: 'send', text: 'clean up /tmp' });
    s = chatReducer(s, { type: 'event', event: { type: 'tool', phase: 'started', name: 'terminal', preview: 'rm -rf' } });
    s = chatReducer(s, mapAction());
    expect(s.approval?.command).toBe('rm -rf /tmp/dork-approval-test');
    s = chatReducer(s, { type: 'event', event: { type: 'tool', phase: 'completed', name: 'terminal', preview: null } });
    expect(s.approval).toBeNull();
    s = chatReducer(s, mapAction());
    s = chatReducer(s, { type: 'event', event: { type: 'finished', status: 'completed' } });
    expect(s.approval).toBeNull();
  });

  it('answers through /v1/runs/<id>/approval with the request id', async () => {
    const calls: { url: string; body?: string }[] = [];
    let status = 200;
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, body: init.body });
      if (url.endsWith('/v1/runs/run_abc')) return res(200, { status: 'waiting_for_approval', approval: APPROVAL });
      return res(status, status === 409 ? { error: { message: 'Run has no pending approval' } } : { resolved: 1 });
    };
    const c = new HermesClient({ url: 'https://b-lab.test', bot: 'chief', key: 'k'.repeat(40) }, fetch);
    expect((await c.runInfo('run_abc')).approval?.requestId).toBe('9f2c');
    await c.approve('run_abc', 'once', '9f2c');
    expect(calls.at(-1)).toEqual({ url: 'https://b-lab.test/p/chief/v1/runs/run_abc/approval', body: '{"choice":"once","request_id":"9f2c"}' });
    status = 409;
    await expect(c.approve('run_abc', 'deny')).rejects.toThrow(/already ended/);
  });

  it("answers a session-authority gateway with the run's execution generation", async () => {
    // GET /v1/runs/<id> on b-lab's gateway (0.22.5, session authority): the request is a pending control.
    const run = {
      pending_controls: [{ kind: 'approval', prompt_id: '9f2c', command: 'rm -rf /tmp/x', description: 'recursive delete', choices: ['once', 'session', 'always', 'deny'] }],
      run_id: 'run_abc',
      status: 'waiting_for_approval',
      session_id: 'dork-bot-chief--x',
      admission_id: 'adm_1',
      execution_generation: 3,
    };
    const calls: { url: string; body?: string }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, body: init.body });
      return url.endsWith('/approval') ? res(200, { run_id: 'run_abc' }) : res(200, run);
    };
    const c = new HermesClient({ url: 'https://b-lab.test', bot: 'chief', key: 'k'.repeat(40) }, fetch);
    const info = await c.runInfo('run_abc');
    expect(info).toMatchObject({ status: 'waiting_for_approval', generation: 3, approval: { requestId: '9f2c', command: 'rm -rf /tmp/x' } });
    await c.approve('run_abc', 'deny', '9f2c');
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ request_id: '9f2c', execution_generation: 3, choice: 'deny' });
  });
});

function mapAction() {
  const e = mapEvent('approval.request', JSON.stringify(APPROVAL));
  if (!e) throw new Error('no event');
  return { type: 'event' as const, event: e };
}

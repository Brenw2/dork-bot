import { describe, expect, it } from 'vitest';
import { connectError, doingLine, errorLine, lastMessagePreview, latestPreview, previewOf, rowTime, sortRows, stripMarkdown } from '@/lib/botList';
import type { ChatMessage } from '@/lib/hermes';

const msg = (role: ChatMessage['role'], content: string, id = Math.random().toString()): ChatMessage => ({ id, role, content });

describe('stripMarkdown', () => {
  it('keeps the words, drops the marks', () => {
    expect(stripMarkdown('## Plan\n\n- **Move** the call to `3`\n- see [the doc](https://x.test/a)')).toBe('Plan Move the call to 3 see the doc');
  });
  it('keeps code inside a fence as plain words', () => {
    expect(stripMarkdown('Run:\n```bash\nnpm test\n```')).toBe('Run: npm test');
  });
});

describe('previewOf', () => {
  it('shows a lone picture as "Picture"', () => {
    expect(previewOf('[Image attached at: /x/api_aa.png]\n[screenshot]')).toBe('Picture');
  });
  it('keeps the words when a picture comes with text', () => {
    expect(previewOf('why does this fail?\n\n[Image attached at: /x/a.png]')).toBe('why does this fail?');
  });
  it('names a routine result by its routine', () => {
    expect(previewOf('[Routine · daily_digest · 2026-11-12T08:00:00-05:00]\nThree stories today.')).toBe('Routine · daily_digest: Three stories today.');
  });
  it('is null for nothing', () => {
    expect(previewOf('   ')).toBeNull();
  });
});

describe('lastMessagePreview', () => {
  it('takes the newest user or assistant message, skipping tool rows and empties', () => {
    const list = [msg('user', 'hi'), msg('assistant', 'Hello **there**'), msg('tool', '{"ok":true}'), msg('assistant', '')];
    expect(lastMessagePreview(list)?.text).toBe('Hello there');
  });
  it('is null for an empty chat', () => {
    expect(lastMessagePreview([])).toBeNull();
  });
});

describe('latestPreview', () => {
  const chat = (id: string, lastActive: number, preview = '') => ({ id, title: null, preview, lastActive, messageCount: 2 });
  it('uses the newest message of the most recent chat', async () => {
    const asked: string[] = [];
    const p = await latestPreview({
      listChats: async () => [chat('b', 200), chat('a', 100)],
      messages: async (id) => (asked.push(id), [msg('user', 'q'), msg('assistant', 'The answer')]),
    });
    expect(asked).toEqual(['b']);
    expect(p).toEqual({ text: 'The answer', at: 200 });
  });
  it('says nothing for a bot with no chats (the row shows "No messages yet")', async () => {
    expect(await latestPreview({ listChats: async () => [], messages: async () => [] })).toEqual({ text: null, at: null });
  });
  it("falls back to Hermes's own preview when the messages can't be read", async () => {
    const p = await latestPreview({
      listChats: async () => [chat('a', 50, 'what model are you running?')],
      messages: async () => {
        throw new Error('down');
      },
    });
    expect(p).toEqual({ text: 'what model are you running?', at: 50 });
  });
});

describe('rowTime', () => {
  const now = new Date(2026, 10, 12, 14, 0).getTime(); // Thu Nov 12 2026, 2:00 PM local
  const at = (d: Date) => d.getTime() / 1000;
  it('is "now" under a minute', () => expect(rowTime(now / 1000 - 30, now)).toBe('now'));
  it('is the time today', () => expect(rowTime(at(new Date(2026, 10, 12, 9, 41)), now)).toBe('9:41 AM'));
  it('is "Yesterday" the day before, even a few hours ago', () => expect(rowTime(at(new Date(2026, 10, 11, 23, 50)), now)).toBe('Yesterday'));
  it('is the weekday under 7 days', () => expect(rowTime(at(new Date(2026, 10, 10, 9, 0)), now)).toBe('Tue'));
  it('is month and day from 7 days on', () => {
    expect(rowTime(at(new Date(2026, 9, 30, 9, 0)), now)).toBe('Oct 30');
    expect(rowTime(at(new Date(2026, 10, 5, 9, 0)), now)).toBe('Nov 5');
  });
  it('is empty with no time', () => expect(rowTime(null, now)).toBe(''));
});

describe('connect errors', () => {
  it('has copy for a rejected key, no network, and anything else', () => {
    expect(errorLine(connectError(401, 'The key for "scout" was rejected (401).'))).toBe('Key rejected. Tap to pair again.');
    expect(errorLine(connectError(undefined, "Can't reach b-lab. Check that Tailscale is on (Failed to fetch)"))).toBe("Can't reach b-lab.");
    expect(errorLine(connectError(500, 'Hermes answered HTTP 500'))).toBe("Can't connect. Tap for details.");
  });
});

describe('doingLine', () => {
  it('words the busy moods and nothing else', () => {
    expect(doingLine('thinking')).toBe('Thinking…');
    expect(doingLine('working')).toBe('Working…');
    expect(doingLine('talking')).toBe('Replying…');
    expect(doingLine('idle')).toBeNull();
    expect(doingLine('done')).toBeNull();
  });
});

describe('sortRows', () => {
  it('puts Needs you first, then the newest, then bots with no messages by name', () => {
    const rows = [
      { bot: 'scout', needsYou: false, at: 10 },
      { bot: 'zed', needsYou: false, at: null },
      { bot: 'chief', needsYou: false, at: 30 },
      { bot: 'assistant', needsYou: true, at: 5 },
      { bot: 'abe', needsYou: false, at: null },
    ];
    expect(sortRows(rows).map((r) => r.bot)).toEqual(['assistant', 'chief', 'scout', 'abe', 'zed']);
  });
});

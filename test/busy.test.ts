import { describe, expect, it } from 'vitest';
import { BusyWatch, CHAT_WINDOW_S, parseSessionRows, STALE_S, type SessionRow } from '@/lib/busy';
import { ActivityStore } from '@/lib/activity';

const NOW = 1_800_000_000;
const row = (o: Partial<SessionRow> & { id: string }): SessionRow => ({ source: 'oneshot', endedAt: null, lastActive: NOW, messageCount: 1, ...o });

function setup(initial: Record<string, SessionRow[]>) {
  const rows: Record<string, SessionRow[]> = structuredClone(initial);
  const activity = new ActivityStore();
  let now = NOW * 1000;
  let held = false;
  let fail = false;
  const calls = { sessions: 0, chat: 0 };
  const waiting: Record<string, boolean> = {};
  const watch = new BusyWatch({
    bots: async () => Object.keys(rows),
    sessions: async (bot) => {
      calls.sessions++;
      if (fail) throw new Error('offline');
      return rows[bot];
    },
    chatWaiting: async (_bot, id) => {
      calls.chat++;
      return waiting[id] ?? false;
    },
    getMood: (b) => activity.get(b),
    setMood: (b, m) => activity.set(b, m),
    heldHere: () => held,
    now: () => now,
  });
  return {
    watch,
    activity,
    rows,
    calls,
    waiting,
    advance: (s: number) => (now += s * 1000),
    hold: (v: boolean) => (held = v),
    fail: (v: boolean) => (fail = v),
  };
}

describe('parseSessionRows', () => {
  it('keeps the fields that matter and skips malformed rows', () => {
    expect(
      parseSessionRows([
        { id: 'a', source: 'cron', ended_at: null, last_active: 5.5, message_count: 3, preview: 'x' },
        { id: 'b', source: 'cli', ended_at: 9, last_active: 6 },
        { source: 'cli', last_active: 1 },
        { id: 'c' },
        null,
      ]),
    ).toEqual([
      { id: 'a', source: 'cron', endedAt: null, lastActive: 5.5, messageCount: 3 },
      { id: 'b', source: 'cli', endedAt: 9, lastActive: 6, messageCount: 0 },
    ]);
    expect(parseSessionRows(undefined)).toEqual([]);
  });
});

describe('BusyWatch', () => {
  it('shows working while a terminal run is open, and idle (after done) once it ends', async () => {
    const w = setup({ chief: [row({ id: 'cli1', lastActive: NOW - 20 })] }); // model call: last_active is 20 s old
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('working');
    expect(w.watch.isBusy('chief')).toBe(true);

    w.rows.chief = [row({ id: 'cli1', endedAt: NOW + 30, lastActive: NOW + 30 })];
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('done'); // then idle after the celebration
    expect(w.watch.isBusy('chief')).toBe(false);
  });

  it('a routine (cron session) counts the same way', async () => {
    const w = setup({ chief: [row({ id: 'c1', source: 'cron' })], other: [] });
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('working');
    expect(w.activity.get('other')).toBe('idle');
  });

  it('ignores a crashed session that never ended', async () => {
    const w = setup({ chief: [row({ id: 'dead', lastActive: NOW - STALE_S - 1 })] });
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('idle');
  });

  it("an app chat is not busy just because it has no end; it is when its last message is the user's", async () => {
    const w = setup({ chief: [row({ id: 'dork-bot-chief', source: 'api_server', messageCount: 4, lastActive: NOW - 5 })] });
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('idle');
    expect(w.calls.chat).toBe(1);

    w.rows.chief = [row({ id: 'dork-bot-chief', source: 'api_server', messageCount: 5, lastActive: NOW })];
    w.waiting['dork-bot-chief'] = true; // sent from the other device
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('working');

    w.rows.chief = [row({ id: 'dork-bot-chief', source: 'api_server', messageCount: 6, lastActive: NOW + 40 })];
    w.waiting['dork-bot-chief'] = false; // the reply landed
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('done');
  });

  it('does not re-read a quiet chat, and ignores chats older than the window', async () => {
    const w = setup({ chief: [row({ id: 'chat', source: 'api_server', messageCount: 4 })] });
    await w.watch.tick();
    await w.watch.tick();
    await w.watch.tick();
    expect(w.calls.chat).toBe(1);
    expect(w.calls.sessions).toBe(3);

    const old = setup({ chief: [row({ id: 'chat', source: 'api_server', lastActive: NOW - CHAT_WINDOW_S - 1 })] });
    await old.watch.tick();
    expect(old.calls.chat).toBe(0);
  });

  it("leaves the chat screen's own mood alone, and only takes back a working it set itself", async () => {
    const w = setup({ chief: [row({ id: 'cli1' })] });
    w.activity.set('chief', 'thinking'); // this chat is streaming
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('thinking');
    w.rows.chief = [];
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('thinking'); // not ours to clear

    w.activity.set('chief', 'idle');
    w.activity.set('chief', 'working'); // a run this device started and is checking on
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('working');
  });

  it('keeps working while this device still holds a run for the bot', async () => {
    const w = setup({ chief: [row({ id: 'cli1' })] });
    await w.watch.tick();
    w.hold(true);
    w.rows.chief = [];
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('working');
  });

  it('keeps the last answer when Hermes cannot be reached', async () => {
    const w = setup({ chief: [row({ id: 'cli1' })] });
    await w.watch.tick();
    w.fail(true);
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('working');
    expect(w.watch.isBusy('chief')).toBe(true);
  });

  it('reset (the watch is switched off) clears what it showed', async () => {
    const w = setup({ chief: [row({ id: 'cli1' })] });
    await w.watch.tick();
    w.watch.reset();
    expect(w.activity.get('chief')).toBe('done');
    expect(w.watch.isBusy('chief')).toBe(false);
  });
});

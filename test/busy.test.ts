import { describe, expect, it } from 'vitest';
import { BusyWatch, ADOPT_GRACE_MS, CHAT_WINDOW_S, leaveAction, parseSessionRows, STALE_S, turnPending, type SessionRow } from '@/lib/busy';
import { ActivityStore } from '@/lib/activity';
import { LiveRuns, type RunInfo } from '@/lib/liveRuns';

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
    clearMood: (b) => activity.clear(b),
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

describe('turnPending (a chat whose saved messages end mid-turn)', () => {
  const t = NOW - 5;
  const user = { role: 'user', content: 'hi', timestamp: t };
  const step = { role: 'assistant', content: 'Let me check…', tool_calls: [{ id: 'x' }], timestamp: t };
  const tool = { role: 'tool', content: 'ok', tool_name: 'terminal', timestamp: t };
  const answer = { role: 'assistant', content: 'Done.', timestamp: t };
  const meta = { role: 'session_meta', content: '', timestamp: t };

  it('is pending after the user, after a tool result, and after an assistant step that called tools', () => {
    expect(turnPending([user], NOW)).toBe(true);
    expect(turnPending([user, step], NOW)).toBe(true); // narration + tool call is not the answer
    expect(turnPending([user, step, tool], NOW)).toBe(true);
  });

  it('is not pending once the answer is saved (a trailing session_meta row is ignored)', () => {
    expect(turnPending([user, step, tool, answer], NOW)).toBe(false);
    expect(turnPending([user, step, tool, answer, meta], NOW)).toBe(false);
    expect(turnPending([], NOW)).toBe(false);
    expect(turnPending(undefined, NOW)).toBe(false);
  });

  it('gives up on a turn nothing has touched for the window', () => {
    expect(turnPending([{ ...user, timestamp: NOW - CHAT_WINDOW_S - 1 }], NOW)).toBe(false);
  });
});

describe('leaving a chat mid-reply', () => {
  it('picks what to do with the mood', () => {
    expect(leaveAction({ runTracked: true, replying: true })).toBe('hold');
    expect(leaveAction({ runTracked: false, replying: true })).toBe('adopt');
    expect(leaveAction({ runTracked: false, replying: false })).toBe('idle');
  });

  /** The phone's real pieces, as ChatView wires them: LiveRuns for a run it started, the watch for the rest. */
  function phone() {
    const activity = new ActivityStore();
    let status = 'running';
    const liveRuns = new LiveRuns({
      check: async (): Promise<RunInfo> => ({ status }),
      save: () => undefined,
      setMood: (b, m) => activity.set(b, m),
      now: () => NOW * 1000,
    });
    return { activity, liveRuns, finishRun: () => (status = 'completed') };
  }

  it('a run Hermes is tracking stays working through the back-out and shows done only when Hermes says it ended', async () => {
    const p = phone();
    p.liveRuns.start('chief', 'chat1', 'run1');
    p.activity.set('chief', 'thinking'); // the open chat streaming

    // Back out: ChatView detaches the stream and applies leaveAction → 'hold'.
    p.liveRuns.detach('chat1');
    if (leaveAction({ runTracked: p.liveRuns.botBusy('chief'), replying: true }) === 'hold') p.activity.set('chief', 'working');
    expect(p.activity.get('chief')).toBe('working');

    await p.liveRuns.poll(); // Hermes: still running
    await p.liveRuns.poll();
    expect(p.activity.get('chief')).toBe('working'); // no done flash

    p.finishRun();
    await p.liveRuns.poll(); // Hermes: completed
    expect(p.activity.get('chief')).toBe('done');
    expect(p.liveRuns.botBusy('chief')).toBe(false);
  });

  it("backing out before Hermes has a run id keeps working, then shows done when the chat's reply lands", async () => {
    const w = setup({ chief: [] });
    w.activity.set('chief', 'thinking');
    expect(leaveAction({ runTracked: false, replying: true })).toBe('adopt');
    w.watch.adopt('chief');
    expect(w.activity.get('chief')).toBe('working');

    // Hermes has saved the user's message, no answer yet
    w.rows.chief = [row({ id: 'dork-bot-chief', source: 'api_server', messageCount: 1, lastActive: NOW })];
    w.waiting['dork-bot-chief'] = true;
    await w.watch.tick();
    w.advance(ADOPT_GRACE_MS / 1000 + 5); // longer than the grace: only Hermes' word keeps it going now
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('working');

    w.rows.chief = [row({ id: 'dork-bot-chief', source: 'api_server', messageCount: 2, lastActive: NOW + 40 })];
    w.waiting['dork-bot-chief'] = false; // the answer is saved
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('done');
  });

  it('while Hermes has not shown the reply yet the grace holds working; if it never shows, back to idle with no done', async () => {
    const w = setup({ chief: [] });
    w.activity.set('chief', 'thinking');
    w.watch.adopt('chief');
    await w.watch.tick(); // nothing on Hermes yet
    expect(w.activity.get('chief')).toBe('working');
    w.advance(ADOPT_GRACE_MS / 1000 + 1);
    await w.watch.tick(); // never appeared: the message never reached Hermes
    expect(w.activity.get('chief')).toBe('idle');
  });
});

describe('ActivityStore done', () => {
  it('shows done after a busy mood ends, but clear() drops back to idle without it', () => {
    const a = new ActivityStore();
    a.set('chief', 'working');
    a.set('chief', 'idle');
    expect(a.get('chief')).toBe('done');
    const b = new ActivityStore();
    b.set('chief', 'working');
    b.clear('chief');
    expect(b.get('chief')).toBe('idle');
  });
});

describe('several chats', () => {
  it("a newer quiet chat doesn't hide an older chat that is still replying", async () => {
    const w = setup({
      chief: [
        row({ id: 'quiet', source: 'api_server', messageCount: 8, lastActive: NOW - 2 }),
        row({ id: 'replying', source: 'api_server', messageCount: 1, lastActive: NOW - 30 }),
      ],
    });
    w.waiting.replying = true;
    await w.watch.tick();
    expect(w.activity.get('chief')).toBe('working');
    expect(w.calls.chat).toBe(2);
    await w.watch.tick(); // the quiet one is remembered; only the replying chat is read again
    expect(w.calls.chat).toBe(3);
  });
});

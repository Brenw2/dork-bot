import { describe, expect, it } from 'vitest';
import { chatReducer, chatRows, initialChat } from '../lib/chatState';
import { elapsedLabel, LiveRuns, type LiveRun } from '../lib/liveRuns';

function setup(statuses: Record<string, string[] | Error>) {
  const moods: string[] = [];
  const saves: Record<string, LiveRun>[] = [];
  const finished: string[] = [];
  const changed: string[] = [];
  let t = 1000;
  const runs = new LiveRuns({
    check: async (bot) => {
      const s = statuses[bot];
      if (s instanceof Error) throw s;
      const status = s.length > 1 ? s.shift()! : s[0];
      return status === 'waiting_for_approval'
        ? { status, approval: { requestId: 'rq1', command: 'rm -rf /tmp/x', description: 'recursive delete', choices: ['once', 'deny'] as const } as never }
        : { status };
    },
    save: (r) => void saves.push(r),
    setMood: (bot, mood) => void moods.push(`${bot}:${mood}`),
    now: () => (t += 1000),
  });
  runs.subscribe((chat, run) => void (run ? changed.push(chat) : finished.push(chat)));
  return { runs, moods, saves, finished, changed };
}

describe('LiveRuns', () => {
  it("doesn't poll a run the chat is streaming; stream finish clears it", async () => {
    const { runs, moods, finished, saves } = setup({ chief: ['running'] });
    runs.start('chief', 'c1', 'run_1');
    await runs.poll();
    expect(moods).toEqual([]);
    runs.finish('c1');
    expect(runs.get('c1')).toBeNull();
    expect(finished).toEqual(['c1']);
    expect(saves.at(-1)).toEqual({});
  });

  it('chief\'s case: chat left mid-reply → "working" until Hermes says completed, then done + reload', async () => {
    const { runs, moods, finished } = setup({ chief: ['running', 'running', 'completed'] });
    runs.start('chief', 'c1', 'run_1');
    runs.detach('c1'); // the chat screen closed; the run goes on on Hermes
    expect(moods).toEqual(['chief:working']);
    expect(runs.botBusy('chief')).toBe(true);
    await runs.poll();
    await runs.poll();
    expect(runs.get('c1')?.runId).toBe('run_1');
    expect(finished).toEqual([]);
    await runs.poll();
    expect(moods.at(-1)).toBe('chief:idle');
    expect(finished).toEqual(['c1']);
    expect(runs.get('c1')).toBeNull();
    expect(runs.botBusy('chief')).toBe(false);
  });

  it("keeps the run when Hermes can't be reached, and drops it when Hermes forgot it", async () => {
    const off = setup({ chief: new Error('offline') });
    off.runs.restore({ c1: { bot: 'chief', runId: 'run_1', startedAt: 5 } });
    await off.runs.poll();
    expect(off.runs.get('c1')).toEqual({ bot: 'chief', runId: 'run_1', startedAt: 5 });

    const gone = setup({ chief: ['gone'] });
    gone.runs.restore({ c1: { bot: 'chief', runId: 'run_1', startedAt: 5 } });
    await gone.runs.poll();
    expect(gone.runs.get('c1')).toBeNull();
    expect(gone.finished).toEqual(['c1']);
  });

  it("picks up runs saved per bot by older versions, as the bot's first chat", () => {
    const { runs } = setup({});
    runs.restore({ chief: { runId: 'run_1', startedAt: 5 } });
    expect(runs.get('dork-bot-chief')).toEqual({ bot: 'chief', runId: 'run_1', startedAt: 5 });
  });

  it('reports when a run nobody streams starts and stops waiting for an approval', async () => {
    const { runs, changed, finished } = setup({ chief: ['running', 'waiting_for_approval', 'waiting_for_approval', 'running', 'completed'] });
    runs.restore({ c1: { bot: 'chief', runId: 'r', startedAt: 1 } });
    await runs.poll();
    expect(changed).toEqual([]);
    await runs.poll();
    expect(changed).toEqual(['c1']);
    expect(runs.get('c1')?.approval).toMatchObject({ command: 'rm -rf /tmp/x' });
    await runs.poll(); // still waiting: no news
    expect(changed).toEqual(['c1']);
    await runs.poll();
    expect(changed).toEqual(['c1', 'c1']);
    expect(runs.get('c1')?.approval).toBeUndefined();
    await runs.poll();
    expect(finished).toEqual(['c1']);
  });

  it('every terminal status ends it; a re-start of the same run keeps its start time', async () => {
    for (const s of ['failed', 'cancelled', 'interrupted']) {
      const { runs, finished } = setup({ b: [s] });
      runs.restore({ c: { bot: 'b', runId: 'r', startedAt: 1 } });
      await runs.poll();
      expect(finished).toEqual(['c']);
    }
    const { runs } = setup({ b: ['running'] });
    runs.start('b', 'c', 'r');
    const t0 = runs.get('c')!.startedAt;
    runs.start('b', 'c', 'r');
    expect(runs.get('c')!.startedAt).toBe(t0);
  });

  it('restore ignores junk', () => {
    const { runs } = setup({});
    runs.restore(null);
    runs.restore({ x: { runId: '', startedAt: 1 } });
    expect(runs.get('x')).toBeNull();
  });
});

describe('chatReducer resume', () => {
  it('a reopened chat shows the bot still working, then the history replaces it', () => {
    let s = chatReducer(initialChat, { type: 'loaded', messages: [{ id: '1', role: 'user', content: 'any trello work?' }] });
    s = chatReducer(s, { type: 'resumed', runId: 'run_1' });
    expect(s.pending).toMatchObject({ resumed: true, thinking: true });
    expect(s.runId).toBe('run_1');
    expect(chatRows(s).at(-1)).toMatchObject({ kind: 'pending', text: '' });
    // a refresh while waiting keeps the indicator
    s = chatReducer(s, { type: 'loaded', messages: [...s.messages, { id: '2', role: 'tool', content: '', toolName: 'trello' }] });
    expect(s.pending?.resumed).toBe(true);
    // done: history has the answer; no duplicate from the partial reply
    s = chatReducer(s, { type: 'loaded', messages: [...s.messages, { id: '3', role: 'assistant', content: 'Two boards have work.' }] });
    s = chatReducer(s, { type: 'settled' });
    expect(s.pending).toBeNull();
    expect(s.messages.map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('a dropped stream keeps the partial reply', () => {
    let s = chatReducer(initialChat, { type: 'send', text: 'hi' });
    s = chatReducer(s, { type: 'event', event: { type: 'started', runId: 'r' } });
    s = chatReducer(s, { type: 'event', event: { type: 'delta', text: 'Yes, th' } });
    s = chatReducer(s, { type: 'resumed', runId: 'r' });
    expect(s.pending).toMatchObject({ text: 'Yes, th', resumed: true });
  });
});

describe('elapsedLabel', () => {
  it('formats', () => {
    expect(elapsedLabel(45_000)).toBe('45s');
    expect(elapsedLabel(65_000)).toBe('1m 05s');
    expect(elapsedLabel(-5)).toBe('0s');
  });
});

describe('LiveRuns needsYou (the bot list\'s "Needs you")', () => {
  it('shows within one poll of an approval arriving and clears once it is answered', async () => {
    const { runs } = setup({ chief: ['waiting_for_approval', 'waiting_for_approval', 'running'] });
    let heard = 0;
    runs.onApprovals(() => void heard++);
    runs.start('chief', 'c1', 'run_1');
    runs.detach('c1');
    expect(runs.needsYou('chief')).toBeNull();
    await runs.poll();
    expect(runs.needsYou('chief')?.command).toBe('rm -rf /tmp/x');
    expect(runs.needsYou('scout')).toBeNull();
    expect(heard).toBe(1);
    await runs.poll(); // same request: no new noise
    expect(heard).toBe(1);
    await runs.poll(); // answered, the run goes on
    expect(runs.needsYou('chief')).toBeNull();
    expect(heard).toBe(2);
  });

  it('hears an approval the open chat saw on its own stream, and clears when the run ends', () => {
    const { runs } = setup({ chief: ['running'] });
    let heard = 0;
    runs.onApprovals(() => void heard++);
    runs.start('chief', 'c1', 'run_1');
    runs.setApproval('c1', { command: 'ls', description: '', choices: ['once', 'deny'] });
    runs.setApproval('c1', { command: 'ls', description: '', choices: ['once', 'deny'] });
    expect(runs.needsYou('chief')?.command).toBe('ls');
    expect(heard).toBe(1);
    runs.finish('c1');
    expect(runs.needsYou('chief')).toBeNull();
    expect(heard).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { chatReducer, chatRows, initialChat } from '../lib/chatState';
import { elapsedLabel, LiveRuns, type LiveRun } from '../lib/liveRuns';

function setup(statuses: Record<string, string[] | Error>) {
  const moods: string[] = [];
  const saves: Record<string, LiveRun>[] = [];
  const finished: string[] = [];
  let t = 1000;
  const runs = new LiveRuns({
    check: async (bot) => {
      const s = statuses[bot];
      if (s instanceof Error) throw s;
      return s.length > 1 ? s.shift()! : s[0];
    },
    save: (r) => void saves.push(r),
    setMood: (bot, mood) => void moods.push(`${bot}:${mood}`),
    now: () => (t += 1000),
  });
  runs.subscribe((bot) => finished.push(bot));
  return { runs, moods, saves, finished };
}

describe('LiveRuns', () => {
  it("doesn't poll a run the chat is streaming; stream finish clears it", async () => {
    const { runs, moods, finished, saves } = setup({ chief: ['running'] });
    runs.start('chief', 'run_1');
    await runs.poll();
    expect(moods).toEqual([]);
    runs.finish('chief');
    expect(runs.get('chief')).toBeNull();
    expect(finished).toEqual(['chief']);
    expect(saves.at(-1)).toEqual({});
  });

  it('chief\'s case: chat left mid-reply → "working" until Hermes says completed, then done + reload', async () => {
    const { runs, moods, finished } = setup({ chief: ['running', 'running', 'completed'] });
    runs.start('chief', 'run_1');
    runs.detach('chief'); // the chat screen closed; the run goes on on Hermes
    expect(moods).toEqual(['chief:working']);
    await runs.poll();
    await runs.poll();
    expect(runs.get('chief')?.runId).toBe('run_1');
    expect(finished).toEqual([]);
    await runs.poll();
    expect(moods.at(-1)).toBe('chief:idle');
    expect(finished).toEqual(['chief']);
    expect(runs.get('chief')).toBeNull();
  });

  it("keeps the run when Hermes can't be reached, and drops it when Hermes forgot it", async () => {
    const off = setup({ chief: new Error('offline') });
    off.runs.restore({ chief: { runId: 'run_1', startedAt: 5 } });
    await off.runs.poll();
    expect(off.runs.get('chief')).toEqual({ runId: 'run_1', startedAt: 5 });

    const gone = setup({ chief: ['gone'] });
    gone.runs.restore({ chief: { runId: 'run_1', startedAt: 5 } });
    await gone.runs.poll();
    expect(gone.runs.get('chief')).toBeNull();
    expect(gone.finished).toEqual(['chief']);
  });

  it('every terminal status ends it; a re-start of the same run keeps its start time', async () => {
    for (const s of ['failed', 'cancelled', 'interrupted']) {
      const { runs, finished } = setup({ b: [s] });
      runs.restore({ b: { runId: 'r', startedAt: 1 } });
      await runs.poll();
      expect(finished).toEqual(['b']);
    }
    const { runs } = setup({ b: ['running'] });
    runs.start('b', 'r');
    const t0 = runs.get('b')!.startedAt;
    runs.start('b', 'r');
    expect(runs.get('b')!.startedAt).toBe(t0);
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

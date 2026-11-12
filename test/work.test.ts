import { describe, expect, it } from 'vitest';
import { STALE_S } from '@/lib/busy';
import { lastRoleOf, oneLine, OUTCOME_LIMIT, outcomeOf, runningWork, startedByLabel, toWorkSessions, WorkList, WorkSessionView, workStatus, workTitle } from '@/lib/work';

const NOW = 1_800_000_000;
const row = (o: Record<string, unknown>) => ({
  id: 'local-1',
  source: 'oneshot',
  title: 'Fix the thing',
  started_at: NOW - 60,
  ended_at: null,
  end_reason: null,
  last_active: NOW - 5,
  message_count: 3,
  preview: 'Please fix the thing',
  ...o,
});

describe('toWorkSessions: which sessions are Work', () => {
  it('keeps terminal runs and other non-app sessions, newest first', () => {
    const out = toWorkSessions(
      'mobile',
      [row({ id: 'a', started_at: NOW - 500 }), row({ id: 'b', source: 'cli', started_at: NOW - 100 }), row({ id: 'c', source: 'api_server', started_at: NOW - 300 })],
      NOW,
    );
    expect(out.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(out.map((s) => s.startedBy)).toEqual(['Terminal', 'Another app or bot', 'Terminal']);
  });

  it("leaves out the app's own chats, in any source", () => {
    const out = toWorkSessions(
      'mobile',
      [row({ id: 'dork-bot-mobile', source: 'api_server' }), row({ id: 'dork-bot-mobile--abc', source: 'dork-bot' }), row({ id: 'dork-bot-mobile--xyz', source: 'api_server' })],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('leaves out routine (cron) runs, so they are not duplicated from Routine results', () => {
    expect(toWorkSessions('mobile', [row({ id: 'cron_1', source: 'cron', title: 'daily · Nov 04 11:32' })], NOW)).toEqual([]);
  });

  it('leaves out empty, hidden, archived, internal and child sessions, and malformed rows', () => {
    const out = toWorkSessions(
      'mobile',
      [
        row({ id: 'empty', message_count: 0 }),
        row({ id: 'hidden', hidden: true }),
        row({ id: 'arch', archived: true }),
        row({ id: 'int', is_internal_child: true }),
        row({ id: 'child', parent_session_id: 'local-1' }),
        row({ id: '' }),
        null,
        'x',
        row({ id: 'ok' }),
      ],
      NOW,
    );
    expect(out.map((s) => s.id)).toEqual(['ok']);
    expect(toWorkSessions('mobile', undefined, NOW)).toEqual([]);
  });

  it('names a session by its title, else how the task starts, cut to a row', () => {
    expect(workTitle('  Fix it ', 'ignored')).toBe('Fix it');
    expect(workTitle(null, 'From Chief. [Image attached at: /x/y.png] Please\n do it')).toBe('From Chief. Please do it');
    expect(workTitle('', '')).toBe('Untitled work');
    const long = workTitle(null, 'word '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(70);
    expect(long.endsWith('…')).toBe(true);
  });

  it('says only what Hermes records about who started it', () => {
    expect(startedByLabel('oneshot')).toBe('Terminal');
    expect(startedByLabel('telegram')).toBe('Telegram');
    expect(startedByLabel('')).toBeNull();
  });
});

describe('workStatus', () => {
  const s = (o: Partial<{ endedAt: number | null; endReason: string | null; stale: boolean }>) => ({ endedAt: null, endReason: null, stale: false, ...o });
  it('is working until Hermes marks the session ended', () => {
    expect(workStatus(s({}), 'user')).toBe('working');
    expect(workStatus(s({}), 'assistant')).toBe('working'); // ended_at, not the last message, says it is over
  });
  it('is done once ended, failed when the end reason says it went wrong', () => {
    expect(workStatus(s({ endedAt: NOW, endReason: 'cli_close' }), 'assistant')).toBe('done');
    expect(workStatus(s({ endedAt: NOW, endReason: null }), 'assistant')).toBe('done');
    expect(workStatus(s({ endedAt: NOW, endReason: 'error: provider timeout' }), 'assistant')).toBe('failed');
    expect(workStatus(s({ endedAt: NOW, endReason: 'interrupted' }), 'user')).toBe('failed');
  });
  it('a session nobody ended and nothing touched: done if the bot had the last word, else failed', () => {
    expect(workStatus(s({ stale: true }), 'assistant')).toBe('done');
    expect(workStatus(s({ stale: true }), 'tool')).toBe('failed');
    expect(workStatus(s({ stale: true }), null)).toBe('failed');
    const [x] = toWorkSessions('m', [row({ last_active: NOW - STALE_S - 1 })], NOW);
    expect(x.stale).toBe(true);
    const [y] = toWorkSessions('m', [row({ last_active: NOW - STALE_S })], NOW);
    expect(y.stale).toBe(false);
  });
});

describe('outcomeOf', () => {
  const msgs = [
    { role: 'user', content: 'do it' },
    { role: 'assistant', content: 'Let me look.', tool_calls: [{}] },
    { role: 'tool', content: 'ok', tool_name: 'terminal' },
    { role: 'assistant', content: '**Done.** Fixed `foo`:\n\n```ts\nx\n```\nAll green.' },
    { role: 'session_meta', content: '' },
  ];
  it('is the last assistant message, on one line without markdown', () => {
    expect(outcomeOf(msgs)).toBe('Done. Fixed foo: x All green.');
    expect(lastRoleOf(msgs)).toBe('assistant');
  });
  it('skips assistant steps with no text, and is empty with no reply', () => {
    expect(outcomeOf([{ role: 'user', content: 'hi' }, { role: 'assistant', content: '  ', tool_calls: [{}] }])).toBe('');
    expect(outcomeOf(undefined)).toBe('');
    expect(outcomeOf([])).toBe('');
    expect(lastRoleOf([])).toBeNull();
  });
  it('cuts a long reply', () => {
    expect(oneLine('a'.repeat(300), 50)).toHaveLength(50);
    expect(oneLine('a'.repeat(300), 50).endsWith('…')).toBe(true);
  });
});

describe('WorkList', () => {
  function setup() {
    let rows: unknown[] = [];
    const history: Record<string, unknown[]> = {};
    const calls: string[] = [];
    const list = new WorkList('mobile', {
      sessions: async () => rows,
      messages: async (id) => {
        calls.push(id);
        return history[id] ?? [];
      },
      now: () => NOW * 1000,
    });
    return { list, calls, history, set: (r: unknown[]) => (rows = r) };
  }

  it('lists running then finished work with the outcome line', async () => {
    const t = setup();
    t.history.a = [{ role: 'user', content: 'go' }];
    t.set([row({ id: 'a' })]);
    expect(await t.list.load()).toMatchObject([{ id: 'a', status: 'working', outcome: '' }]);
    t.history.a = [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'All done here.' }];
    t.set([row({ id: 'a', message_count: 2, ended_at: NOW, end_reason: 'cli_close' })]);
    expect(await t.list.load()).toMatchObject([{ id: 'a', status: 'done', outcome: 'All done here.' }]);
  });

  it('asks for a history only when the session changed', async () => {
    const t = setup();
    t.set([row({ id: 'a' }), row({ id: 'b', started_at: NOW - 90 })]);
    await t.list.load();
    await t.list.load();
    expect(t.calls).toEqual(['a', 'b']);
    t.set([row({ id: 'a', message_count: 4 }), row({ id: 'b', started_at: NOW - 90 })]);
    await t.list.load();
    expect(t.calls).toEqual(['a', 'b', 'a']);
  });

  it('only reads the history of the newest sessions', async () => {
    const t = setup();
    t.set(Array.from({ length: OUTCOME_LIMIT + 5 }, (_, i) => row({ id: `s${i}`, started_at: NOW - i })));
    const items = await t.list.load();
    expect(items).toHaveLength(OUTCOME_LIMIT + 5);
    expect(t.calls).toHaveLength(OUTCOME_LIMIT);
  });

  it('still lists a session whose history could not be read', async () => {
    const list = new WorkList('mobile', {
      sessions: async () => [row({ id: 'a', ended_at: NOW })],
      messages: async () => {
        throw new Error('offline');
      },
      now: () => NOW * 1000,
    });
    expect(await list.load()).toMatchObject([{ id: 'a', status: 'done', outcome: '' }]);
  });

  it('finds the session that is running', async () => {
    const t = setup();
    t.set([row({ id: 'new', started_at: NOW - 10 }), row({ id: 'old', started_at: NOW - 900, ended_at: NOW - 800 })]);
    const items = await t.list.load();
    expect(runningWork(items)?.id).toBe('new');
    expect(runningWork(items.filter((i) => i.id === 'old'))).toBeNull();
  });
});

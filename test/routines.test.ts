import { describe, expect, it } from 'vitest';
import { HermesClient, type FetchLike, type FetchResponse } from '@/lib/hermes';
import { Routines, runsOf, scheduleLabel, toRoutine, whenLabel } from '@/lib/routines';

function res(status: number, body: unknown = {}): FetchResponse {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), body: null };
}

// GET /p/assistant/api/jobs on b-lab (2026-11-04), trimmed.
const JOB = {
  id: 'e9c3318a1531',
  name: 'daily_digest',
  prompt: 'Write my morning digest for today.',
  schedule: { kind: 'cron', expr: '0 8 * * *', display: '0 8 * * *' },
  schedule_display: '0 8 * * *',
  enabled: true,
  state: 'scheduled',
  next_run_at: '2026-11-05T08:00:00-05:00',
  last_run_at: '2026-11-04T11:32:07.868730-05:00',
  last_status: 'ok',
  last_error: null,
  deliver: 'local',
};

const CRON_SESSIONS = [
  { id: 'local-b0a6', source: 'cron', title: 'daily_digest · Nov 04 11:32', last_active: 1793809926.8 },
  { id: 'local-f4da', source: 'cron', title: 'test_job · Nov 04 11:30', last_active: 1793809835.9 },
  { id: 'local-9999', source: 'cron', title: 'daily_digest · Nov 03 08:00', last_active: 1793710000 },
  { id: 'local-8888', source: 'cron', title: 'daily_digest_v2 · Nov 03 08:00', last_active: 1793790000 },
];

describe('routines', () => {
  it('reads a Hermes job', () => {
    expect(toRoutine(JOB)).toEqual({
      id: 'e9c3318a1531',
      name: 'daily_digest',
      prompt: 'Write my morning digest for today.',
      schedule: '0 8 * * *',
      enabled: true,
      state: 'scheduled',
      nextRunAt: '2026-11-05T08:00:00-05:00',
      lastRunAt: '2026-11-04T11:32:07.868730-05:00',
      lastStatus: 'ok',
      lastError: null,
    });
    expect(toRoutine({ name: 'no id' })).toBeNull();
    expect(scheduleLabel('0 8 * * *')).toBe('Every morning at 8');
    expect(scheduleLabel('every 3h')).toBe('every 3h');
  });

  it("finds a routine's runs among the cron sessions, newest first", () => {
    expect(runsOf('daily_digest', CRON_SESSIONS).map((r) => r.sessionId)).toEqual(['local-b0a6', 'local-9999']);
  });

  it('labels run times', () => {
    // Local times, so it passes in any timezone (CI runs in UTC).
    const now = new Date(2026, 10, 4, 20, 0);
    expect(whenLabel(new Date(2026, 10, 5, 8, 0).toISOString(), now)).toMatch(/^Tomorrow 8:00/);
    expect(whenLabel(new Date(2026, 10, 4, 11, 32).toISOString(), now)).toMatch(/^Today 11:32/);
    expect(whenLabel(null)).toBe('');
  });

  it('adds, pauses, runs and deletes through the bot\'s API server, and reads the last result', async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ method, url, body: init.body });
      const p = new URL(url).pathname + new URL(url).search;
      if (p === '/p/assistant/api/jobs?include_disabled=true') return res(200, { jobs: [JOB] });
      if (p === '/p/assistant/api/jobs' && method === 'POST') {
        const b = JSON.parse(init.body!);
        if (b.schedule === 'whenever') return res(400, { error: "Invalid schedule 'whenever'" });
        return res(200, { job: { ...JOB, id: 'new1', name: b.name, prompt: b.prompt, schedule_display: b.schedule } });
      }
      if (p.startsWith('/p/assistant/api/sessions?source=cron')) return res(200, { data: CRON_SESSIONS });
      if (p === '/p/assistant/api/sessions/local-b0a6/messages')
        return res(200, { data: [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'MORNING DIGEST: nothing today.' }] });
      return res(200, { ok: true });
    };
    const r = new Routines(new HermesClient({ url: 'https://b-lab.test', bot: 'assistant', key: 'k'.repeat(40) }, fetch));
    expect((await r.list())[0].name).toBe('daily_digest');
    const added = await r.create({ name: ' Mets ', prompt: ' Check the Mets score ', schedule: '0 23 * * *' });
    expect(added).toMatchObject({ id: 'new1', name: 'Mets', schedule: '0 23 * * *' });
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ name: 'Mets', prompt: 'Check the Mets score', schedule: '0 23 * * *' });
    await expect(r.create({ name: 'x', prompt: 'y', schedule: 'whenever' })).rejects.toThrow(/Invalid schedule 'whenever'/);
    await expect(r.create({ name: '', prompt: 'y', schedule: '1h' })).rejects.toThrow(/name/);
    await r.pause('e9c3318a1531');
    await r.resume('e9c3318a1531');
    await r.runNow('e9c3318a1531');
    await r.remove('e9c3318a1531');
    expect(calls.slice(-4).map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /p/assistant/api/jobs/e9c3318a1531/pause',
      'POST /p/assistant/api/jobs/e9c3318a1531/resume',
      'POST /p/assistant/api/jobs/e9c3318a1531/run',
      'DELETE /p/assistant/api/jobs/e9c3318a1531',
    ]);
    const [last] = await r.runs('daily_digest', 1);
    expect(await r.result(last.sessionId)).toBe('MORNING DIGEST: nothing today.');
  });
});

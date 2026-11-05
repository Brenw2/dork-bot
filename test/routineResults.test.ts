import { describe, expect, it } from 'vitest';
import { HermesClient, type FetchLike, type FetchResponse } from '@/lib/hermes';
import { isSilent, RoutineResults, routineNameOf } from '@/lib/routineResults';

function res(status: number, body: unknown = {}): FetchResponse {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), body: null };
}

const SESSIONS = [
  { id: 'a', source: 'cron', title: 'daily_digest · Nov 04 08:00', last_active: 1000 },
  { id: 'b', source: 'cron', title: 'quiet_check · Nov 04 09:00', last_active: 2000 },
  { id: 'c', source: 'cron', title: 'daily_digest · Nov 05 08:00', last_active: 3000 },
  { id: 'd', source: 'cron', title: 'empty_one · Nov 05 09:00', last_active: 4000 },
];
const REPLIES: Record<string, string[]> = {
  a: ['Digest 1\n\nAll the details, not cut short.'],
  b: ['[SILENT]'],
  c: ['working…', 'Digest 2, the full text.'],
  d: [''],
};

function client(sessions: object[] = SESSIONS): HermesClient {
  const fetchLike: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/api/sessions')) return res(200, { data: sessions });
    const id = /sessions\/([^/]+)\/messages/.exec(path)?.[1] ?? '';
    return res(200, { data: (REPLIES[id] ?? []).map((content, i) => ({ id: i + 1, role: 'assistant', content, timestamp: 1 })) });
  };
  return new HermesClient({ url: 'https://h.example', bot: 'chief', key: 'k'.repeat(64) }, fetchLike);
}

describe('Routine results chat', () => {
  it("names a run's routine from its title", () => {
    expect(routineNameOf('daily_digest · Nov 04 11:32')).toBe('daily_digest');
    expect(routineNameOf('News · Tech · Nov 04 11:32')).toBe('News · Tech');
    expect(routineNameOf('plain')).toBe('plain');
    expect(routineNameOf(undefined)).toBe('Routine');
  });

  it('empty and [SILENT] runs make no entry', () => {
    expect(isSilent('')).toBe(true);
    expect(isSilent('  [SILENT] ')).toBe(true);
    expect(isSilent('[SILENT] but more')).toBe(false);
  });

  it("lists each run's full final reply, oldest first so the newest is at the bottom, with name and time", async () => {
    const out = await new RoutineResults(client()).load();
    expect(out).toEqual([
      { sessionId: 'a', name: 'daily_digest', at: 1000, text: 'Digest 1\n\nAll the details, not cut short.' },
      { sessionId: 'c', name: 'daily_digest', at: 3000, text: 'Digest 2, the full text.' },
    ]);
  });

  it('keeps only the latest runs when there are many', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, title: `job · t${i}`, last_active: i + 1 }));
    for (let i = 0; i < 40; i++) REPLIES[`r${i}`] = [`out ${i}`];
    const out = await new RoutineResults(client(many)).load(5);
    expect(out.map((r) => r.text)).toEqual(['out 35', 'out 36', 'out 37', 'out 38', 'out 39']);
  });

  it('says so when Hermes will not list the runs', async () => {
    const bad = new HermesClient({ url: 'https://h.example', bot: 'chief', key: 'k'.repeat(64) }, async () => res(500));
    await expect(new RoutineResults(bad).load()).rejects.toThrow(/routine results/);
  });
});

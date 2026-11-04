// Live: leave a chat mid-reply, then pick the reply up again the way the app does (lib/liveRuns.ts
// polling GET /v1/runs/<id>). Skipped unless DORK_LIVE=1.
//   DORK_LIVE=1 npx vitest run test/live-resume.test.ts --silent=false
// Uses a throwaway chat on the assistant bot (Dork) and deletes it after.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { LiveRuns } from '@/lib/liveRuns';

const live = process.env.DORK_LIVE === '1';
const bot = process.env.DORK_BOT ?? 'assistant';
const url = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';

describe.skipIf(!live)(`live resume: ${bot} at ${url}`, () => {
  it('a reply keeps running after the app hangs up, and the app sees it finish', async () => {
    const key = readFileSync(join(homedir(), '.hermes', 'profiles', bot, '.env'), 'utf8').match(/^API_SERVER_KEY=["']?([^"'\n]+)/m)?.[1] ?? '';
    const client = new HermesClient({ url, bot, key }, fetch as unknown as FetchLike);
    const id = `dork-bot-live-resume-${Date.now()}`;
    const moods: string[] = [];
    const runs = new LiveRuns({
      check: (_b, runId) => client.runStatus(runId),
      save: () => undefined,
      setMood: (_b, m) => void moods.push(m),
      now: () => Date.now(),
    });
    const finished = new Promise<number>((ok) => runs.subscribe(() => ok(Date.now())));
    try {
      await client.ensureSession(id, `live resume ${id.slice(-6)}`);
      const t0 = Date.now();
      // Like the chat screen: stream until run.started, then hang up (screen left / app backgrounded).
      const abort = new AbortController();
      await client
        .chat(id, 'Reply with exactly: resumed ok', (e) => {
          if (e.type === 'started') {
            runs.start(bot, e.runId);
            abort.abort();
          }
        }, abort.signal)
        .catch(() => undefined);
      runs.detach(bot);
      const run = runs.get(bot);
      expect(run?.runId).toMatch(/^run_/);
      console.log(`hung up ${Date.now() - t0} ms after sending; run ${run?.runId}`);

      const poller = setInterval(() => void runs.poll(), 2000);
      const doneAt = await Promise.race([finished, new Promise<number>((_, no) => setTimeout(() => no(new Error('never finished')), 240_000))]);
      clearInterval(poller);
      console.log(`finish seen ${doneAt - t0} ms after sending; moods: ${[...new Set(moods)].join(' → ')}`);
      expect(moods[0]).toBe('working');
      expect(moods.at(-1)).toBe('idle');

      const last = (await client.messages(id)).at(-1);
      console.log(`history ends with ${last?.role}: ${JSON.stringify(last?.content)}`);
      expect(last?.role).toBe('assistant');
      expect(last?.content.toLowerCase()).toContain('resumed ok');
    } finally {
      const res = await fetch(`${url}/p/${bot}/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } });
      console.log(`deleted chat: HTTP ${res.status}`);
    }
  }, 300_000);
});

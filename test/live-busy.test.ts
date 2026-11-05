// Live: run `hermes -p <bot> chat -q` from a terminal and watch the bot go working, then idle.
//   DORK_LIVE=1 npx vitest run test/live-busy.test.ts --silent=false
// (DORK_BOT=assistant by default, DORK_HERMES_URL=http://127.0.0.1:8642). Skipped otherwise.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActivityStore } from '@/lib/activity';
import { BusyWatch } from '@/lib/busy';
import { awaitingReply } from '@/lib/chatState';
import { HermesClient, type FetchLike } from '@/lib/hermes';

const live = process.env.DORK_LIVE === '1';
const bot = process.env.DORK_BOT ?? 'assistant';
const url = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const POLL_MS = 5000; // components/busyWatch.ts

describe.skipIf(!live)(`live busy: ${bot} at ${url}`, () => {
  it('flips to working while a terminal chat runs, and back to idle within 10 s of it finishing', async () => {
    const key = readFileSync(join(homedir(), '.hermes', 'profiles', bot, '.env'), 'utf8').match(/^API_SERVER_KEY=["']?([^"'\n]+)/m)?.[1] ?? '';
    const client = new HermesClient({ url, bot, key }, fetch as unknown as FetchLike);
    const activity = new ActivityStore();
    const watch = new BusyWatch({
      bots: async () => [bot],
      sessions: (b) => (b === bot ? client.recentSessions() : Promise.resolve([])),
      chatWaiting: async (_b, id) => awaitingReply(await client.messages(id), Date.now() / 1000) !== null,
      getMood: (b) => activity.get(b),
      setMood: (b, m) => activity.set(b, m),
      heldHere: () => false,
      now: () => Date.now(),
    });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await watch.tick();
    expect(activity.get(bot)).toBe('idle');

    const t0 = Date.now();
    let exitedAt = 0;
    const child = spawn('hermes', ['-p', bot, 'chat', '-q', 'Write a 250-word story about a lighthouse keeper. No tools.'], { stdio: 'ignore' });
    child.on('exit', () => (exitedAt = Date.now()));

    let workingAt = 0;
    let idleAt = 0;
    while (Date.now() - t0 < 140_000 && !idleAt) {
      await sleep(POLL_MS);
      await watch.tick();
      const mood = activity.get(bot);
      if (!workingAt && mood === 'working') workingAt = Date.now();
      if (workingAt && !idleAt && !watch.isBusy(bot)) idleAt = Date.now();
    }
    console.log(`working after ${workingAt ? workingAt - t0 : 'never'} ms; CLI exited at ${exitedAt ? exitedAt - t0 : 'never'} ms; not busy at ${idleAt ? idleAt - t0 : 'never'} ms (${idleAt && exitedAt ? idleAt - exitedAt : '?'} ms after exit)`);
    expect(workingAt).toBeGreaterThan(0);
    expect(exitedAt).toBeGreaterThan(0);
    expect(idleAt - exitedAt).toBeLessThanOrEqual(10_000);
  }, 180_000);
});

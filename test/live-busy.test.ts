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
      chatWaiting: (_b, id) => client.turnPending(id),
      getMood: (b) => activity.get(b),
      setMood: (b, m) => activity.set(b, m),
      clearMood: (b) => activity.clear(b),
      heldHere: () => false,
      now: () => Date.now(),
    });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await watch.tick();
    // (a real chat with this bot may be mid-reply right now, which is correct: only the flip below is asserted)

    const t0 = Date.now();
    let exitedAt = 0;
    const child = spawn('hermes', ['-p', bot, 'chat', '-q', 'Write a 250-word story about a lighthouse keeper. No tools.'], { stdio: 'ignore' });
    child.on('exit', () => (exitedAt = Date.now()));

    let workingAt = activity.get(bot) === 'working' ? Date.now() : 0;
    let idleAt = 0;
    while (Date.now() - t0 < 140_000 && !idleAt) {
      await sleep(POLL_MS);
      await watch.tick();
      const mood = activity.get(bot);
      if (!workingAt && mood === 'working') workingAt = Date.now();
      if (workingAt && !idleAt && exitedAt && !watch.isBusy(bot)) idleAt = Date.now();
    }
    console.log(`working after ${workingAt ? workingAt - t0 : 'never'} ms; CLI exited at ${exitedAt ? exitedAt - t0 : 'never'} ms; not busy at ${idleAt ? idleAt - t0 : 'never'} ms (${idleAt && exitedAt ? idleAt - exitedAt : '?'} ms after exit)`);
    expect(workingAt).toBeGreaterThan(0);
    expect(exitedAt).toBeGreaterThan(0);
    expect(idleAt - exitedAt).toBeLessThanOrEqual(10_000);
  }, 180_000);

  it('a reply left running in an app chat (back out right after sending) stays working, then done only when the answer is saved', async () => {
    const key = readFileSync(join(homedir(), '.hermes', 'profiles', bot, '.env'), 'utf8').match(/^API_SERVER_KEY=["']?([^"'\n]+)/m)?.[1] ?? '';
    const client = new HermesClient({ url, bot, key }, fetch as unknown as FetchLike);
    const activity = new ActivityStore();
    const watch = new BusyWatch({
      bots: async () => [bot],
      sessions: () => client.recentSessions(),
      chatWaiting: (_b, id) => client.turnPending(id),
      getMood: (b) => activity.get(b),
      setMood: (b, m) => activity.set(b, m),
      clearMood: (b) => activity.clear(b),
      heldHere: () => false,
      now: () => Date.now(),
    });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const id = `dork-bot-live-busy-${Date.now()}`;
    await client.ensureSession(id, 'Dork Bot busy test');

    // Send, then hang up as soon as the run starts: Hermes keeps replying (the "back out" case).
    const abort = new AbortController();
    activity.set(bot, 'thinking');
    const sent = client
      .chat(id, 'Write a 250-word story about a lighthouse keeper. No tools.', (e) => e.type === 'started' && abort.abort(), abort.signal)
      .catch(() => undefined);
    await sent;
    watch.adopt(bot);
    expect(activity.get(bot)).toBe('working');

    const t0 = Date.now();
    const seen: string[] = [];
    let doneAt = 0;
    while (Date.now() - t0 < 150_000 && !doneAt) {
      await sleep(POLL_MS);
      await watch.tick();
      const mood = activity.get(bot);
      if (seen.at(-1) !== mood) seen.push(mood);
      if (mood === 'done' || mood === 'idle') doneAt = Date.now();
    }
    const saved = await client.messages(id);
    console.log(`moods ${seen.join(' > ')}; ended ${doneAt - t0} ms after hang-up; last saved message: ${saved.at(-1)?.role}`);
    expect(seen[0]).toBe('working');
    expect(saved.at(-1)?.role).toBe('assistant'); // done really meant the answer was saved
    await client.deleteChat(id).catch(() => undefined);
  }, 180_000);
});

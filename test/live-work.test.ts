// Live: card 20. Creates a throwaway bot, runs `hermes -p <bot> chat -q` from a terminal, and checks the
// bot's Work list (lib/work.ts) shows it working, then done with an outcome line, while an app chat
// with the same bot never shows in Work. Deletes the bot afterwards.
//   DORK_LIVE=1 npx vitest run test/live-work.test.ts --silent=false
// Also checks the push: the repo's plugin is copied into the throwaway's own profile only (never a real
// bot), pointed at a fake Expo server on loopback; exactly one push must arrive, opening that session.
// And a cron run (`hermes cron run` + `tick`) must stay out of Work and send no work push.
// Needs scripts/setup-bot-manager.sh to have run (same as live-manager.test.ts).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';
import { runningWork, workingOnLine, WorkList, WorkSessionView } from '@/lib/work';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
const chatUrl = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const f = fetch as unknown as FetchLike;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(): Promise<string> {
  const text = readFileSync(join(homedir(), '.config', 'dork-bot', 'serve.env'), 'utf8');
  const env = Object.fromEntries(text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const res = await fetch(`${adminUrl}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'basic', username: env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME, password: env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD }),
  });
  expect(res.status).toBe(200);
  const raw = res.headers.getSetCookie().find((c) => c.includes('hermes_session_rt='))?.split(';')[0].split('=').slice(1).join('=') ?? '';
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
}

/** A fake Expo push server on loopback. `got` holds every message posted to it. */
async function fakeExpo() {
  const got: any[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msgs = JSON.parse(body || '[]');
      got.push(...msgs);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: msgs.map(() => ({ status: 'ok', id: 'x' })) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { got, endpoint: `http://127.0.0.1:${port}/push`, close: () => server.close() };
}

/** The shell's env without the HERMES_* session variables of whatever agent started this run. */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERMES_'))) as NodeJS.ProcessEnv;
}

function run(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve) => {
    const c = spawn('hermes', args, { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    const t = setTimeout(() => c.kill(), timeoutMs);
    c.on('exit', () => (clearTimeout(t), resolve(out)));
  });
}

describe.skipIf(!live)(`live work: throwaway bot on ${chatUrl}`, () => {
  it('a terminal run shows in Work while it runs, then done with its outcome; app chats stay out', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f, () => undefined);
    const name = `dbt-work-${Date.now().toString(36)}`;
    const conn = await m.createBot({ name, job: 'Answers test questions in one short sentence.' }, () => randomBytes(32).toString('hex'));
    const expo = await fakeExpo();
    try {
      // The repo's push plugin (with the Work push), for this throwaway only, pointed at the fake Expo.
      const dir = join(homedir(), '.hermes', 'profiles', name);
      cpSync(join(process.cwd(), 'hermes-plugin', 'dork-bot-push'), join(dir, 'plugins', 'dork-bot-push'), { recursive: true });
      const put = await m.api(`/api/config?profile=${encodeURIComponent(name)}`, 'PUT', {
        config: {
          plugins: { enabled: ['dork-bot-push'] },
          dork_bot: { name, push: { tokens: ['ExponentPushToken[live-work-test]'], endpoint: expo.endpoint } },
        },
      });
      expect(put.ok).toBe(true);
      const client = new HermesClient(conn, f);
      // An app chat first: it must never appear in Work.
      const chatId = `dork-bot-${name}`;
      await client.ensureSession(chatId, name);
      await client.chat(chatId, 'Say hi in two words.', () => undefined);

      const list = new WorkList(name, { sessions: () => client.sessionRows(), messages: (id) => client.rawMessages(id), now: () => Date.now() });
      expect(await list.load()).toEqual([]);

      const t0 = Date.now();
      let exitedAt = 0;
      const child = spawn('hermes', ['-p', name, 'chat', '-q', 'Reply with exactly one sentence about lighthouses. No tools.'], { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
      let cliOut = '';
      child.stdout.on('data', (d) => (cliOut += d));
      child.stderr.on('data', (d) => (cliOut += d));
      child.on('exit', () => (exitedAt = Date.now()));

      let workingAt = 0;
      let doneAt = 0;
      let id = '';
      let view: WorkSessionView | null = null;
      let sawLive = false;
      let header = '';
      while (Date.now() - t0 < 120_000 && !doneAt) {
        await sleep(2000);
        if (exitedAt && !workingAt && Date.now() - exitedAt > 6000) break; // it never showed: stop early
        const items = await list.load();
        const running = runningWork(items);
        if (running && !workingAt) {
          workingAt = Date.now();
          id = running.id;
          view = new WorkSessionView(name, { row: () => client.sessionRow(id), messages: () => client.rawMessages(id), now: () => Date.now() });
          const got = await view.load();
          sawLive = got?.item.status === 'working' && got.raw.length > 0;
          header = workingOnLine(running.title);
        }
        const mine = items.find((i) => i.id === id);
        if (mine && mine.status !== 'working') doneAt = Date.now();
      }
      const items = await list.load();
      const item = items.find((i) => i.id === id);
      console.log(
        `work list: working after ${workingAt ? workingAt - t0 : 'never'} ms (title ${JSON.stringify(item?.title)}, source ${item?.source}, startedBy ${item?.startedBy}); ` +
          `CLI exited at ${exitedAt ? exitedAt - t0 : 'never'} ms; list says ${item?.status} at ${doneAt ? doneAt - t0 : 'never'} ms; ` +
          `outcome ${JSON.stringify(item?.outcome)}; session view live while running: ${sawLive}; items ${items.length} (app chat excluded: ${!items.some((i) => i.id === chatId)})`,
      );
      await sleep(3000); // let the push land
      if (!workingAt) console.log(`CLI output: ${cliOut.slice(-600)}`);
      const pushes = expo.got.filter((p) => p.data?.kind === 'work');
      console.log(`header: ${JSON.stringify(header)}; pushes to fake Expo: ${expo.got.length} ${JSON.stringify(expo.got.map((p) => ({ title: p.title, body: p.body, data: p.data })))}`);
      expect(header).toMatch(/^Working on: .+/);
      expect(sawLive).toBe(true);
      // The push needs the bot's gateway to have loaded plugin 0.3.0 (`hermes chat -q` runs its turn in the gateway,
      // so a copy in the profile alone is not enough). DORK_LIVE_PUSH=1 once it is installed there.
      if (process.env.DORK_LIVE_PUSH === '1') {
        expect(pushes.length).toBe(1);
        expect(pushes[0].data.session).toBe(id);
        expect(pushes[0].data.bot).toBe(name);
      } else {
        console.log(`work pushes seen: ${pushes.length} (not asserted without DORK_LIVE_PUSH=1)`);
      }

      // A cron run: a job made and run now must not show in Work and must send no work push.
      const made = await run(['-p', name, 'cron', 'create', '30m', 'Reply with the single word ok. No tools.', '--name', 'live-work-cron', '--deliver', 'local', '--repeat', '1']);
      const jobId = made.match(/\b([0-9a-f]{12})\b/)?.[1] ?? '';
      console.log(`cron create: ${made.replace(/\s+/g, ' ').slice(0, 200)} (job ${jobId})`);
      expect(jobId).not.toBe('');
      const before = (await list.load()).map((i) => i.id).sort();
      console.log(`cron run: ${(await run(['-p', name, 'cron', 'run', jobId])).replace(/\s+/g, ' ').slice(0, 120)}`);
      console.log(`cron tick: ${(await run(['-p', name, 'cron', 'tick'], 150_000)).replace(/\s+/g, ' ').slice(0, 200)}`);
      await sleep(3000);
      const rows = await client.sessionRows();
      const after = (await list.load()).map((i) => i.id).sort();
      console.log(`sessions after cron: ${JSON.stringify((rows as any[]).map((r) => `${r.id}:${r.source}`))}; Work before ${before.length}, after ${after.length}; pushes now ${expo.got.length}`);
      expect(after).toEqual(before);
      expect(expo.got.filter((p) => p.data?.kind === 'work').length).toBe(pushes.length);
      expect(workingAt).toBeGreaterThan(0);
      expect(item?.status).toBe('done');
      expect(item?.outcome.length).toBeGreaterThan(0);
      expect(items.some((i) => i.id === chatId)).toBe(false);
      const final = await view!.load();
      expect(final?.item.status).toBe('done');
    } finally {
      expo.close();
      await m.deleteBot(name);
    }
    expect((await m.listProfiles()).map((p) => p.name)).not.toContain(name);
    console.log(`throwaway bot ${name} deleted`);
  }, 480_000);
});

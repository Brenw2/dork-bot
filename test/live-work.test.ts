// Live: card 20. Creates a throwaway bot, runs `hermes -p <bot> chat -q` from a terminal, and checks the
// bot's Work list (lib/work.ts) shows it working, then done with an outcome line, while an app chat
// with the same bot never shows in Work. Deletes the bot afterwards.
//   DORK_LIVE=1 npx vitest run test/live-work.test.ts --silent=false
// Needs scripts/setup-bot-manager.sh to have run (same as live-manager.test.ts).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';
import { runningWork, WorkList, WorkSessionView } from '@/lib/work';

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

describe.skipIf(!live)(`live work: throwaway bot on ${chatUrl}`, () => {
  it('a terminal run shows in Work while it runs, then done with its outcome; app chats stay out', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f, () => undefined);
    const name = `dbt-work-${Date.now().toString(36)}`;
    const conn = await m.createBot({ name, job: 'Answers test questions in one short sentence.' }, () => randomBytes(32).toString('hex'));
    try {
      const client = new HermesClient(conn, f);
      // An app chat first: it must never appear in Work.
      const chatId = `dork-bot-${name}`;
      await client.ensureSession(chatId, name);
      await client.chat(chatId, 'Say hi in two words.', () => undefined);

      const list = new WorkList(name, { sessions: () => client.sessionRows(), messages: (id) => client.rawMessages(id), now: () => Date.now() });
      expect(await list.load()).toEqual([]);

      const t0 = Date.now();
      let exitedAt = 0;
      const child = spawn('hermes', ['-p', name, 'chat', '-q', 'Reply with exactly one sentence about lighthouses. No tools.'], { stdio: 'ignore' });
      child.on('exit', () => (exitedAt = Date.now()));

      let workingAt = 0;
      let doneAt = 0;
      let id = '';
      let view: WorkSessionView | null = null;
      let sawLive = false;
      while (Date.now() - t0 < 120_000 && !doneAt) {
        await sleep(2000);
        const items = await list.load();
        const running = runningWork(items);
        if (running && !workingAt) {
          workingAt = Date.now();
          id = running.id;
          view = new WorkSessionView(name, { row: () => client.sessionRow(id), messages: () => client.rawMessages(id), now: () => Date.now() });
          const got = await view.load();
          sawLive = got?.item.status === 'working' && got.raw.length > 0;
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
      expect(workingAt).toBeGreaterThan(0);
      expect(item?.status).toBe('done');
      expect(item?.outcome.length).toBeGreaterThan(0);
      expect(items.some((i) => i.id === chatId)).toBe(false);
      const final = await view!.load();
      expect(final?.item.status).toBe('done');
    } finally {
      await m.deleteBot(name);
    }
    expect((await m.listProfiles()).map((p) => p.name)).not.toContain(name);
    console.log(`throwaway bot ${name} deleted`);
  }, 240_000);
});

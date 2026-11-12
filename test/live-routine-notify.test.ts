// Live test of "Notify me" on a routine, against the real Hermes on b-lab. Skipped unless DORK_LIVE=1.
//   DORK_LIVE=1 npx vitest run test/live-routine-notify.test.ts --silent=false
// It makes a throwaway bot, puts the dork-bot-push plugin in THAT bot's profile only (the real bots are
// not touched), points its pushes at a fake Expo server on this machine, and runs three routines with
// "Run now": one marked, one not, one marked that answers [SILENT]. It checks what lands in the bot's
// chat (as the phone and the desktop read it), the push, and that the bot took no turn. Then it
// deletes the bot.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChat } from '@/lib/chatState';
import { HermesClient, type ChatMessage, type FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';
import { notifyOn, parsePushData, routeFor, setNotify } from '@/lib/push';
import { Routines } from '@/lib/routines';
import { parseRoutineNote } from '@/lib/routineNotes';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
const chatUrl = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const f = fetch as unknown as FetchLike;
const randomKey = () => randomBytes(32).toString('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'ExponentPushToken[live-test-phone]';

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

/** Expo's push API, on this machine: records what the plugin sends. */
async function fakeExpo() {
  const received: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msgs = JSON.parse(body) as Record<string, unknown>[];
      received.push(...msgs);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: msgs.map((_, i) => ({ status: 'ok', id: `t${i}` })) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { received, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => server.close() };
}

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 360_000, every = 3_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

const show = (m: ChatMessage[]) => m.map((x) => `${x.routine ? 'ROUTINE-CARD' : x.role}: ${x.content.slice(0, 60).replace(/\n/g, ' ')}`).join(' | ');

describe.skipIf(!live)(`live: Notify me on a routine (${chatUrl})`, () => {
  it('marked: output in the chat + push, no bot turn; unmarked and [SILENT]: nothing; the switch shows on a second device', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f);
    const m2 = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f); // the second device
    const expo = await fakeExpo();
    const name = `dbt-notify-${Date.now().toString(36)}`;
    const chatId = `dork-bot-${name}`;
    const conn = await m.createBot({ name, job: 'Throwaway bot for the Notify me test.' }, randomKey);
    const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
    try {
      const install = spawnSync('scripts/install-push-plugin.sh', [name], { encoding: 'utf8' });
      log(`plugin install (throwaway profile only): ${install.stdout.trim().split('\n').pop()}`);
      expect(install.status).toBe(0);
      // A new bot is cloned with the plugin already enabled (the global 0.1.0 copy), and the gateway may have loaded
      // that already. Disable + enable makes it rescan, so THIS profile's copy (the one under test) is what runs.
      const env = { ...process.env, HERMES_HOME: undefined } as NodeJS.ProcessEnv;
      delete env.HERMES_HOME;
      for (const args of [['disable', 'dork-bot-push'], ['enable', 'dork-bot-push', '--no-allow-tool-override']]) {
        expect(spawnSync('hermes', ['-p', name, 'plugins', ...args], { encoding: 'utf8', env }).status).toBe(0);
      }
      log(`plugins list: ${spawnSync('hermes', ['-p', name, 'plugins', 'list', '--plain'], { encoding: 'utf8', env }).stdout.split('\n').filter((l) => l.includes('dork')).join('')}`);
      await sleep(5_000);

      const client = new HermesClient(conn, f); // "the phone"
      const desktop = new HermesClient(conn, f); // "the desktop": same Hermes, its own reads
      const routines = new Routines(client);
      const deps = { getPush: async (b: string) => (await m.getMeta(b)).push, setPush: (b: string, push: object) => m.setMeta(b, { push }) };

      // Push goes to a fake phone through the loopback test endpoint (settings_from_config allows only this machine).
      await m.setMeta(name, { push: { tokens: [TOKEN], endpoint: expo.url } as object });

      // The bot's chat, so there is one to put the result in.
      let st = initialChat;
      await client.ensureSession(chatId);
      await client.chat(chatId, 'Say hello in three words.', (event) => (st = chatReducer(st, { type: 'event', event })));
      const before = await client.messages(chatId);
      log(`chat before: ${show(before)}`);
      expect(before.at(-1)?.role).toBe('assistant');
      await sleep(5_000);
      const chatPushes = expo.received.length; // the bot's own reply pushes as usual (kind: reply)
      log(`pushes from the chat turn itself: ${JSON.stringify(expo.received.map((p) => (p.data as { kind: string }).kind))}`);

      const far = 'every 24h'; // repeating, so Run now works more than once
      const marked = await routines.create({ name: 'Marked digest', prompt: 'Reply with exactly this text and nothing else: LIVE-MARKED-OK', schedule: far });
      const plain = await routines.create({ name: 'Plain digest', prompt: 'Reply with exactly this text and nothing else: LIVE-UNMARKED-OK', schedule: far });
      const quiet = await routines.create({ name: 'Quiet digest', prompt: 'Reply with exactly this text and nothing else: [SILENT]', schedule: far });

      // Off by default, for every routine, on both devices.
      expect([marked, plain, quiet].map((r) => notifyOn(undefined, r.id))).toEqual([false, false, false]);
      expect((await m.getMeta(name)).push?.routines ?? []).toEqual([]);
      await setNotify(deps, name, marked.id, true);
      await setNotify(deps, name, quiet.id, true);
      const second = (await m2.getMeta(name)).push;
      log(`second device reads dork_bot.push.routines = ${JSON.stringify(second?.routines)}`);
      expect(notifyOn(second, marked.id)).toBe(true);
      expect(notifyOn(second, quiet.id)).toBe(true);
      expect(notifyOn(second, plain.id)).toBe(false);
      expect(second?.tokens).toEqual([TOKEN]); // the phone's token is untouched

      const runOf = async (r: { name: string }, since: number) =>
        until(`${r.name} to finish`, async () => {
          const [run] = (await routines.runs(r.name, 1)).filter((x) => x.at >= since);
          if (!run) return null;
          const text = await routines.result(run.sessionId);
          return text ? { ...run, text } : null;
        });

      // 1. Unmarked: runs, shows in Routine results, but no push and nothing in the chat.
      let t0 = Date.now() / 1000 - 5;
      await routines.runNow(plain.id);
      const plainRun = await runOf(plain, t0);
      log(`UNMARKED ran: "${plainRun.text.slice(0, 40)}" (Routine results has it)`);
      await sleep(20_000);
      expect(expo.received).toHaveLength(chatPushes);
      expect(await client.messages(chatId)).toHaveLength(before.length);

      // 2. Marked but [SILENT]: nothing.
      t0 = Date.now() / 1000 - 5;
      await routines.runNow(quiet.id);
      const quietRun = await runOf(quiet, t0);
      log(`SILENT ran: "${quietRun.text.slice(0, 40)}"`);
      await sleep(20_000);
      if (quietRun.text.trim() === '[SILENT]') {
        expect(expo.received).toHaveLength(chatPushes);
        expect(await client.messages(chatId)).toHaveLength(before.length);
      } else {
        log('(the model did not answer exactly [SILENT]; the silent case is covered by the unit tests)');
      }
      const baselinePushes = chatPushes;

      // 3. Marked: push + the output in the chat, and the bot does not take a turn.
      t0 = Date.now() / 1000 - 5;
      await routines.runNow(marked.id);
      const run = await runOf(marked, t0);
      const push = await until('the push', async () => expo.received.length > baselinePushes && expo.received.at(-1));
      log(`PUSH: ${JSON.stringify({ title: push.title, body: push.body, data: push.data, mutableContent: push.mutableContent })}`);
      expect(push.title).toBe(`${name} · Marked digest`);
      expect(push.body).toBe(run.text.replace(/\s+/g, ' ').trim().slice(0, 100));
      expect(push.mutableContent).toBe(true);
      const data = parsePushData(push.data);
      expect(data).toMatchObject({ kind: 'routine', bot: name, chat: chatId });
      log(`TAP opens: ${JSON.stringify(routeFor(data!, false))}`);

      const phoneView = await until('the routine card in the chat', async () => {
        const msgs = await client.messages(chatId);
        return msgs.some((x) => x.routine) ? msgs : null;
      });
      const desktopView = await desktop.messages(chatId);
      log(`PHONE   chat: ${show(phoneView)}`);
      log(`DESKTOP chat: ${show(desktopView)}`);
      for (const view of [phoneView, desktopView]) {
        const card = view.at(-1)!;
        expect(card.routine).toMatchObject({ name: 'Marked digest', at: (push.data as { at: string }).at });
        expect(card.routine?.text).toBe(run.text.trim());
        expect(card.role).toBe('assistant'); // drawn as the bot's card; stored as a user-role row
        expect(view).toHaveLength(before.length + 1);
      }
      // Stored as Hermes's user-role mirror with the marker, and no assistant message after it.
      const raw = await (await f(`${conn.url}/p/${name}/api/sessions/${chatId}/messages`, { headers: { Authorization: `Bearer ${conn.key}` } })).json();
      const rows = (raw as { data: { role: string; content: string }[] }).data.filter((x) => x.role !== 'session_meta');
      log(`RAW last row: role=${rows.at(-1)?.role} content=${JSON.stringify(rows.at(-1)?.content.slice(0, 80))}`);
      expect(rows.at(-1)?.role).toBe('user');
      expect(parseRoutineNote(rows.at(-1)?.content)).not.toBeNull();
      await sleep(30_000);
      const after = await client.messages(chatId);
      log(`30 s later (no bot turn expected): ${show(after)}`);
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)?.routine).toBeTruthy();
      expect(expo.received).toHaveLength(baselinePushes + 1);

      // Turning it off stops it again.
      await setNotify(deps, name, marked.id, false);
      expect(notifyOn((await m2.getMeta(name)).push, marked.id)).toBe(false);
      t0 = Date.now() / 1000 - 5;
      await routines.runNow(marked.id);
      await runOf(marked, t0 + 1);
      await sleep(15_000);
      expect(expo.received).toHaveLength(baselinePushes + 1);
      expect(await client.messages(chatId)).toHaveLength(before.length + 1);
      log('switch off again: no new push, nothing new in the chat');
    } finally {
      expo.close();
      await m.deleteBot(name);
      log(`throwaway bot ${name} deleted`);
    }
  }, 1_500_000);
});

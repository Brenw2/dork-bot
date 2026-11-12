// Live SPIKE (card 14): private sudo / secret prompts over `hermes serve`'s /api/ws. Skipped unless DORK_LIVE=1.
//   DORK_LIVE=1 npx vitest run test/live-ws-sudo.test.ts --silent=false
//   Over Tailscale like the phone: add DORK_ADMIN_URL=https://b-lab.tail7e27a7.ts.net:8443 DORK_TS_IP=100.101.226.3
//   (this host can't resolve MagicDNS; DORK_TS_IP pins the name inside this test process only).
// Makes a throwaway bot (Haiku), talks to it over the socket the way the app would, answers the sudo request
// with a FAKE test value (sudo rejects it; nothing changes), covers skip / Stop / timeout, then a skill's
// missing env var (secret card), then greps the bot's profile, the session export and the serve/gateway
// logs for both test values. Deletes the bot. The test values are never logged or put in a prompt.
import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBotChat } from '@/lib/chats';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { GatewaySocket, gatewayWsUrl, type GatewayEvent, type PrivateRequest, type RequestAnswer, type WsCtor } from '@/lib/gatewayWs';
import { HermesManager } from '@/lib/manager';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
const chatUrl = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const f = fetch as unknown as FetchLike;
const WS = WebSocket as unknown as WsCtor;

if (live && process.env.DORK_TS_IP) {
  const real = dns.lookup as unknown as (...a: unknown[]) => void;
  const host = new URL(adminUrl).hostname;
  (dns as unknown as { lookup: unknown }).lookup = (h: string, o: unknown, cb: unknown) => {
    const callback = (typeof o === 'function' ? o : cb) as (e: null, a: unknown, fam?: number) => void;
    const opts = (typeof o === 'object' && o ? o : {}) as { all?: boolean };
    if (h === host) return opts.all ? callback(null, [{ address: process.env.DORK_TS_IP, family: 4 }]) : callback(null, process.env.DORK_TS_IP, 4);
    return real(h, o, cb);
  };
}

function serveEnv(): Record<string, string> {
  const text = readFileSync(join(homedir(), '.config', 'dork-bot', 'serve.env'), 'utf8');
  return Object.fromEntries(text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

async function signIn(): Promise<string> {
  const env = serveEnv();
  const res = await fetch(`${adminUrl}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'basic', username: env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME, password: env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD }),
  });
  const cookie = res.headers.getSetCookie().find((c) => c.includes('hermes_session_rt='));
  const raw = cookie?.split(';')[0].split('=').slice(1).join('=') ?? '';
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
}

/** The app's refresh flow (lib/manager.ts token()): refresh token -> short-lived bearer access token. */
async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch(`${adminUrl}/auth/native/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, provider: 'basic' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

interface Turn {
  text: string;
  events: GatewayEvent[];
  requests: PrivateRequest[];
  ms: number;
}

describe.skipIf(!live)(`live /api/ws on ${adminUrl}`, () => {
  it('streams a reply and asks for a sudo password / a secret privately', async () => {
    const refresh = await signIn();
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: refresh }, f);
    const name = `dbt-ws-${Date.now().toString(36)}`;
    const home = join(homedir(), '.hermes', 'profiles', name);
    const tmp = process.env.TMPDIR ?? '/tmp';
    await m.createBot({ name, job: 'Runs shell commands Brennan asks for, exactly as given.' }, () => randomBytes(32).toString('hex'));
    const testValue = `dorktest-${randomBytes(6).toString('hex')}`;
    const secretValue = `dorksecret-${randomBytes(6).toString('hex')}`;
    const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const log = (s: string) => console.log(s);
    let sock: GatewaySocket | null = null;
    const sessions: string[] = [];
    try {
      await m.setBotModel(name, { provider: 'anthropic', model: 'claude-haiku-5-5' }).catch(() => m.setBotModel(name, { provider: 'anthropic', model: 'claude-haiku-4-5' }));
      log(`transport: ${adminUrl}/api/ws?token=<access token from /auth/native/refresh>`);

      let answer: (r: PrivateRequest) => RequestAnswer | Promise<RequestAnswer> = () => ({ value: '' });
      let current: Turn | null = null;
      let sid = '';
      sock = new GatewaySocket(gatewayWsUrl(adminUrl, await accessToken(refresh)), WS, {
        onEvent: (e) => current?.events.push(e),
        onRequest: async (r) => {
          current?.requests.push(r);
          log(`  request frame: ${JSON.stringify(r)}`);
          return answer(r);
        },
      });
      await sock.open();
      const newSession = async () => {
        sid = (await sock!.call<{ session_id: string }>('session.create', { profile: name })).session_id;
        sessions.push(sid);
        return sid;
      };

      const turn = async (text: string, timeoutMs = 120_000): Promise<Turn> => {
        const t: Turn = { text: '', events: [], requests: [], ms: 0 };
        current = t;
        const t0 = Date.now();
        const done = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            clearInterval(poll);
            reject(new Error(`turn timed out; events: ${t.events.map((e) => e.type).join(',')}`));
          }, timeoutMs);
          const poll = setInterval(() => {
            if (t.events.some((e) => e.type === 'message.complete' || e.type === 'error')) {
              clearTimeout(timer);
              clearInterval(poll);
              resolve();
            }
          }, 50);
        });
        await sock!.call('prompt.submit', { session_id: sid, text });
        await done;
        t.ms = Date.now() - t0;
        const complete = t.events.find((e) => e.type === 'message.complete');
        t.text = String((complete?.payload as { text?: string } | undefined)?.text ?? t.events.filter((e) => e.type === 'message.delta').map((e) => (e.payload as { text?: string }).text ?? '').join(''));
        current = null;
        return t;
      };
      const kinds = (t: Turn) => t.requests.map((r) => r.kind).join(',') || 'none';
      const cancels = (t: Turn) => t.events.filter((e) => e.type === 'request.cancel').map((e) => (e.payload as { reason?: string } | undefined)?.reason ?? JSON.stringify(e.payload));
      const approvalsOnce = (r: PrivateRequest): RequestAnswer | null => (r.kind === 'approval' ? { choice: 'once' } : null);
      const SUDO = 'Use the terminal tool to run exactly this command and show me its output: sudo -k; sudo true';

      // 0. a streamed reply
      await newSession();
      const hello = await turn('Reply with just the word PONG.');
      log(`[stream] session.create -> ${sid}; reply after ${hello.ms} ms: ${JSON.stringify(hello.text.slice(0, 40))}; events: ${[...new Set(hello.events.map((e) => e.type))].join(',')}`);
      expect(hello.text).toMatch(/PONG/i);

      // 1. a wrong (fake) password: the card carries the redacted command; sudo rejects the value
      answer = (r) => approvalsOnce(r) ?? { value: testValue };
      await newSession();
      const wrong = await turn(SUDO);
      log(`[wrong password] requests=${kinds(wrong)} in ${wrong.ms} ms; reply=${JSON.stringify(wrong.text.slice(0, 220))}`);
      expect(wrong.requests.some((r) => r.kind === 'sudo')).toBe(true);
      expect(wrong.text).not.toContain(testValue);

      // 2. Skip: an empty answer; the command fails cleanly, no hang
      answer = (r) => approvalsOnce(r) ?? { value: '' };
      await newSession();
      const skipped = await turn(SUDO);
      log(`[skip] requests=${kinds(skipped)} in ${skipped.ms} ms; reply=${JSON.stringify(skipped.text.slice(0, 220))}`);
      expect(skipped.requests.some((r) => r.kind === 'sudo')).toBe(true);

      // 3. Stop while the card is open: session.interrupt ends the wait and the turn
      answer = (r) => {
        if (r.kind === 'approval') return { choice: 'once' };
        void sock!.call('session.interrupt', { session_id: sid }).then((x) => log(`  session.interrupt -> ${JSON.stringify(x)}`));
        return new Promise<RequestAnswer>(() => {}); // the user never answers
      };
      await newSession();
      const stopped = await turn(SUDO, 60_000);
      log(`[stop] requests=${kinds(stopped)} in ${stopped.ms} ms; request.cancel reasons=${JSON.stringify(cancels(stopped))}; last events=${stopped.events.slice(-3).map((e) => e.type).join(',')}`);
      expect(cancels(stopped)).toContain('interrupted');

      // 4. Timeout: nobody answers; Hermes gives up at 120 s and the turn ends with an empty answer
      answer = (r) => approvalsOnce(r) ?? new Promise<RequestAnswer>(() => {});
      await newSession();
      const timed = await turn(SUDO, 220_000);
      log(`[timeout] requests=${kinds(timed)} in ${timed.ms} ms; request.cancel reasons=${JSON.stringify(cancels(timed))}; reply=${JSON.stringify(timed.text.slice(0, 160))}`);
      expect(cancels(timed)).toContain('timeout');
      expect(timed.ms).toBeGreaterThan(100_000);

      // 5. a skill with a missing required env var: the masked secret card; the value lands in the bot's .env
      const skillDir = join(home, 'skills', 'dbt-secret-probe');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        '---\nname: dbt-secret-probe\ndescription: Throwaway test skill that needs the key DBT_PROBE_KEY.\nrequired_environment_variables:\n  - name: DBT_PROBE_KEY\n    prompt: Enter the probe key\n    required_for: the probe\n---\n# Probe\nSay: probe skill loaded.\n',
      );
      answer = (r) => approvalsOnce(r) ?? { value: secretValue };
      await newSession();
      const sec = await turn('Use the skill_view tool to load the skill named dbt-secret-probe, then tell me in one line whether it loaded and whether the key was stored. Never print the key.');
      log(`[secret] requests=${JSON.stringify(sec.requests.filter((r) => r.kind === 'secret'))} in ${sec.ms} ms; reply=${JSON.stringify(sec.text.slice(0, 200))}`);
      expect(sec.requests.some((r) => r.kind === 'secret')).toBe(true);
      const envText = existsSync(join(home, '.env')) ? readFileSync(join(home, '.env'), 'utf8') : '';
      log(`[secret] bot .env has a DBT_PROBE_KEY line: ${envText.split('\n').some((l) => l.startsWith('DBT_PROBE_KEY='))}; it holds the typed value: ${envText.includes(secretValue)}`);
      expect(envText).toContain(secretValue);
      expect(sec.text).not.toContain(secretValue);

      // 6. history over the socket, then grep everything for both test values
      const hist = JSON.stringify(await sock.call('session.history', { session_id: sid }).catch((e) => String(e)));
      log(`session.history (${hist.length} chars): has the secret value=${hist.includes(secretValue)}, has the sudo value=${hist.includes(testValue)}`);
      expect(hist).not.toContain(secretValue);
      expect(hist).not.toContain(testValue);

      for (const s of sessions) await sock.call('session.close', { session_id: s }).catch(() => undefined);
      sock.close();
      sock = null;
      await new Promise((r) => setTimeout(r, 3000));

      const exportFile = join(tmp, `${name}-export.jsonl`);
      execFileSync('hermes', ['-p', name, 'sessions', 'export', '--format', 'jsonl', '--no-redact', '--yes', exportFile], { stdio: 'pipe' });
      const journal = (unit: string) => {
        const file = join(tmp, `${name}-${unit}.log`);
        writeFileSync(file, execFileSync('journalctl', ['--user', '-u', unit, '--since', startedAt, '--no-pager', '-o', 'cat'], { maxBuffer: 1 << 28 }));
        return file;
      };
      const targets = [home, exportFile, journal('dork-bot-hermes-serve'), journal('hermes-gateway'), join(homedir(), '.hermes', 'logs')];
      const short = (p: string) => p.replace(homedir(), '~').replace(tmp, '$TMPDIR');
      log(`grep targets: ${targets.map(short).join('  ')}  (export ${readFileSync(exportFile, 'utf8').split('\n').filter(Boolean).length} session lines)`);
      for (const [label, value] of [['sudo test value', testValue], ['secret test value', secretValue]] as const) {
        const hits: string[] = [];
        for (const t of targets) {
          try {
            hits.push(...execFileSync('grep', ['-rlaF', value, t]).toString().trim().split('\n'));
          } catch {
            /* exit 1 = no hit */
          }
        }
        log(`grep -rlaF <${label}> -> ${hits.length ? hits.map(short).join(' | ') : '0 hits'}`);
        if (label === 'sudo test value') expect(hits).toEqual([]);
        else expect(hits.map(short)).toEqual([`~/.hermes/profiles/${name}/.env`]);
      }
      for (const t of targets.slice(1, 4)) unlinkSync(t);
    } finally {
      for (const s of sessions) await sock?.call('session.close', { session_id: s }).catch(() => undefined);
      sock?.close();
      await m.deleteBot(name);
      rmSync(join(home, 'runtime'), { recursive: true, force: true });
      try {
        rmSync(home, { recursive: false });
      } catch {
        /* not empty or gone */
      }
    }
  }, 900_000);

  // What the switch plan depends on: can the socket continue a chat that started on the API server, and
  // does a chat the socket starts show up where the app lists chats (GET /api/sessions?source=api_server)?
  it('resumes an API-server chat over the socket, and shows what a socket-made chat looks like to the API server', async () => {
    const refresh = await signIn();
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: refresh }, f);
    const name = `dbt-ws-${Date.now().toString(36)}`;
    const conn = await m.createBot({ name, job: 'Answers briefly.' }, () => randomBytes(32).toString('hex'));
    const log = (s: string) => console.log(s);
    let sock: GatewaySocket | null = null;
    const live: string[] = [];
    const asked: string[] = [];
    try {
      await m.setBotModel(name, { provider: 'anthropic', model: 'claude-haiku-5-5' }).catch(() => m.setBotModel(name, { provider: 'anthropic', model: 'claude-haiku-4-5' }));
      const client = new HermesClient(conn, f);
      const chat = `dork-bot-${name}--spike`;
      await client.ensureSession(chat);
      await client.chat(chat, 'Remember this word: MANGO. Reply with just OK.', () => {});
      log(`[api chat] ${chat}: ${(await client.messages(chat)).length} messages on the API server`);

      const events: GatewayEvent[] = [];
      sock = new GatewaySocket(gatewayWsUrl(adminUrl, await accessToken(refresh)), WS, {
        onEvent: (e) => events.push(e),
        onRequest: async (r) => {
          asked.push(r.kind);
          return r.kind === 'approval' ? { choice: 'once' } : { value: '' }; // skip: no password attempt reaches sudo
        },
      });
      await sock.open();
      const waitComplete = async (from: number) => {
        for (let i = 0; i < 1200; i++) {
          if (events.slice(from).some((e) => e.type === 'message.complete')) return;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error('no message.complete');
      };
      const resumed = await sock.call<{ session_id: string; message_count?: number; messages?: unknown[]; running?: boolean }>('session.resume', { session_id: chat, profile: name });
      live.push(resumed.session_id);
      log(`[resume] session.resume(${chat}) -> runtime id ${resumed.session_id}, ${resumed.messages?.length ?? '?'} messages, running=${resumed.running}`);
      const from = events.length;
      await sock.call('prompt.submit', { session_id: resumed.session_id, text: 'What word did I ask you to remember? One word.' });
      await waitComplete(from);
      const reply = String((events.slice(from).find((e) => e.type === 'message.complete')?.payload as { text?: string } | undefined)?.text ?? '');
      log(`[resume] socket turn on the old chat -> ${JSON.stringify(reply.slice(0, 60))}`);
      expect(reply).toMatch(/mango/i);
      const after = await client.messages(chat);
      log(`[resume] the API server now lists ${after.length} messages in ${chat} (same stored session: ${after.length > 2})`);
      expect(after.length).toBeGreaterThan(2);

      // the same resumed API-server chat asks for sudo privately too (answered empty = skip)
      const from1 = events.length;
      await sock.call('prompt.submit', { session_id: resumed.session_id, text: 'Use the terminal tool to run exactly this command and show me its output: sudo -k; sudo true' });
      await waitComplete(from1);
      log(`[resume] sudo on the resumed API-server chat: requests seen=${asked.join(',') || 'none'}`);
      expect(asked).toContain('sudo');
      const created = await sock.call<{ session_id: string; stored_session_id: string }>('session.create', { profile: name, source: 'api_server' });
      live.push(created.session_id);
      const from2 = events.length;
      await sock.call('prompt.submit', { session_id: created.session_id, text: 'Reply with just OK.' });
      await waitComplete(from2);
      await new Promise((r) => setTimeout(r, 1500));
      const rows = ((await (await client.call('/api/sessions?limit=20')).json()) as { data?: { id: string; source?: string; message_count?: number }[] }).data ?? [];
      const mine = rows.find((r) => r.id === created.stored_session_id);
      log(`[socket chat] session.create(source=api_server) -> stored id ${created.stored_session_id}; the API server lists it: ${mine ? `source=${mine.source}, ${mine.message_count} messages` : 'NOT listed'}; app's chat list would show it: ${isBotChat(name, created.stored_session_id)}`);
      log(`[socket chat] app's chat list matches only ids like dork-bot-<bot>--<id>; a socket-made chat gets a generated id, so new chats should still be created over REST (ensureSession) and then resumed over the socket`);
    } finally {
      for (const s of live) await sock?.call('session.close', { session_id: s }).catch(() => undefined);
      sock?.close();
      await m.deleteBot(name);
      await new Promise((r) => setTimeout(r, 500));
      const home = join(homedir(), '.hermes', 'profiles', name);
      rmSync(join(home, 'runtime'), { recursive: true, force: true });
      try {
        rmSync(home, { recursive: false });
      } catch {
        /* gone or not empty */
      }
    }
  }, 300_000);
});

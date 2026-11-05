// Live: a bot asks before running a risky command, and the app answers the way the chat screen
// does. Skipped unless DORK_LIVE=1.
//   DORK_LIVE=1 npx vitest run test/live-approval.test.ts --silent=false
// Makes a throwaway bot on Haiku with approvals.mode manual (so Hermes asks instead of deciding by
// itself), asks it to delete a scratch folder twice (allowed once, then denied), and deletes the bot.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChat, type ChatState } from '@/lib/chatState';
import { HermesClient, type ApprovalChoice, type FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
const chatUrl = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const f = fetch as unknown as FetchLike;

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

describe.skipIf(!live)(`live approvals on ${chatUrl}`, () => {
  it('pauses on a risky command, shows it, and goes on after Allow once / stops after Deny', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f);
    const name = `dbt-appr-${Date.now().toString(36)}`;
    const conn = await m.createBot({ name, job: 'Runs shell commands Brennan asks for, exactly as given.' }, () => randomBytes(32).toString('hex'));
    try {
      await m.setBotModel(name, { provider: 'anthropic', model: 'claude-haiku-5-5' }).catch(() => m.setBotModel(name, { provider: 'anthropic', model: 'claude-haiku-4-5' }));
      const put = await m.api(`/api/config?profile=${encodeURIComponent(name)}`, 'PUT', { config: { approvals: { mode: 'manual' } } });
      expect(put.ok).toBe(true);
      const client = new HermesClient(conn, f);
      const chat = `dork-bot-${name}--appr`;
      await client.ensureSession(chat);

      const turn = async (dir: string, choice: ApprovalChoice) => {
        mkdirSync(dir, { recursive: true });
        let state: ChatState = chatReducer(initialChat, { type: 'send', text: 'x' });
        let polled: string | null = null;
        const t0 = Date.now();
        await client.chat(chat, `Use the terminal tool to run exactly this command, then tell me if it worked: rm -rf ${dir}`, (event) => {
          state = chatReducer(state, { type: 'event', event });
          if (event.type === 'approval') {
            const runId = state.runId!;
            console.log(`approval after ${Date.now() - t0} ms: ${JSON.stringify(event.request)}`);
            // What a reopened chat sees (lib/liveRuns.ts polls this), then the answer.
            void client
              .runInfo(runId)
              .then((info) => {
                polled = `${info.status} ${info.approval?.command ?? ''}`;
                return client.approve(runId, choice, event.request.requestId);
              })
              .catch((e) => console.log(`answer failed: ${e}`));
          }
        });
        const reply = state.messages.filter((x) => x.role === 'assistant').at(-1)?.content ?? '';
        console.log(`${choice}: polled="${polled}" folder still there=${existsSync(dir)} after ${Date.now() - t0} ms; reply=${JSON.stringify(reply.slice(0, 160))}`);
        return { polled, reply, gone: !existsSync(dir), approval: state.approval };
      };

      const scratch = join(tmpdir(), `dork-appr-${Date.now().toString(36)}`);
      const allowed = await turn(`${scratch}-a`, 'once');
      expect(allowed.polled).toMatch(/^waiting_for_approval rm -rf/);
      expect(allowed.gone).toBe(true);
      expect(allowed.approval).toBeNull();

      const denied = await turn(`${scratch}-d`, 'deny');
      expect(denied.polled).toMatch(/^waiting_for_approval/);
      expect(denied.gone).toBe(false);
    } finally {
      await m.deleteBot(name);
    }
  }, 300_000);
});

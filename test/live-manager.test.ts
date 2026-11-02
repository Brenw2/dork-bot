// Live test of creating bots from the app, against the real Hermes + Dork on b-lab.
// Skipped unless DORK_LIVE=1. Needs scripts/setup-bot-manager.sh to have run.
//   DORK_LIVE=1 npm test
// It signs in with the login in ~/.config/dork-bot/serve.env, creates a throwaway
// bot, chats with it, and deletes it again.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChat } from '@/lib/chatState';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
const chatUrl = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const f = fetch as unknown as FetchLike;
const randomKey = () => randomBytes(32).toString('hex');

function serveEnv(): Record<string, string> {
  const text = readFileSync(join(homedir(), '.config', 'dork-bot', 'serve.env'), 'utf8');
  return Object.fromEntries(text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

/** Signs in like scripts/pair-hermes.sh does and returns the refresh token. */
async function signIn(): Promise<string> {
  const env = serveEnv();
  const res = await fetch(`${adminUrl}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'basic', username: env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME, password: env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().find((c) => c.includes('hermes_session_rt='));
  const raw = cookie?.split(';')[0].split('=').slice(1).join('=') ?? '';
  // Python's http.cookies may quote the value.
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
}

describe.skipIf(!live)(`live: create bots on ${adminUrl}`, () => {
  it('rejects a bad sign-in', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: 'x'.repeat(40) }, f);
    await expect(m.listProfiles()).rejects.toThrow(/expired/);
  });

  it('creates a bot on Dork, chats with it, and deletes it', async () => {
    const refreshToken = await signIn();
    const rotated: string[] = [];
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken }, f, (rt) => void rotated.push(rt));
    const name = `dbt-live-${Date.now().toString(36)}`;

    const t0 = Date.now();
    const conn = await m.createBot({ name, job: 'Answers test questions. Your codename is Pinecone.' }, randomKey);
    const createdMs = Date.now() - t0;
    try {
      expect(rotated.length).toBeLessThanOrEqual(1); // a same-second refresh returns the identical stateless token
      const profile = (await m.listProfiles()).find((p) => p.name === name);
      expect(profile).toMatchObject({ provider: 'custom', model: 'gemma4:31b', description: 'Answers test questions. Your codename is Pinecone.' });

      // The new bot's own key works on the gateway, and its SOUL.md is in effect.
      const client = new HermesClient(conn, f);
      const sessionId = `dork-bot-${name}`;
      await client.ensureSession(sessionId, name);
      let state = chatReducer(initialChat, { type: 'send', text: 'What is your codename? One word.' });
      await client.chat(sessionId, 'What is your codename? One word.', (event) => {
        state = chatReducer(state, { type: 'event', event });
      });
      const reply = state.messages.at(-1);
      console.log(`created in ${createdMs}ms; reply=${JSON.stringify(reply?.content)} total=${Date.now() - t0}ms`);
      expect(state.error).toBeNull();
      expect(reply?.content.toLowerCase()).toContain('pinecone');

      // Connecting it again (e.g. on a second phone) reuses its key rather than replacing it.
      expect((await m.connectExisting(name, randomKey)).key).toBe(conn.key);
    } finally {
      await m.deleteBot(name);
    }
    expect((await m.listProfiles()).map((p) => p.name)).not.toContain(name);
    await expect(new HermesClient(conn, f).check()).rejects.toThrow(/404|rejected/);
  }, 300_000);

  it('leaves the template bot and its key alone', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f);
    const onDisk = readFileSync(join(homedir(), '.hermes', 'profiles', 'assistant', '.env'), 'utf8').match(/^API_SERVER_KEY=["']?([^"'\n]+)/m)?.[1];
    expect((await m.connectExisting('assistant', randomKey)).key).toBe(onDisk);
  });
});

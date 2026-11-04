// Live: switch a bot's model on the fly with the app's own switch (lib/models.ts switchModel),
// against the real Hermes on b-lab. Skipped unless DORK_LIVE=1. Needs scripts/setup-bot-manager.sh.
//   DORK_LIVE=1 npx vitest run test/live-models.test.ts --silent=false
// Creates a throwaway bot on Dork, switches it Dork → Haiku → Dork mid-chat, checks in the bot's
// own log which model and provider each turn really ran on, then deletes the bot. One Haiku call.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChat } from '@/lib/chatState';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';
import { chatModel, switchModel, type ModelChoice } from '@/lib/models';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
const chatUrl = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const f = fetch as unknown as FetchLike;

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

describe.skipIf(!live)(`live: switch models on ${chatUrl}`, () => {
  it('switches a bot Dork → Haiku → Dork mid-chat, and every turn runs on the picked model', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f);
    const name = `dbt-models-${Date.now().toString(36)}`;
    const conn = await m.createBot({ name, job: 'Answers test questions.' }, () => randomBytes(32).toString('hex'));
    const client = new HermesClient(conn, f);
    const id = `dork-bot-${name}`;
    // Which model and provider Hermes really used for the chat's latest turn (the bot's own log).
    const lastTurn = () =>
      readFileSync(join(homedir(), '.hermes', 'profiles', name, 'logs', 'agent.log'), 'utf8')
        .split('\n')
        .filter((l) => l.includes(`conversation turn: session=${id} `))
        .at(-1)
        ?.match(/model=(\S+) provider=(\S+)/)
        ?.slice(1);
    const say = async (word: string) => {
      const text = `Reply with exactly: ${word}`;
      let state = chatReducer(initialChat, { type: 'send', text });
      const t0 = Date.now();
      await client.chat(id, text, (event) => (state = chatReducer(state, { type: 'event', event })));
      const reply = state.messages.at(-1)?.content ?? '';
      console.log(`${JSON.stringify(text)} → ${JSON.stringify(reply.slice(0, 120))} in ${Date.now() - t0} ms, ran on ${lastTurn()?.join(' / ')}`);
      expect(state.error).toBeNull();
      expect(reply.toLowerCase()).toContain(word);
    };
    const pick = async (choice: ModelChoice) => {
      const before = await client.modelOptions();
      await switchModel(choice, before.botDefault, {
        setBotModel: (c) => m.setBotModel(name, c),
        setChatModel: (c) => client.setModel(id, c),
      });
      const after = await client.modelOptions();
      expect(after.botDefault).toEqual(choice);
      expect(chatModel(await client.sessionModel(id), choice, after)).toEqual({ choice, problem: null });
    };

    try {
      const t0 = Date.now();
      const catalog = await client.modelOptions();
      console.log(`model list in ${Date.now() - t0} ms: ${catalog.providers.map((g) => `${g.name} (${g.models.length})`).join(', ')}`);
      expect(catalog.botDefault).toEqual({ provider: 'custom:dork', model: 'gemma4:31b' });
      const haiku = catalog.providers.find((g) => g.slug === 'anthropic')?.models.find((x) => x.includes('haiku'));
      expect(haiku).toBeTruthy();

      await client.ensureSession(id, name);
      await say('one');
      expect(lastTurn()).toEqual(['gemma4:31b', 'custom']);

      await pick({ provider: 'anthropic', model: haiku! });
      await say('two');
      expect(lastTurn()).toEqual([haiku, 'anthropic']);

      await pick({ provider: 'custom:dork', model: 'gemma4:31b' });
      await say('three');
      expect(lastTurn()).toEqual(['gemma4:31b', 'custom']);
      expect((await client.messages(id)).filter((x) => x.role === 'user')).toHaveLength(3);
    } finally {
      await m.deleteBot(name);
    }
  }, 900_000);
});

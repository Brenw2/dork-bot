// Live test of connectors, against the real `hermes serve` + gateway + Dork on b-lab.
// Skipped unless DORK_LIVE=1. Needs scripts/setup-bot-manager.sh to have run.
//   DORK_LIVE=1 npx vitest run test/live-connectors.test.ts
// It creates a throwaway bot, adds a no-sign-in connector (deepwiki), checks its tools,
// checks the bot can use it in chat with no gateway restart, starts (and cancels) a real
// OAuth sign-in to see the page and callback the phone would get, then deletes the bot.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChat } from '@/lib/chatState';
import { Connectors, type SignInBrowser } from '@/lib/connectors';
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
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
}

describe.skipIf(!live)(`live: connectors on ${adminUrl}`, () => {
  it('adds a connector, the bot uses it, OAuth hands out a phone-reachable sign-in, and it all cleans up', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f);
    const name = `dbt-conn-${Date.now().toString(36)}`;
    const conn = await m.createBot({ name, job: 'Answers questions about GitHub repositories. Use your tools.' }, randomKey);
    try {
      const c = new Connectors(m, name);
      const catalog = await c.catalog();
      console.log(`catalog (${catalog.length}): ${catalog.map((e) => `${e.name}:${e.auth}`).join(' ')}`);
      const deepwiki = catalog.find((e) => e.name === 'deepwiki');
      expect(deepwiki, 'deepwiki in the catalog').toBeDefined();
      expect(catalog.every((e) => !e.needsInstall)).toBe(true);

      // No-sign-in connector: add + probe, no browser.
      const noBrowser: SignInBrowser = { open: async () => expect.fail('no browser for deepwiki'), close: () => {} };
      const tools = await c.connect({ entry: deepwiki! }, noBrowser);
      console.log(`deepwiki tools: ${tools.map((t) => t.name).join(', ')}`);
      expect(tools.length).toBeGreaterThan(0);
      expect((await c.list()).map((s) => s.name)).toContain('deepwiki');
      // Scoped to this bot only.
      expect((await new Connectors(m, 'assistant').list()).map((s) => s.name)).not.toContain('deepwiki');

      // The gateway picks it up on its reconcile tick (no restart). Ask until a deepwiki tool runs.
      const client = new HermesClient(conn, f);
      const sessionId = `dork-bot-${name}`;
      await client.ensureSession(sessionId, name);
      const t0 = Date.now();
      let used: string | undefined;
      for (let attempt = 0; attempt < 4 && !used; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 30_000));
        const q = 'Use your deepwiki tool to tell me, in one sentence, what the GitHub repo facebook/react is.';
        let state = chatReducer(initialChat, { type: 'send', text: q });
        await client.chat(sessionId, q, (event) => {
          state = chatReducer(state, { type: 'event', event });
        });
        // Only a real tool call counts (MCP tools are named mcp__deepwiki__<tool>), not a mention in the reply.
        used = state.messages.filter((msg) => msg.role === 'tool').map((msg) => msg.toolName ?? '').find((t) => t.includes('deepwiki'));
        console.log(`attempt ${attempt + 1} at ${Math.round((Date.now() - t0) / 1000)}s: tool=${used ?? 'none'} reply=${JSON.stringify(state.messages.at(-1)?.content?.slice(0, 160))}`);
      }
      expect(used, 'the bot called a deepwiki tool').toBeDefined();

      // OAuth: a real sign-in page whose callback goes to Hermes over Tailscale, then cancel.
      const oauthEntry = catalog.find((e) => e.auth === 'oauth' && e.needs.length === 0);
      expect(oauthEntry, 'an OAuth entry with no setup values').toBeDefined();
      let opened = '';
      const cancelling: SignInBrowser = { open: async (url) => void (opened = url), close: () => {} };
      await expect(c.connect({ entry: oauthEntry! }, cancelling, { pollMs: 500 })).rejects.toThrow(/cancelled|sign-in/i);
      const redirect = new URL(opened).searchParams.get('redirect_uri');
      console.log(`${oauthEntry!.name} sign-in host=${new URL(opened).host} redirect_uri=${redirect}`);
      expect(redirect).toMatch(/^https:\/\/[^/]+\.ts\.net:8443\/api\/mcp\/oauth\/callback\//);
      expect((await c.list()).map((s) => s.name)).not.toContain(oauthEntry!.name); // half-added one removed

      await c.remove('deepwiki');
      expect((await c.list()).map((s) => s.name)).not.toContain('deepwiki');
    } finally {
      await m.deleteBot(name);
    }
  }, 600_000);
});

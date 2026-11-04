// Live test of the bot list following Hermes across devices, against the real `hermes serve` on
// b-lab. Skipped unless DORK_LIVE=1. Two in-memory "devices" (say, the phone and the desktop app)
// sync with the same Hermes; a throwaway bot is made, restyled, hidden and deleted between them.
//   DORK_LIVE=1 npx vitest run test/live-sync.test.ts --silent=false
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';
import { syncBots, type LocalBot, type SyncDeps } from '@/lib/sync';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
const chatUrl = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const f = fetch as unknown as FetchLike;
const randomKey = () => randomBytes(32).toString('hex');

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

function device(m: HermesManager) {
  let bots: (LocalBot & { key: string })[] = [];
  const deps: SyncDeps = {
    chatUrl: m.chatUrl,
    listProfiles: () => m.listProfiles(),
    getMeta: (b) => m.getMeta(b),
    setMeta: (b, p) => m.setMeta(b, p),
    connect: (b) => m.connectExisting(b, randomKey),
    local: async () => bots,
    save: async (c, meta) => void bots.push({ bot: c.bot, url: c.url, key: c.key, look: meta.look, model: meta.model }),
    update: async (b, meta) => void (bots = bots.map((x) => (x.bot === b ? { ...x, ...meta } : x))),
    remove: async (b) => void (bots = bots.filter((x) => x.bot !== b)),
  };
  return { sync: () => syncBots(deps), bots: () => bots, deps };
}

describe.skipIf(!live)(`live: bots follow Hermes across devices (${adminUrl})`, () => {
  it('a bot made on the phone shows on the desktop with its look; changes and hiding carry over; delete removes it', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f);
    const phone = device(m);
    const desktop = device(m);
    const name = `dbt-sync-${Date.now().toString(36)}`;
    const tabby = { character: 'cat' as const, variant: 1, color: '#ff8800' };
    const robot = { character: 'robot' as const, variant: 2, color: '#3366ff' };
    const t0 = Date.now();
    const ms = () => `${Date.now() - t0}ms`;

    const conn = await m.createBot({ name, job: 'Throwaway bot for the sync test.' }, randomKey);
    try {
      // Both devices already have the real bots, so only the throwaway's key is fetched
      // (Hermes allows 5 key reads per 30 s).
      for (const p of await m.listProfiles()) {
        if (p.isDefault || p.name === name) continue;
        for (const d of [phone, desktop]) d.bots().push({ bot: p.name, url: chatUrl, key: 'seeded' });
      }
      // Phone: made it with a look (app/new.tsx saves it, then pushes the look).
      await phone.deps.save(conn, { look: tabby });
      await m.setMeta(name, { look: tabby, hidden: false });

      const r1 = await desktop.sync();
      console.log(`desktop first sync ${ms()}: added=${r1.added.join(',')} errors=${JSON.stringify(r1.errors)}`);
      const onDesktop = desktop.bots().find((b) => b.bot === name);
      expect(onDesktop).toMatchObject({ look: tabby });
      expect(onDesktop?.key).toBe(conn.key); // same key, not a new one that would lock the phone out

      // Desktop restyles it; a Hermes config rewrite in between (model set) keeps the block.
      await m.setMeta(name, { look: robot });
      await m.setBotModel(name, { provider: 'custom', model: 'gemma4:31b' });
      expect((await m.getMeta(name)).look).toEqual(robot);
      const r2 = await phone.sync();
      console.log(`phone sync ${ms()}: updated=${r2.updated.join(',')}`);
      expect(phone.bots().find((b) => b.bot === name)?.look).toEqual(robot);

      // Phone hides it: it goes from the desktop too, and stays on Hermes.
      await m.setMeta(name, { hidden: true });
      const r3 = await desktop.sync();
      expect(r3.removed).toContain(name);
      expect((await m.listProfiles()).map((p) => p.name)).toContain(name);
      // Added back from New bot (hidden: false) on the desktop: the phone gets it back.
      await m.setMeta(name, { hidden: false });
      await phone.deps.remove(name);
      expect((await phone.sync()).added).toContain(name);
    } finally {
      await m.deleteBot(name);
    }
    const r4 = await desktop.sync();
    console.log(`after delete ${ms()}: desktop removed=${r4.removed.join(',')}`);
    expect(desktop.bots().map((b) => b.bot)).not.toContain(name);
    expect((await phone.sync()).removed).toContain(name);
  }, 120_000);
});

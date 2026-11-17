// Live test of the Usage data layer against the real `hermes serve` on b-lab. Skipped unless DORK_LIVE=1.
//   DORK_LIVE=1 npx vitest run test/live-usage.test.ts
// Reads only (no bots are made): the Anthropic windows must match `hermes usage --json`, and every bot gets totals.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';
import { UsageClient } from '@/lib/usage';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
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
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().find((c) => c.includes('hermes_session_rt='));
  const raw = cookie?.split(';')[0].split('=').slice(1).join('=') ?? '';
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
}

describe.skipIf(!live)(`live: usage on ${adminUrl}`, () => {
  it('shows Anthropic windows that match hermes usage --json, and real totals per bot', async () => {
    const m = new HermesManager({ adminUrl, chatUrl: 'http://127.0.0.1:8642', refreshToken: await signIn() }, f);
    const client = new UsageClient(m);
    const { providers } = await client.providers(true);
    const claude = providers.find((p) => p.slug === 'anthropic');
    expect(claude?.kind).toBe('windows');

    const cli = JSON.parse(execFileSync('hermes', ['usage', '--json'], { encoding: 'utf8' })) as { windows: { label: string; used_percent: number; resets_at: string }[] };
    expect(cli.windows.length).toBeGreaterThan(0);
    for (const w of cli.windows) {
      const mine = claude!.windows.find((x) => x.label === w.label);
      expect(mine, `window ${w.label}`).toBeTruthy();
      // The two reads are seconds apart and each rounds on its own: within 3 points, same reset to the minute.
      expect(Math.abs(mine!.percent - w.used_percent)).toBeLessThanOrEqual(3);
      expect(Math.abs(mine!.resetsAt! - Date.parse(w.resets_at))).toBeLessThan(60_000);
    }

    const profiles = (await (await m.api('/api/profiles')).json()) as { profiles: { name: string }[] };
    const names = profiles.profiles.map((p) => p.name);
    const { usage, errors } = await client.bots(names, 30);
    expect(errors).toEqual({});
    expect(usage.map((u) => u.bot)).toEqual(names);
    for (const u of usage) {
      expect(u.input).toBeGreaterThanOrEqual(0);
      expect(u.daily.reduce((a, d) => a + d.input, 0)).toBe(u.input);
    }
    console.log(usage.map((u) => `${u.bot}: ${u.input} in, ${u.output} out, ${u.apiCalls} calls, top ${u.topModel}`).join('\n'));
  }, 60_000);
});

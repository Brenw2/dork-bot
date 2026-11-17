import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchLike, FetchResponse } from '@/lib/hermes';
import {
  UsageClient,
  claudeSession,
  formatCost,
  formatCredits,
  formatReset,
  formatTokens,
  gaugeState,
  levelFor,
  parseBotUsage,
  parseProviderUsage,
  resetLine,
  sortProviders,
} from '@/lib/usage';
import { HermesManager } from '@/lib/manager';

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
// Captured from b-lab on 2026-11-17 (trimmed: no model lists, no secrets).
const OPTIONS = fx('model-options-usage.json');
const ANALYTICS = fx('analytics-usage.json');
const EMPTY = fx('analytics-usage-empty.json');

function res(status: number, body: unknown = {}): FetchResponse {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), body: null };
}

describe('levelFor (thresholds)', () => {
  it('is normal under 70, warning 70 to 90, red over 90', () => {
    expect(levelFor(0)).toBe('ok');
    expect(levelFor(69.9)).toBe('ok');
    expect(levelFor(70)).toBe('warn');
    expect(levelFor(90)).toBe('warn');
    expect(levelFor(90.1)).toBe('bad');
    expect(levelFor(100)).toBe('bad');
  });
});

describe('parseProviderUsage', () => {
  it('reads the real single-account windows (Anthropic) and flags the rest as having none', () => {
    const list = parseProviderUsage(OPTIONS);
    const claude = list.find((p) => p.slug === 'anthropic')!;
    expect(claude.kind).toBe('windows');
    expect(claude.windows.map((w) => [w.label, w.percent])).toEqual([['Current session', 34], ['Current week', 10]]);
    expect(claude.windows[0].resetsAt).toBe(Date.parse('2026-11-18T00:00:00.287832+00:00'));
    expect(claude.windows[0].scope).toBe('account');
    expect(list.find((p) => p.slug === 'nous')!.kind).toBe('none');
    const dork = list.find((p) => p.slug === 'custom:dork')!;
    expect(dork.local).toBe(true);
    expect(dork.pending).toBe(false);
  });

  it('reads credential pools (usage.accounts) per account, never averaged', () => {
    const list = parseProviderUsage({
      providers: [
        {
          slug: 'openai-codex',
          name: 'OpenAI Codex',
          authenticated: true,
          usage: {
            accounts: [
              { id: 'a1', label: 'work', state: 'ready', resets_at: null, windows: [{ label: 'Session', used_percent: 95, resets_at: '2026-11-18T00:00:00+00:00', scope: 'account' }] },
              { id: 'a2', label: 'home', state: 'unknown', resets_at: null, windows: [] },
              { id: 'a3', label: '', state: 'limited', resets_at: '2026-11-19T00:00:00+00:00', windows: [] },
            ],
          },
        },
      ],
    });
    const p = list[0];
    expect(p.kind).toBe('accounts');
    expect(p.windows).toEqual([]);
    expect(p.accounts.map((a) => [a.label, a.state, a.windows.length])).toEqual([['work', 'ready', 1], ['home', 'unknown', 0], ['Account 3', 'limited', 0]]);
    expect(p.accounts[2].resetsAt).toBe(Date.parse('2026-11-19T00:00:00+00:00'));
  });

  it('reads credits only when Hermes sends them', () => {
    const credits = (c: unknown) => parseProviderUsage({ providers: [{ slug: 'x', name: 'X', authenticated: true, usage: { credits: c, windows: [] } }] })[0].credits;
    expect(credits(12.5)).toEqual({ amount: 12.5, currency: 'USD' });
    expect(credits({ remaining: 3, currency: 'EUR' })).toEqual({ amount: 3, currency: 'EUR' });
    expect(credits({ balance: 0 })).toEqual({ amount: 0, currency: 'USD' });
    expect(credits('lots')).toBeNull();
    expect(credits({})).toBeNull();
    expect(parseProviderUsage(OPTIONS).every((p) => p.credits === null)).toBe(true);
    expect(formatCredits({ amount: 12.5, currency: 'USD' })).toBe('$12.50');
    expect(formatCredits({ amount: 3, currency: 'EUR' })).toBe('3.00 EUR');
  });

  it('handles missing usage, junk and unauthenticated providers without throwing', () => {
    expect(parseProviderUsage(null)).toEqual([]);
    expect(parseProviderUsage({})).toEqual([]);
    expect(parseProviderUsage({ providers: 'no' })).toEqual([]);
    const list = parseProviderUsage({
      providers: [
        { slug: 'a', name: 'A', authenticated: true },
        { slug: 'b', authenticated: false },
        { name: 'no slug' },
        'junk',
        { slug: 'c', name: 'C', authenticated: true, usage: { windows: [{ label: 'W', used_percent: 'x' }, null, { used_percent: 250 }, { used_percent: -5 }] } },
      ],
    });
    expect(list.map((p) => p.slug)).toEqual(['a', 'c']);
    expect(list[0]).toMatchObject({ kind: 'none', pending: true, windows: [], accounts: [], credits: null });
    // Percent clamps to 0..100, a missing label becomes "Usage", a missing reset stays null.
    expect(list[1].windows).toEqual([
      { label: 'Usage', percent: 100, resetsAt: null, scope: 'account' },
      { label: 'Usage', percent: 0, resetsAt: null, scope: 'account' },
    ]);
  });

  it('sorts providers with numbers first, local last', () => {
    const order = sortProviders(parseProviderUsage(OPTIONS)).map((p) => p.slug);
    expect(order).toEqual(['anthropic', 'nous', 'custom:dork']);
  });
});

describe('header gauge', () => {
  const claude = (percent: number, label = 'Current session') =>
    parseProviderUsage({ providers: [{ slug: 'anthropic', name: 'Anthropic', authenticated: true, usage: { windows: [{ label, used_percent: percent, resets_at: null }] } }] });

  it('shows the Claude session window and goes red over 90', () => {
    expect(gaugeState(parseProviderUsage(OPTIONS))).toEqual({ kind: 'value', percent: 34, level: 'ok' });
    expect(gaugeState(claude(75))).toEqual({ kind: 'value', percent: 75, level: 'warn' });
    expect(gaugeState(claude(90))).toMatchObject({ level: 'warn' });
    expect(gaugeState(claude(91))).toEqual({ kind: 'value', percent: 91, level: 'bad' });
  });

  it('is empty with no data, and ignores the week window', () => {
    expect(gaugeState(null)).toEqual({ kind: 'none' });
    expect(gaugeState([])).toEqual({ kind: 'none' });
    expect(gaugeState(claude(99, 'Current week'))).toEqual({ kind: 'none' });
    expect(claudeSession(parseProviderUsage({ providers: [{ slug: 'nous', name: 'N', authenticated: true, usage: { windows: [{ label: 'Current session', used_percent: 99 }] } }] }))).toBeNull();
  });

  it('uses the worst session across a Claude pool', () => {
    const list = parseProviderUsage({
      providers: [{ slug: 'anthropic', name: 'Anthropic', authenticated: true, usage: { accounts: [
        { id: 'a', label: 'a', state: 'ready', windows: [{ label: 'Current session', used_percent: 20 }] },
        { id: 'b', label: 'b', state: 'ready', windows: [{ label: 'Current session', used_percent: 93 }] },
      ] } }],
    });
    expect(gaugeState(list)).toMatchObject({ percent: 93, level: 'bad' });
  });
});

describe('reset text', () => {
  const now = Date.parse('2026-11-17T22:00:00Z');
  it('counts down in the unit that fits', () => {
    expect(formatReset(now + 119 * 60000, now)).toBe('1h 59m');
    expect(formatReset(now + 12 * 60000, now)).toBe('12m');
    expect(formatReset(now + 28 * 3600000 + 60000, now)).toBe('1d 4h');
    expect(formatReset(now - 1000, now)).toBe('now');
    expect(formatReset(null, now)).toBeNull();
    expect(resetLine(now + 119 * 60000, now)).toBe('Resets in 1h 59m');
    expect(resetLine(null, now)).toBe('Reset time not given');
    expect(resetLine(now, now)).toBe('Resetting now');
  });
});

describe('parseBotUsage', () => {
  it('reads the real analytics payload', () => {
    const u = parseBotUsage('assistant', 7, ANALYTICS);
    expect(u.bot).toBe('assistant');
    expect(u.input).toBe(ANALYTICS.totals.total_input);
    expect(u.output).toBe(ANALYTICS.totals.total_output);
    expect(u.apiCalls).toBe(ANALYTICS.totals.total_api_calls);
    expect(u.cost).toBeCloseTo(ANALYTICS.totals.total_estimated_cost);
    expect(u.daily.length).toBe(ANALYTICS.daily.length);
    expect(u.daily[0]).toMatchObject({ day: '2026-11-11', input: 730, output: 2453, apiCalls: 4 });
    const sorted = [...u.models].sort((a, b) => b.input + b.output - (a.input + a.output));
    expect(u.models).toEqual(sorted);
    expect(u.topModel).toBe(u.models[0].model);
  });

  it('turns null SQL sums into zeros and has no top model for an idle bot', () => {
    const u = parseBotUsage('default', 7, EMPTY);
    expect(u).toMatchObject({ input: 0, output: 0, apiCalls: 0, cost: 0, daily: [], models: [], topModel: null });
    expect(parseBotUsage('x', 30, null)).toMatchObject({ input: 0, topModel: null });
  });

  it('skips a model with no tokens when picking the top one', () => {
    const u = parseBotUsage('x', 7, { by_model: [{ model: 'idle', input_tokens: 0, output_tokens: 0 }, { model: 'busy', input_tokens: 5, output_tokens: 1 }] });
    expect(u.topModel).toBe('busy');
    expect(parseBotUsage('x', 7, { by_model: [{ model: 'idle', input_tokens: 0, output_tokens: 0 }] }).topModel).toBeNull();
  });
});

describe('number formats', () => {
  it('shortens tokens and costs', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1234)).toBe('1.2K');
    expect(formatTokens(12000)).toBe('12K');
    expect(formatTokens(3400000)).toBe('3.4M');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(1.236)).toBe('$1.24');
  });
});

describe('UsageClient', () => {
  function serve(opts: { warmAfter?: number; botFail?: string } = {}) {
    const calls: string[] = [];
    let optionCalls = 0;
    const fetch: FetchLike = async (url) => {
      const u = new URL(url);
      calls.push(`${u.pathname}${u.search}`);
      if (u.pathname === '/auth/native/refresh') return res(200, { access_token: 'at', refresh_token: 'rt', expires_at: 1e12 });
      if (u.pathname === '/api/model/options') {
        optionCalls++;
        const cold = optionCalls <= (opts.warmAfter ?? 0);
        return res(200, cold ? { providers: OPTIONS.providers.map((p: { usage?: unknown }) => ({ ...p, usage: undefined })) } : OPTIONS);
      }
      if (u.pathname === '/api/analytics/usage') {
        const profile = u.searchParams.get('profile');
        if (profile === opts.botFail) return res(404, { detail: 'no profile' });
        return res(200, ANALYTICS);
      }
      return res(404);
    };
    const manager = new HermesManager({ adminUrl: 'https://h.test:8443', chatUrl: 'https://h.test', refreshToken: 'rt' }, fetch);
    return { manager, calls };
  }

  it('asks once more after a cold cache, and sends refresh=true only when asked', async () => {
    const { manager, calls } = serve({ warmAfter: 1 });
    const sleeps: number[] = [];
    const c = new UsageClient(manager, async (ms) => void sleeps.push(ms), () => 42);
    const snap = await c.providers(true);
    expect(sleeps).toEqual([4000]);
    expect(snap.fetchedAt).toBe(42);
    expect(snap.providers.find((p) => p.slug === 'anthropic')!.kind).toBe('windows');
    const options = calls.filter((x) => x.startsWith('/api/model/options'));
    expect(options).toEqual(['/api/model/options?include_unconfigured=false&refresh=true', '/api/model/options?include_unconfigured=false']);
  });

  it('does not wait when the cache is warm', async () => {
    const { manager, calls } = serve();
    const sleeps: number[] = [];
    await new UsageClient(manager, async (ms) => void sleeps.push(ms)).providers();
    expect(sleeps).toEqual([]);
    expect(calls.filter((x) => x.startsWith('/api/model/options'))).toHaveLength(1);
  });

  it('reads each bot with its profile, and one failing bot does not hide the others', async () => {
    const { manager, calls } = serve({ botFail: 'scout' });
    const { usage, errors } = await new UsageClient(manager).bots(['assistant', 'scout', 'chief'], 30);
    expect(usage.map((u) => u.bot)).toEqual(['assistant', 'chief']);
    expect(Object.keys(errors)).toEqual(['scout']);
    expect(errors.scout).toContain('no profile');
    expect(calls).toContain('/api/analytics/usage?days=30&profile=scout');
  });
});

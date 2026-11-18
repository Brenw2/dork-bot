import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchLike, FetchResponse } from '@/lib/hermes';
import {
  UsageClient,
  axisLabels,
  calloutText,
  clockLabel,
  countdown,
  daySeries,
  displayName,
  dueResets,
  formatCount,
  localTokens,
  niceTop,
  providerOfModel,
  shareOf,
  spokenCallout,
  spokenTokens,
  stepPicked,
  sortBots,
  stateWord,
  subtitle,
  totalsOf,
  updatedLine,
  usageBotNames,
  formatCost,
  formatCredits,
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

describe('levelFor (thresholds, on the rounded value)', () => {
  it('is normal under 70, warning 70 to 90, red 91 and up', () => {
    expect(levelFor(0)).toBe('ok');
    expect(levelFor(69)).toBe('ok');
    expect(levelFor(69.4)).toBe('ok');
    expect(levelFor(69.5)).toBe('warn'); // shows 70
    expect(levelFor(70)).toBe('warn');
    expect(levelFor(90)).toBe('warn');
    expect(levelFor(90.4)).toBe('warn'); // shows 90
    expect(levelFor(90.5)).toBe('bad'); // shows 91
    expect(levelFor(91)).toBe('bad');
    expect(levelFor(100)).toBe('bad');
  });
  it('has a word for warning and red, never for normal', () => {
    expect([30, 69, 70, 90, 91, 99, 100].map(stateWord)).toEqual([null, null, 'Running low', 'Running low', 'Almost out', 'Almost out', 'Limit reached']);
  });
});

describe('parseProviderUsage', () => {
  it('reads the real single-account windows (Anthropic) and flags the rest as having none', () => {
    const list = parseProviderUsage(OPTIONS);
    const claude = list.find((p) => p.slug === 'anthropic')!;
    expect(claude.kind).toBe('windows');
    const real = OPTIONS.providers.find((x: { slug: string }) => x.slug === 'anthropic').usage.windows;
    expect(claude.windows.map((w) => [w.label, w.percent])).toEqual(real.map((w: { label: string; used_percent: number }) => [w.label, w.used_percent]));
    expect(claude.windows[0].resetsAt).toBe(Date.parse(real[0].resets_at));
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
    expect(list[0]).toMatchObject({ kind: 'none', pending: true, windows: [], accounts: [], credits: null, models: [] });
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
  const one = (slug: string, windows: { label: string; used_percent: number }[]) => ({ slug, name: slug, authenticated: true, usage: { windows } });

  it('shows the highest window across every provider, not just Claude', () => {
    expect(gaugeState(parseProviderUsage(OPTIONS))).toMatchObject({ kind: 'value', percent: Math.max(...OPTIONS.providers.find((x: { slug: string }) => x.slug === 'anthropic').usage.windows.map((w: { used_percent: number }) => w.used_percent)), provider: 'Claude' });
    const list = parseProviderUsage({ providers: [one('anthropic', [{ label: 'Current session', used_percent: 29 }, { label: 'Current week', used_percent: 94 }]), one('openai-codex', [{ label: '5-hour', used_percent: 78 }])] });
    expect(gaugeState(list)).toMatchObject({ percent: 94, level: 'bad', provider: 'Claude', label: 'Current week' });
    expect(gaugeState(parseProviderUsage({ providers: [one('openai-codex', [{ label: '5-hour', used_percent: 78 }])] }))).toMatchObject({ level: 'warn', provider: 'Codex' });
  });

  it('is red from 91 on the Claude session, amber at 90', () => {
    const claude = (n: number) => parseProviderUsage({ providers: [one('anthropic', [{ label: 'Current session', used_percent: n }])] });
    expect(gaugeState(claude(90))).toMatchObject({ level: 'warn' });
    expect(gaugeState(claude(91))).toMatchObject({ level: 'bad' });
  });

  it('is hidden with no data', () => {
    expect(gaugeState(null)).toEqual({ kind: 'none' });
    expect(gaugeState([])).toEqual({ kind: 'none' });
    expect(gaugeState(parseProviderUsage({ providers: [{ slug: 'nous', name: 'N', authenticated: true }] }))).toEqual({ kind: 'none' });
  });

  it('reads pooled accounts too', () => {
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
  it('counts down, floored, two units', () => {
    expect(countdown(now + 119 * 60000 + 30000, now)).toBe('1h 59m');
    expect(countdown(now + 42 * 60000 + 59000, now)).toBe('42m');
    expect(countdown(now + 30000, now)).toBe('<1m');
    expect(countdown(now + (3 * 24 + 18) * 3600000 + 60000, now)).toBe('3d 18h');
    expect(countdown(now - 1, now)).toBeNull();
    expect(resetLine(now + 119 * 60000 + 30000, now)).toBe('Resets in 1h 59m');
    expect(resetLine(now - 1000, now)).toBe('Reset due');
    expect(resetLine(null, now)).toBe('Reset time not given');
  });
  it('writes the clock in the device zone: today, this week, later', () => {
    const local = new Date(2026, 10, 17, 12, 0).getTime();
    expect(clockLabel(new Date(2026, 10, 17, 19, 0).getTime(), local, 'en-US')).toBe('7:00 PM');
    expect(clockLabel(new Date(2026, 10, 21, 12, 0).getTime(), local, 'en-US')).toBe('Sat 12:00 PM');
    expect(clockLabel(new Date(2026, 10, 28, 12, 0).getTime(), local, 'en-US')).toBe('Nov 28, 12:00 PM');
  });
  it('words the Updated line', () => {
    const t = new Date(2026, 10, 17, 9, 41).getTime();
    expect(updatedLine(t, t + 30000)).toBe('Updated just now');
    expect(updatedLine(t, t + 60000)).toBe('Updated 1 min ago');
    expect(updatedLine(t, t + 12 * 60000)).toBe('Updated 12 min ago');
    expect(updatedLine(t, t + 3 * 3600000)).toBe('Updated 3 h ago');
    expect(updatedLine(t, t + 30 * 3600000, 'en-US')).toBe('Updated Tue 9:41 AM');
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

describe('number formats (locked)', () => {
  it('shortens tokens', () => {
    const f = formatTokens;
    expect([0, 812, 999].map(f)).toEqual(['0', '812', '999']);
    expect([1000, 1234, 9900, 9949].map(f)).toEqual(['1K', '1.2K', '9.9K', '9.9K']);
    expect([9999, 10000, 340000, 912000].map(f)).toEqual(['10K', '10K', '340K', '912K']);
    expect([999499, 999500, 999950, 1e6, 1234567, 14.9e6].map(f)).toEqual(['999K', '1M', '1M', '1M', '1.2M', '14.9M']);
    expect([99.94e6, 99.96e6, 120e6, 999.95e6, 1.3e9].map(f)).toEqual(['99.9M', '100M', '120M', '1B', '1.3B']);
    expect(f(4.8e6)).toBe('4.8M');
  });
  it('formats counts and costs', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0.005)).toBe('$0.01');
    expect(formatCost(3.41)).toBe('$3.41');
    expect(formatCost(1284.5)).toBe('$1,284.50');
  });
});

describe('providers and bots', () => {
  const list = parseProviderUsage(OPTIONS);
  it('names providers like the comps and says what they are', () => {
    expect(list.map(displayName)).toEqual(['Nous Portal', 'Claude', 'dork']);
    expect(subtitle(list[1])).toBe('Anthropic subscription');
    expect(subtitle(list[2])).toBe('Local model · no limits');
    expect(subtitle(list[0])).toBe('');
  });
  it('finds a model\'s provider from Hermes\'s lists, never a guess', () => {
    expect(providerOfModel('claude-opus-5-5', list)).toBe('Claude');
    expect(providerOfModel('qwen3.8:27b', list)).toBe('dork');
    expect(providerOfModel('mystery-model', list)).toBeNull();
  });
  const a = parseBotUsage('assistant', 7, ANALYTICS);
  const idle = parseBotUsage('default', 7, EMPTY);
  it('counts tool calls from the per-tool counts and local tokens from the local models', () => {
    expect(a.toolCalls).toBe(ANALYTICS.tools.reduce((n: number, t: { count: number }) => n + t.count, 0));
    expect(a.toolCalls).toBeGreaterThan(0);
    const dork = list.find((p) => p.local)!;
    const q = ANALYTICS.by_model.find((m: { model: string }) => m.model === 'qwen3.8:27b');
    expect(localTokens(dork, [a, idle])).toBe(q.input_tokens + q.output_tokens);
  });
  it('sorts by tokens, idle last, and sums the totals', () => {
    const big = { ...a, bot: 'big', input: 9e6 };
    expect(sortBots([idle, a, big]).map((u) => u.bot)).toEqual(['big', 'assistant', 'default']);
    expect(totalsOf([a, big]).tokens).toBe(a.input + a.output + big.input + big.output);
  });
  it('gives model shares that sum to about 100', () => {
    const sum = a.models.reduce((n, m) => n + shareOf(m, a), 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(2);
  });
});

describe('chart maths', () => {
  const now = new Date(2026, 10, 17, 12).getTime();
  it('makes one point per day ending today, empty days 0', () => {
    const u = parseBotUsage('x', 7, { daily: [{ day: '2026-11-16', input_tokens: 100, output_tokens: 50, cache_read_tokens: 9999 }] });
    const s = daySeries(u, now);
    expect(s.map((p) => p.day)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
    expect(s.map((p) => p.tokens)).toEqual([0, 0, 0, 0, 0, 150, 0]); // cache is left out
    expect(daySeries({ ...u, days: 90 }, now)).toHaveLength(90);
  });
  it('picks a nice top', () => {
    expect([0, 1, 426000, 500000, 500001, 90, 1.1e6].map(niceTop)).toEqual([1, 1, 500000, 500000, 1e6, 100, 2e6]);
  });
  it('words the callout and the axis', () => {
    expect(calloutText('2026-11-10', 409000, 'en-US')).toBe('Tue, Nov 10 · 409K tokens');
    const s7 = daySeries({ ...parseBotUsage('x', 7, {}), days: 7 }, now);
    expect(axisLabels(s7, 7, 'en-US').map((l) => l.text)).toEqual(['W', 'T', 'F', 'S', 'S', 'M', 'T']);
    const s30 = daySeries({ ...parseBotUsage('x', 30, {}), days: 30 }, now);
    expect(axisLabels(s30, 30, 'en-US').map((l) => l.text)).toEqual(['Oct 19', 'Nov 3', 'Today']);
    const s90 = daySeries({ ...parseBotUsage('x', 90, {}), days: 90 }, now);
    expect(axisLabels(s90, 90, 'en-US').map((l) => l.text)).toEqual(['Sep', 'Oct', 'Nov']);
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

describe('usageBotNames', () => {
  it('lists every profile but the default, and marks the ones this phone does not list', () => {
    const profiles = [{ name: 'default', isDefault: true }, { name: 'chief', isDefault: false }, { name: 'quiet', isDefault: false }];
    expect(usageBotNames(profiles, ['chief'])).toEqual({ names: ['chief', 'quiet'], hidden: { chief: false, quiet: true } });
    expect(usageBotNames(profiles, ['default', 'chief']).names).toEqual(['default', 'chief', 'quiet']);
  });
});

describe('dueResets (Reset due refetches once)', () => {
  const at = Date.parse('2026-11-18T12:00:00Z');
  const list = parseProviderUsage({
    providers: [
      { slug: 'anthropic', name: 'Anthropic', authenticated: true, usage: { windows: [
        { label: 'Current session', used_percent: 50, resets_at: '2026-11-18T11:59:00Z' },
        { label: 'Current week', used_percent: 10, resets_at: '2026-11-21T12:00:00Z' },
        { label: 'No reset', used_percent: 10 },
      ] } },
      { slug: 'openai-codex', name: 'Codex', authenticated: true, usage: { accounts: [{ id: 'a', label: 'a', state: 'ready', windows: [{ label: '5-hour', used_percent: 5, resets_at: '2026-11-18T12:00:00Z' }] }] } },
    ],
  });
  it('lists only windows already past their reset, with a stable key', () => {
    expect(dueResets(list, at)).toEqual([`anthropic|Current session|${Date.parse('2026-11-18T11:59:00Z')}`, `openai-codex|5-hour|${at}`]);
    expect(dueResets(list, at - 120000)).toEqual([]);
    expect(dueResets(list, at)).toEqual(dueResets(list, at + 5000)); // same keys later: the screen has already refetched for them
  });
});

describe('chart VoiceOver (adjustable)', () => {
  it('steps one day at a time and clamps at both ends', () => {
    expect(stepPicked(null, 1, 7)).toBe(0); // the first increment lands on the earliest day
    expect(stepPicked(0, 1, 7)).toBe(1);
    expect(stepPicked(5, 1, 7)).toBe(6);
    expect(stepPicked(6, 1, 7)).toBe(6); // clamped at the latest
    expect(stepPicked(3, -1, 7)).toBe(2);
    expect(stepPicked(0, -1, 7)).toBe(0); // clamped at the earliest
    expect(stepPicked(null, -1, 7)).toBeNull(); // nothing selected, nothing to step back from
    expect(stepPicked(null, 1, 0)).toBeNull();
    expect(stepPicked(2, 1, 0)).toBeNull();
    let at: number | null = null;
    for (let i = 0; i < 100; i++) at = stepPicked(at, 1, 30);
    expect(at).toBe(29);
  });
  it('says the picked day the way the comp does', () => {
    expect(spokenCallout('2026-11-10', 409000, 'en-US')).toBe('Tue, Nov 10, 409 thousand tokens');
    expect(spokenCallout('2026-11-11', 812, 'en-US')).toBe('Wed, Nov 11, 812 tokens');
    expect(spokenCallout('2026-11-12', 1234567, 'en-US')).toBe('Thu, Nov 12, 1.2 million tokens');
    expect(spokenTokens(0)).toBe('0');
  });
});

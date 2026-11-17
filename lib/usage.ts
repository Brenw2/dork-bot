// Usage screen data (card 25): AI subscription limits and per-bot token use, from `hermes serve`.
//   - Limits: GET /api/model/options. Each authenticated provider may carry `usage.windows` (one account) or
//     `usage.accounts` (a credential pool). Hermes fills these from a cache and refreshes it in the background
//     (agent/account_usage_cache.py: at most one try per provider per 120 s, snapshots go stale after 15 min), so
//     the first call after a cold start has no `usage` at all. `refresh=true` only busts the model-id cache, NOT
//     this one, so "refresh" here means: call, and if a provider that should report has nothing yet, call again.
//   - History: GET /api/analytics/usage?days=7|30|90&profile=<bot>.
// Plain TypeScript with the manager's authenticated `api`, so it's unit-tested in Node (test/usage.test.ts).
import { HermesError } from './hermes';
import { fail, type HermesManager } from './manager';

export type Level = 'ok' | 'warn' | 'bad';

/** Judged on the DISPLAYED integer (Fix 12): 0-69 normal, 70-90 warning, 91+ red. */
export function levelFor(percent: number): Level {
  const shown = Math.round(percent);
  if (shown > 90) return 'bad';
  if (shown >= 70) return 'warn';
  return 'ok';
}

/** The word next to a warning or red window: Running low (70-90), Almost out (91-99), Limit reached (100). */
export function stateWord(percent: number): string | null {
  const shown = Math.round(percent);
  if (shown >= 100) return 'Limit reached';
  if (shown > 90) return 'Almost out';
  if (shown >= 70) return 'Running low';
  return null;
}

export interface UsageWindow {
  label: string;
  /** 0 to 100 (clamped; Hermes can report over 100). */
  percent: number;
  /** Epoch ms, or null when Hermes doesn't say. */
  resetsAt: number | null;
  /** `model` windows cap one model family; `account` windows cap the whole login. */
  scope: string;
}

export interface UsageAccount {
  id: string;
  label: string;
  state: string;
  resetsAt: number | null;
  windows: UsageWindow[];
}

export interface ProviderUsage {
  slug: string;
  name: string;
  /** 'windows' (one account), 'accounts' (a pool) or 'none': Hermes has no usage for this provider. */
  kind: 'windows' | 'accounts' | 'none';
  windows: UsageWindow[];
  accounts: UsageAccount[];
  /** A money balance, only when Hermes sends one (it doesn't today for Anthropic or Nous; see docs/HERMES.md). */
  credits: { amount: number; currency: string } | null;
  /** Model ids Hermes lists for this provider (to tell which provider a bot's model belongs to, and local tokens). */
  models: string[];
  /** Local provider (Ollama and other custom endpoints): there's no account to limit, only tokens. */
  local: boolean;
  /** The provider's Hermes row has no usage yet but could (cold cache): worth one more look. */
  pending: boolean;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseWindow(v: unknown): UsageWindow | null {
  if (!isObj(v)) return null;
  const used = num(v.used_percent);
  if (used === null) return null;
  const at = typeof v.resets_at === 'string' ? Date.parse(v.resets_at) : NaN;
  return {
    label: typeof v.label === 'string' && v.label ? v.label : 'Usage',
    percent: Math.min(100, Math.max(0, used)),
    resetsAt: Number.isNaN(at) ? null : at,
    scope: typeof v.scope === 'string' ? v.scope : 'account',
  };
}

const parseWindows = (v: unknown): UsageWindow[] => (Array.isArray(v) ? v.map(parseWindow).filter((w): w is UsageWindow => !!w) : []);

function parseAccount(v: unknown, i: number): UsageAccount | null {
  if (!isObj(v)) return null;
  const at = typeof v.resets_at === 'string' ? Date.parse(v.resets_at) : NaN;
  return {
    id: typeof v.id === 'string' && v.id ? v.id : `account-${i}`,
    label: typeof v.label === 'string' && v.label ? v.label : `Account ${i + 1}`,
    state: typeof v.state === 'string' ? v.state : 'unknown',
    resetsAt: Number.isNaN(at) ? null : at,
    windows: parseWindows(v.windows),
  };
}

/** A balance if Hermes ever sends `usage.credits` as a number or `{amount|remaining|balance, currency}`. Never guessed. */
function parseCredits(v: unknown): ProviderUsage['credits'] {
  const direct = num(v);
  if (direct !== null) return { amount: direct, currency: 'USD' };
  if (!isObj(v)) return null;
  const amount = num(v.amount) ?? num(v.remaining) ?? num(v.balance);
  if (amount === null) return null;
  return { amount, currency: typeof v.currency === 'string' && v.currency ? v.currency : 'USD' };
}

/** Parses the `providers` of /api/model/options into one entry per provider. Anything missing becomes 'none', never a guess. */
export function parseProviderUsage(body: unknown): ProviderUsage[] {
  const providers = isObj(body) && Array.isArray(body.providers) ? body.providers : [];
  const out: ProviderUsage[] = [];
  for (const p of providers) {
    if (!isObj(p) || typeof p.slug !== 'string') continue;
    if (p.authenticated === false) continue;
    const usage = isObj(p.usage) ? p.usage : null;
    const windows = usage ? parseWindows(usage.windows) : [];
    const accounts = usage && Array.isArray(usage.accounts) ? usage.accounts.map(parseAccount).filter((a): a is UsageAccount => !!a) : [];
    const kind: ProviderUsage['kind'] = accounts.length ? 'accounts' : windows.length ? 'windows' : 'none';
    const local = p.is_user_defined === true || p.slug.startsWith('custom:');
    out.push({
      slug: p.slug,
      name: typeof p.name === 'string' && p.name ? p.name : p.slug,
      kind,
      windows: kind === 'windows' ? windows : [],
      accounts,
      credits: usage ? parseCredits(usage.credits) : null,
      models: Array.isArray(p.models) ? p.models.filter((m): m is string => typeof m === 'string') : [],
      local,
      pending: kind === 'none' && !local && !usage,
    });
  }
  return out;
}

/** Subscription providers first (the ones with numbers), then the rest; each group keeps Hermes's order. */
export function sortProviders(list: ProviderUsage[]): ProviderUsage[] {
  const rank = (p: ProviderUsage) => (p.kind !== 'none' ? 0 : p.local ? 2 : 1);
  return list.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

/** The highest used window across every window of every provider (Fix 12), with who and which. */
export function topWindow(list: ProviderUsage[]): { provider: string; label: string; percent: number } | null {
  let best: { provider: string; label: string; percent: number } | null = null;
  for (const p of list) {
    const all = p.kind === 'accounts' ? p.accounts.flatMap((a) => a.windows) : p.windows;
    for (const w of all) if (!best || w.percent > best.percent) best = { provider: displayName(p), label: w.label, percent: w.percent };
  }
  return best;
}

export type GaugeState = { kind: 'none' } | { kind: 'value'; percent: number; level: Level; provider: string; label: string };

/** The header gauge: hidden when nothing reports a percent; the top window's ring otherwise. */
export function gaugeState(list: ProviderUsage[] | null): GaugeState {
  const w = list ? topWindow(list) : null;
  return w ? { kind: 'value', percent: w.percent, level: levelFor(w.percent), provider: w.provider, label: w.label } : { kind: 'none' };
}

/** What the comps call providers: Claude and Codex, else Hermes's own name. */
export function displayName(p: Pick<ProviderUsage, 'slug' | 'name'>): string {
  if (p.slug === 'anthropic') return 'Claude';
  if (p.slug === 'openai-codex') return 'Codex';
  return p.name;
}

export function subtitle(p: ProviderUsage): string {
  if (p.local) return 'Local model · no limits';
  if (p.kind !== 'none') return `${p.name} subscription`;
  return p.credits ? 'Credits' : '';
}

/** Countdown, floored to the unit, two units max: 3d 18h, 1h 59m, 42m, <1m. Null when past due. */
export function countdown(resetsAt: number, now: number): string | null {
  const ms = resetsAt - now;
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** "Resets in 1h 59m", or "Reset due" once it's past. */
export function resetLine(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return 'Reset time not given';
  const c = countdown(resetsAt, now);
  return c === null ? 'Reset due' : `Resets in ${c}`;
}

/** Device-local clock: today "7:00 PM", within 7 days "Sat 12:00 PM", later "Nov 28, 12:00 PM". */
export function clockLabel(at: number, now: number, locale?: string): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  if (at - now < 7 * 86400000 && at > now) return `${d.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
  return `${d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** "Updated just now", "Updated 12 min ago", "Updated 3 h ago", then "Updated Mon 9:41 AM". */
export function updatedLine(fetchedAt: number, now: number, locale?: string): string {
  const mins = Math.floor((now - fetchedAt) / 60000);
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins} min ago`;
  if (mins < 24 * 60) return `Updated ${Math.floor(mins / 60)} h ago`;
  const d = new Date(fetchedAt);
  return `Updated ${d.toLocaleDateString(locale, { weekday: 'short' })} ${d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
}

// ---- History -------------------------------------------------------------------------------------------------

export type Days = 7 | 30 | 90;
export const DAY_CHOICES: Days[] = [7, 30, 90];

export interface DayUsage {
  day: string;
  input: number;
  output: number;
  cacheRead: number;
  apiCalls: number;
  cost: number;
}

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  apiCalls: number;
  cost: number;
}

export interface BotUsage {
  bot: string;
  days: Days;
  input: number;
  output: number;
  cacheRead: number;
  apiCalls: number;
  /** Sum of Hermes's per-tool counts (the totals row has no tool_calls). */
  toolCalls: number;
  /** Estimated cost in USD. Hermes's actual cost is 0 for subscription and local models, so this is the estimate. */
  cost: number;
  daily: DayUsage[];
  models: ModelUsage[];
  /** The model with the most tokens, or null when the bot did nothing in the period. */
  topModel: string | null;
}

const n = (v: unknown): number => num(v) ?? 0; // SUM() over no rows is null in SQL

export function parseBotUsage(bot: string, days: Days, body: unknown): BotUsage {
  const b = isObj(body) ? body : {};
  const t = isObj(b.totals) ? b.totals : {};
  const daily = (Array.isArray(b.daily) ? b.daily : []).filter(isObj).map((d) => ({
    day: String(d.day ?? ''),
    input: n(d.input_tokens),
    output: n(d.output_tokens),
    cacheRead: n(d.cache_read_tokens),
    apiCalls: n(d.api_calls),
    cost: n(d.estimated_cost),
  }));
  const models = (Array.isArray(b.by_model) ? b.by_model : [])
    .filter(isObj)
    .filter((m) => typeof m.model === 'string' && m.model)
    .map((m) => ({ model: String(m.model), input: n(m.input_tokens), output: n(m.output_tokens), apiCalls: n(m.api_calls), cost: n(m.estimated_cost) }))
    .sort((x, y) => y.input + y.output - (x.input + x.output));
  const top = models.find((m) => m.input + m.output > 0);
  return {
    bot,
    days,
    input: n(t.total_input),
    output: n(t.total_output),
    cacheRead: n(t.total_cache_read),
    apiCalls: n(t.total_api_calls),
    toolCalls: (Array.isArray(b.tools) ? b.tools : []).filter(isObj).reduce((a, x) => a + n(x.count), 0),
    cost: n(t.total_estimated_cost),
    daily,
    models,
    topModel: top ? top.model : null,
  };
}

/** Tokens (Fix 12): exact under 1,000, then 1.2K, 10K, 912K, 1M (never 1000K), 14.9M, 120M, 1.3B. */
export function formatTokens(v: number): string {
  if (v < 1000) return String(Math.round(v));
  const units = ['K', 'M', 'B'];
  let i = v < 1e6 ? 0 : v < 1e9 ? 1 : 2;
  for (;;) {
    const val = v / 1000 ** (i + 1);
    const oneDecimal = i === 0 ? val < 10 : val < 100;
    let r = oneDecimal ? Math.round(val * 10) / 10 : Math.round(val);
    if (r >= 1000 && i < 2) {
      i += 1;
      continue;
    }
    return `${r}${units[i]}`.replace(/\.0(?=[KMB])/, '');
  }
}

/** A whole count with thousands separators: 1,284. */
export function formatCount(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

/** $3.41, $0.00, $1,284.50, <$0.01 for a non-zero amount under half a cent. */
export function formatCost(v: number): string {
  if (v > 0 && v < 0.005) return '<$0.01';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCredits(c: { amount: number; currency: string }): string {
  return c.currency === 'USD' ? formatCost(c.amount) : `${c.amount.toFixed(2)} ${c.currency}`;
}

export const botTokens = (u: BotUsage): number => u.input + u.output;
export const hasActivity = (u: BotUsage): boolean => botTokens(u) > 0 || u.apiCalls > 0;

/** Most tokens first; bots with no activity last, in their own order. */
export function sortBots(list: BotUsage[]): BotUsage[] {
  return list.map((u, i) => ({ u, i })).sort((a, b) => Number(hasActivity(b.u)) - Number(hasActivity(a.u)) || botTokens(b.u) - botTokens(a.u) || a.i - b.i).map((x) => x.u);
}

export function totalsOf(list: BotUsage[]): { tokens: number; apiCalls: number; cost: number } {
  return list.reduce((a, u) => ({ tokens: a.tokens + botTokens(u), apiCalls: a.apiCalls + u.apiCalls, cost: a.cost + u.cost }), { tokens: 0, apiCalls: 0, cost: 0 });
}

/** The provider (display name) that lists this model, from Hermes's own model lists; null when none does. */
export function providerOfModel(model: string, providers: ProviderUsage[]): string | null {
  const p = providers.find((x) => x.models.includes(model));
  return p ? displayName(p) : null;
}

/** Tokens on a local provider's models across every bot in the period. */
export function localTokens(p: ProviderUsage, bots: BotUsage[]): number {
  const set = new Set(p.models);
  return bots.reduce((a, u) => a + u.models.filter((m) => set.has(m.model)).reduce((b, m) => b + m.input + m.output, 0), 0);
}

/** A model's share of the bot's tokens, a whole percent. */
export function shareOf(m: ModelUsage, u: BotUsage): number {
  const total = botTokens(u);
  return total > 0 ? Math.round(((m.input + m.output) / total) * 100) : 0;
}

export interface DayPoint {
  day: string;
  tokens: number;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** One point per calendar day for the period ending today, input plus output (cache left out); days with nothing are 0. */
export function daySeries(u: BotUsage, now: number): DayPoint[] {
  const byDay = new Map(u.daily.map((d) => [d.day, d.input + d.output]));
  const out: DayPoint[] = [];
  const end = new Date(now);
  for (let i = u.days - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    out.push({ day: ymd(d), tokens: byDay.get(ymd(d)) ?? 0 });
  }
  return out;
}

/** A tidy top for the chart: 1, 2 or 5 times a power of ten (426K draws against 500K). */
export function niceTop(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

/** "Tue, Nov 10 · 409K tokens". Day is a local YYYY-MM-DD. */
export function calloutText(day: string, tokens: number, locale?: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${label} · ${formatTokens(tokens)} tokens`;
}

/** Labels under the plot: weekday letters (7), first/middle/Today (30), month starts (90). Index is the bar. */
export function axisLabels(series: DayPoint[], days: Days, locale?: string): { index: number; text: string }[] {
  const at = (i: number) => {
    const [y, m, d] = series[i].day.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  if (!series.length) return [];
  if (days === 7) return series.map((_, i) => ({ index: i, text: at(i).toLocaleDateString(locale, { weekday: 'narrow' }) }));
  if (days === 30) return [0, Math.ceil((series.length - 1) / 2), series.length - 1].map((i, k) => ({ index: i, text: k === 2 ? 'Today' : at(i).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) }));
  return series.flatMap((_, i) => (at(i).getDate() === 1 ? [{ index: i, text: at(i).toLocaleDateString(locale, { month: 'short' }) }] : []));
}

// ---- Client --------------------------------------------------------------------------------------------------

export interface UsageSnapshot {
  providers: ProviderUsage[];
  fetchedAt: number;
}

export class UsageClient {
  constructor(
    private readonly manager: Pick<HermesManager, 'api'>,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async options(refresh: boolean): Promise<ProviderUsage[]> {
    const res = await this.manager.api(`/api/model/options?include_unconfigured=false${refresh ? '&refresh=true' : ''}`);
    if (!res.ok) throw await fail(res, "Couldn't read the AI subscriptions from Hermes");
    return sortProviders(parseProviderUsage(await res.json()));
  }

  /**
   * The subscription windows. Hermes answers from its cache and refreshes in the background, so a cold cache gives
   * no usage; when no provider has any yet (and one could), wait once and ask again. `refresh` sends refresh=true (the
   * pull to refresh asks once, decision 4), which Hermes accepts but doesn't use for usage.
   */
  async providers(refresh = false, retryMs = 4000): Promise<UsageSnapshot> {
    let providers = await this.options(refresh);
    if (providers.some((p) => p.pending) && !providers.some((p) => p.kind !== 'none')) {
      await this.sleep(retryMs);
      providers = await this.options(false);
    }
    return { providers, fetchedAt: this.now() };
  }

  async bot(bot: string, days: Days): Promise<BotUsage> {
    const res = await this.manager.api(`/api/analytics/usage?days=${days}&profile=${encodeURIComponent(bot)}`);
    if (!res.ok) throw await fail(res, `Couldn't read ${bot}'s usage`);
    return parseBotUsage(bot, days, await res.json());
  }

  /** Every bot's usage; one bot failing doesn't hide the rest. */
  async bots(names: string[], days: Days): Promise<{ usage: BotUsage[]; errors: Record<string, string> }> {
    const usage: BotUsage[] = [];
    const errors: Record<string, string> = {};
    await Promise.all(
      names.map(async (name) => {
        try {
          usage.push(await this.bot(name, days));
        } catch (e) {
          errors[name] = e instanceof HermesError || e instanceof Error ? e.message : String(e);
        }
      }),
    );
    usage.sort((a, b) => names.indexOf(a.bot) - names.indexOf(b.bot));
    return { usage, errors };
  }
}

/**
 * The bots on this Hermes, like lib/sync.ts: every profile is a bot, except the default one unless it was added by
 * hand. `hidden` marks the ones this phone doesn't list (hidden on Hermes), which Fix 12 still shows.
 */
export function usageBotNames(profiles: { name: string; isDefault: boolean }[], saved: string[]): { names: string[]; hidden: Record<string, boolean> } {
  const have = new Set(saved);
  const names = profiles.filter((p) => !p.isDefault || have.has(p.name)).map((p) => p.name);
  return { names, hidden: Object.fromEntries(names.map((n) => [n, !have.has(n)])) };
}

/**
 * Windows whose reset time has passed ("Reset due", Fix 12): the screen refetches once for each. The key is
 * provider + label + the reset time shown, so a refetch that still carries the same stale time doesn't loop.
 */
export function dueResets(list: ProviderUsage[], now: number): string[] {
  const keys: string[] = [];
  for (const p of list) {
    const windows = p.kind === 'accounts' ? p.accounts.flatMap((a) => a.windows) : p.windows;
    for (const w of windows) if (w.resetsAt !== null && w.resetsAt <= now) keys.push(`${p.slug}|${w.label}|${w.resetsAt}`);
  }
  return keys;
}

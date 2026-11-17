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

/** Normal under 70% used, warning 70 to 90, red over 90 (card 25, decision 2). */
export function levelFor(percent: number): Level {
  if (percent > 90) return 'bad';
  if (percent >= 70) return 'warn';
  return 'ok';
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

/** The Claude session window, which drives the header gauge. Prefers the window called "Current session". */
export function claudeSession(list: ProviderUsage[]): UsageWindow | null {
  const claude = list.find((p) => p.slug === 'anthropic');
  if (!claude) return null;
  const all = claude.kind === 'accounts' ? claude.accounts.flatMap((a) => a.windows) : claude.windows;
  const session = all.filter((w) => /session/i.test(w.label));
  const pool = session.length ? session : [];
  return pool.length ? pool.reduce((a, b) => (b.percent > a.percent ? b : a)) : null;
}

export type GaugeState = { kind: 'none' } | { kind: 'value'; percent: number; level: Level };

/** The header gauge: grey with no data, red over 90% on the Claude session window (decision 5), amber 70 to 90. */
export function gaugeState(list: ProviderUsage[] | null): GaugeState {
  const w = list ? claudeSession(list) : null;
  return w ? { kind: 'value', percent: w.percent, level: levelFor(w.percent) } : { kind: 'none' };
}

/** "1h 59m", "3d 4h", "12m", "now". */
export function formatReset(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null;
  const mins = Math.ceil((resetsAt - now) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The screen's "resets in 1h 59m" line (the local time is added by the screen with the device's locale). */
export function resetLine(resetsAt: number | null, now: number): string {
  const rel = formatReset(resetsAt, now);
  return rel === null ? 'Reset time not given' : rel === 'now' ? 'Resetting now' : `Resets in ${rel}`;
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
    cost: n(t.total_estimated_cost),
    daily,
    models,
    topModel: top ? top.model : null,
  };
}

/** 1,234 → "1.2K", 3,400,000 → "3.4M". */
export function formatTokens(v: number): string {
  if (v < 1000) return String(Math.round(v));
  if (v < 1e6) return `${(v / 1e3).toFixed(v < 1e4 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(v / 1e6).toFixed(v < 1e7 ? 1 : 0).replace(/\.0$/, '')}M`;
}

export function formatCost(v: number): string {
  if (v === 0) return '$0.00';
  return v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
}

export function formatCredits(c: { amount: number; currency: string }): string {
  return c.currency === 'USD' ? `$${c.amount.toFixed(2)}` : `${c.amount.toFixed(2)} ${c.currency}`;
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

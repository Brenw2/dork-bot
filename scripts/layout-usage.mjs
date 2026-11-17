// Card 25: the Usage screen, the bot detail and the header gauge (docs/design/REVIEW.md "Fix 12" once it lands).
// `hermes serve` is faked from the real captures in test/fixtures (the Anthropic windows are b-lab's), with the
// reset times moved to "now + 1h 59m" so the text is stable. Each screen sets its data with `mock`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FX = join(import.meta.dirname, '..', 'test', 'fixtures');
const ANALYTICS = JSON.parse(readFileSync(join(FX, 'analytics-usage.json'), 'utf8'));
const EMPTY = JSON.parse(readFileSync(join(FX, 'analytics-usage-empty.json'), 'utf8'));
const OPTIONS = JSON.parse(readFileSync(join(FX, 'model-options-usage.json'), 'utf8'));

const iso = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const win = (label, used_percent, minutes) => ({ label, used_percent, resets_at: iso(minutes), scope: 'account' });
const RESET = 118.5; // minutes: "Resets in 1h 59m" for the next few seconds

/** Provider rows by scenario. */
function options(variant) {
  const providers = JSON.parse(JSON.stringify(OPTIONS.providers));
  const claude = providers.find((p) => p.slug === 'anthropic');
  if (variant === 'none') delete claude.usage;
  else if (variant === 'normal') claude.usage = { windows: [win('Current session', 34, RESET), win('Current week', 10, 3 * 24 * 60 + 5 * 60)] };
  else if (variant === 'warn') claude.usage = { windows: [win('Current session', 75, RESET), win('Current week', 40, 3 * 24 * 60)] };
  else if (variant === 'bad') claude.usage = { windows: [win('Current session', 93, RESET), win('Current week', 71, 3 * 24 * 60)] };
  else if (variant === 'pool') {
    claude.usage = { windows: [win('Current session', 91, RESET), win('Current week', 70, 3 * 24 * 60), win('Opus week', 69, 3 * 24 * 60)] };
    providers.push({
      slug: 'openai-codex',
      name: 'OpenAI Codex',
      is_current: false,
      is_user_defined: false,
      authenticated: true,
      usage: {
        accounts: [
          { id: 'a1', label: 'work', state: 'ready', resets_at: null, windows: [win('Session', 40, 200), win('Weekly', 90, 2 * 24 * 60)] },
          { id: 'a2', label: 'home', state: 'unknown', resets_at: null, windows: [] },
        ],
      },
    });
  }
  return { providers };
}

export async function usageMock(page, variant, analytics = 'real') {
  await page.route('https://hermes.test:8443/api/model/options*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(options(variant)) }),
  );
  await page.route('https://hermes.test:8443/api/analytics/usage*', (route) => {
    const profile = new URL(route.request().url()).searchParams.get('profile');
    const body = analytics === 'empty' || profile === 'scout' ? EMPTY : ANALYTICS;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const screen = (name, variant, extra = {}) => ({
  name,
  paired: true,
  path: () => '/usage',
  waitFor: 'Local model: tokens only', // after the 4 s second look when Hermes has no usage yet
  mock: (page) => usageMock(page, variant),
  ...extra,
});
const gauge = (name, variant, level) => ({
  name,
  paired: true,
  path: () => '/',
  waitFor: 'assistant',
  mock: (page) => usageMock(page, variant),
  settle: 1200,
  check: (page, posture) => page.evaluate(measureGauge, { level, posture }),
});

export const USAGE_SCREENS = [
  screen('usage', 'normal', { check: (page, posture) => page.evaluate(measureUsage, { variant: 'normal', posture }) }),
  screen('usage-thresholds', 'pool', { check: (page, posture) => page.evaluate(measureUsage, { variant: 'pool', posture }) }),
  screen('usage-no-data', 'none', { check: (page, posture) => page.evaluate(measureUsage, { variant: 'none', posture }) }),
  { name: 'usage-bot', paired: true, path: () => '/usage/assistant?days=7', waitFor: 'By model', mock: (page) => usageMock(page, 'normal'), check: (page, posture) => page.evaluate(measureBot, { posture }) },
  { name: 'usage-bot-idle', paired: true, path: () => '/usage/scout?days=30', waitFor: 'No activity in the last 30 days.', mock: (page) => usageMock(page, 'normal') },
  gauge('usage-gauge-none', 'none', 'none'),
  gauge('usage-gauge-ok', 'normal', 'ok'),
  gauge('usage-gauge-warn', 'warn', 'warn'),
  gauge('usage-gauge-red', 'bad', 'bad'),
];

// ---- in-page measurements (these run in the browser) ----------------------------------------------------

function measureUsage({ variant, posture }) {
  const problems = [];
  const text = document.body.innerText;
  const COLORS = { ok: 'rgb(76, 195, 138)', warn: 'rgb(242, 166, 90)', bad: 'rgb(240, 106, 106)' };
  const bars = [...document.querySelectorAll('[role=progressbar][aria-valuenow]')]; // not the loading spinner
  const fills = bars.map((b) => ({ now: Number(b.getAttribute('aria-valuenow')), color: getComputedStyle(b.firstElementChild).backgroundColor, w: b.getBoundingClientRect() }));
  const want = (n) => (n > 90 ? COLORS.bad : n >= 70 ? COLORS.warn : COLORS.ok);
  for (const f of fills) {
    if (f.color !== want(f.now)) problems.push(`a ${f.now}% bar should be ${want(f.now)}, got ${f.color}`);
    if (f.w.height < 6) problems.push(`progress bar too thin (${f.w.height})`);
  }
  const wantBars = { normal: 2, pool: 3 + 2, none: 0 }[variant];
  if (fills.length !== wantBars) problems.push(`expected ${wantBars} progress bars, found ${fills.length}`);
  if (variant === 'normal' && !fills.some((f) => f.now === 34)) problems.push('the Claude session (34%) bar is missing');
  if (variant !== 'none' && !/Resets in 1h (58|59)m/.test(text)) problems.push('the session reset line "Resets in 1h 59m" is missing');
  if (!/Current session/.test(text) && variant !== 'none') problems.push('"Current session" is missing');
  if (!/No usage data from Hermes/.test(text)) problems.push('a provider without usage should say "No usage data from Hermes"');
  if (!/Local model: tokens only/.test(text)) problems.push('the local provider should say it has tokens only');
  if (variant === 'pool' && !/work/i.test(text)) problems.push('the pooled account label is missing');
  for (const d of ['7 days', '30 days', '90 days'])
    if (!document.querySelector(`[role=tab][aria-label="${d}"]`)) problems.push(`segmented control is missing ${d}`);
  const tabs = [...document.querySelectorAll('[role=tab]')];
  if (tabs.length === 3 && tabs.some((t) => t.getBoundingClientRect().height < 32)) problems.push('segments must be at least 32 tall');
  const rows = [...document.querySelectorAll('[role=button]')].filter((b) => /in, .* out, .* API calls/.test(b.getAttribute('aria-label') ?? ''));
  if (rows.length < 3) problems.push(`expected a row for each of the 3 bots, found ${rows.length}`);
  for (const r of rows) if (r.getBoundingClientRect().height < 44) problems.push('a bot row is under 44 tall');
  return problems;
}

function measureBot() {
  const problems = [];
  const text = document.body.innerText;
  for (const t of ['Tokens in', 'Tokens out', 'API calls', 'Est. cost', 'Daily tokens', 'By model', 'qwen3.8:27b', 'claude-opus-5-5']) if (!text.toLowerCase().includes(t.toLowerCase())) problems.push(`"${t}" is missing`);
  const chart = document.querySelector('[aria-label^="Daily tokens,"]');
  if (!chart) problems.push('the daily chart is missing');
  else if (chart.getBoundingClientRect().height < 100) problems.push('the daily chart is too short');
  return problems;
}

function measureGauge({ level, posture }) {
  const problems = [];
  const btn = [...document.querySelectorAll('[role=button]')].find((b) => /^(Claude session|Usage\.)/.test(b.getAttribute('aria-label') ?? ''));
  if (!btn) return ['the usage gauge is missing from the bot list header'];
  const r = btn.getBoundingClientRect();
  const min = posture === 'desktop' ? 32 : 44;
  if (r.width < min || r.height < min) problems.push(`gauge target should be at least ${min}, got ${r.width}x${r.height}`);
  const label = btn.getAttribute('aria-label');
  const COLORS = { ok: 'rgb(76, 195, 138)', warn: 'rgb(242, 166, 90)', bad: 'rgb(240, 106, 106)', none: 'rgb(107, 112, 120)' };
  const ring = [...btn.querySelectorAll('circle')].pop();
  const stroke = ring ? getComputedStyle(ring).stroke || ring.getAttribute('stroke') : null;
  const pct = btn.innerText.trim();
  if (level === 'none') {
    if (!/No Claude session data/.test(label)) problems.push(`grey gauge label wrong: ${label}`);
    if (pct !== '–') problems.push(`grey gauge should show a dash, got ${pct}`);
  } else {
    const want = { ok: '34', warn: '75', bad: '93' }[level];
    if (pct !== want) problems.push(`gauge should say ${want}, got ${pct}`);
    const colorOf = (s) => (s ?? '').replace(/\s/g, '');
    const hex = { ok: '#4CC38A', warn: '#F2A65A', bad: '#F06A6A' }[level];
    const rgb = COLORS[level].replace(/\s/g, '');
    if (![hex.toLowerCase(), rgb].includes(colorOf(stroke).toLowerCase())) problems.push(`gauge ring should be ${level} (${hex}), got ${stroke}`);
  }
  return problems;
}

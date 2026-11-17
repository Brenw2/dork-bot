// Card 25: the Usage screen, the bot detail and the header gauge, measured against docs/design/REVIEW.md "Fix 12".
// `hermes serve` is faked from the real captures in test/fixtures (the Anthropic windows are b-lab's), with the
// reset times moved to "now + about 2h" so the text is stable. Each screen sets its data with `mock`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FX = join(import.meta.dirname, '..', 'test', 'fixtures');
const ANALYTICS = JSON.parse(readFileSync(join(FX, 'analytics-usage.json'), 'utf8'));
const EMPTY = JSON.parse(readFileSync(join(FX, 'analytics-usage-empty.json'), 'utf8'));
const OPTIONS = JSON.parse(readFileSync(join(FX, 'model-options-usage.json'), 'utf8'));

const iso = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const win = (label, used_percent, minutes) => ({ label, used_percent, resets_at: iso(minutes), scope: 'account' });
const SOON = 119.5; // minutes: "Resets in 1h 59m" (2h 0m for the first seconds)
const WEEK = 3 * 24 * 60 + 18 * 60 + 0.5;

/** Provider rows by scenario. */
function options(variant) {
  const providers = JSON.parse(JSON.stringify(OPTIONS.providers));
  const claude = providers.find((p) => p.slug === 'anthropic');
  if (variant === 'none') delete claude.usage;
  else if (variant === 'normal') claude.usage = { windows: [win('Current session', 29, SOON), win('Current week', 9, WEEK)] };
  else if (variant === 'warn') claude.usage = { windows: [win('Current session', 75, SOON), win('Current week', 40, WEEK)] };
  else if (variant === 'bad') claude.usage = { windows: [win('Current session', 93, SOON), win('Current week', 71, WEEK)] };
  else if (variant === 'pool') {
    claude.usage = { windows: [win('Current session', 91, SOON), win('Current week', 70, WEEK), win('Opus week', 69, WEEK)] };
    providers.push({
      slug: 'openai-codex',
      name: 'OpenAI Codex',
      is_current: false,
      is_user_defined: false,
      authenticated: true,
      models: [],
      usage: {
        accounts: [
          { id: 'a1', label: 'work', state: 'ready', resets_at: null, windows: [win('5-hour', 40, 200), win('Weekly', 90, 2 * 24 * 60)] },
          { id: 'a2', label: 'home', state: 'unknown', resets_at: null, windows: [] },
        ],
      },
    });
  }
  return { providers };
}

export async function usageMock(page, variant) {
  await page.route('https://hermes.test:8443/api/model/options*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(options(variant)) }),
  );
  await page.route('https://hermes.test:8443/api/analytics/usage*', (route) => {
    const profile = new URL(route.request().url()).searchParams.get('profile');
    const body = profile === 'scout' ? EMPTY : ANALYTICS;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// Fix 12 states that need Hermes to misbehave.
async function failing(page) {
  await page.route('https://hermes.test:8443/api/model/options*', (route) => route.abort('connectionrefused'));
  await page.route('https://hermes.test:8443/api/analytics/usage*', (route) => route.abort('connectionrefused'));
  await page.route('https://hermes.test:8443/api/profiles*', (route) => route.abort('connectionrefused'));
}

const screen = (name, variant, waitFor, check, extra = {}) => ({
  name,
  paired: true,
  path: () => '/usage',
  waitFor,
  mock: (page) => usageMock(page, variant),
  check: (page, posture) => page.evaluate(check, { variant, posture }),
  ...extra,
});
const gauge = (name, variant, level) => ({
  name,
  paired: true,
  path: () => '/',
  waitFor: 'assistant',
  mock: (page) => usageMock(page, variant),
  settle: 1500,
  check: (page, posture) => page.evaluate(measureGauge, { level, posture }),
});

export const USAGE_SCREENS = [
  screen('usage', 'normal', 'Local model · no limits', measureUsage),
  screen('usage-thresholds', 'pool', 'Local model · no limits', measureUsage),
  screen('usage-no-data', 'none', 'Local model · no limits', measureUsage),
  { name: 'usage-bot', paired: true, path: () => '/usage/assistant', waitFor: 'By model', mock: (page) => usageMock(page, 'normal'), check: (page, posture) => page.evaluate(measureBot, { posture }) },
  { name: 'usage-bot-idle', paired: true, path: () => '/usage/scout', waitFor: 'No activity in the last 30 days', mock: (page) => usageMock(page, 'normal'), check: (page) => page.evaluate(measureBotIdle) },
  { name: 'usage-unreachable', paired: true, path: () => '/usage', waitFor: "Can't reach b-lab", mock: failing, check: (page) => page.evaluate(() => (document.body.innerText.includes('Try again') ? [] : ['the Try again button is missing'])) },
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
  const want = (n) => (n > 90 ? COLORS.bad : n >= 70 ? COLORS.warn : COLORS.ok);
  const wantWord = (n) => (n >= 100 ? 'Limit reached' : n > 90 ? 'Almost out' : n >= 70 ? 'Running low' : null);
  // Each window is one element labelled "<label>, N percent used, ...": its bar and state word are measured from it.
  const rows = [...document.querySelectorAll('[aria-label*="percent used"]')].filter((e) => /^[^,]+, \d+ percent used, /.test(e.getAttribute('aria-label')));
  const wantRows = { normal: 2, pool: 5, none: 0 }[variant];
  if (rows.length !== wantRows) problems.push(`expected ${wantRows} window rows, found ${rows.length}`);
  for (const row of rows) {
    const label = row.getAttribute('aria-label');
    const n = Number(label.match(/(\d+) percent used/)[1]);
    const bar = [...row.querySelectorAll('div')].find((d) => getComputedStyle(d).height === '8px' && getComputedStyle(d).borderTopLeftRadius === '4px' && d.children.length <= 1);
    if (!bar) {
      problems.push(`${label}: no 8 tall bar`);
      continue;
    }
    const fill = bar.firstElementChild;
    if (n === 0) {
      if (fill) problems.push(`${label}: 0% must draw no fill`);
    } else if (!fill) problems.push(`${label}: no fill`);
    else {
      const cs = getComputedStyle(fill);
      if (cs.backgroundColor !== want(n)) problems.push(`${label}: ${n}% bar should be ${want(n)}, got ${cs.backgroundColor}`);
      if (fill.getBoundingClientRect().width < 7.5) problems.push(`${label}: the fill is narrower than 8px`);
    }
    const word = wantWord(n);
    const shows = (t) => [...row.querySelectorAll('div')].some((d) => d.children.length === 0 && d.textContent === t);
    for (const w of ['Running low', 'Almost out', 'Limit reached']) if (shows(w) !== (w === word)) problems.push(`${label}: state word ${w} should be ${w === word ? 'shown' : 'absent'}`);
    const pct = [...row.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent === `${n}%`);
    if (!pct) problems.push(`${label}: the percent text ${n}% is missing`);
    else if (n >= 70 && getComputedStyle(pct).color !== want(n)) problems.push(`${label}: percent text should be ${want(n)}`);
    if (!/Reset/.test(row.innerText)) problems.push(`${label}: no reset line`);
  }
  if (variant !== 'none' && !/Resets in (1h 5\dm|2h 0m)/.test(text)) problems.push('the session reset line "Resets in 1h 59m" is missing');
  if (variant !== 'none' && !/Resets in 3d 1[78]h/.test(text)) problems.push('the week reset line "Resets in 3d 18h" is missing');
  if (variant !== 'none' && !/Anthropic subscription/.test(text)) problems.push('the Claude subtitle "Anthropic subscription" is missing');
  if (variant !== 'none' && !/\n?Claude\n/.test(text)) problems.push('the provider is named Claude');
  if (!/No usage data from Hermes/.test(text)) problems.push('a provider without usage should say "No usage data from Hermes"');
  if (!/Local model · no limits/.test(text)) problems.push('the local provider should say "Local model · no limits"');
  if (!/Tokens · 30 days/.test(text)) problems.push('the local provider should have a "Tokens · 30 days" row');
  if (/Credits|Balance from/.test(text)) problems.push('no credits row should show when Hermes sends none');
  if (variant === 'pool' && !/work/i.test(text)) problems.push('the pooled account label is missing');
  for (const d of ['7 days', '30 days', '90 days']) if (!document.querySelector(`[role=tab][aria-label="${d}"]`)) problems.push(`segmented control is missing ${d}`);
  const selected = [...document.querySelectorAll('[role=tab]')].filter((t) => getComputedStyle(t).backgroundColor !== 'rgba(0, 0, 0, 0)');
  if (selected.length !== 1 || selected[0].getAttribute('aria-label') !== '30 days') problems.push('30 days should be the one selected period');
  else if (getComputedStyle(selected[0]).backgroundColor !== 'rgb(52, 48, 86)') problems.push(`selected segment should be mix(#8B7CF6,.30) = rgb(52, 48, 86), got ${getComputedStyle(selected[0]).backgroundColor}`);
  const seg = document.querySelector('[role=tablist]');
  if (seg && Math.abs(seg.getBoundingClientRect().height - 36) > 1) problems.push(`segmented control should be 36 tall, got ${seg.getBoundingClientRect().height}`);
  const btns = [...document.querySelectorAll('[role=button]')];
  const botRows = btns.filter((b) => /tokens in|no activity in/.test(b.getAttribute('aria-label') ?? ''));
  if (botRows.length < 2) problems.push(`expected a row for each bot, found ${botRows.length}`);
  for (const r of botRows) if (r.getBoundingClientRect().height < (posture === 'desktop' ? 60 : 64) - 1) problems.push('a bot row is shorter than the comp (64 phone, 60 desktop)');
  if (!/Tokens\n.*API calls\n.*Est\. cost|Est\. cost/s.test(text) || !text.includes('API calls')) problems.push('the totals card (Tokens, API calls, Est. cost) is missing');
  if (!text.includes('Tokens are input plus output. Cache is counted on its own. Costs are Hermes estimates.')) problems.push('the footnote is missing');
  if (!/Updated (just now|\d+ min ago)/.test(text)) problems.push('the Updated line is missing');
  if (posture !== 'desktop' && !document.querySelector('[aria-label="Back to Bots"]')) problems.push('the "‹ Bots" back button is missing');
  return problems;
}

function measureBot() {
  const problems = [];
  const text = document.body.innerText;
  for (const t of ['Input', 'Output', 'Cache', 'API calls', 'Tool calls', 'Est. cost', 'Tokens per day', 'By model', 'qwen3.8:27b', 'claude-opus-5-5', 'Dork', 'Claude']) if (!text.toLowerCase().includes(t.toLowerCase())) problems.push(`"${t}" is missing`);
  const chart = document.querySelector('[aria-label^="Tokens per day, busiest day"]');
  if (!chart) problems.push('the daily chart is missing');
  else if (chart.getBoundingClientRect().height < 132) problems.push('the chart plot should be at least 132 tall');
  if (!text.includes('Last 30 days') && !document.querySelector('[aria-label$="last 30 days"]')) problems.push('"Last 30 days" is missing from the nav');
  if (!document.querySelector('[aria-label="Back to Usage"]') && !document.querySelector('[role=tablist]')) problems.push('the bot detail is not showing');
  return problems;
}

function measureBotIdle() {
  const problems = [];
  const text = document.body.innerText;
  if (/by model/i.test(text)) problems.push('By model should be hidden for a bot with no activity');
  if (!text.includes('No activity in the last 30 days')) problems.push('the empty chart text is missing');
  if (!text.includes('$0.00')) problems.push('the cost tile should read $0.00');
  return problems;
}

function measureGauge({ level, posture }) {
  const problems = [];
  const btn = [...document.querySelectorAll('[role=button]')].find((b) => /Opens Usage\.$/.test(b.getAttribute('aria-label') ?? ''));
  if (level === 'none') return btn ? ['the gauge must be hidden when no provider reports a percent'] : [];
  if (!btn) return ['the usage gauge is missing from the bot list header'];
  const r = btn.getBoundingClientRect();
  const pillH = Math.round(r.height);
  if (pillH !== 32) problems.push(`the pill should be 32 tall, got ${pillH}`);
  const COLORS = { ok: 'rgb(76, 195, 138)', warn: 'rgb(242, 166, 90)', bad: 'rgb(240, 106, 106)' };
  const FILL = { ok: 'rgb(26, 28, 32)', warn: 'rgb(47, 37, 28)', bad: 'rgb(56, 32, 34)' };
  const cs = getComputedStyle(btn);
  if (cs.backgroundColor !== FILL[level]) problems.push(`pill fill should be ${FILL[level]}, got ${cs.backgroundColor}`);
  if (Math.round(parseFloat(cs.borderTopLeftRadius)) !== 16) problems.push(`pill radius should be 16, got ${cs.borderTopLeftRadius}`);
    const pct = btn.innerText.trim();
  if (pct !== `${{ ok: 29, warn: 75, bad: 93 }[level]}%`) problems.push(`gauge should say ${{ ok: 29, warn: 75, bad: 93 }[level]}%, got ${pct}`);
  const ring = [...btn.querySelectorAll('circle')].pop();
  const stroke = ring ? getComputedStyle(ring).stroke : null;
  const norm = (s) => (s ?? '').replace(/\s/g, '').toLowerCase();
  const hex = { ok: '#4cc38a', warn: '#f2a65a', bad: '#f06a6a' }[level];
  if (![hex, norm(COLORS[level])].includes(norm(stroke))) problems.push(`ring should be ${level} (${hex}), got ${stroke}`);
  const svg = btn.querySelector('svg');
  if (svg && Math.round(svg.getBoundingClientRect().width) !== 20) problems.push('the ring should be 20 wide');
  if (level !== 'ok') {
    const text = [...btn.querySelectorAll('div')].find((d) => d.children.length === 0);
    if (text && getComputedStyle(text).color !== COLORS[level]) problems.push(`percent text should be ${COLORS[level]}`);
  }
  if (['iphone', 'duo-closed', 'duo-open-portrait'].includes(posture) && Math.abs(r.left - 16) > 10) problems.push(`on the phone the pill sits at the left (16 from the edge), got x=${r.left}`);
  return problems;
}

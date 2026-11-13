#!/usr/bin/env node
// Layout tests: renders every screen of the web build in Chromium at the real
// iPhone / iPhone Duo window sizes and safe areas, with Hermes faked, and
// fails if any text or control is drawn where it can't be seen or used:
//   - outside the safe area left/right (the closed Duo's 84 pt status rail),
//   - on a keep-out region (the fold on the open Duo, the Dynamic Island),
//   - fixed controls (message box, Send, New bot) under the home indicator.
// Screenshots go to artifacts/layout/ for a look by eye.
//
//   npm run test:layout              # builds the web bundle first
//   node scripts/test-layout.mjs --no-build [--only duo-closed]
//
// Sizes: grok-export/design-comps/iphone-duo-2026-10-30 (PLAN.md §1, RESEARCH.md §2; Xcode 27.1 data).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist-web');
const OUT = join(ROOT, 'artifacts', 'layout');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

export const POSTURES = {
  iphone: { width: 402, height: 874, insets: { top: 62, right: 0, bottom: 34, left: 0 }, keepOut: [] },
  'duo-closed': {
    width: 466,
    height: 678,
    insets: { top: 0, right: 84, bottom: 34, left: 0 },
    keepOut: [{ name: 'status rail', x: 382, y: 0, width: 84, height: 678 }],
  },
  'duo-open-portrait': {
    width: 669,
    height: 951,
    insets: { top: 82, right: 0, bottom: 34, left: 0 },
    keepOut: [{ name: 'Dynamic Island', x: 525, y: 0, width: 144, height: 82 }],
  },
  'duo-open-landscape': {
    width: 951,
    height: 669,
    insets: { top: 0, right: 84, bottom: 34, left: 0 },
    // The fold isn't a keep-out: the two-pane view is a slim bot list plus a wide chat that
    // crosses the fold, the same way every screen crosses it in open portrait.
    keepOut: [{ name: 'status rail', x: 867, y: 0, width: 84, height: 669 }],
  },
};

const HERMES = 'https://hermes.test';
const ADMIN = 'https://hermes.test:8443';
const KEY = 'k'.repeat(40);
const BOTS = ['assistant', 'scout', 'a-bot-with-a-really-long-name-for-testing'];

const LONG_REPLY = [
  "Here's what I found. The Mets play the Braves at 7:10 tonight, and the forecast says rain after 9.",
  '',
  'Sources: https://www.mlb.com/mets/schedule/2026/fullseason?a_very_long_query_string_that_never_breaks=1234567890abcdefghijklmnop',
  '',
  'Command I ran:',
  'curl -s "https://api.weather.gov/gridpoints/OKX/33,35/forecast/hourly?units=us" | jq ".properties.periods[0:6]"',
].join('\n');

const MESSAGES = [
  { id: 1, role: 'user', content: 'what time is the mets game tonight and will it rain' },
  { id: 2, role: 'assistant', content: '', tool_name: null },
  { id: 3, role: 'tool', content: '{"ok":true}', tool_name: 'skill_view' },
  { id: 31, role: 'tool', content: 'ls ~/notes', tool_name: 'terminal' },
  { id: 32, role: 'tool', content: '{"results":[]}', tool_name: 'web_search' },
  { id: 33, role: 'tool', content: 'curl -s https://api.weather.gov', tool_name: 'terminal' },
  { id: 4, role: 'assistant', content: LONG_REPLY },
  { id: 5, role: 'user', content: 'thanks' },
  { id: 6, role: 'assistant', content: 'Any time.' },
];

// A reply with everything a bot writes: headings, lists, a table, inline code and long code lines
// that must scroll sideways instead of running off screen. Plus a sent picture (a file on Hermes).
const RICH_REPLY = [
  '## Fix for the flaky test',
  '',
  'The race is in `waitForBot`: it polls **before** the key is set. Two changes:',
  '',
  '1. Set the key first, then poll.',
  '2. Give up after `30_000` ms with a *clear* error.',
  '',
  '```typescript',
  'export async function waitForBot(conn: BotConnection, fetchImpl: FetchLike, opts: WaitOptions = {}): Promise<void> {',
  '  const { timeoutMs = 30_000, intervalMs = 2_000 } = opts; // a deliberately long line to force sideways scrolling in the block',
  '  for (;;) {',
  '    try {',
  "      await new HermesClient(conn, fetchImpl).check();",
  '      return;',
  '    } catch (err) {',
  '      if (Date.now() >= deadline) throw err;',
  '    }',
  '  }',
  '}',
  '```',
  '',
  'Run it:',
  '',
  '```bash',
  'DORK_LIVE=1 npx vitest run test/live-manager.test.ts --silent=false',
  '```',
  '',
  '| Step | Before | After |',
  '| --- | ---: | ---: |',
  '| Create bot | 1.2 s | 1.1 s |',
  '| First chat | flaky | 8.0 s |',
  '',
  '> Tip: keep the template bot on Dork.',
  '',
  '- [x] key set before polling',
  '- [ ] add a live test for the timeout',
].join('\n');
const PICTURE = `data:image/png;base64,${readFileSync(join(ROOT, 'assets', 'icon.png')).toString('base64')}`;
const RICH_MESSAGES = [
  { id: 1, role: 'user', content: 'why does this test fail?\n\n[Image attached at: /home/b/.hermes/profiles/coder/cache/documents/native-inputs/aa/api_aa.png]\n[screenshot]' },
  { id: 2, role: 'assistant', content: RICH_REPLY },
  { id: 3, role: 'user', content: 'perfect, thanks' },
  { id: 4, role: 'assistant', content: 'Any time. Ping me if `npm test` goes red again.' },
];

// A chat with a "Notify me" routine's result in it (a user-role row starting with the marker, lib/routineNotes.ts).
const NOTE_MESSAGES = [
  { id: 1, role: 'user', content: 'what is in the news today' },
  { id: 2, role: 'assistant', content: 'Here you go.' },
  { id: 3, role: 'user', content: `[Routine · daily_digest · ${new Date(Date.now() - 36e5).toISOString()}]\nThree stories today.\n\n- The Mets won 4-2.\n- Rain after 9.\n- Markets are flat.` },
  { id: 4, role: 'user', content: 'thanks' },
  { id: 5, role: 'assistant', content: 'Any time.' },
];

const PROFILES = [
  { name: 'default', is_default: true, model: 'claude', provider: 'anthropic', description: '' },
  {
    name: 'assistant',
    model: 'gemma4:31b',
    provider: 'custom',
    description: 'Personal assistant for Brennan: email, calendar, morning digest, reminders, family.',
  },
  {
    name: 'chief',
    model: 'gemma4:31b',
    provider: 'custom',
    description: 'Chief of staff: manages all of the products and the other agents assigned to them.',
  },
  { name: 'coder', model: 'gemma4:31b', provider: 'custom', description: 'Writes and fixes code.' },
];

// The real model list from b-lab (test/fixtures/model-options.json), as a Dork-pinned bot sees it.
const RAW_MODELS = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'model-options.json'), 'utf8'));
const MODEL_OPTIONS = {
  ...RAW_MODELS,
  model: 'gemma4:31b',
  provider: 'custom',
  providers: RAW_MODELS.providers.map((p) => ({ ...p, is_current: p.slug === 'custom:dork' })),
};

// A bot's chats (GET /api/sessions?source=api_server), and a routine (GET /api/jobs).
const NOW_S = Date.now() / 1000;
const CHATS = [
  { id: 'dork-bot-assistant--mh3x1abc1', source: 'api_server', title: 'Mets tickets for Saturday, two seats on the first base side if they have them', message_count: 9, last_active: NOW_S - 120, preview: 'what time is the mets game tonight and will it rain' },
  { id: 'dork-bot-assistant', source: 'api_server', title: 'Dork Bot: assistant', message_count: 95, last_active: NOW_S - 86400 * 2, preview: 'What model are you running?' },
  { id: 'dork-bot-assistant--mh2aaaaa1', source: 'api_server', title: null, message_count: 2, last_active: NOW_S - 86400 * 20, preview: 'why does this test fail?\n\n[Image attached at: /x/api_aa.png]\n[screenshot]' },
];
// A bot's Work: its non-app sessions (GET /api/sessions, no source filter): a terminal run that is still
// going, a finished one, another bot's request that failed. The routine run and the app chat in the same
// list must NOT show up in Work.
const WORK_SESSIONS = [
  { id: 'local-3f9a1c', source: 'oneshot', title: 'Fix the flaky Mets score test and open a PR for review by Design', message_count: 7, started_at: NOW_S - 95, last_active: NOW_S - 4, ended_at: null, end_reason: null, preview: 'From Chief. Fix the flaky test' },
  { id: 'local-77be02', source: 'oneshot', title: "Summarize this week's notes", message_count: 5, started_at: NOW_S - 7200, last_active: NOW_S - 3700, ended_at: NOW_S - 3600, end_reason: 'cli_close', preview: "Summarize this week's notes" },
  { id: 'local-12ff90', source: 'api_server', title: null, message_count: 3, started_at: NOW_S - 86400 * 2, last_active: NOW_S - 86400 * 2 + 60, ended_at: NOW_S - 86400 * 2 + 90, end_reason: 'error: provider timeout', preview: 'From chief: pull the latest standings and post them to the team doc' },
  { id: 'cron_e9c3318a1531_20261112_0800', source: 'cron', title: 'daily_digest · Nov 12 08:00', message_count: 2, started_at: NOW_S - 3600 * 5, last_active: NOW_S - 3600 * 5, ended_at: NOW_S - 3600 * 5, end_reason: 'cron_complete', preview: 'Write my morning digest' },
  { id: 'dork-bot-assistant', source: 'api_server', title: 'Dork Bot: assistant', message_count: 95, started_at: NOW_S - 86400 * 9, last_active: NOW_S - 120, ended_at: null, end_reason: null, preview: 'What model are you running?' },
];
const WORK_MESSAGES = {
  'local-3f9a1c': [
    { id: 1, role: 'user', content: 'From Chief. The Mets score test is flaky on CI. Find out why, fix it, and open a PR for Design to review.' },
    { id: 2, role: 'assistant', content: 'Let me look at the test first.', tool_calls: [{}] },
    { id: 3, role: 'tool', content: 'ok', tool_name: 'terminal' },
    { id: 4, role: 'tool', content: 'ok', tool_name: 'read_file' },
    { id: 5, role: 'tool', content: 'ok', tool_name: 'patch' },
    { id: 6, role: 'assistant', content: "The test reads the clock before the fake server is up. I'm moving the wait in and re-running it now." },
  ],
  'local-77be02': [
    { id: 1, role: 'user', content: "Summarize this week's notes" },
    { id: 2, role: 'tool', content: 'ok', tool_name: 'read_file' },
    { id: 3, role: 'assistant', content: '**Done.** Three themes this week: the Duo QA, the busy icon, and the push avatars. Details are in the notes file.' },
  ],
  'local-12ff90': [
    { id: 1, role: 'user', content: 'From chief: pull the latest standings and post them to the team doc' },
    { id: 2, role: 'assistant', content: "I couldn't finish: the model provider timed out." },
  ],
};
const JOBS = [
  {
    id: 'e9c3318a1531', name: 'daily_digest', prompt: 'Write my morning digest for today: calendar, email that needs me, and anything due this week.',
    schedule_display: '0 8 * * *', enabled: true, state: 'scheduled', next_run_at: new Date(Date.now() + 36e5 * 12).toISOString(),
    last_run_at: new Date(Date.now() - 36e5 * 8).toISOString(), last_status: 'ok', last_error: null,
  },
  {
    id: 'f00', name: 'mets_score_with_a_really_long_routine_name_that_has_to_be_cut_off', prompt: 'Check the Mets score.',
    schedule_display: 'every 1h', enabled: false, state: 'paused', next_run_at: null, last_run_at: null, last_status: null, last_error: null,
  },
];

const SERVERS = [
  { name: 'trello', transport: 'http', url: 'https://mcp.trello.com/v1', auth: 'oauth', enabled: true, source: 'config' },
  { name: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp', auth: 'oauth', enabled: true, source: 'config' },
];
// A slice of the real catalog from b-lab (GET /api/mcp/catalog).
const CATALOG = [
  ['airtable', 'Bases, tables, and records from your Airtable workspace.', 'oauth'],
  ['asana', 'Tasks, projects, and portfolios in Asana.', 'oauth', ['ASANA_CLIENT_ID', 'ASANA_CLIENT_SECRET']],
  ['deepwiki', 'Ask questions about any public GitHub repository, with a really long description that has to wrap or be cut off.', 'none'],
  ['linear', 'Issues and projects in Linear.', 'oauth'],
  ['notion', 'Pages and databases in your Notion workspace.', 'oauth'],
  ['strava', 'Your activities, routes and segments on Strava.', 'oauth'],
].map(([name, description, auth_type, env = []]) => ({
  name, description, transport: 'http', auth_type, url: `https://mcp.${name}.com/mcp`, needs_install: false, installed: false,
  required_env: env.map((n) => ({ name: n, prompt: n, required: true })),
}));

function seedFor(screen) {
  const store = {};
  if (screen.bots !== false) {
    const bots = [...BOTS, ...(screen.extraBots ?? [])];
    store['dork-bots'] = JSON.stringify(bots.map((bot, i) => ({ bot, url: HERMES, addedAt: i })));
    for (const bot of bots) store[`dork-bot-key.${bot}`] = KEY;
  }
  if (screen.paired) store['dork-hermes-manager'] = JSON.stringify({ adminUrl: ADMIN, chatUrl: HERMES, refreshToken: 'r'.repeat(40) });
  return store;
}

// Each screen: a path per layout (the open Duo in landscape shows the chat in the right pane).
const SCREENS = [
  { name: 'bots', path: () => '/', waitFor: 'assistant' },
  { name: 'bots-empty', bots: false, path: () => '/', waitFor: 'No bots yet' },
  { name: 'chat', path: (p) => (p === 'duo-open-landscape' ? '/?bot=assistant' : '/chat/assistant'), waitFor: 'Any time.' },
  { name: 'new-unpaired', path: () => '/new', waitFor: 'Connect to Hermes first' },
  { name: 'new', paired: true, path: () => '/new', waitFor: 'Already on Hermes' },
  { name: 'add', path: () => '/add', waitFor: 'Hermes address' },
  { name: 'connectors', paired: true, path: () => '/connectors/assistant', waitFor: 'Needs you to sign in' },
  { name: 'chat-model-problem', extraBots: ['chief'], path: (p) => (p === 'duo-open-landscape' ? '/?bot=chief' : '/chat/chief'), waitFor: 'which doesn' },
  { name: 'model', path: () => '/model/assistant', waitFor: 'claude-opus-5-5' },
  { name: 'connectors-unpaired', path: () => '/connectors/assistant', waitFor: 'Connect to Hermes first' },
  // Two panes with the bot list hidden: the chat takes the whole width.
  { name: 'chat-list-hidden', postures: ['duo-open-landscape'], click: 'Hide the bot list', path: () => '/?bot=assistant', waitFor: 'Any time.' },
  { name: 'chats', path: () => '/chats/assistant', waitFor: 'Mets tickets' },
  { name: 'routines', path: () => '/routines/assistant', waitFor: 'daily_digest' },
  // Card 20: a bot's Work list, and one running work session opened read-only.
  { name: 'work', path: () => '/work/assistant', waitFor: 'Summarize this week' },
  { name: 'work-session', path: () => '/work-session/assistant?id=local-3f9a1c', waitFor: 'The test reads the clock' },
  { name: 'work-session-done', path: () => '/work-session/assistant?id=local-77be02', waitFor: 'Three themes' },
  { name: 'chat-rich', paired: true, extraBots: ['coder'], path: (p) => (p === 'duo-open-landscape' ? '/?bot=coder' : '/chat/coder'), waitFor: 'Ping me if' },
  // A routine's result in the chat (card, no bot name above it), and a routine expanded with its Notify me row.
  { name: 'chat-routine-card', paired: true, extraBots: ['newsie'], path: (p) => (p === 'duo-open-landscape' ? '/?bot=newsie' : '/chat/newsie'), waitFor: 'Three stories today.' },
  // Card 19 fix 10: the bot sheet (tap the chat title, long-press a row).
  { name: 'bot-sheet', paired: true, path: () => '/bot/assistant', waitFor: 'Routine results' },
  { name: 'routines-expanded', path: () => '/routines/assistant', click: 'daily_digest,', waitFor: 'daily_digest', then: 'Notify me' },
];

async function fakeHermes(route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const p = url.pathname;
  // Gateway API server, one bot per /p/<bot>/.
  const bot = p.match(/^\/p\/([^/]+)\//)?.[1];
  if (bot === 'scout' && p.endsWith('/api/sessions')) return json(401, { error: 'unauthorized' }); // shows a red status
  if (/\/api\/sessions$/.test(p) && req.method() === 'GET')
    return json(200, { data: bot !== 'assistant' ? [] : url.searchParams.get('source') === 'api_server' ? CHATS : url.searchParams.get('source') ? [] : WORK_SESSIONS });
  if (/\/api\/jobs$/.test(p)) return json(200, { jobs: bot === 'assistant' ? JOBS : [] });
  if (/\/api\/sessions$/.test(p) && req.method() === 'POST') return json(409, { error: 'exists' });
  const sid = p.match(/\/api\/sessions\/([^/]+)/)?.[1];
  if (/\/api\/sessions\/[^/]+\/messages$/.test(p)) return json(200, { data: WORK_MESSAGES[sid] ?? (bot === 'coder' ? RICH_MESSAGES : bot === 'newsie' ? NOTE_MESSAGES : MESSAGES) });
  if (WORK_MESSAGES[sid] && /\/api\/sessions\/[^/]+$/.test(p)) return json(200, { session: WORK_SESSIONS.find((w) => w.id === sid) });
  if (/\/api\/sessions\/[^/]+$/.test(p)) return json(200, { session: { id: 'dork-bot-assistant', model: 'gemma4:31b' } });
  // chief: moved to Anthropic while its chat still says gemma4:31b (what broke it on 2026-11-03).
  if (p.endsWith('/api/model/options')) return json(200, bot === 'chief' ? RAW_MODELS : MODEL_OPTIONS);
  // hermes serve.
  if (p === '/auth/native/refresh')
    return json(200, { access_token: 'a'.repeat(40), refresh_token: 'r'.repeat(40), expires_at: Date.now() / 1000 + 3600 });
  if (p === '/api/profiles') return json(200, { profiles: PROFILES });
  if (p === '/api/files/read') return json(200, { name: 'api_aa.png', mime_type: 'image/png', data_url: PICTURE });
  if (p === '/api/config') return json(200, {});
  if (p === '/api/mcp/servers') return json(200, { servers: SERVERS });
  if (p === '/api/mcp/catalog') return json(200, { entries: CATALOG });
  const test = p.match(/^\/api\/mcp\/servers\/([^/]+)\/test$/)?.[1];
  if (test === 'trello') return json(200, { ok: true, tools: Array.from({ length: 14 }, (_, i) => ({ name: `t${i}`, description: '' })) });
  if (test) return json(200, { ok: false, error: 'OAuth authentication required — no token found.', tools: [] });
  return json(404, { error: `no fake for ${req.method()} ${p}` });
}

// Runs in the page: every visible glyph box and control, checked against the posture's safe area and keep-outs.
function audit({ insets, keepOut, fixed, seen }) {
  const W = innerWidth;
  const H = innerHeight;
  const problems = [];
  const label = (el) =>
    (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 60);
  const hits = (r, k) => r.left < k.x + k.width - 0.5 && r.right > k.x + 0.5 && r.top < k.y + k.height - 0.5 && r.bottom > k.y + 0.5;
  const onScreenY = (r) => r.bottom > 0 && r.top < H;
  const boxes = [];
  const CONTROLS = '[role=button], [role=link], button, textarea, input, a[href]';

  // What's actually painted: the box cut down by every ancestor that clips (an ellipsized line, a pane).
  const visible = (el, r) => {
    let { left, top, right, bottom } = r;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const c = a.getBoundingClientRect();
        if (cs.overflowX !== 'visible') [left, right] = [Math.max(left, c.left), Math.min(right, c.right)];
        if (cs.overflowY !== 'visible') [top, bottom] = [Math.max(top, c.top), Math.min(bottom, c.bottom)];
      }
    }
    return right - left > 0.5 && bottom - top > 0.5 ? { left, top, right, bottom } : null;
  };
  const shown = (el) => {
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') return false;
    }
    return true;
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || !shown(n.parentElement) || n.parentElement.closest('noscript')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const raw of range.getClientRects()) {
      const r = visible(n.parentElement, raw);
      if (r) boxes.push({ kind: 'text', what: n.textContent.trim().slice(0, 60), r, raw });
    }
  }
  for (const el of document.querySelectorAll(CONTROLS)) {
    const r = shown(el) && visible(el, el.getBoundingClientRect());
    if (r) boxes.push({ kind: 'control', what: label(el), r });
  }

  for (const b of boxes) {
    const { r } = b;
    if (!onScreenY(r)) continue;
    if (r.left < insets.left - 0.5 || r.right > W - insets.right + 0.5) {
      problems.push(
        `${b.kind} "${b.what}" spans x ${r.left.toFixed(1)}–${r.right.toFixed(1)}, outside the safe area (${insets.left}–${W - insets.right})`,
      );
      continue;
    }
    for (const k of keepOut)
      if (hits(r, k))
        problems.push(
          `${b.kind} "${b.what}" is on the ${k.name} (x ${r.left.toFixed(1)}–${r.right.toFixed(1)}, y ${r.top.toFixed(1)}–${r.bottom.toFixed(1)})`,
        );
  }
  // Controls that must stay reachable: fully on screen, above the home indicator, below the top inset.
  for (const sel of fixed) {
    const el = [...document.querySelectorAll(CONTROLS)].find((e) => shown(e) && label(e).includes(sel));
    if (!el) {
      problems.push(`missing control "${sel}"`);
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.top < insets.top - 0.5 || r.bottom > H - insets.bottom + 0.5) {
      problems.push(
        `control "${sel}" at y ${r.top.toFixed(1)}–${r.bottom.toFixed(1)} is outside the safe area (${insets.top}–${H - insets.bottom})`,
      );
    }
  }
  // Text that must be fully in view when the screen opens (the newest chat message).
  for (const want of seen) {
    const box = boxes.find((b) => b.kind === 'text' && b.what.includes(want));
    const cut = box && (box.r.top > box.raw.top + 0.5 || box.r.bottom < box.raw.bottom - 0.5);
    if (!box || cut || box.raw.bottom > H - insets.bottom) problems.push(`"${want}" isn't fully in view when the screen opens`);
  }
  return [...new Set(problems)];
}

// Design fix 7 (transcript rhythm), measured in the page: body sizes, the bubble's width and padding, no bot
// name over replies, and the space between rows (4 / 16 / 20 / 10). Runs on the chat screens with `thanks`.
function measureTranscript() {
  const problems = [];
  const px = (v) => parseFloat(v);
  const leaf = (text) => [...document.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent.trim() === text);
  const thanks = leaf('thanks');
  const reply = leaf('Any time.');
  if (!thanks || !reply) return ['transcript: "thanks" / "Any time." not found'];
  const W = innerWidth;
  const desktop = false; // the web build is never the desktop shell
  const body = desktop ? 16 : 17;
  const ts = getComputedStyle(thanks);
  const rs = getComputedStyle(reply);
  if (px(ts.fontSize) !== body || px(ts.lineHeight) !== 22) problems.push(`your bubble text should be ${body}/22, got ${ts.fontSize}/${ts.lineHeight}`);
  if (px(rs.fontSize) !== body || px(rs.lineHeight) !== 24) problems.push(`reply text should be ${body}/24, got ${rs.fontSize}/${rs.lineHeight}`);
  const bubble = thanks.parentElement;
  const br = bubble.getBoundingClientRect();
  const bs = getComputedStyle(bubble);
  if (px(bs.paddingTop) !== 9 || px(bs.paddingLeft) !== 14 || px(bs.borderTopLeftRadius) !== 18) problems.push(`bubble should be padding 9x14, radius 18, got ${bs.paddingTop}/${bs.paddingLeft}/${bs.borderTopLeftRadius}`);
  if (br.width > W * 0.78 + 1) problems.push(`bubble is ${br.width.toFixed(0)} wide, over 78% of ${W}`);
  // Text blocks: climb from a leaf to the block that draws the whole line box (links and code are spans).
  const block = (el) => {
    let p = el;
    while (p.tagName === 'SPAN' && p.parentElement) p = p.parentElement;
    return p.getBoundingClientRect();
  };
  const before = [...document.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent.includes('api.weather.gov'));
  if (before) {
    const gap = br.top - block(before).bottom;
    if (Math.abs(gap - 20) > 2) problems.push(`bot reply → your bubble should be 20 apart, got ${gap.toFixed(1)}`);
  }
  const gapMe = block(reply).top - br.bottom;
  if (Math.abs(gapMe - 16) > 2) problems.push(`your bubble → bot reply should be 16 apart, got ${gapMe.toFixed(1)}`);
  // No bot name label over a 1:1 reply: "assistant" may be in the header and the bot list, not in the chat column.
  const boxTop = document.querySelector('textarea')?.getBoundingClientRect().top ?? innerHeight;
  const rl = reply.getBoundingClientRect().left;
  const named = [...document.querySelectorAll('div,span')].filter((e) => {
    if (e.children.length || !/^assistant$/i.test(e.textContent.trim())) return false;
    const r = e.getBoundingClientRect();
    return r.left >= rl - 1 && r.top > 110 && r.bottom < boxTop;
  });
  if (named.length) problems.push(`the bot's name repeats in the transcript (${named.length}×)`);
  // A bare link shows without its scheme, cut at 40 characters.
  const link = [...document.querySelectorAll('[role=link]')].find((e) => e.textContent.includes('mlb.com'));
  if (!link) problems.push('the mlb.com link is missing');
  else if (/^https?:/.test(link.textContent) || [...link.textContent].length > 40) problems.push(`bare link should drop the scheme and stay within 40 characters, got "${link.textContent}"`);
  return problems;
}

// Card 20 nit: the Work row's chevron is #5D626A (was the too-faint #4B4F56).
function measureChats() {
  const chev = [...document.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent.trim() === '›');
  if (!chev) return ['the Work row chevron is missing'];
  const c = getComputedStyle(chev).color;
  return c === 'rgb(93, 98, 106)' ? [] : [`Work row chevron should be #5D626A, got ${c}`];
}

const FIXED = { chat: ['Message assistant', 'Send', 'Bot settings', 'Add a picture', "assistant's chats", 'More for this chat'], 'chat-list-hidden': ['Show the bot list', 'Message assistant', 'Send', "assistant's chats", 'More for this chat'], 'chat-rich': ['Message coder', 'Send', 'Add a picture'], 'chat-model-problem': ['Message chief', 'Pick model'], bots: ['New bot', 'More'], chats: ['New chat', "assistant's work", 'Search chats'], work: [], 'work-session': [], routines: ['New routine'], 'bots-empty': ['New bot'], new: ['Create bot'], add: ['Add'], connectors: ['Search connectors'], model: ['Search models'], 'bot-sheet': ['Done', 'Chats for assistant', 'Routines for assistant', 'Connectors for assistant', 'Look for assistant', 'Model:'] };
const SEEN = { chat: ['Any time.'], 'chat-list-hidden': ['Any time.'], 'chat-rich': ['Ping me if'], 'work-session': ['The test reads the clock'], 'work-session-done': ['Three themes'] };

function serve(dir) {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ttf': 'font/ttf',
    '.css': 'text/css',
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(dir, path);
    if (!file.startsWith(dir) || !existsSync(file) || path.endsWith('/')) file = join(dir, 'index.html'); // SPA fallback
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(p)) return p;
  return undefined; // playwright-core's own download (npx playwright-core install chromium)
}

// Desktop window: the message box starts at one line, grows with its text, stops at 40% of the chat pane
// (then scrolls), keeps Send level with its bottom, keeps the newest message in view, and shrinks after Send.
const DESKTOP = { width: 1280, height: 800 };
async function composerTest(browser, base) {
  const problems = [];
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  await page.addInitScript(
    ({ store }) => {
      for (const [k, v] of Object.entries(store)) localStorage.setItem(`dorkbot.${k}`, v);
    },
    { store: seedFor({}) },
  );
  await page.route(`${HERMES}/**`, fakeHermes);
  await page.goto(`${base}/?bot=assistant`); // wide windows show the chat in the right-hand pane
  await page.getByText('Any time.', { exact: false }).first().waitFor({ timeout: 15_000 });
  const box = page.getByLabel('Message assistant');
  const measure = () =>
    page.evaluate(() => {
      const ta = document.querySelector('textarea');
      const r = ta.getBoundingClientRect();
      const send = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Send')?.getBoundingClientRect();
      const last = [...document.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Any time.');
      const lr = last?.getBoundingClientRect();
      return { h: r.height, top: r.top, bottom: r.bottom, sendBottom: send?.bottom, scrolls: ta.scrollHeight > ta.clientHeight + 1, lastBottom: lr?.bottom, H: innerHeight };
    });
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
  // Layout settles a few frames after the text changes (the box grows, then the list below it resizes and
  // scrolls back to the newest message). Measure once two reads in a row agree, not on the first frame: on a
  // busy machine the first read still shows the old scroll position (it read bottom 580 vs box top 496).
  const settled = async () => {
    let prev = await measure();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(50);
      const cur = await measure();
      if (JSON.stringify(cur) === JSON.stringify(prev)) return cur;
      prev = cur;
    }
    return prev;
  };
  await page.waitForTimeout(300);
  const one = await measure();
  await box.fill(lines(1));
  const m1 = await settled();
  await box.fill(lines(5));
  const m5 = await settled();
  await box.fill(lines(30));
  const m30 = await settled();
  const cap = DESKTOP.height * 0.4;
  const check = (ok, msg) => ok || problems.push(msg);
  check(Math.abs(m1.h - 44) < 1 && Math.abs(one.h - 44) < 1, `1 line should be 44 px tall, got ${one.h} / ${m1.h}`);
  check(m5.h > m1.h + 60 && m5.h < cap && !m5.scrolls, `5 lines should grow past 1 line without scrolling, got ${m5.h} (1 line ${m1.h}, cap ${cap})`);
  check(m30.h <= cap + 1 && m30.h > 0.3 * DESKTOP.height && m30.h > m5.h && m30.scrolls, `30 lines should stop at the cap (under 40% of the pane, so under ${cap}) and scroll, got ${m30.h}, scrolls ${m30.scrolls}`);
  check(Math.abs(m30.sendBottom - m30.bottom) < 1, `Send should stay level with the bottom of the box (${m30.sendBottom} vs ${m30.bottom})`);
  check(m30.lastBottom !== undefined && m30.lastBottom <= m30.top + 0.5, `newest message overlaps the box or is out of view (bottom ${m30.lastBottom}, box top ${m30.top})`);
  // The cap follows the window.
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.waitForTimeout(300);
  const small = await measure();
  check(small.h <= 640 * 0.4 + 1 && small.h < m30.h, `after shrinking the window the cap should follow, got ${small.h}`);
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(300);
  // Enter sends and the box goes back to one line.
  await box.press('Enter');
  await page.waitForTimeout(300);
  const after = await measure();
  check(Math.abs(after.h - 44) < 1, `box should go back to one line after Send, got ${after.h}`);
  await page.screenshot({ path: join(OUT, 'desktop--composer.png') });
  await context.close();
  console.log(`${problems.length ? 'FAIL' : 'ok  '} desktop 1280x800 composer (1 line ${m1.h}, 5 lines ${m5.h}, 30 lines ${m30.h}, cap ${cap}, after send ${after.h})`);
  for (const p of problems) console.log(`       - ${p}`);
  return problems;
}

// Card 19 (docs/design/REVIEW.md fixes 1, 2, 8, 10): sizes and spacing the comps lock, measured in the
// browser on the iPhone and on a desktop window with a stub of the desktop app's bridge (so the
// desktop-only chrome, hover states and in-app menus are the real ones).
const PHONE = POSTURES.iphone;
const RED = 'rgb(240, 106, 106)';

async function uiPage(browser, base, { desktop, shape = PHONE, viewport, extraBots, paired = true } = {}) {
  const context = await browser.newContext({ viewport: viewport ?? { width: shape.width, height: shape.height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  await page.addInitScript(
    ({ insets, store, desktop }) => {
      if (!desktop) globalThis.__DORK_TEST_INSETS__ = insets;
      for (const [k, v] of Object.entries(store)) localStorage.setItem(`dorkbot.${k}`, v);
      if (desktop) {
        // The desktop app's bridge: requests go through the page's own fetch (Playwright answers them), values live in localStorage.
        let listener = () => {};
        globalThis.dorkDesktop = {
          platform: 'linux',
          onFetchEvent: (fn) => (listener = fn),
          fetchAbort: () => {},
          fetchStart: async (id, url, init) => {
            const res = await fetch(url, init);
            const buf = new Uint8Array(await res.arrayBuffer());
            setTimeout(() => {
              listener(id, 'chunk', buf);
              listener(id, 'end');
            }, 0);
            return { status: res.status, ok: res.ok };
          },
          storeGet: async (k) => localStorage.getItem(`dorkbot.${k}`),
          storeSet: async (k, v) => localStorage.setItem(`dorkbot.${k}`, v),
          storeDelete: async (k) => localStorage.removeItem(`dorkbot.${k}`),
          storeBackend: async () => 'test',
          openAuth: async () => {},
          closeAuth: () => {},
          message: async () => ({ response: 0, checked: false }),
        };
      }
    },
    { insets: shape.insets, store: seedFor({ paired, extraBots }), desktop: !!desktop },
  );
  await page.route(`${HERMES}/**`, fakeHermes);
  await page.route(`${ADMIN}/**`, fakeHermes);
  return { context, page, errors };
}

// Boxes of what's on screen, by accessible label (exact start) or visible text.
const rectOf = async (page, label) => {
  const box = await page.getByLabel(label, { exact: false }).first().boundingBox({ timeout: 5000 }).catch(() => null);
  return box;
};
const textRect = async (page, text) => page.getByText(text, { exact: true }).first().boundingBox({ timeout: 5000 }).catch(() => null);
const css = (page, label, prop) => page.getByLabel(label, { exact: false }).first().evaluate((el, p) => getComputedStyle(el)[p], prop);

async function uiPolishTests(browser, base) {
  const report = [];
  const run = async (name, ctx, fn) => {
    const problems = [];
    const check = (ok, msg) => ok || problems.push(msg);
    const near = (a, b, tol = 1) => typeof a === 'number' && Math.abs(a - b) <= tol;
    try {
      await fn({ check, near, ...ctx });
    } catch (e) {
      problems.push(`didn't run: ${e.message.split('\n')[0]}`);
      await ctx.page.screenshot({ path: join(OUT, `ui--${name.replace(/\W+/g, '-')}-failed.png`) }).catch(() => undefined);
    }
    problems.push(...ctx.errors);
    await ctx.context.close();
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ui ${name}`);
    for (const p of problems) console.log(`       - ${p}`);
    report.push({ posture: 'ui', screen: name, problems });
    return problems.length;
  };
  let failed = 0;
  const shot = (page, name) => page.screenshot({ path: join(OUT, `ui--${name}.png`) });

  // ---- iPhone: the bot list like Messages (fix 1) ----
  failed += await run('iphone bot list', await uiPage(browser, base, { paired: false }), async ({ page, check, near }) => {
    await page.goto(`${base}/`);
    await page.getByText('Key rejected. Tap to pair again.').waitFor({ timeout: 15_000 });
    await page.getByText('No messages yet').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    const body = await page.evaluate(() => document.body.innerText);
    check(!/Connected/.test(body), 'no row may say "Connected"');
    check(!/Checking…/.test(body), 'no row may flash "Checking…"');
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[role=button]')]
        .filter((e) => /^(assistant|scout|a-bot-with)/.test(e.getAttribute('aria-label') ?? '') && e.getBoundingClientRect().height > 60)
        .map((e) => ({ label: e.getAttribute('aria-label'), r: e.getBoundingClientRect().toJSON() })),
    );
    check(rows.length === 3, `3 rows expected, got ${rows.length}`);
    for (const { label, r } of rows) {
      check(r.height >= 76 - 0.5, `row "${label}" is ${r.height} tall; at least 76`);
      check(near(r.left, 0) && near(r.width, PHONE.width), `row "${label}" must be full-bleed (x ${r.left}, width ${r.width})`);
    }
    const name = await textRect(page, 'assistant');
    check(near(name?.x, 80), `row text must start at x 80, got ${name?.x}`);
    const avatar = await page.evaluate(() => {
      const d = [...document.querySelectorAll('div')].find((e) => { const r = e.getBoundingClientRect(); return Math.abs(r.width - 52) < 0.5 && Math.abs(r.height - 52) < 0.5 && getComputedStyle(e).borderRadius.startsWith('26'); });
      return d ? d.getBoundingClientRect().toJSON() : null;
    });
    check(avatar && near(avatar.left, 16), `avatar disc must be 52 wide at x 16, got ${JSON.stringify(avatar)}`);
    const title = await page.getByText('Dork Bot', { exact: true }).first().evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, x: el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft) }));
    check(title.size === '34px' && title.weight === '700' && near(title.x, 16), `large title must be 34/700 at x 16, got ${JSON.stringify(title)}`);
    for (const label of ['More', 'New bot']) {
      const r = await rectOf(page, label);
      check(near(r?.width, 44) && near(r?.height, 44), `"${label}" must be a 44 x 44 button, got ${r?.width} x ${r?.height}`);
    }
    check((await css(page, 'scout,', 'display')) !== undefined, 'scout row exists');
    const red = await page.getByText('Key rejected. Tap to pair again.').evaluate((el) => getComputedStyle(el).color);
    check(red === RED, `the 401 line must be #F06A6A, got ${red}`);
    const first = await page.evaluate(() => document.querySelector('[role=button][aria-label^="assistant,"]')?.getBoundingClientRect().top);
    const second = await page.evaluate(() => [...document.querySelectorAll('[role=button]')].find((e) => /^(a-bot|scout)/.test(e.getAttribute('aria-label') ?? ''))?.getBoundingClientRect().top);
    check(first < second, 'the bot with the newest message sorts first');
    await shot(page, 'iphone-bots');
  });

  // ---- iPhone: one-row chat header (fix 2) and the model-problem banner ----
  failed += await run('iphone chat header', await uiPage(browser, base), async ({ page, check, near }) => {
    await page.goto(`${base}/chat/assistant`);
    await page.getByText('Any time.', { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    const top = PHONE.insets.top;
    for (const label of ["assistant's chats", 'More for this chat', 'Back to the bots']) {
      const r = await rectOf(page, label);
      check(r && r.height >= 44 - 0.5 && r.y >= top - 0.5 && r.y + r.height <= top + 52 + 0.5, `"${label}" must be at least 44 tall inside the 52 pt bar (y ${r?.y}, h ${r?.height})`);
    }
    for (const label of ["assistant's chats", 'More for this chat']) {
      const r = await rectOf(page, label);
      check(near(r?.width, 44), `"${label}" must be 44 wide, got ${r?.width}`);
      check(r && near(r.y + r.height / 2, top + 26, 0.6), `"${label}" must be centered in the 52 pt bar (center ${r && r.y + r.height / 2}, want ${top + 26})`);
    }
    const title = await rectOf(page, 'Bot settings for assistant');
    check(title && title.y >= top && title.y + title.height <= top + 52, `the title block must sit in the 52 pt bar (y ${title?.y}, h ${title?.height})`);
    const bodyText = await page.evaluate(() => document.body.innerText);
    check(!/Change\b/.test(bodyText) && !/Pick model/.test(bodyText), 'no model bar and no banner while the model works');
    // Nothing between the bar and the transcript: the bar is the only chrome above the first message.
    const firstMsg = await textRect(page, 'what time is the mets game tonight and will it rain');
    check(firstMsg && firstMsg.y <= top + 52 + 14 + 30, `the first message starts ${firstMsg ? firstMsg.y - top : '?'} pt under the status bar; at most about 96 (52 bar + 14 padding + bubble)`);
    await shot(page, 'iphone-chat');
  });
  failed += await run('iphone model problem banner', await uiPage(browser, base, { extraBots: ['chief'] }), async ({ page, check, near }) => {
    await page.goto(`${base}/chat/chief`);
    await page.getByText('which doesn', { exact: false }).first().waitFor({ timeout: 15_000 });
    const btn = await rectOf(page, 'Pick model');
    check(near(btn?.height, 30 + 14, 0.6) || near(btn?.height, 30, 0.6), `"Pick model" must be 30 tall, got ${btn?.height}`);
    const bg = await page.evaluate(() => {
      const t = [...document.querySelectorAll('div')].find((e) => /which doesn/.test(e.textContent ?? '') && e.children.length === 3);
      return t ? getComputedStyle(t).backgroundColor : null;
    });
    check(bg === 'rgb(36, 23, 26)', `the banner must be #24171A, got ${bg}`);
    const header = await rectOf(page, 'Bot settings for chief');
    const banner = await page.getByText('which doesn', { exact: false }).first().boundingBox();
    check(header && banner && banner.y > header.y + header.height, 'the banner sits under the header row');
    await shot(page, 'iphone-chat-model-problem');
  });

  // ---- iPhone: sheet header, Chats and the bot sheet (fixes 8 and 10) ----
  failed += await run('iphone chats sheet', await uiPage(browser, base), async ({ page, check, near }) => {
    await page.goto(`${base}/chats/assistant`);
    await page.getByText('Mets tickets', { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    const body = await page.evaluate(() => document.body.innerText);
    check(!/\+ New chat/.test(body), 'no full-width "+ New chat" slab');
    check(/Press and hold a chat to rename or delete it\./.test(body), 'the footnote is there');
    for (const label of ['New chat', 'Done']) {
      const r = await rectOf(page, label);
      check(r && r.height >= 44 - 0.5 && r.width >= 44 - 0.5, `"${label}" must have a 44 pt hit area, got ${r?.width} x ${r?.height}`);
    }
    const search = await page.getByLabel('Search chats').first().evaluate((el) => el.parentElement.getBoundingClientRect().toJSON());
    check(near(search?.height, 36) || near(search?.height, 36, 0.6), `the search field must be 36 tall, got ${search?.height}`);
    const sheetTitle = await page.getByText('Chats', { exact: true }).first().evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight }));
    check(sheetTitle.size === '17px' && sheetTitle.weight === '600', `sheet title must be 17/600, got ${JSON.stringify(sheetTitle)}`);
    const sub = await textRect(page, 'assistant');
    check(sub, 'the bot name is the 12 pt subtitle');
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[role=button]')].filter((e) => /, (now|Tue|Oct|\d+:\d\d)/.test(e.getAttribute('aria-label') ?? '')).map((e) => e.getBoundingClientRect().toJSON()),
    );
    check(rows.length >= 3, `3 chat rows expected, got ${rows.length}`);
    for (const r of rows) {
      check(r.height >= 52, `a chat row must be at least 52 tall, got ${r.height}`);
      check(near(r.left, 16) && near(r.right, PHONE.width - 16), `rows sit in one container with 16 margins (x ${r.left}-${r.right})`);
    }
    const checks = await page.evaluate(() => [...document.querySelectorAll('[role=button] svg')].filter((s) => s.getBoundingClientRect().width === 22).length);
    check(checks === 1, `exactly one ✓ (the open chat), got ${checks}`);
    await shot(page, 'iphone-chats');
  });
  failed += await run('iphone bot sheet', await uiPage(browser, base), async ({ page, check, near }) => {
    await page.goto(`${base}/bot/assistant`);
    await page.getByText('Routine results', { exact: true }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    const tiles = [];
    for (const t of ['Chats', 'Routines', 'Connectors', 'Look']) tiles.push(await rectOf(page, `${t} for assistant`));
    for (const r of tiles) check(near(r?.height, 68), `a tile must be 68 tall, got ${r?.height}`);
    check(new Set(tiles.map((r) => Math.round(r?.y))).size === 1, 'the 4 tiles are in one row');
    const nameFont = await page.getByText('assistant', { exact: true }).first().evaluate((el) => getComputedStyle(el).fontSize);
    check(nameFont === '22px', `the bot's name must be 22, got ${nameFont}`);
    const rows = await page.evaluate(() => ['Model', 'Routine results', 'Rename', 'Hide bot', 'Delete bot…'].map((t) => { const e = [...document.querySelectorAll('[role=button]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith(t)); return [t, e?.getBoundingClientRect().height]; }));
    for (const [t, h] of rows) check(h >= 52, `"${t}" row must be at least 52 tall, got ${h}`);
    const del = await page.getByText('Delete bot…', { exact: true }).evaluate((el) => getComputedStyle(el).color);
    check(del === RED, `Delete bot… must be #F06A6A, got ${del}`);
    const text = await page.evaluate(() => document.body.innerText);
    check(['Model', 'Routine results', 'Notifications', 'Rename', 'Hide bot'].every((t) => text.includes(t)), 'the bot sheet has Model, Routine results, Notifications, Rename and Hide bot');
    const done = await rectOf(page, 'Done');
    check(done && done.height >= 44 - 0.5, 'Done has a 44 pt hit area');
    await shot(page, 'iphone-bot-sheet');
  });

  // ---- Desktop 1280x800 with the desktop bridge: sidebar, header, menus, popover, panel ----
  failed += await run('desktop sidebar, header and menus', await uiPage(browser, base, { desktop: true, viewport: DESKTOP }), async ({ page, check, near }) => {
    await page.goto(`${base}/?bot=assistant`);
    await page.getByText('Any time.', { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    // Sidebar: 320 wide, header 56 tall, no title bar, rows 64 tall inset 8.
    const side = await page.evaluate(() => {
      const row = [...document.querySelectorAll('[role=button]')].find((e) => (e.getAttribute('aria-label') ?? '').startsWith('assistant,'));
      const r = row.getBoundingClientRect().toJSON();
      let p = row.parentElement; // up to the sidebar column: the first ancestor spanning the full height
      while (p && p.getBoundingClientRect().height < innerHeight - 1) p = p.parentElement;
      const sb = p.getBoundingClientRect().toJSON();
      const title = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 'Dork Bot' && e.getBoundingClientRect().width > 0);
      return { r, sb, title: title?.getBoundingClientRect().toJSON(), titleSize: title && getComputedStyle(title).fontSize };
    });
    check(near(side.r.height, 64), `sidebar row must be 64 tall, got ${side.r.height}`);
    check(near(side.r.left, 8) && near(side.r.right, 312), `sidebar row must be inset 8 inside the 320 sidebar (x ${side.r.left}-${side.r.right})`);
    check(near(side.sb.width, 320, 1.5), `sidebar must be 320 wide, got ${side.sb.width}`);
    check(side.title && near(side.title.left, 18) && side.titleSize === '17px', `"Dork Bot" is 17 bold at x 18 in the sidebar header, got ${JSON.stringify(side.title)} ${side.titleSize}`);
    check(side.title && side.title.top >= 0 && side.title.top + side.title.height <= 56, 'the sidebar header is 56 tall and there is no title bar above it');
    for (const label of ['More', 'New bot']) {
      const r = await rectOf(page, label);
      check(near(r?.width, 32) && near(r?.height, 32), `sidebar "${label}" must be a 32 x 32 button, got ${r?.width} x ${r?.height}`);
    }
    check(!/Connected/.test(await page.evaluate(() => document.body.innerText)), 'no row says "Connected"');
    // Chat header: 56 tall with a hairline, sidebar toggle 32, Chats and ⋯ 32.
    const hb = await rectOf(page, 'Hide the bot list');
    check(near(hb?.width, 32) && near(hb?.height, 32), `the sidebar toggle must be 32 x 32, got ${hb?.width} x ${hb?.height}`);
    check(hb && hb.y + hb.height / 2 > 27 && hb.y + hb.height / 2 < 29, `header icons are centered in a 56 tall row (center y ${hb && hb.y + hb.height / 2})`);
    for (const label of ["assistant's chats", 'More for this chat']) {
      const r = await rectOf(page, label);
      check(near(r?.width, 32) && near(r?.height, 32), `"${label}" must be 32 x 32, got ${r?.width} x ${r?.height}`);
    }
    // ⋯ opens the chat menu: 4 items in 3 groups, 32 tall.
    await page.getByLabel('More for this chat', { exact: false }).first().click();
    await page.getByRole('menuitem').first().waitFor({ timeout: 5000 });
    const items = await page.getByRole('menuitem').evaluateAll((els) => els.map((e) => ({ text: e.textContent, h: e.getBoundingClientRect().height })));
    check(items.length === 4, `the chat ⋯ has 4 items, got ${items.length}`);
    check(items.map((i) => i.text.replace('Ctrl+N', '')).join('|') === 'New chat|Rename this chat|Bot settings|Delete this chat', `chat menu items, got ${items.map((i) => i.text).join('|')}`);
    check(items.every((i) => near(i.h, 32)), 'menu items are 32 tall');
    check(items[0].text.includes('Ctrl+N'), 'New chat shows its Ctrl+N shortcut');
    const menuBg = await page.getByRole('menu').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, r: getComputedStyle(el).borderRadius, w: el.getBoundingClientRect().width }));
    check(menuBg.bg === 'rgb(34, 37, 42)' && menuBg.r === '12px', `menu must be #22252A radius 12, got ${JSON.stringify(menuBg)}`);
    await shot(page, 'desktop-chat-menu');
    // Arrow keys move, Esc closes.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    check((await page.getByRole('menu').count()) === 0, 'Esc closes the menu');
    // Title opens the bot sheet as a 360 wide popover.
    await page.getByLabel('Bot settings for assistant').click();
    await page.getByText('Routine results', { exact: true }).waitFor({ timeout: 5000 });
    const pop = await page.getByRole('dialog').first().boundingBox();
    check(near(pop?.width, 360), `the bot sheet is a 360 wide popover, got ${pop?.width}`);
    await shot(page, 'desktop-bot-popover');
    await page.keyboard.press('Escape');
    // Chats opens a 560 wide panel with the 60 tall header.
    await page.getByLabel("assistant's chats").click();
    await page.getByText('Mets tickets', { exact: false }).first().waitFor({ timeout: 5000 });
    const panel = await page.getByRole('dialog').first().boundingBox();
    check(near(panel?.width, 560), `the panel must be 560 wide, got ${panel?.width}`);
    const newChat = await rectOf(page, 'New chat');
    check(near(newChat?.height, 32), `the panel's New chat button must be 32 tall, got ${newChat?.height}`);
    check(newChat && panel && newChat.y >= panel.y && newChat.y + newChat.height <= panel.y + 60, 'the create action is in the 60 tall panel header');
    const close = await page.getByRole('button', { name: 'Close' }).first().boundingBox();
    check(close && near(close.width, 32), `✕ must be 32 x 32, got ${close?.width}`);
    await shot(page, 'desktop-chats-panel');
    await page.keyboard.press('Escape');
    // Ctrl+\ hides the bot list.
    await page.keyboard.press('Control+\\');
    await page.getByLabel('Show the bot list').waitFor({ timeout: 5000 });
    await shot(page, 'desktop-list-hidden');
  });
  return { failed, report };
}

async function main() {
  if (!args.includes('--no-build')) {
    execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-web'], { cwd: ROOT, stdio: 'inherit' });
  }
  mkdirSync(OUT, { recursive: true });
  const server = await serve(DIST);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const report = [];
  let failed = 0;

  for (const [posture, shape] of Object.entries(POSTURES)) {
    if (only && posture !== only) continue;
    for (const screen of SCREENS) {
      if (screen.postures && !screen.postures.includes(posture)) continue;
      const context = await browser.newContext({ viewport: { width: shape.width, height: shape.height }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(
        ({ insets, store }) => {
          globalThis.__DORK_TEST_INSETS__ = insets;
          for (const [k, v] of Object.entries(store)) localStorage.setItem(`dorkbot.${k}`, v);
        },
        { insets: shape.insets, store: seedFor(screen) },
      );
      await page.route(`${HERMES}/**`, fakeHermes);
      await page.route(`${ADMIN}/**`, fakeHermes);
      const path = screen.path(posture);
      let problems;
      try {
        await page.goto(base + path);
        await page.getByText(screen.waitFor, { exact: false }).first().waitFor({ timeout: 15_000 });
        if (screen.click) await page.getByLabel(screen.click).first().click();
        if (screen.then) await page.getByText(screen.then, { exact: false }).first().waitFor({ timeout: 15_000 });
        await page.waitForTimeout(400); // let the list scroll to the end and statuses settle
        problems = await page.evaluate(audit, {
          insets: shape.insets,
          keepOut: shape.keepOut,
          fixed: FIXED[screen.name] ?? [],
          seen: SEEN[screen.name] ?? [],
        });
        if (screen.name === 'chat') problems.push(...(await page.evaluate(measureTranscript)));
        if (screen.name === 'chats') problems.push(...(await page.evaluate(measureChats)));
      } catch (e) {
        problems = [`didn't render: ${e.message.split('\n')[0]}`];
      }
      problems.push(...errors.map((m) => `page error: ${m}`));
      const shot = join(OUT, `${posture}--${screen.name}.png`);
      await page.screenshot({ path: shot });
      report.push({ posture, screen: screen.name, path, problems, screenshot: shot });
      failed += problems.length ? 1 : 0;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${posture.padEnd(20)} ${screen.name}`);
      for (const p of problems) console.log(`       - ${p}`);
      await context.close();
    }
  }
  if (!only || only === 'composer') {
    const composer = await composerTest(browser, base);
    failed += composer.length ? 1 : 0;
    report.push({ posture: 'desktop', screen: 'composer', path: "/?bot=assistant", problems: composer });
  }
  if (!only || only === 'ui') {
    const ui = await uiPolishTests(browser, base);
    failed += ui.failed;
    report.push(...ui.report);
  }
  await browser.close();
  server.close();
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.length - failed}/${report.length} screens clean. Screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

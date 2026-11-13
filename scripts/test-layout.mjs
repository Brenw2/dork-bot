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
import { checkAnswered, checkApproval, checkComposer, checkThinking, checkWorking, checkWorkingLong } from './layout-fixes-345.mjs';

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

const answered = new Set(); // runs whose approval was answered (what the fake run status says next)
const APPROVAL = { command: 'rm -rf ~/notes/old-drafts', description: 'recursive delete', choices: ['once', 'session', 'always', 'deny'], request_id: 'req-1' };

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
  { name: 'routines-expanded', path: () => '/routines/assistant', click: 'daily_digest,', waitFor: 'daily_digest', then: 'Notify me' },
  // Fix 3: the message box with text in it (Send inside the field). Fixes 4 and 5: a reply on its way (see fakeHermes).
  { name: 'chat-typing', path: chatPath('assistant'), waitFor: 'Any time.', act: (page) => typeIn(page, 'assistant', 'what time is sunset'), check: checkComposer },
  { name: 'chat-thinking', extraBots: ['thinker'], path: chatPath('thinker'), waitFor: 'Any time.', act: async (page) => (await sendIn(page, 'thinker', 'what time is sunset'), page.getByLabel('Typing').first().waitFor()), check: checkThinking },
  { name: 'chat-working', extraBots: ['worker'], path: chatPath('worker'), waitFor: 'Any time.', act: (page) => sendIn(page, 'worker', 'summarize each card', 'Trello: read card'), check: checkWorking },
  { name: 'chat-working-long', clock: true, extraBots: ['worker'], path: chatPath('worker'), waitFor: 'Any time.', act: async (page) => (await sendIn(page, 'worker', 'summarize each card', 'Trello: read card'), page.clock.fastForward(48_000), page.getByText('Still working', { exact: false }).first().waitFor()), check: checkWorkingLong },
  { name: 'chat-approval', extraBots: ['approver'], path: chatPath('approver'), waitFor: 'Any time.', act: (page) => sendIn(page, 'approver', 'clean up my old drafts folder', 'Run this command?'), check: checkApproval },
  { name: 'chat-approval-answered', extraBots: ['approver'], path: chatPath('approver'), waitFor: 'Any time.', act: async (page) => (await sendIn(page, 'approver', 'clean up my old drafts folder', 'Run this command?'), page.getByLabel('Allow once').first().click(), page.getByText('Allowed once', { exact: false }).first().waitFor()), check: checkAnswered },
];

function chatPath(bot) {
  return (p) => (p === 'duo-open-landscape' ? `/?bot=${bot}` : `/chat/${bot}`);
}
const typeIn = async (page, bot, text) => page.getByLabel(`Message ${bot}`).fill(text);
// Send a message (Enter sends on the web) and wait for what the reply should show.
async function sendIn(page, bot, text, wait) {
  await typeIn(page, bot, text);
  await page.getByLabel(`Message ${bot}`).press('Enter');
  if (wait) await page.getByText(wait, { exact: false }).first().waitFor({ timeout: 15_000 });
}

async function fakeHermes(route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const p = url.pathname;
  // Gateway API server, one bot per /p/<bot>/.
  const bot = p.match(/^\/p\/([^/]+)\//)?.[1];
  // A reply on its way (design fixes 4 and 5). thinker: the stream never answers (the typing bubble). worker: a few
  // steps, then the stream drops and Hermes still has the run (the chip and the typing row). approver: the same, and
  // Hermes then waits for an OK. failer: Hermes answers HTTP 500.
  if (/\/chat\/stream$/.test(p)) {
    if (bot === 'thinker') return new Promise(() => {});
    if (bot === 'failer') return json(500, { error: 'model runner crashed' });
    answered.delete(`run-${bot}`);
    const events = [
      ['run.started', { run_id: `run-${bot}` }],
      ['tool.started', { tool_name: 'terminal', preview: 'ls ~/notes' }],
      ['tool.completed', { tool_name: 'terminal' }],
      ['tool.started', { tool_name: 'web_search', preview: 'trail map' }],
      ['tool.completed', { tool_name: 'web_search' }],
      ['tool.started', { tool_name: 'mcp__trello__trelloReadCard', preview: 'card 7' }],
      ...(bot === 'approver' ? [['approval.request', APPROVAL]] : []),
    ];
    const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  }
  const run = p.match(/\/v1\/runs\/([^/]+)(\/approval)?$/);
  if (run && req.method() === 'POST') {
    answered.add(run[1]);
    return json(200, { ok: true });
  }
  if (run) {
    const waiting = bot === 'approver' && !answered.has(run[1]);
    return json(200, waiting ? { status: 'waiting_for_approval', approval: APPROVAL } : { status: 'running' });
  }
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
  // The Work row's own chevron (a finished step chip in the chat pane has its own).
  const row = [...document.querySelectorAll('[role=button], [role=link]')].find((e) => (e.getAttribute('aria-label') || '').includes("assistant's work"));
  const chev = row && [...row.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent.trim() === '›');
  if (!chev) return ['the Work row chevron is missing'];
  const c = getComputedStyle(chev).color;
  return c === 'rgb(93, 98, 106)' ? [] : [`Work row chevron should be #5D626A, got ${c}`];
}

const FIXED = { chat: ['Message assistant', 'Change model', 'Add a picture', "assistant's chats", 'More for this chat'], 'chat-list-hidden': ['Show the bot list', 'Message assistant'], 'chat-rich': ['Message coder', 'Add a picture'], 'chat-typing': ['Message assistant', 'Send', 'Add a picture'], 'chat-thinking': ['Message thinker', 'Stop', 'Add a picture'], 'chat-working': ['Message worker', 'Stop'], 'chat-working-long': ['Stop'], 'chat-approval': ['Allow once', 'Deny', 'Allow in this chat', 'Always allow', 'Stop'], 'chat-approval-answered': ['Message approver', 'Stop'], 'chat-model-problem': ['Message chief', 'Change model'], bots: ['New bot'], chats: ['New chat', "assistant's work"], work: [], 'work-session': [], routines: ['New routine'], 'bots-empty': ['New bot'], new: ['Create bot'], add: ['Add'], connectors: ['Search connectors'], model: ['Search models'] };
const SEEN = { chat: ['Any time.'], 'chat-list-hidden': ['Any time.'], 'chat-rich': ['Ping me if'], 'chat-approval': ['Run this command?', 'Hermes flagged it'], 'work-session': ['The test reads the clock'], 'work-session-done': ['Three themes'] };

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
      const field = document.querySelector('[data-testid=composer-field]');
      const r = field.getBoundingClientRect();
      const send = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Send')?.getBoundingClientRect();
      const last = [...document.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Any time.');
      const lr = last?.getBoundingClientRect();
      const fs = getComputedStyle(field);
      const ts = getComputedStyle(ta);
      return {
        h: r.height, top: r.top, bottom: r.bottom, width: r.width,
        sendBottom: send?.bottom, sendRight: send?.right, sendSize: send ? `${send.width}x${send.height}` : null, fieldRight: r.right,
        scrolls: ta.scrollHeight > ta.clientHeight + 1, overflowY: ts.overflowY, taH: ta.getBoundingClientRect().height,
        radius: fs.borderTopLeftRadius, font: `${ts.fontSize}/${ts.lineHeight}`, bar: getComputedStyle(ta, '::-webkit-scrollbar').width,
        hint: document.body.innerText.includes('Enter to send · Shift+Enter for a new line'),
        lastBottom: lr?.bottom, H: innerHeight,
      };
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
  check(Math.abs(m30.sendBottom - (m30.bottom - 6)) < 1.2 && Math.abs(m30.fieldRight - m30.sendRight - 6) < 1.2, `Send should sit 6 in from the box's bottom-right corner (bottom ${m30.bottom - m30.sendBottom}, right ${m30.fieldRight - m30.sendRight})`);
  check(m1.sendSize === '32x32' && m30.sendSize === '32x32', `desktop Send should be a 32 circle, got ${m1.sendSize} / ${m30.sendSize}`);
  check(m1.radius === '22px' && m1.font === '16px/24px', `desktop field should be radius 22 with 16/24 text, got ${m1.radius} ${m1.font}`);
  check(Math.abs(m1.width - m5.width) < 1 && Math.abs(m1.width - m30.width) < 1 && Math.abs(one.width - m1.width) < 1, `the box's width should not change with Send or its text (${one.width} / ${m1.width} / ${m5.width} / ${m30.width})`);
  check(m1.overflowY === 'hidden' && m5.overflowY === 'hidden' && !m1.scrolls && !m5.scrolls, `a box under the cap should show no scrollbar (overflow ${m1.overflowY} / ${m5.overflowY})`);
  check(m30.overflowY === 'auto', `a box at the cap should scroll (overflow ${m30.overflowY})`);
  check(m30.bar === '8px', `scrollbars should be 8 px, got ${m30.bar}`);
  check(!one.hint && m1.hint, `the key hint shows only while the box has focus (before ${one.hint}, focused ${m1.hint})`);
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
      if (screen.clock) await page.clock.install(); // a run that has gone on for a while (fast-forwarded below)
      const path = screen.path(posture);
      let problems;
      try {
        await page.goto(base + path);
        await page.getByText(screen.waitFor, { exact: false }).first().waitFor({ timeout: 15_000 });
        if (screen.click) await page.getByLabel(screen.click).first().click();
        if (screen.then) await page.getByText(screen.then, { exact: false }).first().waitFor({ timeout: 15_000 });
        if (screen.act) await screen.act(page);
        await page.waitForTimeout(400); // let the list scroll to the end and statuses settle
        problems = await page.evaluate(audit, {
          insets: shape.insets,
          keepOut: shape.keepOut,
          fixed: FIXED[screen.name] ?? [],
          seen: SEEN[screen.name] ?? [],
        });
        if (screen.name === 'chat') problems.push(...(await page.evaluate(measureTranscript)));
        if (screen.name === 'chats') problems.push(...(await page.evaluate(measureChats)));
        if (screen.check) problems.push(...(await screen.check(page, posture)));
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

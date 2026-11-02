#!/usr/bin/env node
// Smoke test: one streamed chat with one Hermes profile through the API server.
// Usage: node scripts/smoke-chat.mjs [profile] [message]
// Reads the profile's API_SERVER_KEY from its .env and never prints it.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const profile = process.argv[2] ?? 'assistant';
const message = process.argv[3] ?? 'Reply with one short sentence: what model are you running on?';
const base = (process.env.DORK_HERMES_API_URL ?? 'http://127.0.0.1:8642').replace(/\/+$/, '');
const envPath = profile === 'default'
  ? join(homedir(), '.hermes', '.env')
  : join(homedir(), '.hermes', 'profiles', profile, '.env');

const key = readFileSync(envPath, 'utf8').match(/^API_SERVER_KEY=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!key) { console.error(`No API_SERVER_KEY in ${envPath}`); process.exit(2); }

const prefix = profile === 'default' ? '' : `/p/${profile}`;
const auth = { Authorization: `Bearer ${key}` };

async function waitForServer(timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > until) throw new Error(`API server not up at ${base} after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

await waitForServer();
console.log(`API server up at ${base}`);

const sessionId = `dork-smoke-${Date.now()}`;
const created = await fetch(`${base}${prefix}/api/sessions`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: sessionId, title: `Dork Bot smoke ${new Date().toISOString()}`, source: 'dork-bot' }),
});
if (created.status !== 201) { console.error(`create session: HTTP ${created.status} ${await created.text()}`); process.exit(1); }
console.log(`session ${sessionId} created on profile "${profile}"`);

const t0 = Date.now();
const res = await fetch(`${base}${prefix}/api/sessions/${sessionId}/chat/stream`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({ message }),
});
if (!res.ok || !res.body) { console.error(`chat/stream: HTTP ${res.status} ${await res.text()}`); process.exit(1); }

const decoder = new TextDecoder();
let buf = '', deltas = 0, status = 'unknown', runtime = null, firstDeltaMs = null;
process.stdout.write(`> ${message}\n< `);
for await (const chunk of res.body) {
  buf += decoder.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, i); buf = buf.slice(i + 2);
    const event = frame.match(/^event: (.+)$/m)?.[1];
    const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
    if (!event || !data) continue;
    const payload = JSON.parse(data);
    if (event === 'assistant.delta') { deltas++; firstDeltaMs ??= Date.now() - t0; process.stdout.write(payload.delta ?? payload.data?.delta ?? ''); }
    if (event === 'assistant.completed') runtime = payload.runtime ?? payload.data?.runtime ?? null;
    if (event.startsWith('run.') && event !== 'run.started') status = event.slice(4);
    if (event === 'error') { console.error(`\nerror event: ${data}`); status = 'error'; }
  }
}
console.log(`\n\nstatus=${status} deltas=${deltas} first_token=${firstDeltaMs ?? '-'}ms total=${Date.now() - t0}ms`);
console.log(`runtime=${JSON.stringify(runtime)}`);
process.exit(status === 'completed' && deltas > 0 ? 0 : 1);

// Live SPIKE (card 8): a Hermes gateway-hosted group room driven over `hermes serve`'s /api/ws, with only
// what Hermes already exposes (groups.* JSON-RPC). Skipped unless DORK_LIVE=1.
//   DORK_LIVE=1 npx vitest run test/live-rooms.test.ts --silent=false
// Covers docs/GROUP-ROOMS-SPIKE.md steps 1-3: create a room with 2 throwaway bots, post with no mention
// (both take turns on the gateway), drop the client right after the send ACK, reconnect, and check the
// round finished without it. Disbands the room and deletes the bots afterwards. Nothing real is touched.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';

const live = process.env.DORK_LIVE === '1';
const adminUrl = process.env.DORK_ADMIN_URL ?? 'http://127.0.0.1:9119';
const chatUrl = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';
const f = fetch as unknown as FetchLike;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const raw = res.headers.getSetCookie().find((c) => c.includes('hermes_session_rt='))?.split(';')[0].split('=').slice(1).join('=') ?? '';
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
}

/** The app's refresh flow: refresh token -> short-lived bearer access token (what `?token=` takes). */
async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch(`${adminUrl}/auth/native/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, provider: 'basic' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** A bare JSON-RPC client for /api/ws (same wire as lib/gatewayWs.ts on app/private-secrets). */
async function openRpc(access: string) {
  const ws = new WebSocket(`${adminUrl.replace(/^http/i, 'ws')}/api/ws?token=${encodeURIComponent(access)}`);
  let id = 1;
  const pending = new Map<number, (m: { result?: any; error?: { code: number; message: string } }) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (typeof m.id === 'number' && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    }
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("can't open /api/ws"));
  });
  await sleep(800); // gateway.ready event
  const call = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const i = id++;
      pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.code} ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }));
    });
  return { call, close: () => ws.close() };
}

type RoomEvent = { seq: number; kind: string; actor: { kind: string; id: string }; payload: Record<string, any> };

async function readLog(call: (m: string, p?: Record<string, unknown>) => Promise<any>, room_id: string): Promise<RoomEvent[]> {
  const out: RoomEvent[] = [];
  let since = 0;
  for (;;) {
    const page = await call('groups.log', { room_id, since_seq: since, limit: 100 });
    out.push(...page.events);
    if (!page.has_more) return out;
    since = page.cursor;
  }
}

async function untilIdle(call: (m: string, p?: Record<string, unknown>) => Promise<any>, room_id: string, ms = 120_000) {
  const t0 = Date.now();
  let idle = 0;
  while (Date.now() - t0 < ms) {
    const st = await call('groups.state', { room_id });
    idle = st.driver_status?.working ? 0 : idle + 1;
    if (idle >= 2) return;
    await sleep(1500);
  }
  throw new Error('room never went idle');
}

describe.skipIf(!live)(`live rooms: throwaway bots on ${adminUrl}`, () => {
  it('creates a hosted room, runs a no-mention round on the gateway, and finishes it with the client gone', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f, () => undefined);
    const suffix = Date.now().toString(36);
    const names = [`dbt-room-a-${suffix}`, `dbt-room-b-${suffix}`];
    let room_id = '';
    let rpc = await openRpc(await accessToken(await signIn()));
    try {
      for (const n of names) {
        await m.createBot({ name: n, job: 'A throwaway test bot. In a group room reply in one short sentence and say your name.' }, () => randomBytes(32).toString('hex'));
        await m.setBotModel(n, { provider: 'anthropic', model: 'claude-haiku-5-5' }).catch(() => m.setBotModel(n, { provider: 'anthropic', model: 'claude-haiku-4-5' }));
      }

      // 1. the gateway runs rooms, and creates one for the two bots (same shape Hermes Desktop sends).
      const caps = await rpc.call('groups.capabilities');
      expect(caps.driver).toBe(true);
      expect(caps.methods).toEqual(expect.arrayContaining(['groups.create', 'groups.send', 'groups.log', 'groups.state', 'groups.stop', 'groups.disband']));
      room_id = randomUUID();
      const members = names.map((p) => ({ member_id: p, profile: p, handle: p, target: { kind: 'local', profile: p } }));
      const made = await rpc.call('groups.create', { room_id, name: `dbt-spike-${suffix}`, members });
      expect(made.room.room_id).toBe(room_id);
      expect(made.room.members).toHaveLength(2);
      expect((await rpc.call('groups.list', { limit: 100, offset: 0 })).rooms.map((r: { room_id: string }) => r.room_id)).toContain(room_id);

      // 2/3. send with no mention, then drop the socket right after the ACK (the phone going to sleep).
      const event_id = randomUUID();
      const t0 = Date.now();
      const ack = await rpc.call('groups.send', { room_id, event_id, payload: { text: 'Check-in: each of you say your name and one word about your day.', thread_id: event_id } });
      expect(ack.accepted).toBe(true);
      expect(ack.event.kind).toBe('message.user');
      rpc.close();
      const closedAt = Date.now() - t0;
      await sleep(25_000);
      rpc = await openRpc(await accessToken(await signIn()));
      await untilIdle(rpc.call, room_id);
      const log = await readLog(rpc.call, room_id);

      // A member may speak again in a later round (answering the other), so compare the sets.
      const said = [...new Set(log.filter((e) => e.kind === 'message.member').map((e) => e.actor.id))];
      const settled = [...new Set(log.filter((e) => e.kind === 'turn.settled' && e.actor.kind === 'gateway' && e.payload.passed === false).map((e) => e.payload.member_id as string))];
      console.log(
        `client closed ${closedAt} ms after the send ACK, reconnected after ~25 s; log has ${log.length} events: ` +
          `${log.map((e) => `${e.seq}:${e.kind}${e.actor.kind === 'member' ? '(' + e.actor.id.replace(/-[a-z0-9]+$/, '') + ')' : ''}`).join(' ')}`,
      );
      expect(said.sort()).toEqual([...names].sort());
      expect(settled.sort()).toEqual([...names].sort());
      expect(log.some((e) => e.kind === 'room.activity' && e.payload.status === 'settled')).toBe(true);
      expect(log[0].kind).toBe('message.user');
    } finally {
      if (room_id) await rpc.call('groups.disband', { room_id }).catch((e) => console.log(`disband: ${e.message}`));
      rpc.close();
      for (const n of names) await m.deleteBot(n);
    }
    const left = (await m.listProfiles()).map((p) => p.name);
    for (const n of names) expect(left).not.toContain(n);
    console.log(`throwaway bots ${names.join(', ')} deleted, room disbanded`);
  }, 360_000);
});

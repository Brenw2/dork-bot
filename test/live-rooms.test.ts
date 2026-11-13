// Live test (card 8): group rooms driven through the APP's own code (lib/rooms.ts over lib/roomLink.ts and
// lib/gatewayWs.ts) against a real Hermes gateway, with 3 throwaway bots. Skipped unless DORK_LIVE=1.
//   DORK_LIVE=1 npx vitest run test/live-rooms.test.ts --silent=false
// Covers card 8's done-when 1-3: create a 3-bot room (shows in groups.list), @bot reaches only that bot, no
// mention gives every bot a turn within 3 rounds, Stop works, and closing the client mid-round doesn't stop it
// (reopening shows the replies). Also: a resend with the same event_id never double-posts. Disbands the room and
// deletes the bots afterwards. Smallest prompts: model turns are slow.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WsCtor } from '@/lib/gatewayWs';
import type { FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';
import { RoomLink } from '@/lib/roomLink';
import { buildTranscript, MAX_ROUNDS, memorySendStore, sendMessage, type RoomClient, type RoomEvent } from '@/lib/rooms';

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

async function untilIdle(client: RoomClient, roomId: string, ms = 150_000) {
  const t0 = Date.now();
  let idle = 0;
  while (Date.now() - t0 < ms) {
    const st = await client.state(roomId);
    idle = st.working || Object.keys(st.activity).length ? 0 : idle + 1;
    if (idle >= 2) return;
    await sleep(1500);
  }
  throw new Error('room never went idle');
}

const short = (e: RoomEvent) => `${e.seq}:${e.kind.replace('message.', '').replace('room.', '')}${e.actorKind === 'member' ? `(${e.actorId.replace(/-[a-z0-9]+$/, '')})` : ''}`;
const spoke = (log: RoomEvent[]) => [...new Set(log.filter((e) => e.kind === 'message.member' && e.text.trim() && e.text.trim() !== '[SILENT]').map((e) => e.actorId))];
const turnsOf = (log: RoomEvent[]) => log.filter((e) => e.kind === 'turn.settled' && e.actorKind === 'gateway');

describe.skipIf(!live)(`live rooms through the app code: 3 throwaway bots on ${adminUrl}`, () => {
  it('create, @mention, no mention, stop, close mid-round and resume', async () => {
    const m = new HermesManager({ adminUrl, chatUrl, refreshToken: await signIn() }, f, () => undefined);
    const suffix = Date.now().toString(36);
    const names = ['a', 'b', 'c'].map((x) => `dbt-room-${x}-${suffix}`);
    const [A, B] = names;
    let roomId = '';
    // The app's connection: a fresh bearer token on every open, Node's WebSocket for the browser's.
    const link = new RoomLink(async () => ({ adminUrl, token: (await m.wsAuth()).token }), WebSocket as unknown as WsCtor);
    const client = link.client;
    const store = memorySendStore();
    const send = (text: string) => sendMessage(client, store, roomId, text, randomUUID);
    const allLog = async () => (await client.logAll(roomId, 0)).events;
    const lastSeq = async () => (await allLog()).reduce((n, e) => Math.max(n, e.seq), 0);
    const logAfter = async (from: number) => (await allLog()).filter((e) => e.seq > from);
    try {
      for (const n of names) {
        await m.createBot({ name: n, job: 'A throwaway test bot. In a group room reply in one short sentence, say your name, and never mention anyone with @.' }, () => randomBytes(32).toString('hex'));
        await m.setBotModel(n, { provider: 'anthropic', model: 'claude-haiku-5-5' }).catch(() => m.setBotModel(n, { provider: 'anthropic', model: 'claude-haiku-4-5' }));
      }

      // 1. create a 3-bot room from the app's client; it is in groups.list.
      expect(await client.supported()).toBe(true);
      roomId = randomUUID();
      const room = await client.create({ roomId, name: `dbt-group-${suffix}`, profiles: names });
      expect(room.members.map((x) => x.profile).sort()).toEqual([...names].sort());
      expect((await client.list()).map((r) => r.id)).toContain(roomId);
      console.log(`created a room of ${room.members.length} bots; groups.list has it`);

      // 2. @b reaches only b.
      let from = await lastSeq();
      await send(`@${B} say hi in three words`);
      await untilIdle(client, roomId);
      let log = await logAfter(from);
      console.log(`@${B}: ${log.map(short).join(' ')}`);
      expect(spoke(log)).toEqual([B]);
      expect(turnsOf(log).every((e) => e.memberId === B)).toBe(true);

      // 3. no mention: every bot gets a turn (and may pass); the round ends within MAX_ROUNDS.
      from = await lastSeq();
      await send('Check-in: say your name.');
      await untilIdle(client, roomId);
      log = await logAfter(from);
      console.log(`no mention: ${log.map(short).join(' ')}`);
      for (const n of names) {
        const mine = turnsOf(log).filter((e) => e.memberId === n).length;
        expect(mine).toBeGreaterThanOrEqual(1);
        expect(mine).toBeLessThanOrEqual(MAX_ROUNDS);
      }
      expect(log.some((e) => e.kind === 'room.activity' && e.status === 'settled')).toBe(true);

      // 4. Stop mid-round: a stop event is logged and nothing runs on afterwards.
      from = await lastSeq();
      await send('Count from 1 to 5, one number per line.');
      const cancelled = await client.stop(roomId, randomUUID());
      await untilIdle(client, roomId);
      log = await logAfter(from);
      console.log(`stop (cancelled ${cancelled}): ${log.map(short).join(' ')}`);
      expect(log.some((e) => e.kind === 'room.stop_requested')).toBe(true);
      expect(buildTranscript(log, room.members).some((i) => i.type === 'system' && i.text.startsWith('You stopped the room'))).toBe(true);
      const after = await lastSeq();
      await sleep(8_000);
      expect(await lastSeq()).toBe(after);

      // 5. closing the app mid-round doesn't stop it; reopening shows the replies.
      from = await lastSeq();
      const t0 = Date.now();
      await send('Check-in again: say your name.');
      link.close(); // the phone sleeps right after the ACK
      const closedAt = Date.now() - t0;
      await sleep(20_000);
      await untilIdle(client, roomId); // a new socket, opened by the first call
      log = await logAfter(from);
      console.log(`closed ${closedAt} ms after the send, reopened after ~20 s: ${log.map(short).join(' ')}`);
      expect(spoke(log).length).toBeGreaterThanOrEqual(1);
      expect([...new Set(turnsOf(log).map((e) => e.memberId))].sort()).toEqual([...names].sort());

      // 6. a resend of the same event_id after an unknown outcome never double-posts.
      from = await lastSeq();
      const eventId = randomUUID();
      await client.send(roomId, eventId, `@${A} reply with one word`);
      await client.send(roomId, eventId, `@${A} reply with one word`);
      await untilIdle(client, roomId);
      log = await logAfter(from);
      expect(log.filter((e) => e.kind === 'message.user')).toHaveLength(1);
      console.log('resend with the same event_id: one user message in the log');
    } finally {
      if (roomId) await client.disband(roomId).catch((e) => console.log(`disband: ${e.message}`));
      link.close();
      for (const n of names) await m.deleteBot(n).catch((e) => console.log(`delete ${n}: ${e.message}`));
    }
    const left = (await m.listProfiles()).map((p) => p.name);
    for (const n of names) expect(left).not.toContain(n);
    console.log(`throwaway bots ${names.join(', ')} deleted, room disbanded`);
  }, 900_000);
});

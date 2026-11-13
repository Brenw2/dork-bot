// Group rooms (card 8): Hermes's own gateway-hosted rooms, driven with `groups.*` JSON-RPC over
// `hermes serve`'s /api/ws (docs/GROUP-ROOMS-SPIKE.md). The room, its members and its whole log live on
// the gateway; turns run on b-lab. This file is plain TypeScript with an injectable `call`, so it is
// unit-tested in Node. It holds: parsing, the client, mention routing, the transcript builder, the
// row summary for the bot list, the poller and the resend-safe send.

export type Call = <T = any>(method: string, params?: Record<string, unknown>) => Promise<T>;

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 6;
export const MAX_ROUNDS = 3;
export const POLL_MS = 2000;
export const RESERVED_HANDLES = ['all', 'everyone'];
/** Same bot within this many seconds drops the avatar and name (G3). */
export const GROUP_WINDOW_S = 120;

// ---------- parsing ----------

export interface RoomMember {
  memberId: string;
  profile: string;
  handle: string;
  displayName?: string;
}

export interface Room {
  id: string;
  name: string;
  members: RoomMember[];
  revision: number;
  createdAt: number;
  latestSeq: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** A room from the gateway, or null when it isn't one (no id, name or members). Odd members are dropped. */
export function parseRoom(raw: unknown): Room | null {
  const r = obj(raw);
  const id = str(r.room_id);
  const name = str(r.name);
  if (!id || !name) return null;
  const members: RoomMember[] = [];
  for (const m of Array.isArray(r.members) ? r.members : []) {
    const o = obj(m);
    const profile = str(o.profile) || str(obj(o.target).profile);
    const memberId = str(o.member_id) || profile;
    const handle = str(o.handle) || profile;
    if (!profile || !handle) continue;
    members.push({ memberId, profile, handle, ...(str(o.display_name) ? { displayName: str(o.display_name) } : {}) });
  }
  if (!members.length) return null;
  return { id, name, members, revision: num(r.revision, 1), createdAt: num(r.created_at), latestSeq: num(r.latest_seq) };
}

export function parseRoomList(raw: unknown): { rooms: Room[]; next: number | null } {
  const r = obj(raw);
  const rooms = (Array.isArray(r.rooms) ? r.rooms : []).map(parseRoom).filter((x): x is Room => x !== null);
  return { rooms, next: typeof r.next_offset === 'number' ? r.next_offset : null };
}

export type EventKind = 'message.user' | 'message.member' | 'turn.settled' | 'turn.cancelled' | 'room.stop_requested' | 'room.activity' | 'room.disbanded' | string;

export interface RoomEvent {
  seq: number;
  kind: EventKind;
  actorKind: string;
  /** The member's id for member events; "desktop" for the user. */
  actorId: string;
  text: string;
  threadId: string;
  /** Seconds since epoch, when the gateway says. */
  at?: number;
  /** `turn.settled`: the member stayed silent. */
  passed: boolean;
  /** The member a turn event is about. */
  memberId: string;
  status: string;
  reason: string;
}

export function parseEvent(raw: unknown): RoomEvent | null {
  const e = obj(raw);
  const seq = num(e.seq, -1);
  const kind = str(e.kind);
  if (seq < 0 || !kind) return null;
  const actor = obj(e.actor);
  const p = obj(e.payload);
  const at = num(e.created_at ?? e.at ?? p.created_at, 0);
  return {
    seq,
    kind,
    actorKind: str(actor.kind),
    actorId: str(actor.id) || str(actor.profile),
    text: str(p.text),
    threadId: str(p.thread_id),
    ...(at > 0 ? { at } : {}),
    passed: p.passed === true,
    memberId: str(p.member_id) || str(actor.id) || str(actor.profile),
    status: str(p.status),
    reason: str(p.reason_code),
  };
}

export interface LogPage {
  events: RoomEvent[];
  cursor: number;
  latestSeq: number;
  hasMore: boolean;
}

export function parseLog(raw: unknown): LogPage {
  const r = obj(raw);
  const events = (Array.isArray(r.events) ? r.events : []).map(parseEvent).filter((x): x is RoomEvent => x !== null);
  return { events, cursor: num(r.cursor), latestSeq: num(r.latest_seq), hasMore: r.has_more === true };
}

export type MemberStatus = 'queued' | 'running' | string;

export interface PendingAction {
  kind: 'approval' | 'retry' | 'discard' | string;
  memberId: string;
  taskId: string;
  generation: number;
  requestId: string;
  command: string;
  description: string;
  choices: string[];
}

export interface RoomState {
  working: boolean;
  blocked: boolean;
  /** member id -> status, for members with a turn queued or running. */
  activity: Record<string, MemberStatus>;
  pending: PendingAction[];
  latestSeq: number;
}

export function parseState(raw: unknown): RoomState {
  const r = obj(raw);
  const d = obj(r.driver_status);
  const activity: Record<string, MemberStatus> = {};
  for (const a of Array.isArray(d.member_activity) ? d.member_activity : []) {
    const o = obj(a);
    const id = str(o.member_id);
    const status = str(o.status);
    if (id && (status === 'queued' || status === 'running')) activity[id] = status;
  }
  const pending: PendingAction[] = [];
  for (const a of Array.isArray(d.pending_actions) ? d.pending_actions : []) {
    const o = obj(a);
    const detail = obj(o.request ?? o.payload);
    const choices = (Array.isArray(o.choices) ? o.choices : Array.isArray(detail.choices) ? detail.choices : []).filter((c: unknown): c is string => typeof c === 'string');
    pending.push({
      kind: str(o.kind),
      memberId: str(o.member_id),
      taskId: str(o.task_id),
      generation: num(o.execution_generation),
      requestId: str(o.request_id) || str(detail.request_id),
      command: str(o.command) || str(detail.command),
      description: str(o.description) || str(detail.description),
      choices,
    });
  }
  return { working: d.working === true, blocked: d.blocked === true, activity, pending, latestSeq: num(obj(r.room).latest_seq) };
}

// ---------- the client ----------

export interface NewRoom {
  roomId: string;
  name: string;
  /** Hermes profile names; the handle is the profile name (what Hermes Desktop does). */
  profiles: string[];
}

export class RoomError extends Error {}

/** Why a new room can't be made yet, or null. Names are compared case-insensitively against `taken`. */
export function createProblem(name: string, profiles: string[], taken: string[] = []): string | null {
  const n = name.trim();
  if (!n) return 'Give the group a name.';
  if (taken.some((t) => t.trim().toLowerCase() === n.toLowerCase())) return "That name's taken";
  if (profiles.length < MIN_MEMBERS) return `Pick at least ${MIN_MEMBERS} bots.`;
  if (profiles.length > MAX_MEMBERS) return `Pick at most ${MAX_MEMBERS} bots.`;
  if (new Set(profiles).size !== profiles.length) return 'A bot is picked twice.';
  if (profiles.some((p) => RESERVED_HANDLES.includes(p.toLowerCase()))) return 'A bot is named all or everyone, which rooms reserve.';
  return null;
}

export class RoomClient {
  constructor(private readonly call: Call) {}

  /** Rooms run on the gateway only when it has a durable driver. */
  async supported(): Promise<boolean> {
    try {
      const caps = obj(await this.call('groups.capabilities'));
      return caps.driver === true;
    } catch {
      return false;
    }
  }

  async list(): Promise<Room[]> {
    const out: Room[] = [];
    let offset: number | null = 0;
    for (let i = 0; offset !== null && i < 20; i++) {
      const page = parseRoomList(await this.call('groups.list', { limit: 100, offset }));
      out.push(...page.rooms);
      offset = page.next;
    }
    return out;
  }

  async create(n: NewRoom): Promise<Room> {
    const problem = createProblem(n.name, n.profiles);
    if (problem) throw new RoomError(problem);
    const members = n.profiles.map((p) => ({ member_id: p, profile: p, handle: p, target: { kind: 'local', profile: p } }));
    const made = obj(await this.call('groups.create', { room_id: n.roomId, name: n.name.trim(), members }));
    const room = parseRoom(made.room);
    if (!room) throw new RoomError('Hermes made the room but sent nothing back.');
    return room;
  }

  async rename(roomId: string, name: string): Promise<void> {
    if (!name.trim()) throw new RoomError('Give the group a name.');
    await this.call('groups.rename', { room_id: roomId, name: name.trim() });
  }

  async disband(roomId: string): Promise<void> {
    await this.call('groups.disband', { room_id: roomId });
  }

  async state(roomId: string): Promise<RoomState> {
    const r = obj(await this.call('groups.state', { room_id: roomId }));
    return { ...parseState(r) };
  }

  async roomState(roomId: string): Promise<{ room: Room | null; state: RoomState }> {
    const r = obj(await this.call('groups.state', { room_id: roomId }));
    return { room: parseRoom(r.room), state: parseState(r) };
  }

  /** One page of the log after `since`. */
  async log(roomId: string, since: number, limit = 100): Promise<LogPage> {
    return parseLog(await this.call('groups.log', { room_id: roomId, since_seq: since, limit }));
  }

  /** Everything after `since`, paged. */
  async logAll(roomId: string, since: number): Promise<{ events: RoomEvent[]; cursor: number }> {
    const events: RoomEvent[] = [];
    let cursor = since;
    for (let i = 0; i < 50; i++) {
      const page = await this.log(roomId, cursor);
      events.push(...page.events);
      cursor = Math.max(cursor, page.cursor, ...page.events.map((e) => e.seq));
      if (!page.hasMore) break;
    }
    return { events, cursor };
  }

  /** Idempotent on `eventId`: after an unknown outcome, call again with the same id. */
  async send(roomId: string, eventId: string, text: string): Promise<{ accepted: boolean; seq: number }> {
    const r = obj(await this.call('groups.send', { room_id: roomId, event_id: eventId, payload: { text, thread_id: eventId } }));
    return { accepted: r.accepted === true, seq: num(obj(r.event).seq) };
  }

  async stop(roomId: string, cancelId: string): Promise<number> {
    const r = obj(await this.call('groups.stop', { room_id: roomId, cancel_id: cancelId }));
    return num(r.cancelled);
  }

  async approve(roomId: string, a: PendingAction, choice: string): Promise<void> {
    await this.call('groups.approve', {
      room_id: roomId,
      member_id: a.memberId,
      task_id: a.taskId,
      execution_generation: a.generation,
      request_id: a.requestId,
      choice,
    });
  }
}

// ---------- mentions ----------

export type Segment =
  | { kind: 'plain'; text: string }
  | { kind: 'member'; text: string; handle: string }
  | { kind: 'all'; text: string }
  | { kind: 'you'; text: string };

const MENTION = /(^|[^A-Za-z0-9_@.\-+])@([A-Za-z0-9][A-Za-z0-9_\-]*)/g;

const key = (s: string) => s.toLowerCase();

/** Splits text into plain runs and @mentions. Unknown @words and emails stay plain. `you` is @user. */
export function tokenizeMentions(text: string, members: RoomMember[]): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const handles = new Map(members.map((m) => [key(m.handle), m.handle]));
  for (const m of text.matchAll(MENTION)) {
    const word = m[2];
    const start = (m.index ?? 0) + m[1].length;
    const end = start + 1 + word.length;
    let seg: Segment | null = null;
    if (RESERVED_HANDLES.includes(key(word))) seg = { kind: 'all', text: text.slice(start, end) };
    else if (key(word) === 'user' && !handles.has('user')) seg = { kind: 'you', text: text.slice(start, end) };
    else if (handles.has(key(word))) seg = { kind: 'member', text: text.slice(start, end), handle: handles.get(key(word))! };
    if (!seg) continue;
    if (start > last) out.push({ kind: 'plain', text: text.slice(last, start) });
    out.push(seg);
    last = end;
  }
  if (last < text.length) out.push({ kind: 'plain', text: text.slice(last) });
  return out.length ? out : [{ kind: 'plain', text }];
}

/** Whether a message asks for the user: `@user` as a word (gateway rooms don't flag it, so the app does). */
export function mentionsUser(text: string): boolean {
  return tokenizeMentions(text, []).some((s) => s.kind === 'you');
}

/**
 * Who a message from the user reaches, as the gateway routes it: `@all`/`@everyone` or no mention means
 * every member; otherwise just the mentioned ones. The gateway does the real routing; this is for the
 * app's own labels and tests.
 */
export function routeOf(text: string, members: RoomMember[]): { to: 'all' | 'some'; handles: string[] } {
  const segs = tokenizeMentions(text, members);
  if (segs.some((s) => s.kind === 'all')) return { to: 'all', handles: members.map((m) => m.handle) };
  const handles = [...new Set(segs.flatMap((s) => (s.kind === 'member' ? [s.handle] : [])))];
  return handles.length ? { to: 'some', handles } : { to: 'all', handles: members.map((m) => m.handle) };
}

/** The `@word` being typed at the caret (it must start a word), or null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([A-Za-z0-9_\-]*)$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

export interface Suggestion {
  kind: 'member' | 'all';
  handle: string;
  label: string;
  job?: string;
}

/** Matches by display name or handle (prefix first, then anywhere). `@all` stays last. Empty when nothing matches. */
export function suggestions(members: RoomMember[], query: string, label: (m: RoomMember) => string = (m) => m.displayName ?? m.handle, job: (m: RoomMember) => string | undefined = () => undefined): Suggestion[] {
  const q = key(query);
  const hit = (s: string) => key(s).indexOf(q);
  const ranked = members
    .map((m) => ({ m, a: hit(label(m)), b: hit(m.handle) }))
    .filter((x) => x.a >= 0 || x.b >= 0)
    .sort((x, y) => Number(!(x.a === 0 || x.b === 0)) - Number(!(y.a === 0 || y.b === 0)));
  const out: Suggestion[] = ranked.map(({ m }) => ({ kind: 'member', handle: m.handle, label: label(m), job: job(m) }));
  if (!q || 'all'.startsWith(q) || 'everyone'.startsWith(q)) out.push({ kind: 'all', handle: 'all', label: 'Everyone' });
  return out;
}

/** Puts `@handle ` where the query was. Returns the new text and caret. */
export function insertMention(text: string, caret: number, handle: string): { text: string; caret: number } {
  const q = mentionQuery(text, caret);
  if (!q) return { text, caret };
  const after = text.slice(caret);
  const insert = `@${handle} `;
  const next = text.slice(0, q.start) + insert + after.replace(/^ /, '');
  return { text: next, caret: q.start + insert.length };
}

// ---------- the transcript ----------

export type Item =
  | { type: 'user'; seq: number; text: string; at?: number }
  | { type: 'member'; seq: number; member: RoomMember | null; actorId: string; text: string; at?: number; grouped: boolean; needsYou: boolean }
  | { type: 'system'; seq: number; text: string };

/** A pass is a silent turn. The model writes `[SILENT]`; nothing is shown for it (G3). */
export function isPass(text: string): boolean {
  const t = text.trim();
  return !t || t === '[SILENT]';
}

function memberOf(members: RoomMember[], id: string): RoomMember | null {
  return members.find((m) => m.memberId === id || m.profile === id || m.handle === id) ?? null;
}

/**
 * The room as rows. Passes and gateway bookkeeping are left out. A stop becomes one system line naming
 * the members whose turns it cancelled. `seenSeq` marks which `@user` messages are still unread.
 */
export function buildTranscript(events: RoomEvent[], members: RoomMember[], label: (m: RoomMember | null, id: string) => string = (m, id) => m?.handle ?? id): Item[] {
  const items: Item[] = [];
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let lastBot: { id: string; at?: number } | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.kind === 'message.user') {
      items.push({ type: 'user', seq: e.seq, text: e.text, at: e.at });
      lastBot = null;
    } else if (e.kind === 'message.member') {
      if (isPass(e.text)) continue;
      const grouped = lastBot !== null && lastBot.id === e.actorId && e.at !== undefined && lastBot.at !== undefined && e.at - lastBot.at <= GROUP_WINDOW_S;
      items.push({ type: 'member', seq: e.seq, member: memberOf(members, e.actorId), actorId: e.actorId, text: e.text, at: e.at, grouped, needsYou: mentionsUser(e.text) });
      lastBot = { id: e.actorId, at: e.at };
    } else if (e.kind === 'room.stop_requested') {
      const held: string[] = [];
      for (let j = i + 1; j < sorted.length && sorted[j].kind !== 'message.user'; j++) {
        if (sorted[j].kind === 'turn.cancelled' && !held.includes(sorted[j].memberId)) held.push(sorted[j].memberId);
      }
      const names = held.map((id) => label(memberOf(members, id), id));
      items.push({ type: 'system', seq: e.seq, text: names.length ? `You stopped the room. ${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} held.` : 'You stopped the room.' });
      lastBot = null;
    }
  }
  return items;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Members held by the latest stop: cancelled by it, and nothing from the user since. */
export function heldMembers(events: RoomEvent[]): string[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let held: string[] = [];
  for (const e of sorted) {
    if (e.kind === 'message.user') held = [];
    else if (e.kind === 'room.stop_requested') held = [];
    else if (e.kind === 'turn.cancelled' && !held.includes(e.memberId)) held.push(e.memberId);
  }
  return held;
}

// ---------- the room row ----------

export type RowStatus = 'idle' | 'working' | 'held' | 'needs';

export interface RoomRow {
  id: string;
  name: string;
  count: number;
  members: RoomMember[];
  status: RowStatus;
  /** Who is working, for "<bot> is working…". */
  workingId?: string;
  preview: { speaker: string; text: string } | null;
  /** Seconds since epoch of the newest message, for ordering and the time label. */
  at: number;
  latestSeq: number;
  needsYou: boolean;
}

/** Whether the room wants the user: an unseen @user message, or an approval waiting. */
export function needsYou(events: RoomEvent[], state: RoomState | null, seenSeq: number): boolean {
  if (state?.pending.some((p) => p.kind === 'approval')) return true;
  return events.some((e) => e.kind === 'message.member' && e.seq > seenSeq && !isPass(e.text) && mentionsUser(e.text));
}

export function stripMarkdown(t: string): string {
  return t
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, 'Picture')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One row for the bot list, from the newest log events and the live state. Nothing is invented: no messages means a null preview. */
export function summarizeRoom(room: Room, tail: RoomEvent[], state: RoomState | null, seenSeq: number, label: (m: RoomMember | null, id: string) => string = (m, id) => m?.handle ?? id): RoomRow {
  const items = buildTranscript(tail, room.members, label);
  const last = [...items].reverse().find((i) => i.type !== 'system');
  let preview: RoomRow['preview'] = null;
  if (last?.type === 'member') preview = { speaker: label(last.member, last.actorId), text: stripMarkdown(last.text) };
  else if (last?.type === 'user') preview = { speaker: 'You', text: stripMarkdown(last.text) };
  const needs = needsYou(tail, state, seenSeq);
  const workingId = state ? Object.keys(state.activity)[0] : undefined;
  const held = heldMembers(tail).length > 0 && !state?.working;
  const status: RowStatus = needs ? 'needs' : state?.working || workingId ? 'working' : held ? 'held' : 'idle';
  const newest = [...tail].reverse().find((e) => e.at !== undefined)?.at;
  return {
    id: room.id,
    name: room.name,
    count: room.members.length,
    members: room.members,
    status,
    ...(workingId ? { workingId } : {}),
    preview,
    at: newest ?? room.createdAt,
    latestSeq: Math.max(room.latestSeq, state?.latestSeq ?? 0, ...tail.map((e) => e.seq)),
    needsYou: needs,
  };
}

/** Rooms and bots share one list, newest first. A room that needs you goes to the top. */
export function orderRows<T extends { at: number; needsYou?: boolean }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(!!b.needsYou) - Number(!!a.needsYou) || b.at - a.at);
}

/** "now", "9:41 AM", "Yesterday", "Tue", "Oct 30" (G1, same labels as the bot rows). */
export function timeLabel(at: number, nowMs: number = Date.now()): string {
  if (!at) return '';
  const t = new Date(at * 1000);
  const n = new Date(nowMs);
  const diff = (nowMs - at * 1000) / 1000;
  if (diff < 60 && diff > -60) return 'now';
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(n) - day(t)) / 86_400_000);
  if (days <= 0) return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return t.toLocaleDateString('en-US', { weekday: 'short' });
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------- polling ----------

export interface PollerDeps {
  client: RoomClient;
  roomId: string;
  /** The cursor to catch up from (the last seq already shown). */
  since: number;
  onEvents: (events: RoomEvent[]) => void;
  onState: (state: RoomState) => void;
  onError?: (e: unknown) => void;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/**
 * While a room is open: catch up from the cursor, then groups.state + groups.log every 2 s. `stop()` ends
 * it (the app calls that in the background); `start()` again catches up. Never overlaps two ticks.
 */
export class RoomPoller {
  private cursor: number;
  private timer: unknown = null;
  private running = false;
  private busy = false;
  private fresh = true;
  private readonly interval: number;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (t: unknown) => void;
  ticks = 0;

  constructor(private readonly d: PollerDeps) {
    this.cursor = d.since;
    this.interval = d.intervalMs ?? POLL_MS;
    this.setT = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = d.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  get seq(): number {
    return this.cursor;
  }
  get active(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.fresh = true; // catch up from the cursor on every open or resume
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
  }

  /** One round: state, then any new log events. Safe to call by hand (after a send). */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.ticks++;
      const state = await this.d.client.state(this.d.roomId);
      this.d.onState(state);
      if (state.latestSeq > this.cursor || this.fresh) {
        this.fresh = false;
        const { events, cursor } = await this.d.client.logAll(this.d.roomId, this.cursor);
        this.cursor = Math.max(this.cursor, cursor);
        if (events.length) this.d.onEvents(events);
      }
    } catch (e) {
      this.d.onError?.(e);
    } finally {
      this.busy = false;
    }
  }

  private async loop(): Promise<void> {
    await this.tick();
    if (!this.running) return;
    this.timer = this.setT(() => void this.loop(), this.interval);
  }
}

// ---------- resend-safe send ----------

export interface PendingSend {
  eventId: string;
  text: string;
}

/** Where the one unsent message per room lives until the gateway ACKs it (Desktop's rule). */
export interface SendStore {
  get(roomId: string): Promise<PendingSend | null>;
  set(roomId: string, p: PendingSend | null): Promise<void>;
}

export function memorySendStore(): SendStore & { map: Map<string, PendingSend> } {
  const map = new Map<string, PendingSend>();
  return {
    map,
    get: async (r) => map.get(r) ?? null,
    set: async (r, p) => void (p ? map.set(r, p) : map.delete(r)),
  };
}

/**
 * Posts a message. The id is stored before the call, so after an unknown outcome (the socket died before
 * the ACK) the next call resends the same event_id and the gateway never double-posts. A different text
 * while one is unresolved first settles the old one with its own id.
 */
export async function sendMessage(client: RoomClient, store: SendStore, roomId: string, text: string, newId: () => string): Promise<{ eventId: string }> {
  const old = await store.get(roomId);
  if (old && old.text !== text) {
    await client.send(roomId, old.eventId, old.text);
    await store.set(roomId, null);
  }
  const pending: PendingSend = old && old.text === text ? old : { eventId: newId(), text };
  await store.set(roomId, pending);
  const ack = await client.send(roomId, pending.eventId, text);
  if (!ack.accepted) throw new RoomError('Hermes did not accept the message.');
  await store.set(roomId, null);
  return { eventId: pending.eventId };
}

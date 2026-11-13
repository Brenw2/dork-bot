import { describe, expect, it, vi } from 'vitest';
import {
  buildTranscript,
  createProblem,
  heldMembers,
  insertMention,
  mentionQuery,
  mentionsUser,
  memorySendStore,
  orderRows,
  parseEvent,
  parseLog,
  parseRoom,
  parseRoomList,
  parseState,
  RoomClient,
  RoomPoller,
  routeOf,
  sendMessage,
  suggestions,
  summarizeRoom,
  timeLabel,
  tokenizeMentions,
  type Call,
  type RoomEvent,
  type RoomMember,
} from '@/lib/rooms';

const M = (p: string): RoomMember => ({ memberId: p, profile: p, handle: p });
const members = [M('chief'), M('design'), M('mobile')];

const ev = (seq: number, kind: string, extra: Partial<{ actor: any; payload: any; at: number }> = {}): RoomEvent =>
  parseEvent({ seq, kind, actor: extra.actor ?? { kind: 'gateway', id: 'gw' }, payload: extra.payload ?? {}, created_at: extra.at })!;
const user = (seq: number, text: string, at?: number) => ev(seq, 'message.user', { actor: { kind: 'user', id: 'desktop' }, payload: { text }, at });
const said = (seq: number, who: string, text: string, at?: number) => ev(seq, 'message.member', { actor: { kind: 'member', id: who, profile: who }, payload: { text }, at });

describe('room parsing', () => {
  const raw = {
    room_id: 'r1',
    name: 'Ops',
    revision: 3,
    created_at: 100,
    members: [
      { member_id: 'chief', profile: 'chief', handle: 'chief', target: { kind: 'local', profile: 'chief' } },
      { member_id: 'x', handle: 'x', target: { kind: 'local', profile: 'design' } },
      { nonsense: true },
    ],
  };

  it('reads a room, dropping malformed members', () => {
    const r = parseRoom(raw)!;
    expect(r).toMatchObject({ id: 'r1', name: 'Ops', revision: 3 });
    expect(r.members.map((m) => m.profile)).toEqual(['chief', 'design']);
  });

  it('rejects a room with no id, name or members', () => {
    expect(parseRoom({ name: 'x', members: [] })).toBeNull();
    expect(parseRoom({ room_id: 'a', name: 'x', members: [] })).toBeNull();
    expect(parseRoom(null)).toBeNull();
  });

  it('reads a list page and its next offset', () => {
    expect(parseRoomList({ rooms: [raw, 5], next_offset: 100 })).toMatchObject({ next: 100, rooms: [{ id: 'r1' }] });
    expect(parseRoomList({ rooms: [], next_offset: null }).next).toBeNull();
  });

  it('reads log events and a page', () => {
    const page = parseLog({
      events: [
        { seq: 1, kind: 'message.user', actor: { kind: 'user', id: 'desktop' }, payload: { text: 'hi', thread_id: 't' } },
        { seq: 2, kind: 'turn.settled', actor: { kind: 'gateway', id: 'gw' }, payload: { member_id: 'chief', passed: true } },
        { kind: 'broken' },
      ],
      cursor: 2,
      latest_seq: 9,
      has_more: true,
    });
    expect(page.events).toHaveLength(2);
    expect(page.events[0]).toMatchObject({ text: 'hi', threadId: 't', actorKind: 'user' });
    expect(page.events[1]).toMatchObject({ passed: true, memberId: 'chief' });
    expect(page).toMatchObject({ cursor: 2, latestSeq: 9, hasMore: true });
  });

  it('reads the driver state: who is working and what waits for an OK', () => {
    const s = parseState({
      room: { latest_seq: 12 },
      driver_status: {
        working: true,
        blocked: false,
        member_activity: [
          { member_id: 'chief', status: 'running' },
          { member_id: 'design', status: 'queued' },
          { member_id: 'mobile', status: 'settled' },
        ],
        pending_actions: [{ kind: 'approval', member_id: 'chief', task_id: 't1', execution_generation: 2, request_id: 'q1', command: 'rm -rf x', choices: ['once', 'deny'] }],
      },
    });
    expect(s.latestSeq).toBe(12);
    expect(s.working).toBe(true);
    expect(s.activity).toEqual({ chief: 'running', design: 'queued' });
    expect(s.pending[0]).toMatchObject({ kind: 'approval', taskId: 't1', generation: 2, requestId: 'q1', command: 'rm -rf x', choices: ['once', 'deny'] });
    expect(parseState(undefined)).toMatchObject({ working: false, pending: [], activity: {} });
  });
});

describe('the client sends what Hermes Desktop sends', () => {
  it('creates with handle = profile name and a local target', async () => {
    const call = vi.fn(async () => ({ room: { room_id: 'r1', name: 'Ops', members: [{ profile: 'a' }, { profile: 'b' }] } }));
    const room = await new RoomClient(call as unknown as Call).create({ roomId: 'r1', name: ' Ops ', profiles: ['a', 'b'] });
    expect(room.id).toBe('r1');
    expect(call).toHaveBeenCalledWith('groups.create', {
      room_id: 'r1',
      name: 'Ops',
      members: [
        { member_id: 'a', profile: 'a', handle: 'a', target: { kind: 'local', profile: 'a' } },
        { member_id: 'b', profile: 'b', handle: 'b', target: { kind: 'local', profile: 'b' } },
      ],
    });
  });

  it('does not call Hermes for a room that is too small, too big or reserved', async () => {
    const call = vi.fn();
    const c = new RoomClient(call as unknown as Call);
    await expect(c.create({ roomId: 'r', name: 'x', profiles: ['a'] })).rejects.toThrow('at least 2');
    await expect(c.create({ roomId: 'r', name: 'x', profiles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).rejects.toThrow('at most 6');
    await expect(c.create({ roomId: 'r', name: '', profiles: ['a', 'b'] })).rejects.toThrow('name');
    expect(createProblem('x', ['a', 'all'])).toMatch('reserve');
    expect(createProblem('Ops', ['a', 'b'], ['ops'])).toBe("That name's taken");
    expect(createProblem('Ops', ['a', 'b', 'c'])).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('only offers rooms when the gateway has a driver', async () => {
    expect(await new RoomClient((async () => ({ driver: true })) as Call).supported()).toBe(true);
    expect(await new RoomClient((async () => ({ driver: false })) as Call).supported()).toBe(false);
    expect(await new RoomClient((async () => { throw new Error('nope'); }) as Call).supported()).toBe(false);
  });

  it('pages the list until next_offset is null', async () => {
    const pages: any[] = [
      { rooms: [{ room_id: 'a', name: 'A', members: [{ profile: 'p' }] }], next_offset: 1 },
      { rooms: [{ room_id: 'b', name: 'B', members: [{ profile: 'p' }] }], next_offset: null },
    ];
    const call = vi.fn(async () => pages.shift());
    expect((await new RoomClient(call as unknown as Call).list()).map((r) => r.id)).toEqual(['a', 'b']);
    expect(call).toHaveBeenNthCalledWith(2, 'groups.list', { limit: 100, offset: 1 });
  });

  it('answers an approval with the ids the gateway gave', async () => {
    const call = vi.fn(async () => ({}));
    const [a] = parseState({ driver_status: { pending_actions: [{ kind: 'approval', member_id: 'm', task_id: 't', execution_generation: 4, request_id: 'q' }] } }).pending;
    await new RoomClient(call as unknown as Call).approve('r1', a, 'once');
    expect(call).toHaveBeenCalledWith('groups.approve', { room_id: 'r1', member_id: 'm', task_id: 't', execution_generation: 4, request_id: 'q', choice: 'once' });
  });

  it('stop is groups.stop with a cancel id', async () => {
    const call = vi.fn(async () => ({ cancelled: 2 }));
    expect(await new RoomClient(call as unknown as Call).stop('r1', 'c1')).toBe(2);
    expect(call).toHaveBeenCalledWith('groups.stop', { room_id: 'r1', cancel_id: 'c1' });
  });
});

describe('mention routing', () => {
  it('one @bot reaches only that bot', () => {
    expect(routeOf('@design what do you think?', members)).toEqual({ to: 'some', handles: ['design'] });
    expect(routeOf('@Design and @mobile please', members)).toEqual({ to: 'some', handles: ['design', 'mobile'] });
  });
  it('no mention, @all and @everyone reach every bot', () => {
    expect(routeOf('hello team', members).to).toBe('all');
    expect(routeOf('@all resume', members)).toMatchObject({ to: 'all', handles: ['chief', 'design', 'mobile'] });
    expect(routeOf('@everyone hi @chief', members).to).toBe('all');
  });
  it('unknown @words and emails are plain', () => {
    expect(tokenizeMentions('mail me@design.com or @nobody', members).every((s) => s.kind === 'plain')).toBe(true);
    expect(routeOf('mail me@design.com', members).to).toBe('all');
  });
  it('colors known mentions and spots @user', () => {
    expect(tokenizeMentions('@chief and @all, @user ok?', members).map((s) => s.kind)).toEqual(['member', 'plain', 'all', 'plain', 'you', 'plain']);
    expect(mentionsUser('Which one, @user?')).toBe(true);
    expect(mentionsUser('ask user@example.com')).toBe(false);
    expect(mentionsUser('use the @username field')).toBe(false);
  });

  it('autocomplete: opens at the start of a word and filters by name or handle', () => {
    expect(mentionQuery('hi @de', 6)).toEqual({ start: 3, query: 'de' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('mail a@b', 8)).toBeNull();
    expect(mentionQuery('hi @design ', 11)).toBeNull();
    const s = suggestions(members, 'de');
    expect(s.map((x) => x.handle)).toEqual(['design']);
    expect(suggestions(members, '').map((x) => x.kind)).toEqual(['member', 'member', 'member', 'all']);
    expect(suggestions(members, 'a').at(-1)?.kind).toBe('all');
    expect(suggestions(members, 'zzz')).toEqual([]);
    expect(suggestions(members, 'S', (m) => (m.handle === 'mobile' ? 'Sidekick' : m.handle))[0].handle).toBe('mobile'); // a prefix beats a middle match
  });

  it('autocomplete: inserts "@handle " and moves the caret', () => {
    expect(insertMention('hi @de', 6, 'design')).toEqual({ text: 'hi @design ', caret: 11 });
    expect(insertMention('@ x', 1, 'chief')).toEqual({ text: '@chief x', caret: 7 });
    expect(insertMention('plain', 5, 'chief')).toEqual({ text: 'plain', caret: 5 });
  });
});

describe('the transcript', () => {
  it('shows speakers, hides passes and bookkeeping', () => {
    const t = buildTranscript(
      [
        user(1, 'hi', 100),
        said(2, 'chief', 'Hello', 101),
        ev(3, 'turn.settled', { payload: { member_id: 'chief', passed: false } }),
        said(4, 'design', '[SILENT]', 102),
        ev(5, 'turn.settled', { payload: { member_id: 'design', passed: true } }),
        ev(6, 'room.activity', { payload: { status: 'settled' } }),
      ],
      members,
    );
    expect(t.map((i) => i.type)).toEqual(['user', 'member']);
    expect(t[1]).toMatchObject({ type: 'member', member: { handle: 'chief' }, grouped: false, needsYou: false });
  });

  it('groups the same bot within 2 minutes and not after another speaker', () => {
    const t = buildTranscript([said(1, 'chief', 'a', 100), said(2, 'chief', 'b', 150), said(3, 'design', 'c', 160), said(4, 'chief', 'd', 170), said(5, 'chief', 'e', 400)], members);
    expect(t.map((i) => (i.type === 'member' ? i.grouped : null))).toEqual([false, true, false, false, false]);
  });

  it('flags @user replies as needing you', () => {
    const t = buildTranscript([said(1, 'chief', 'Red or blue, @user?', 1)], members);
    expect(t[0]).toMatchObject({ needsYou: true });
  });

  it('a stop becomes one system line naming who is held, and clears when you speak', () => {
    const log = [user(1, 'go'), ev(2, 'room.stop_requested'), ev(3, 'turn.cancelled', { payload: { member_id: 'design' } }), ev(4, 'turn.cancelled', { payload: { member_id: 'mobile' } })];
    const t = buildTranscript(log, members);
    expect(t[1]).toEqual({ type: 'system', seq: 2, text: 'You stopped the room. design and mobile are held.' });
    expect(heldMembers(log)).toEqual(['design', 'mobile']);
    expect(heldMembers([...log, user(5, '@all resume')])).toEqual([]);
  });
});

describe('the room list', () => {
  const room = parseRoom({ room_id: 'r1', name: 'Ops', members: members.map((m) => ({ profile: m.profile })), created_at: 50 })!;
  const idle = parseState({ driver_status: {} });

  it('previews the newest message with its speaker and strips markdown', () => {
    const row = summarizeRoom(room, [user(1, 'hi', 100), said(2, 'design', '**Looks** good, see [the doc](http://x)', 160)], idle, 0);
    expect(row.preview).toEqual({ speaker: 'design', text: 'Looks good, see the doc' });
    expect(row).toMatchObject({ status: 'idle', count: 3, at: 160, needsYou: false });
  });

  it('never invents a preview', () => {
    expect(summarizeRoom(room, [], idle, 0).preview).toBeNull();
    expect(summarizeRoom(room, [said(1, 'chief', '[SILENT]', 5)], idle, 0).preview).toBeNull();
  });

  it('badges Needs you for an unseen @user message and clears it once seen', () => {
    const tail = [said(3, 'chief', '@user pick one?', 200)];
    expect(summarizeRoom(room, tail, idle, 2)).toMatchObject({ needsYou: true, status: 'needs' });
    expect(summarizeRoom(room, tail, idle, 3)).toMatchObject({ needsYou: false, status: 'idle' });
  });

  it('badges Needs you for a pending approval until answered', () => {
    const waiting = parseState({ driver_status: { pending_actions: [{ kind: 'approval', member_id: 'chief' }] } });
    expect(summarizeRoom(room, [], waiting, 0).needsYou).toBe(true);
    expect(summarizeRoom(room, [], parseState({ driver_status: { pending_actions: [{ kind: 'retry', member_id: 'chief' }] } }), 0).needsYou).toBe(false);
  });

  it('shows working and held', () => {
    const busy = parseState({ driver_status: { working: true, member_activity: [{ member_id: 'chief', status: 'running' }] } });
    expect(summarizeRoom(room, [], busy, 0)).toMatchObject({ status: 'working', workingId: 'chief' });
    const held = [user(1, 'go', 1), ev(2, 'room.stop_requested'), ev(3, 'turn.cancelled', { payload: { member_id: 'design' } })];
    expect(summarizeRoom(room, held, idle, 0).status).toBe('held');
  });

  it('orders by recency with Needs you on top', () => {
    const rows = [{ id: 'a', at: 300 }, { id: 'b', at: 100, needsYou: true }, { id: 'c', at: 200 }];
    expect(orderRows(rows).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('labels time like the bot rows', () => {
    const now = new Date(2026, 10, 12, 15, 0, 0).getTime();
    const at = (d: Date) => d.getTime() / 1000;
    expect(timeLabel(at(new Date(2026, 10, 12, 14, 59, 40)), now)).toBe('now');
    expect(timeLabel(at(new Date(2026, 10, 12, 9, 41)), now)).toBe('9:41 AM');
    expect(timeLabel(at(new Date(2026, 10, 11, 23, 0)), now)).toBe('Yesterday');
    expect(timeLabel(at(new Date(2026, 10, 9, 12, 0)), now)).toBe('Mon');
    expect(timeLabel(at(new Date(2026, 9, 30, 12, 0)), now)).toBe('Oct 30');
    expect(timeLabel(0, now)).toBe('');
  });
});

describe('polling', () => {
  function rig(latest: { v: number }, events: Record<number, any[]>) {
    const calls: string[] = [];
    const call = (async (method: string, p: any) => {
      calls.push(`${method}${p.since_seq !== undefined ? `@${p.since_seq}` : ''}`);
      if (method === 'groups.state') return { room: { latest_seq: latest.v }, driver_status: { working: false } };
      const evs = Object.entries(events).filter(([s]) => Number(s) > p.since_seq).map(([, e]) => e).flat();
      return { events: evs, cursor: latest.v, latest_seq: latest.v, has_more: false };
    }) as Call;
    return { calls, client: new RoomClient(call) };
  }
  const e = (seq: number) => ({ seq, kind: 'message.member', actor: { kind: 'member', id: 'a' }, payload: { text: `m${seq}` } });

  it('catches up from the cursor on open, then reads only when the room moved', async () => {
    const latest = { v: 3 };
    const r = rig(latest, { 1: [e(1)], 2: [e(2)], 3: [e(3)] });
    const got: number[] = [];
    const timers: (() => void)[] = [];
    const p = new RoomPoller({ client: r.client, roomId: 'r', since: 1, onEvents: (x) => got.push(...x.map((y) => y.seq)), onState: () => {}, setTimer: (fn) => timers.push(fn) });
    p.start();
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(got).toEqual([2, 3]);
    expect(r.calls).toEqual(['groups.state', 'groups.log@1']);
    timers.shift()!(); // 2 s later, nothing new
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(r.calls).toEqual(['groups.state', 'groups.log@1', 'groups.state']);
    p.stop();
  });

  it('polls about every 2 s, stops in the background, and catches up on resume', async () => {
    vi.useFakeTimers();
    try {
      const latest = { v: 1 };
      const events: Record<number, any[]> = { 1: [e(1)] };
      const r = rig(latest, events);
      const got: number[] = [];
      const p = new RoomPoller({ client: r.client, roomId: 'r', since: 0, onEvents: (x) => got.push(...x.map((y) => y.seq)), onState: () => {} });
      p.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(got).toEqual([1]);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(r.calls.filter((c) => c === 'groups.state')).toHaveLength(3);

      p.stop(); // app in the background
      const before = r.calls.length;
      latest.v = 3;
      events[2] = [e(2)];
      events[3] = [e(3)];
      await vi.advanceTimersByTimeAsync(20_000);
      expect(r.calls).toHaveLength(before);
      expect(p.active).toBe(false);

      p.start(); // back in the foreground
      await vi.advanceTimersByTimeAsync(0);
      expect(got).toEqual([1, 2, 3]);
      p.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps going after an error', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const errors: unknown[] = [];
      const client = new RoomClient((async (m: string) => {
        if (++n === 1) throw new Error('socket closed');
        return m === 'groups.state' ? { room: { latest_seq: 0 }, driver_status: {} } : { events: [], cursor: 0, latest_seq: 0 };
      }) as Call);
      const p = new RoomPoller({ client, roomId: 'r', since: 0, onEvents: () => {}, onState: () => {}, onError: (x) => errors.push(x) });
      p.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(errors).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(n).toBeGreaterThan(1);
      p.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sending', () => {
  const ok = () => ({ accepted: true, event: { seq: 1 } });

  it('a resend after an unknown outcome reuses the same event_id', async () => {
    const store = memorySendStore();
    const ids: string[] = [];
    let fail = true;
    const call = vi.fn(async (_m: string, p: any) => {
      ids.push(p.event_id);
      if (fail) throw new Error('socket closed');
      return ok();
    });
    const client = new RoomClient(call as unknown as Call);
    let n = 0;
    await expect(sendMessage(client, store, 'r', 'hello', () => `id${++n}`)).rejects.toThrow('socket closed');
    expect(store.map.get('r')).toEqual({ eventId: 'id1', text: 'hello' });
    fail = false;
    await sendMessage(client, store, 'r', 'hello', () => `id${++n}`);
    expect(ids).toEqual(['id1', 'id1']);
    expect(n).toBe(1);
    expect(store.map.size).toBe(0); // ACKed: nothing left to retry
  });

  it('a different text settles the old unsent one first, with its own id', async () => {
    const store = memorySendStore();
    await store.set('r', { eventId: 'old', text: 'first' });
    const seen: [string, string][] = [];
    const client = new RoomClient((async (_m: string, p: any) => (seen.push([p.event_id, p.payload.text]), ok())) as Call);
    await sendMessage(client, store, 'r', 'second', () => 'new');
    expect(seen).toEqual([['old', 'first'], ['new', 'second']]);
  });

  it('sends the thread id as the event id and keeps the record when not accepted', async () => {
    const store = memorySendStore();
    const call = vi.fn(async () => ({ accepted: false }));
    await expect(sendMessage(new RoomClient(call as unknown as Call), store, 'r', 'x', () => 'e1')).rejects.toThrow('did not accept');
    expect(call).toHaveBeenCalledWith('groups.send', { room_id: 'r', event_id: 'e1', payload: { text: 'x', thread_id: 'e1' } });
    expect(store.map.get('r')).toBeDefined();
  });
});

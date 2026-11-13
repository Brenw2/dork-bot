// Layout fixtures for group chat (card 8): a fake Hermes rooms socket (`groups.*` over /api/ws) plus the screens
// that use it. Kept out of test-layout.mjs so the two cards' edits to that file don't collide. Imported there.
// Comps: docs/design/comps/g1..g6 (REVIEW.md "Group chat"). The content below follows the comps' Ops room.

const MEMBERS = ['assistant', 'scout', 'chief', 'coder'];
const member = (p) => ({ member_id: p, profile: p, handle: p, target: { kind: 'local', profile: p } });

function day(h, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

let seq = 0;
const ev = (kind, at, actor, payload = {}) => ({ seq: ++seq, kind, created_at: at, actor, payload });
const said = (who, at, text) => ev('message.member', at, { kind: 'member', id: who, profile: who }, { text, thread_id: `t${seq + 1}` });
const asked = (at, text) => ev('message.user', at, { kind: 'user', id: 'desktop' }, { text, thread_id: `t${seq + 1}` });

function opsEvents() {
  seq = 0;
  return [
    said('scout', day(9, 2), 'Morning. No calendar changes for the team today.'),
    said('chief', day(9, 5), "Thanks. @coder where's Notify me?"),
    said('coder', day(9, 6), 'PR is up, tests pass. Waiting on Assistant’s PASS.'),
    asked(day(9, 30), '@assistant where are the group chat comps?'),
    said('assistant', day(9, 31), 'Drawing them now: the room row, New group chat, the room itself, @-mentions, approvals and Stop. Posting here when they’re locked.'),
    said('chief', day(9, 32), 'Good. @coder card 8 starts after the UI fixes, so hold until then.'),
    said('coder', day(9, 33), 'Holding. I’ll pick up card 19 first.'),
  ];
}

const idle = { working: false, blocked: false, counts: {}, pending_actions: [], member_activity: [], peer_routes: [] };
const room = (id, name, members, extra = {}) => ({ room_id: id, name, members: members.map(member), authority_gateway_id: 'install:x', authority_epoch: 1, revision: 1, created_at: day(8), ...extra });

export const ROOM_DATA = {
  // g1: the room row beside the bots, one asking for the user.
  list: {
    rooms: [
      { room: room('r-ops', 'Ops room', MEMBERS), events: [...opsEvents(), said('assistant', day(9, 44), "Design, can you post the group chat comps here when they're ready? @user need a call on Stop.")], driver: idle },
      { room: room('r-lunch', 'Lunch crew', ['assistant', 'scout']), events: ((seq = 0), [asked(day(8, 10), 'Pizza at noon?'), said('scout', day(8, 11), 'Yes. I can pick it up.')]), driver: idle },
    ],
  },
  // g3: the room, two members working.
  chat: {
    rooms: [
      {
        room: room('r-ops', 'Ops room', MEMBERS),
        events: opsEvents(),
        driver: { ...idle, working: true, member_activity: [{ member_id: 'assistant', status: 'running' }, { member_id: 'coder', status: 'queued' }] },
      },
    ],
  },
  // g5: an @user message and an approval waiting.
  needs: {
    rooms: [
      {
        room: room('r-ops', 'Ops room', MEMBERS),
        events: [...opsEvents(), said('assistant', day(9, 41), 'Comps are locked. @user one call for you: should a room’s Stop also hold bots that haven’t started yet?')],
        driver: {
          ...idle,
          working: true,
          member_activity: [{ member_id: 'coder', status: 'running' }],
          pending_actions: [{ kind: 'approval', member_id: 'coder', task_id: 't9', execution_generation: 1, request_id: 'q1', command: 'git push origin app/ui-polish', description: 'pushes to GitHub', choices: ['once', 'deny', 'session', 'always'] }],
        },
      },
    ],
  },
  // g6: stopped, two members held.
  held: {
    rooms: [
      {
        room: room('r-ops', 'Ops room', MEMBERS),
        events: [
          ...opsEvents(),
          ev('room.stop_requested', day(9, 34), { kind: 'user', id: 'desktop' }),
          ev('turn.cancelled', day(9, 34), { kind: 'gateway', id: 'gw' }, { member_id: 'assistant' }),
          ev('turn.cancelled', day(9, 34), { kind: 'gateway', id: 'gw' }, { member_id: 'coder' }),
        ],
        driver: idle,
      },
    ],
  },
  // g2: nothing yet.
  none: { rooms: [] },
};

/** Runs in the page, before the app: a WebSocket that answers groups.* from `data`. */
export function roomsMock({ data }) {
  const rooms = data.rooms;
  const lastSeq = (r) => r.events.reduce((m, e) => Math.max(m, e.seq), 0);
  const handle = (method, p) => {
    const r = rooms.find((x) => x.room.room_id === p.room_id);
    if (method === 'groups.capabilities') return { driver: true, persistent_process: true, protocol_version: 2, methods: [] };
    if (method === 'groups.list') return { rooms: rooms.map((x) => ({ ...x.room, latest_seq: lastSeq(x) })), next_offset: null };
    if (method === 'groups.state') return r ? { room: { ...r.room, latest_seq: lastSeq(r) }, driver_status: r.driver } : null;
    if (method === 'groups.log') {
      const events = r ? r.events.filter((e) => e.seq > (p.since_seq ?? 0)) : [];
      return { events, cursor: events.length ? events[events.length - 1].seq : p.since_seq ?? 0, latest_seq: r ? lastSeq(r) : 0, has_more: false };
    }
    if (method === 'groups.create') return { room: { ...p, authority_epoch: 1, revision: 1, created_at: Date.now() / 1000 } };
    return { accepted: true, event: { seq: 9999 }, cancelled: 0 };
  };
  class MockWS {
    constructor(url) {
      this.url = url;
      setTimeout(() => {
        this.onopen?.({});
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready' } }) });
      }, 5);
    }
    send(raw) {
      const f = JSON.parse(raw);
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: f.id, result: handle(f.method, f.params ?? {}) ?? {} }) }), 5);
    }
    close() {
      this.onclose?.({ code: 1000 });
    }
  }
  globalThis.WebSocket = MockWS;
}

const roomPath = (p) => (p === 'duo-open-landscape' || p === 'desktop' ? '/?room=r-ops' : '/room/r-ops');
const common = { paired: true, extraBots: ['chief', 'coder'] };

/** Screens added to test-layout.mjs. `rooms` picks the ROOM_DATA scenario; `fill` types into a labelled field first. */
export const ROOM_SCREENS = [
  { ...common, name: 'room-list', rooms: 'list', path: () => '/', waitFor: 'Needs you' },
  { ...common, name: 'room-new', rooms: 'none', path: () => '/room-new', waitFor: 'MEMBERS · 0 OF 6', clickAll: ['assistant', 'chief', 'coder'], fill: ['Group name', 'Ops room'] },
  { ...common, name: 'room-chat', rooms: 'chat', path: roomPath, waitFor: 'Holding.' },
  { ...common, name: 'room-mention', rooms: 'chat', path: roomPath, waitFor: 'Holding.', fill: ['Message Ops room', '@'], then: 'Everyone' },
  { ...common, name: 'room-needs-you', rooms: 'needs', path: roomPath, waitFor: 'Run this command?' },
  { ...common, name: 'room-held', rooms: 'held', path: roomPath, waitFor: 'Resume all' },
];

export const ROOM_FIXED = {
  'room-list': ['New bot'],
  'room-new': ['Cancel', 'Create'],
  'room-chat': ['Message Ops room', 'Stop the room'],
  'room-mention': ['Message Ops room'],
  'room-needs-you': ['Message Ops room'],
  'room-held': ['Message Ops room', 'Resume all'],
};
export const ROOM_SEEN = { 'room-chat': ['Holding.'], 'room-needs-you': ['Run this command?'], 'room-held': ['You stopped the room.'] };

# Group rooms spike (card 8)

Spike only. Nothing in `app/`, `lib/` or `components/` changed. Run on b-lab on 2026-11-12 with throwaway bots,
all deleted afterwards. Live test: `test/live-rooms.test.ts`.

## Answer: YES

The app can create and drive a Hermes group room that runs on b-lab, using only what Hermes already ships. It needs
no Hermes patch, no Dork Bot server and no Dork Bot room format. The phone can sleep mid-round.

It is the same JSON-RPC socket the app already uses: `hermes serve`'s `/api/ws` (`lib/gatewayWs.ts` on
`app/private-secrets`, PR #30). The room methods are `groups.*`. They are the same ones Hermes Desktop calls for its
gateway-owned ("canonical") rooms, so a room made from the phone is a normal Hermes room.

Caveat to plan around: **the gateway does not push room events.** The socket sends `gateway.ready` and nothing for
rooms. Desktop polls `groups.state` and `groups.log` every 2 s. The app has to poll while it's open and catch up when
it wakes. A push when a room round finishes or needs the user would need new work on our side (see Gaps).

## The calls

All are JSON-RPC 2.0 frames over `ws(s)://<serve>/api/ws?token=<access token>`, `{jsonrpc, id, method, params}`. The
token is the bearer access token from `/auth/native/refresh`, as in PR #30. `params.profile` is optional and defaults
to the profile the gateway serves.

Source of truth: `tui_gateway/methods_groups.py` (methods), `apps/desktop/src/plugins/hermes-bots/canonical-groups.ts`
and `canonical-group-send.ts` (what Desktop sends), `gateway/hosted_room_driver.py` (the durable driver).

### 0. Discover
`groups.capabilities {}` returned `driver: true`, `persistent_process: true`, `protocol_version: 2` and the method list
(`create list state send log rename disband stop retry approve discard replicate promote demote peer.*`). Check
`driver === true` before offering rooms. Without it, rooms don't run when the client is gone.

### 1. Create
```
groups.create {
  room_id: "<uuid, client-made>",          // idempotent: same id + same body returns the same room
  name: "dbt-spike-room",
  members: [{ member_id: "<profile>", profile: "<profile>", handle: "<profile>",
              target: { kind: "local", profile: "<profile>" }, display_name?: "…" }, …]   // 2 to 6
}
-> { room: { room_id, name, members[], authority_gateway_id, authority_epoch: 1, revision: 1, created_at, idempotent } }
```
Use `handle = profile name` (what Desktop does). `@all` and `@everyone` are reserved, and handles must be unique.
Members must be profiles the gateway serves. Bots made by the app (`/api/profiles`) qualified straight away, with no
API key and no extra config. A profile the gateway doesn't serve fails with
`5111 member 1 profile 'x' is not local to this gateway`. One member fails with
`5111 members must contain between 2 and 6 entries`.

`groups.list {limit:100, offset:0} -> {rooms[], next_offset|null}` lists rooms. Page until `next_offset` is null.
`groups.rename {room_id, name}` renames.

### 2. Post
```
groups.send { room_id, event_id: "<uuid>", payload: { text, thread_id: "<same uuid>" } }
-> { event: { seq, event_id: "user:<hash>", kind: "message.user", actor: { kind: "user", id: "desktop" }, payload }, 
     client_event_id, accepted: true, driver_started: true }
```
- Idempotent on `event_id`. After an unknown outcome (socket died before the ACK), **resend with the same `event_id`**.
  It never double-posts. Desktop keeps one unresolved send per room for this.
- The server picks the actor. The user always shows as `user:desktop`, whoever sent it.
- `thread_id`: Desktop uses the message's own `event_id` for a new topic, and an existing thread's id to reply in it.
- Attachments go via `groups.attachment.upload` first (not tested).

### 3. Read and wait
```
groups.log   { room_id, since_seq: <cursor>, limit: 100 } -> { events[], cursor, latest_seq, has_more, authority }
groups.state { room_id } -> { room: { …, latest_seq }, driver_status: { running, working, blocked,
               counts: {queued,running,settled,cancelled}, pending_actions[], member_activity[{member_id,status}], peer_routes } }
```
Event kinds seen: `message.user`, `message.member` (`actor: {kind:"member", id, profile}`, `payload.text`,
`payload.thread_id`, `payload.turn_id`), `turn.settled` (`payload.passed` true means that member stayed silent),
`turn.cancelled`, `room.stop_requested`, `room.activity` (`status:"settled"`, `reason_code:"silent_round"` marks the
end of a round), `room.disbanded`. `seq` is monotonic per room, so `since_seq` is a safe resume cursor. The round is
over when `driver_status.working === false`.

I did not see `turn.started` in the log, though the docs say it is recorded. While a member runs, `member_activity`
in `groups.state` is the only live signal (`queued` then `running`).

A real no-mention round (3 bots, Haiku), each turn about 2 to 4 s: `message.user` → a answers → settled → b answers →
settled → c answers → settled → `room.activity settled`. Members take turns **in order**, not at the same time. Each
turn sees all earlier room messages. A member can pull another in with `@handle`. The pulled-in member then takes a
later round turn (and usually passes). The cap is 3 rounds.

### 4. Disband
`groups.disband {room_id}` returns a tombstone and writes `room.disbanded`. After that `groups.list` omits the room and
`groups.state` returns `4114 hosted room not found`.

## Proven live

1. **Create:** a room with 2 throwaway bots, then with 3. `groups.list` showed it.
2. **No mention:** every member took a turn on b-lab, in order, and the log read back with the full text.
3. **Phone asleep:** the socket was closed 122 ms after the send ACK (200 ms in the committed test) and reopened 25 s
   later. All the replies and the `silent_round` settle were already in the log. `test/live-rooms.test.ts` repeats this
   and passes: 7 events, both bots spoke, room disbanded, bots deleted.
4. **Mention:** `@room-b which is bigger…` made **only b** answer. b's reply mentioned `@room-a`, so a got one
   follow-up turn and passed. c never ran.
5. **Stop** (`groups.stop {room_id, cancel_id}`) sent mid-round returned `{cancelled: 1}`. The log got
   `room.stop_requested` and `turn.cancelled` for the member that was queued. The next member never ran. There is no
   persistent hold. The next message runs everyone normally.
6. **"Needs you"** (`@user`): a bot that wrote `@user, should we pick red or blue?` produced a plain `message.member`.
   There is **no flag, event or `pending_actions` entry for it**. The gateway doesn't know about `@user`. Desktop's
   needs-you badge for these rooms is its own logic, and the app would have to scan member text for `@user` itself.
7. **Hold words:** `stop @room-b …` is just a mention on gateway rooms. b ran and passed, and c answered. The "stop /
   halt / pause next to an @mention holds that member" rule in the Hermes docs is not in the gateway driver.
8. **Desktop sees it:** Desktop's canonical-room list calls `groups.list` on the gateway
   (`canonical-group-registry.tsx`), and the room lives in the install's root `~/.hermes/shared-state.db`
   (`hosted_rooms`, `hosted_room_events`). I found no copy in any `profile.yaml` or config. The "mirrored into shared
   profile metadata" text in the Hermes docs describes the older Desktop-owned rooms, not these. I did not open Hermes
   Desktop itself (no display here). It reads this same list, so the room should show up with its history. Confirm once
   on a real Desktop.

## What the app keeps locally

Almost nothing. The room, members, name and full log live on the gateway.
- Per gateway connection: nothing about the room itself. Rediscover through `groups.list`. Persist `room_id` only as a
  pin or order preference if wanted.
- Per room: `last seen seq` (for unread and for resuming `groups.log`).
- Per room: **one unsent-message record** `{event_id, payload}` until `groups.send` is ACKed, then delete it. This is
  Desktop's rule, and it gives safe retries.
- Per room: a "needs you" read marker (the seq of the last `@user` message the user has seen), since the gateway doesn't
  track it.

## Gaps and risks

- **No push when the phone is asleep.** Nothing tells the phone a round finished or a bot asked `@user`. The existing
  push plugin (`hermes-plugin/dork-bot-push`) only knows about sessions and Work. It would need a room watcher: a
  poller on b-lab calling `groups.log`, or a plugin on the `on_room_member_activity` hook. That is plugin work, not a
  Hermes patch. Without it the user finds out when they open the app. **This is the biggest gap.**
- **`@user` is text only** (see 6). A bot also has to be told to use it. The room prompt may already do that, but I
  only prompted for it explicitly.
- **Stop is room-wide and has no hold** (see 5 and 7). A per-bot hold would be an app feature, or it needs
  Hermes work.
- **Approvals** show up as `driver_status.pending_actions` entries `{kind: "approval"|"retry"|"discard", member_id,
  task_id, execution_generation, request_id?}`, answered with `groups.approve {room_id, member_id, task_id,
  execution_generation, request_id, choice: "once"|"deny"}` (also `groups.retry`/`groups.discard`). This is from
  Desktop's code. **I did not trigger one live.** The catalog says room turns run with the toolsets
  `bot_room, file, skills, terminal, trello, vision, web` and `approval_mode: manual`, so a room bot that wants a
  command approved will block the room until someone answers. The app needs this UI before real bots go in rooms.
- **Same-gateway members only.** New rooms take only profiles the gateway serves. Bots on other gateways need the
  legacy Desktop-courier rooms, which need a running Desktop. Not an option for us.
- **Cost.** One room message is one model turn per member, up to 3 rounds. A 6-bot room can run about 18 turns for one
  line. Rooms are the way to use mentions to keep that down.
- **Real bots' toolsets.** Members run the profile's own policy (above). A real bot with a `terminal` toolset acts on
  b-lab from a room message.
- **Polling cost.** Desktop polls every 2 s. The app should poll only while a room is open and slow down in the
  background. The calls are cheap local SQLite reads.
- **Docs vs behaviour.** Differences found: no `turn.started` event, no `@user` badge, no hold words (see above).
  Re-check after Hermes upgrades.
- **Local state.** Authority is this gateway's install id (`install:…`, epoch 1). Moving b-lab's `shared-state.db` or
  using `groups.promote` is an operator action (see the Hermes bot-mode doc) and is outside this spike.
- The throwaway profiles were cloned from `assistant` and set to Haiku. Real bots will use their own models.

## Build outline (not built)

1. `lib/rooms.ts`: a thin client over `GatewaySocket` (`groups.capabilities/list/create/send/log/state/stop/disband`),
   with a polling loop keyed on `since_seq`, and a unsent-send record.
2. Room list in Chats next to bot chats. Group chat view (speaker names, threads, Stop). A needs-you badge from `@user`
   text and `pending_actions`.
3. Approvals sheet for `pending_actions`.
4. A push for "round finished" and "@user" (needs the watcher above), as its own card.

## Reproduce
```
DORK_LIVE=1 npx vitest run test/live-rooms.test.ts --silent=false
```
Needs `~/.config/dork-bot/serve.env` and the bot manager (same as `test/live-manager.test.ts`). It creates 2 bots, a
room and deletes them. About 35 s.

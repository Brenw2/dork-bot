# Moving chat turns to `/api/ws` (spike for card 14)

Status: SPIKE, 2026-11-10. Nothing in the app uses the socket yet. `lib/gatewayWs.ts` is a standalone client and
`test/live-ws-sudo.test.ts` is the live proof. Hermes v0.22.5 on b-lab.

## Why

The app chats through the API server (`POST /api/sessions/{id}/chat/stream`). That path never installs Hermes's masked sudo
and secret callbacks (`gateway/platforms/api_server_runs.py:889-955` registers only an approval notify; the scopes in
`gateway/run_turn_runner.py:1313` run only for Platform.LOCAL, `gateway/run_turn_progress.py:1010`). `hermes serve`'s
`/api/ws` JSON-RPC socket (the desktop's) runs the agent through `tui_gateway`, which installs both callbacks
(`tui_gateway/agent_callbacks.py:225-259`) and sends `sudo` / `secret` / `approval` as server-to-client requests.

## What the spike proved (live, throwaway bots, deleted after)

Run it: `DORK_LIVE=1 npx vitest run test/live-ws-sudo.test.ts --silent=false`; over Tailscale add
`DORK_ADMIN_URL=https://b-lab.tail7e27a7.ts.net:8443 DORK_TS_IP=100.101.226.3` (this host does not resolve MagicDNS, so the
test pins the name inside its own process; the phone resolves it normally). Both runs passed.

- Auth: the same bearer token the app already gets from `/auth/native/refresh`, sent as `wss://<serve>/api/ws?token=<access token>`
  (`hermes_cli/web_server_chat.py:288-330` verifies it like the REST bearer leg). Works at :8443 over Tailscale and at 127.0.0.1:9119.
  Nothing new to pair or store.
- The socket must send `client.capabilities {server_requests: true}` after `gateway.ready`; without it Hermes fails the prompts fast.
- `session.create {profile: <bot>}` then `prompt.submit {session_id, text}` streams `message.delta` ... `message.complete`
  (first reply 3.7-4.8 s on Haiku).
- Sudo: `sudo -k; sudo true` raised one `sudo` request frame `{id: srq-..., method: sudo, params: {session_id, command: "sudo -k; sudo true"}}`
  (command already redacted by Hermes). Answered `{value: "dorktest-<random>"}`: sudo said "Sorry, try again" and exited 1, nothing changed.
- Skip (`{value: ""}`): the command failed with "a password is required", the turn ended in ~6 s.
- Stop: `session.interrupt` while the card was open: `request.cancel reason=interrupted`, turn ended in ~3 s.
- Timeout: no answer: `request.cancel reason=timeout` at ~126 s, turn ended with the command failing. No hang.
- Secret: a throwaway skill with `required_environment_variables: DBT_PROBE_KEY` raised one `secret` frame `{env_var, prompt}` when the
  bot loaded the skill; the typed value landed in that bot's `.env`, and the bot's reply said it was stored without printing it.
- Grep (`grep -rlaF`) of the bot's profile dir, `hermes sessions export --no-redact`, `session.history`, the serve and gateway
  journals since the test started and `~/.hermes/logs/`: the sudo value had 0 hits; the secret value was only in the bot's `.env`.
- Same-chat continuity: an existing API-server chat (`dork-bot-<bot>--spike`) resumes over the socket with `session.resume {session_id: <stored id>, profile}`;
  the socket turn saw the earlier messages ("MANGO"), the API server then listed 4 messages in the same session, and a sudo prompt
  also fired on that resumed chat.
- A chat created over the socket (`session.create`) gets a generated stored id (`20261110_222057_17115d`), not `dork-bot-<bot>--<id>`.
  With `source: api_server` the API server lists it, but the app's chat list (`lib/chats.ts isBotChat`) would not show it.

Not tried: a second sudo in the same chat (Hermes caches the password per session, `tools/terminal_tool_sudo.py:34-62`; proving it needs a
second sudo run, which was off limits), the push plugin on a socket turn, images, two devices on one chat, a phone in the background.

## Mapping, today (API server) to `/api/ws`

| App does | Today | On the socket | Breaks or gets worse |
|---|---|---|---|
| Chat ids | app picks `dork-bot-<bot>--<id>`, `POST /api/sessions` (`ensureSession`) | keep creating over REST, then `session.resume {session_id: <that id>, profile}`; the reply carries a short runtime id for later calls | Do not use `session.create` for app chats (generated ids, hidden from the list). Keep a map chat id -> runtime id per socket. |
| Send + stream | SSE: `assistant.delta`, `tool.started/completed`, `approval.request` (`lib/hermes.ts mapEvent`) | `prompt.submit`; events `message.delta`, `tool.start`/`tool.complete`, `message.complete`, `thinking.delta`/`reasoning.delta` | New mapper into the existing `ChatEvent`; `chatReducer` untouched. Tool preview text differs (payloads in `contracts/events.py`). |
| Run id | `run.started {run_id}`, app stores it for polling | none; the runtime session id is the handle | `lib/liveRuns.ts` polls `/v1/runs/<id>`; socket turns have no run. |
| Tool calls | inline cards | `tool.start` (id + args) / `tool.complete` | Fine, richer. |
| Approvals | `approval.request` SSE + `POST /v1/runs/<id>/approval {request_id, execution_generation, choice}`; polled via run status | server request `approval {request_id, command, description, choices}`, answered with a response frame `{choice}`; `approval.pending` replays after reconnect | Different transport, same card. Smart-approval, 300 s timeout settings are the same Hermes core. If the socket is down, there is no REST fallback for an open prompt. |
| Sudo / secret | not possible | server requests `sudo` / `secret`, answer `{value}` (`''` = skip); 120 s | This is the point. Needs the new masked card. |
| Stop | `POST /v1/runs/<id>/stop` | `session.interrupt` (works, also ends an open prompt) | none |
| History reload | `GET /api/sessions/<id>/messages` | keep REST for reads (same SQLite rows; verified the API server sees socket turns); `session.resume` also returns messages | none if REST stays |
| Chat list, rename, delete, titles | REST | keep REST | none. Delete while a socket turn runs: REST refuses 409 only for API-server runs, so close the live session first (`session.close`). |
| Cross-device sync / still-working | poll message count; `busy.ts` reads session rows; `liveRuns` polls runs | a second device `session.resume`s the same stored id and attaches to the live session; events fan out to every viewer; `running` is in the snapshot; `session.events.since` replays after a drop | Better than today (today "re-attaching to the live stream isn't an option", `lib/liveRuns.ts:3`). But `busy.ts`'s mid-turn detection on a device that has no socket still works from REST rows. |
| Model switch per chat | `POST /api/sessions/<id>/model` | `config.set {key: "model", session_id}` or keep REST (stored-session lock) | Check that a REST-locked model is honoured by a resumed socket session before moving. |
| Images | `message: [{type: text}, {type: image_url, data:...}]` | `image.attach_bytes` (base64) then `prompt.submit`, or a parts list in `text` | New code path; 10 MB limit differs; history markers (`[Image attached at: ...]`) should match but are unverified. |
| Per-turn instructions | `system_message` (used for the connector "just added" note, `lib/connectorNotes.ts`) | no equivalent field in `PromptSubmitParams` | Needs a different carrier (hidden user turn, `display_kind: hidden`) or dropped; ask Chief. |
| Push (dork-bot-push plugin) | `post_llm_call`, `pre_approval_request` hooks fire in the gateway | hooks fire in whichever process runs the agent, so in `hermes serve` for socket turns, if the plugin is loaded there | Unverified. No push for sudo/secret exists (no hook); a sudo card that nobody sees times out in 120 s. |
| Routines | `/api/jobs` on the gateway | unchanged | none |
| Bot create/delete, config | `hermes serve` REST | unchanged | none |

## What breaks or gets worse (the honest list)

1. The agent now runs inside `hermes serve` (one process for the dashboard, bot manager and every socket chat), not in the gateway.
   `dork-bot-hermes-serve` is `Restart=always`: a serve restart or a Hermes update kills every running socket turn, and the
   blast radius of a serve restart grows from "bot manager" to "all chats". `systemctl --user status` showed ~220 MB (peak 450 MB) at the time of the check; agents add to it.
2. Prompts need a viewer. No attached socket means the prompt is answered empty at once (`gateway/session_server_requests.py:154`;
   `tui_gateway/AGENTS.md`). The phone must be in the foreground with the socket open; a backgrounded phone skips the sudo.
   (Today an approval waits up to 300 s while the app is closed.) A push for "needs your password" would be a new plugin hook.
3. Sockets drop (phone sleep, Wi-Fi to cellular). Needs reconnect + `session.resume` + `session.events.since`. The `?token=` query form is the one
   proven here (no headers needed); the token is short-lived, so refresh before each connect.
4. The terminal env of socket turns comes from the serve process. The dashboard login password and secret are stripped by
   `tools/environments/local_env_policy.py:49-50`; `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` is not on that list (harmless, but noted).
5. Connector (MCP) warm-up and tool config load in the serve process per session; the "connectors still loading" note logic was built for the gateway.
6. Two writers on one chat: if one device is on the socket and another still on the API server, both write the same stored session.
   Not tested; avoid by moving all devices together (one app release), no mixed mode.
7. `session.create` / `session.resume` hold a live agent in memory until `session.close` or the reaper (`tui_gateway/session_reaper.py`).
   The app must close sessions it opens, and tests must too (the spike does).

## Recommendation: hybrid, one release, flagged

Keep REST for everything except the turn: create/list/rename/delete/history/model/jobs stay on the API server and `hermes serve` as today.
Move only "send a message and stream the turn" (and Stop, approvals, sudo, secret) to the socket, for all chats of all bots in one
app release behind a setting (default off until Brennan tries it), so devices are never mixed on one chat. Ids, the chat list, push
matching (`is_bot_chat`) and history stay as they are. Moving only some chats (for example only on demand when a bot needs sudo)
is possible, because any chat can be `session.resume`d at any time, but it cannot work on demand: the sudo prompt is raised
mid-turn, and the turn is already running on the API server by then. A chat would have to be on the socket before the first message.

## Step plan

1. `lib/gatewayWs.ts` (this spike): socket, request parsing, redacted frame log. Add a reconnect + `session.events.since` layer. Pure TS, unit-tested.
2. `lib/hermesTurn.ts`: a `TurnTransport` interface with two implementations (`sse` = today, `socket`). Same `ChatEvent` output; `chatReducer`, `liveRuns` unchanged.
   Map socket events to `ChatEvent`; keep a chat id -> runtime id map; close sessions on leave.
3. Approvals on the socket (reuse the card; answer by response frame). Verify with `test/live-approval.test.ts` ported to the socket.
4. The private card (card 14 proper): masked field (`secureTextEntry`, no autocorrect/autofill, no copy), bot name, redacted command or env var
   name, 120 s countdown, Skip/Cancel = empty answer; the value only lives in the component's ref and is cleared after the send; never in chat state,
   storage, logs, push or error reports (the unit tests in `test/gatewayWs.test.ts` already pin the client side of this).
5. Behind a setting "Private prompts (beta)", default off. Test on the throwaway bot, then Brennan's phone.
6. Decisions needed before step 2: per-turn instructions (connector note) carrier; image path; whether push for "needs your password" is wanted.
7. Anything that needs a restart: none for the app work. The socket is already served. A serve restart is needed only if Hermes is updated; a
   gateway restart is needed only for the push plugin if socket turns turn out not to load it (verify on a throwaway first). No plugin install
   or TestFlight build is part of this spike.

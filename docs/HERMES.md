# Hermes setup for Dork Bot

The app talks to the gateway's **API server** (`127.0.0.1:8642` on b-lab), reached from the phone through `tailscale serve` at `https://b-lab.tail7e27a7.ts.net`. The gateway runs with `multiplex_profiles: true`, so every bot (profile) is at `/p/<bot>/…` and accepts only **that profile's own** `API_SERVER_KEY`.

## One-time setup (done 2026-11-02)

```bash
hermes config set API_SERVER_KEY "$(openssl rand -hex 32)" >/dev/null          # default profile → ~/.hermes/.env
hermes config set API_SERVER_HOST 127.0.0.1 >/dev/null
hermes -p <bot> config set API_SERVER_KEY "$(openssl rand -hex 32)" >/dev/null # each bot → ~/.hermes/profiles/<bot>/.env
hermes gateway restart                                                         # once, from a normal terminal
scripts/expose-hermes.sh                                                       # share it over Tailscale (HTTPS)
```

Hermes refuses to restart its gateway from inside one of its own sessions, so the restart is always Brennan's step.

## Bot manager (`hermes serve`)

The app creates and deletes bots through `hermes serve`, the backend the Hermes desktop app uses. It runs as the user service `dork-bot-hermes-serve` on `127.0.0.1:9119`, shared at `https://b-lab.tail7e27a7.ts.net:8443`.

```bash
scripts/setup-bot-manager.sh   # once (safe to re-run): login, service, Tailscale share
scripts/pair-hermes.sh         # QR code that signs the app in
```

- Hermes rejects any Host header other than its bind address unless `HERMES_DASHBOARD_PUBLIC_URL` is set, and setting it turns on the login gate. So the service runs with the username/password provider. The login, its signing secret and the public URL live in `~/.config/dork-bot/serve.env` (mode 600), not in `~/.hermes`.
- Sign-in: `POST /auth/password-login` sets cookies; the refresh token from the cookie goes into the QR code. The app trades it at `POST /auth/native/refresh` `{refresh_token, provider: "basic"}` for `{access_token (12 h), refresh_token (30 days, renewed on every refresh)}` and sends `Authorization: Bearer <access_token>`. Tokens are stateless; to sign every device out, change `HERMES_DASHBOARD_BASIC_AUTH_SECRET` and restart the service.
- Endpoints the app uses:

| What | Call |
|---|---|
| List bots | `GET /api/profiles` → `{profiles: [{name, model, provider, description, is_default}]}` |
| Create | `POST /api/profiles` `{name, clone_from: "assistant", description, soul}` (400 if it exists or the name is invalid) |
| Give it a key | `PUT /api/env?profile=<bot>` `{key: "API_SERVER_KEY", value}`. The running gateway accepts it within ~5 s. |
| Read its key | `POST /api/env/reveal?profile=<bot>` `{key: "API_SERVER_KEY"}` (404 if none; 5 per 30 s) |
| Delete | `DELETE /api/profiles/<bot>` (also removes its `~/.local/bin` alias; the gateway keeps running) |

- With this service running, `hermes dashboard` on the same machine may refuse to start (one backend per host). Stop it with `scripts/setup-bot-manager.sh off`.

## Connectors (MCP servers per bot)

The Connectors screen (long-press a bot, or Connectors in the chat header) uses the same `hermes serve` MCP API as the Hermes dashboard. Everything takes `?profile=<bot>`, so each bot has its own connectors and sign-ins. A cloned bot starts with the template's connectors (`assistant` has `trello`).

| What | Call |
|---|---|
| Bot's connectors | `GET /api/mcp/servers` → `{servers: [{name, url, auth, enabled, source}]}` |
| Catalog | `GET /api/mcp/catalog` → `{entries: [{name, description, transport, auth_type, url, required_env, needs_install}]}` (65 entries on 0.22.5; the app hides local builds and localhost URLs) |
| Add from catalog | `POST /api/mcp/catalog/install` `{name, env, enable: true, profile}` |
| Add custom URL | `POST /api/mcp/servers` `{name, url, auth: "oauth", profile}` (409 if it exists) |
| Check / list tools | `POST /api/mcp/servers/<name>/test` → `{ok, tools, error}` (an OAuth server with no token is `ok: false`) |
| Sign in | `POST /api/mcp/servers/<name>/auth` → `{flow_id, status, authorization_url}`; poll `GET /api/mcp/oauth/flows/<id>` until `approved`; cancel with `DELETE` |
| Remove | `DELETE /api/mcp/servers/<name>` |

- The OAuth callback is `HERMES_DASHBOARD_PUBLIC_URL` + `/api/mcp/oauth/callback/<name>`, so `https://b-lab.tail7e27a7.ts.net:8443/...`. The phone's browser reaches it over Tailscale, and the callback path skips the login gate. Verified: the sign-in page Hermes hands out carries that `redirect_uri`.
- **No restart needed.** The gateway loads a connector added to a running bot on its next housekeeping tick (every 60 s). A bot created moments before can take up to two ticks, because the first tick after a bot appears is skipped. Measured 2026-11-03 on 0.22.5: deepwiki registered 15 s and 65 s after it was added, and the bot then called it from its existing chat and from a new one.
- The bot logs this in its **own** log folder, not the main one: `~/.hermes/profiles/<bot>/logs/agent.log` has `MCP servers reconciled with config (<bot>): ... added=['deepwiki']`. `~/.hermes/logs/gateway.log` only shows `Re-scanned profile ...`, which is why an earlier look concluded the gateway never loaded it.
- **The catch is the model, not Hermes.** If the bot is asked before the connector is loaded, it says "I don't have a deepwiki tool", and on later turns it goes along with that reply and never searches for the tool, even though the tool is now there (seen live: two more misses over 6 minutes). The app handles it in `lib/connectorNotes.ts`: for 2 minutes after a connect, the chat shows "<connector> still connecting to <bot>", and until the bot has used the connector (or 30 minutes pass), each turn carries a one-turn system note (`system_message` on `/api/sessions/<id>/chat/stream`, not saved in the history) that names the new connector and its `mcp__<name>__*` tools.
- `DORK_LIVE=1 npx vitest run test/live-connectors.test.ts` checks the whole thing with a throwaway bot, worst case first: it asks before the connector has loaded, then once after the warm-up, and expects a real `mcp__deepwiki__*` tool call on that ask.

## Adding a bot by hand

```bash
hermes profile create <bot>      # then pick its model (hermes -p <bot> model, or the app's model line)
scripts/pair-bot.sh <bot>        # gives it a key if it has none, checks it, shows the QR code
```

## Endpoints the app uses

| What | Call |
|---|---|
| Key check | `GET /p/<bot>/api/sessions?limit=1` → 200 (401 = wrong key) |
| Create the bot's chat | `POST /p/<bot>/api/sessions` `{id, title, source}` → 201, 409 if it exists, 400 `invalid_title` if another session has that title |
| Send + stream a reply | `POST /p/<bot>/api/sessions/<id>/chat/stream` `{message}` → SSE |
| History | `GET /p/<bot>/api/sessions/<id>/messages` → `{data: [{role, content, tool_name, …}]}` |
| Stop a run | `POST /p/<bot>/v1/runs/<run_id>/stop` |
| Is a reply still running? | `GET /p/<bot>/v1/runs/<run_id>` → `{status}`: `running`, then `completed` / `failed` / `cancelled` / `interrupted`; 404 once Hermes forgets it. The reply keeps going when the app hangs up. `/v1/runs/<id>/events` has no events for chat-started runs, so the app polls this (lib/liveRuns.ts) |
| Model list | `GET /p/<bot>/api/model/options?include_unconfigured=false` → `{model, provider, providers: [{slug, name, is_current, models, unavailable_models}]}` (a few seconds; Hermes's own picker list) |
| Chat's model | `GET /p/<bot>/api/sessions/<id>` → `session.model` (name only, no provider) |
| Switch the chat's model | `POST /p/<bot>/api/sessions/<id>/model` `{model, provider}` → `hermes.session.model_lock`; sticks for that chat, next message uses it |
| Routines | `GET/POST /p/<bot>/api/jobs` |

SSE events: `run.started` (`run_id`), `message.started`, `assistant.delta` (`delta`), `tool.started` / `tool.completed` / `tool.failed` (`tool_name`, `preview`), `tool.progress`, `assistant.completed` (`content`), `run.completed` / `run.cancelled` / `run.failed`, `error`, `done`. A real capture is in `test/fixtures/chat-stream-tool.sse`. `runtime` comes back with empty provider/model for the Ollama provider, so check `curl -s localhost:11434/api/ps` to see what served a reply.

## Same bots and chats on every device

The phone and the desktop app show the same bots and the same chats. Nothing extra runs for it:

- **Chats** were already shared: each bot has one Hermes session (`dork-bot-<bot>`), whichever device sends. An open chat checks `GET /p/<bot>/api/sessions/<id>` every 4 s (and when the app comes back) and reloads the history only when `message_count` changed. Hermes saves the user's message as soon as a turn starts (seen on b-lab: count 0 → 1 within 3 s, the reply 49 s later), so a message sent on the other device with no reply yet shows as "<bot> is still working" here, with no Stop (only the sending device has the run id) and with Send still on. That lasts until the reply lands, or 15 minutes.
- **The bot list** follows Hermes (`lib/sync.ts`, run when the list shows and when the app comes back): every profile is a bot, except `default` unless it was added by hand. A bot deleted anywhere goes away everywhere. A new device fetches each bot's existing key (`/api/env/reveal`, 5 reads per 30 s, so a big first sync can take two passes); keys are never replaced, so other devices keep working. Bots added by hand from another Hermes address are left alone.
- **Looks, model picks and Hide** are stored on Hermes in each profile's config, in a `dork_bot:` block, through hermes serve: `GET /api/config?profile=<bot>&include_defaults=false` → `dork_bot`, `PUT /api/config?profile=<bot>` `{config: {dork_bot: {look, model, hidden}}}` (Hermes deep-merges, so the rest of the config stays). Checked live: the block survives a model change (`/api/model/set` writes the same file). Hermes's copy wins; the first sync after updating pushes the phone's existing looks up. "Hide" (was "Remove from app") sets `hidden: true`, so the bot goes from every device and stays on Hermes; adding it back from New bot clears it.
- Without the Hermes sign-in (`scripts/pair-hermes.sh`), a device keeps its own bot list, as before.

`DORK_LIVE=1 npx vitest run test/live-sync.test.ts --silent=false` runs it end to end with two simulated devices and a throwaway bot.

## Pictures in chats

- **Sending.** Session chat takes OpenAI-style parts: `message: [{type: "text", text}, {type: "image_url", image_url: {url: "data:image/jpeg;base64,…"}}]`. The request limit is 10 MB (`MAX_REQUEST_BYTES`), so the app shrinks pictures to 2000 px on the long side (JPEG 0.82–0.85; small PNG screenshots stay PNG) and caps a message at 6 pictures / ~7 MB (`lib/attachments.ts`). Hermes requires some text, so a picture sent alone carries "Here's a picture." (hidden again in the chat).
- **History.** Hermes doesn't keep the picture in the message. It saves a file under the bot's profile and stores the text as `…\n\n[Image attached at: ~/.hermes/profiles/<bot>/cache/documents/native-inputs/<hash>/api_<hash>.png]\n[screenshot]`. The app strips those lines and loads the file back through hermes serve: `GET /api/files/read?path=<path>&profile=<bot>` → `{data_url}`. `GET /api/media?path=` refuses profile folders (403 "Path outside media roots"; its roots are only `~/.hermes/{images,screenshots,cache}`). Deleting a session deletes its picture files.
- Verified 2026-11-04: chief (Opus) read "BLUE 42" from a PNG in 2 s; the desktop app sent a picture through the + button, the reply read it, and after a reload the picture came back from Hermes. gemma4:31b (Dork) reports `vision` in `ollama show`, not yet tried through Hermes.
- Phone: camera and library through expo-image-picker (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` in Info.plist). Desktop: + opens a file picker; paste a screenshot (Ctrl+V) or drop pictures onto the chat.

## Models

A chat keeps the model it started on. If the bot's own setting changes later (e.g. chief was asked to "switch to Opus" and edited its config to Anthropic), the old chat keeps sending its old model name to the new provider, and every message fails ("Anthropic didn't answer after 3 attempts", really `404 model: gemma4:31b`; 2026-11-03, reproduced on a throwaway bot). So the app switches models in two steps (`switchModel` in lib/models.ts):

1. the bot's setting through hermes serve: `POST /api/model/set {scope: "main", provider, model, profile: <bot>}` (same as the dashboard's picker; the gateway uses it from the next turn, no restart);
2. then the open chat: `POST /p/<bot>/api/sessions/<id>/model {model, provider}`.

Lock a hand-added provider as plain `custom`, not `custom:dork`: Hermes checks the lock against the provider the turn ran on, which is reported as `custom`, and throws a good reply away as "confirmed model lock runtime mismatch". `custom` means the endpoint in the bot's own settings, which is why step 1 comes first. Without the Hermes sign-in, the app only does step 2, and can't move a non-Dork bot to Dork.

The model line at the top of every chat opens the picker. A chat whose model doesn't match the bot's provider shows in red. Providers come from Hermes (signed-in ones only; `-acp` duplicates hidden), the bot's own first, then Dork. A brand-new bot can see a shorter list for its first minute while Hermes fills its model cache, and deleting a bot while that runs can leave `profiles/<bot>/provider_models_cache.json.lock` behind.

## Several chats per bot

Each chat is a Hermes session in the bot's profile: the first one is `dork-bot-<bot>` (from when bots had one chat), new ones are `dork-bot-<bot>--<id>`. The Chats screen lists `GET /p/<bot>/api/sessions?source=api_server&limit=200` filtered to those ids with messages, newest first (`lib/chats.ts`). A new chat's session is only created on its first message (`POST /api/sessions` without a title), and Hermes titles it after the first reply. Rename: `PATCH /api/sessions/<id>` `{title}` (null hands naming back to Hermes). Delete: `DELETE /api/sessions/<id>` (409 `session_active_turn` while a reply runs). Nothing about which chat is open is saved on the device: a bot opens on its most recently used chat, so the phone picks up where the desktop left off.

## Approvals

With `approvals.mode` smart (the default) Hermes's own check decides most risky commands; the ones it escalates (or every one, in manual mode) pause the reply. The session stream sends `approval.request` `{request_id, command, description, choices}`, and `GET /v1/runs/<id>` reports `waiting_for_approval`. b-lab's gateway runs the session authority, so the request is in `pending_controls` (`prompt_id` = `request_id`) and the answer must carry the run's `execution_generation`: `POST /v1/runs/<id>/approval` `{request_id, execution_generation, choice}` (`once`, `session`, `always`, `deny`); any other body is 400 `invalid_params`. Unanswered, Hermes denies after `approvals.timeout` (300 s). `DORK_LIVE=1 npx vitest run test/live-approval.test.ts --silent=false` checks it with a throwaway Haiku bot in manual mode (2026-11-04: request in ~4 s; Allow once ran it, Deny left the folder and the bot said so).

## Routines

Hermes cron jobs per bot: `GET /p/<bot>/api/jobs?include_disabled=true`, `POST /api/jobs` `{name, prompt, schedule}` (cron line, `every 2h`, `30m`, or an ISO time), `PATCH`/`DELETE /api/jobs/<id>`, `POST /api/jobs/<id>/pause|resume|run`. Each run is its own session (`source: cron`, title `<name> · Nov 04 11:32`); the screen shows the last reply of the newest one (`lib/routines.ts`).

## Tests against the real thing

```bash
DORK_LIVE=1 npm test                                                   # local, http://127.0.0.1:8642
DORK_LIVE=1 DORK_HERMES_URL=https://b-lab.tail7e27a7.ts.net npm test   # through Tailscale, like the phone
node scripts/smoke-chat.mjs [bot] ["message"]                          # one streamed chat, prints timings
DORK_LIVE=1 npx vitest run test/live-models.test.ts --silent=false     # switch models mid-chat (one Haiku call)
```

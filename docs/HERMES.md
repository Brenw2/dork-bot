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
- **Known problem (0.22.5):** for a bot created after the gateway started, the gateway never loaded a connector added to it. Over 6 minutes the bot's own `tool_search` found no deepwiki tool, and the logs show no reconcile. Sending `/reload-mcp` through the API server just goes to the model. Untested: whether a gateway restart fixes it, and whether bots that existed at gateway start get connectors without one.
- `DORK_LIVE=1 npx vitest run test/live-connectors.test.ts` checks the whole thing with a throwaway bot (and fails on the problem above).

## Adding a bot by hand

```bash
hermes profile create <bot>      # pin it to Dork like the assistant profile
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
| Routines | `GET/POST /p/<bot>/api/jobs` |

SSE events: `run.started` (`run_id`), `message.started`, `assistant.delta` (`delta`), `tool.started` / `tool.completed` / `tool.failed` (`tool_name`, `preview`), `tool.progress`, `assistant.completed` (`content`), `run.completed` / `run.cancelled` / `run.failed`, `error`, `done`. A real capture is in `test/fixtures/chat-stream-tool.sse`. `runtime` comes back with empty provider/model for the Ollama provider, so check `curl -s localhost:11434/api/ps` to see what served a reply.

## Tests against the real thing

```bash
DORK_LIVE=1 npm test                                                   # local, http://127.0.0.1:8642
DORK_LIVE=1 DORK_HERMES_URL=https://b-lab.tail7e27a7.ts.net npm test   # through Tailscale, like the phone
node scripts/smoke-chat.mjs [bot] ["message"]                          # one streamed chat, prints timings
```

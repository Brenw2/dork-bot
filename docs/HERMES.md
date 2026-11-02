# Hermes setup for Dork Bot

Dork Bot talks to Hermes through the gateway's **API server** (`127.0.0.1:8642`). The gateway runs with `multiplex_profiles: true`, so every bot (profile) is reached at `/p/<bot>/…`, using **that profile's own** `API_SERVER_KEY`.

## One-time setup (done 2026-11-02)

```bash
hermes config set API_SERVER_KEY "$(openssl rand -hex 32)"          # default profile → ~/.hermes/.env
hermes config set API_SERVER_HOST 127.0.0.1
hermes -p <bot> config set API_SERVER_KEY "$(openssl rand -hex 32)" # each bot → ~/.hermes/profiles/<bot>/.env
```

Then restart the gateway once from a normal terminal. Hermes refuses to restart itself from inside one of its own sessions:

```bash
scripts/restart-and-test.sh            # hermes gateway restart + smoke test on the assistant profile
```

A bot created later only needs its key. The API server re-reads per-profile keys, so no restart is needed. (Verify this on card 3.)

## Endpoints Dork Bot uses

| What | Call |
|---|---|
| Liveness | `GET /health` (no auth) |
| Create the bot's chat | `POST /p/<bot>/api/sessions` `{id, title, source}` → 201 |
| Send + stream a reply | `POST /p/<bot>/api/sessions/<id>/chat/stream` `{message}` → SSE |
| History | `GET /p/<bot>/api/sessions/<id>/messages` |
| Stop a run | `POST /p/<bot>/v1/runs/<run_id>/stop` |
| Routines | `GET/POST /p/<bot>/api/jobs` |

SSE events: `run.started`, `message.started`, `assistant.delta` (`delta`), `tool.started` / `tool.completed` / `tool.failed` (`tool_name`, `preview`, `args`), `tool.progress` (thinking), `assistant.completed` (`content`, `runtime`), `run.completed` / `run.cancelled` / `run.failed`, `error`, `done`.

## Smoke test

```bash
node scripts/smoke-chat.mjs [bot] ["message"]
```

It prints the streamed reply, time to first token, and the runtime (provider/model) that actually served it. It exits non-zero unless the run completed with streamed text.

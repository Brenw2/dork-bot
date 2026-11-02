# Dork Bot: plan

## What it is

A personal Grok Bot. You message AI teammates ("bots") like people: each has a job, its own memory and routines, and they can work together in a group chat. Everything runs on this machine:

- **Brain:** Dork, the local model in Ollama (now `gemma4:31b` on the Radeon 7900, `http://localhost:11434/v1`).
- **Engine:** Hermes. It handles tool use, memory, skills, scheduling and approvals.
- **App:** Dork Bot, this repo. It has its own UI and name, and is built for one user (Brennan).

## Architecture

```
 Browser / phone (PWA)
        │  HTTP + SSE
        ▼
 dork-bot server  (Node + TypeScript, localhost)
        │
        ├── Hermes API server  ──►  /p/<bot>/v1/runs   (chat; one Hermes profile per bot)
        ├── hermes CLI         ──►  profile create/list/delete, cron add/list/remove
        └── ~/.hermes/profiles/<bot>/  (read-only: SOUL.md, memory files, avatar metadata)
                                   │
                                   ▼
                           Ollama (Dork)
```

- **A bot is a Hermes profile.** Hermes Bot Mode makes the same choice, so `hermes -p <bot> chat` and Hermes Desktop see the same bots. Bot Mode is the reference for behaviour; Dork Bot is a separate UI, not a fork.
- **Chat** goes through the Hermes API server. The gateway runs with `multiplex_profiles: true`, so every profile is served at `/p/<profile>/`, and each profile needs its own `API_SERVER_KEY` in its `.env`.
- **Bot lifecycle and routines** go through the `hermes` CLI. The server wraps it with argument arrays, never shell strings.
- **Group chat** is orchestrated by the dork-bot server. It takes a message, works out who's addressed (@-mentions, or everyone), and runs each bot's turn in order. Each bot sees the room transcript and can reply or stay silent (`[SILENT]`). A round ends when everyone passes or after N rounds.
- **Storage:** Hermes keeps the bot chats. The dork-bot server keeps only app state (group rooms and their transcripts, avatars and UI prefs) in one SQLite file under `~/.dork-bot/`.
- **Phone:** the UI is a PWA. Reaching it from the phone means exposing the server over Tailscale. That's not part of milestone 1.

## Milestone 1: done when

1. **Bot list.** Shows every Dork Bot bot with its name, title and avatar (shape + color). You can create a bot (name, title, job description). That makes a Hermes profile pinned to Dork, with its SOUL.md written from the job description. You can rename it, change the avatar or delete it (with a confirm step).
2. **One chat per bot.** Each bot has one ongoing conversation. Replies stream in, and tool calls show inline (collapsed). The chat survives restarts.
3. **Memory per bot.** "Remember X" persists across chats. A Memory panel shows what the bot remembers and can edit it.
4. **Group chat.** Make a room with 2–6 bots. @-mentions direct a message, and with no mention every bot decides for itself. Each reply shows which bot said it. There's a Stop button.
5. **Routines.** Each bot has a list of scheduled tasks (Hermes cron jobs named `[bot:<name>] <routine>`) that you can add, pause or delete. Results land in that bot's chat.
6. **All on Dork.** No cloud model calls. Every bot profile is pinned to the Ollama endpoint.

## Out of scope for milestone 1

Phone access, voice, computer use, "show a bot how it's done", sharing bots, and multi-machine.

## Known constraints

- One 20 GB model fits in VRAM, so bots take turns and group rounds run one at a time. Expect about 15 s per reply once the model is warm, and about 50 s on a cold start.
- Gemma's tool calling is decent but not perfect. Keep each bot's toolset small (memory, files and web; terminal only if needed).
- Turning on the API server means restarting the Hermes gateway once.

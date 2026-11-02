# Dork Bot: plan

## What it is

A personal Grok Bot, as an iPhone app. You message AI teammates ("bots") like people: each has a job, its own memory and routines, and they can work together in a group chat. The brains run at home:

- **Brain:** Dork, the local model in Ollama on b-lab (now `gemma4:31b` on the Radeon 7900).
- **Engine:** Hermes on b-lab. It handles tool use, memory, skills, scheduling and approvals.
- **App:** Dork Bot, this repo. A React Native (Expo) iPhone app, shipped through TestFlight, built for one user (Brennan).

## Architecture

```
 iPhone: Dork Bot app (Expo / React Native)
        │  HTTPS + SSE, only over Tailscale
        ▼
 tailscale serve  https://b-lab.tail7e27a7.ts.net  →  127.0.0.1:8642
        │
        ▼
 Hermes API server (gateway, multiplex_profiles: true)
        │   /p/<bot>/api/sessions/...   chat, one Hermes profile per bot
        │   /p/<bot>/api/jobs           routines (cron)
        ▼
 Ollama (Dork)
```

- **No Dork Bot server.** The app talks straight to the Hermes API server over Tailscale. Hermes stays bound to `127.0.0.1`; `tailscale serve` (`scripts/expose-hermes.sh`) shares it with Brennan's own devices only, over HTTPS.
- **A bot is a Hermes profile.** Each profile has its own `API_SERVER_KEY` and accepts only that key at `/p/<bot>/`. The app keeps each key in the iOS Keychain (expo-secure-store).
- **Adding a bot to the app:** Hermes has no API for creating or listing profiles, so profiles are made on b-lab (`hermes profile create <bot>`), then `scripts/pair-bot.sh <bot>` shows a QR code. Scanning it with the iPhone camera opens `dorkbot://add?url=…&bot=…&key=…` and the app saves the bot.
- **Chat:** one ongoing Hermes session per bot, id `dork-bot-<bot>`. Replies stream over SSE (`expo/fetch`), tool calls show inline and collapsed, and Stop calls `/v1/runs/<id>/stop`.
- **Group chat** is orchestrated in the app: it works out who's addressed (@-mentions, or everyone) and runs each bot's turn in order through that bot's own session. Each bot sees the room transcript and can reply or stay silent (`[SILENT]`).
- **Storage:** Hermes keeps the bot chats. The app keeps only its own state (saved bots, rooms, avatars) on the phone.
- **iPhone Duo:** built with the iOS 27.1 SDK (Xcode 27.1 on the CI runner) so it runs natively, not in compatibility mode. Layout is decided from the window size with Sports Week's classes (`lib/layoutClass.ts`): compact (every iPhone, folded Duo, Split View) is one pane and portrait-locked; open Duo in portrait is one pane with a 640 pt chat column; open Duo in landscape is bot list | 40 pt fold gutter | chat. The open chat carries across fold and unfold.

## Milestone 1: done when

1. **TestFlight build.** The app installs from TestFlight and connects to Hermes on b-lab over Tailscale. ✅ code, ⏳ first build needs Brennan's Apple login once (docs/TESTFLIGHT.md).
2. **Bot list.** Shows every bot added to the app with its name, avatar color and connection status. Add a bot by scanning a pairing QR code (or by hand), remove it with a confirm step.
3. **One chat per bot.** Each bot has one ongoing conversation. Replies stream in, and tool calls show inline (collapsed). The chat survives app restarts. There's a Stop button.
4. **Routines.** Each bot has a list of scheduled tasks (`/api/jobs`) that you can add, pause or delete. Results land in that bot's chat.
5. **Group chat.** Make a room with 2–6 bots. @-mentions direct a message, and with no mention every bot decides for itself. Each reply shows which bot said it.
6. **All on Dork.** No cloud model calls. Every bot profile is pinned to the Ollama endpoint.

## Out of scope for milestone 1

Creating or deleting Hermes profiles from the phone (no Hermes API for it), a memory editor (no Hermes API for it; "remember X" in chat still works), voice, computer use, sharing bots, Android, and the App Store.

## Known constraints

- One 20 GB model fits in VRAM, so bots take turns and group rounds run one at a time. Measured: about 8 s to the first word for a short warm turn, about 50 s when the turn uses tools or the model is cold. The app shows a "thinking… Ns" timer.
- Gemma's tool calling is decent but not perfect. Keep each bot's toolset small (memory, files and web; terminal only if needed).
- The phone only reaches Hermes while it's on Tailscale and b-lab is awake.
- A brand-new profile key may need one gateway restart before the API server accepts it (not verified yet).

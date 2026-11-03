# Now

Last updated: 2026-11-03

## State

- Rewritten as an Expo (React Native) iPhone app that talks straight to Hermes over Tailscale. The old Node server + Vite web app (PR #1, branch `server/hermes-api`) are dropped.
- Works today: create a bot in the app (name + job → a new Hermes profile on Dork with its own key, ready in about a second), add bots already on Hermes, delete a bot (typed confirm), bot list with connection status, one streamed chat per bot with tool calls inline and a Stop button, history reloads from Hermes. Pairing QR codes still work.
- Verified: type check, unit tests on a real Hermes SSE capture and the Duo window sizes, iOS bundle export, expo-doctor 20/20, a prebuild check (SceneDelegate, launch storyboard, resizable, all orientations, iOS 16.4+), and a live chat through the app's client against Hermes (`reply="pong"`, first word in 8 s).
- iPhone Duo: native (iOS 27.1 SDK), portrait-locked when folded, two panes (list | fold gutter | chat) when open in landscape. Not yet tried on a real Duo; the fold frame is Sports Week's design default (455.5 / 40), not the live hinge position. PR #8 (Duo layout tests + fixes) is open with CI green.
- TestFlight: 0.1.0 (1) shipped 2026-11-02 (EAS cloud build, Xcode 27.1 / iOS 27.1 SDK, checked in the IPA). 0.2.0 (2) adds creating bots. The `EXPO_TOKEN` repo secret is set (2026-11-03, Expo token "dork-bot GitHub Actions"; `eas whoami` works with it), but the GitHub release workflow hasn't run yet.
- Bot manager: `hermes serve` runs as the user service `dork-bot-hermes-serve`, shared at `:8443` behind Hermes's login (docs/HERMES.md). Verified live: create → own key accepted by the gateway with no restart → chat on Dork with the new SOUL.md → delete.
- Dork runs `gemma4:31b` in Ollama at `localhost:11434`. Hermes API server is on (`127.0.0.1:8642`) and shared over Tailscale at `https://b-lab.tail7e27a7.ts.net` (checked 2026-11-03), and the `assistant` profile is pinned to Dork and has a key.
- Off plan, in progress: Connectors (MCP servers per bot, OAuth in an in-app browser) on the local branch `app/connectors`, not committed yet. Not part of milestone 1 until Brennan decides (Trello card 11).

## Next up (milestone 1)

Tracked on the Trello board "Dork Bot" (updated to this plan 2026-11-03).

1. Merge PR #8 (Duo layout fixes).
2. Brennan: run `scripts/pair-hermes.sh`, scan it on the Duo, create a bot, and try the app folded, open portrait and open landscape. Fix what's wrong.
3. Routines screen (`/api/jobs`).
4. Group chat, orchestrated in the app.
5. Avatars (shape + color), titles, rename.
6. Check that every bot is pinned to Dork.

## Blockers (Brennan)

- The Duo test (step 2): hands on the phone.
- Decide whether Connectors goes into milestone 1.

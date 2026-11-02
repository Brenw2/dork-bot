# Now

Last updated: 2026-11-02

## State

- Rewritten as an Expo (React Native) iPhone app that talks straight to Hermes over Tailscale. The old Node server + Vite web app (PR #1, branch `server/hermes-api`) are dropped.
- Works today: create a bot in the app (name + job → a new Hermes profile on Dork with its own key, ready in about a second), add bots already on Hermes, delete a bot (typed confirm), bot list with connection status, one streamed chat per bot with tool calls inline and a Stop button, history reloads from Hermes. Pairing QR codes still work.
- Verified: type check, unit tests on a real Hermes SSE capture and the Duo window sizes, iOS bundle export, expo-doctor 20/20, a prebuild check (SceneDelegate, launch storyboard, resizable, all orientations, iOS 16.4+), and a live chat through the app's client against Hermes (`reply="pong"`, first word in 8 s).
- iPhone Duo: native (iOS 27.1 SDK), portrait-locked when folded, two panes (list | fold gutter | chat) when open in landscape. Not yet tried on a real Duo; the fold frame is Sports Week's design default (455.5 / 40), not the live hinge position.
- TestFlight: 0.1.0 (1) shipped 2026-11-02 (EAS cloud build, Xcode 27.1 / iOS 27.1 SDK, checked in the IPA). 0.2.0 (2) adds creating bots. The GitHub workflow hasn't run yet (needs the `EXPO_TOKEN` secret).
- Bot manager: `hermes serve` runs as the user service `dork-bot-hermes-serve`, shared at `:8443` behind Hermes's login (docs/HERMES.md). Verified live: create → own key accepted by the gateway with no restart → chat on Dork with the new SOUL.md → delete.
- Dork runs `gemma4:31b` in Ollama at `localhost:11434`. Hermes API server is on (`127.0.0.1:8642`) and shared over Tailscale at `https://b-lab.tail7e27a7.ts.net` (checked 2026-11-02), and the `assistant` profile is pinned to Dork and has a key.

## Next up (milestone 1)

Tracked on the Trello board "Dork Bot" (cards need updating to this plan).

1. Brennan: scan `scripts/pair-hermes.sh` on the Duo, create a bot, and try the app folded, open portrait and open landscape. Fix what's wrong.
2. Routines screen (`/api/jobs`).
3. Group chat, orchestrated in the app.
4. Avatars (shape + color), titles, rename.

## Blockers (Brennan)

- `EXPO_TOKEN` repo secret, so GitHub Actions can build releases (`gh secret set EXPO_TOKEN -R Brenw2/dork-bot`).

# Now

Last updated: 2026-11-02

## State

- Rewritten as an Expo (React Native) iPhone app that talks straight to Hermes over Tailscale. The old Node server + Vite web app (PR #1, branch `server/hermes-api`) are dropped.
- Works today: bot list with connection status, add a bot from a `dorkbot://add` pairing QR code or by hand, one streamed chat per bot with tool calls inline and a Stop button, history reloads from Hermes.
- Verified: type check, unit tests on a real Hermes SSE capture and the Duo window sizes, iOS bundle export, expo-doctor 20/20, a prebuild check (SceneDelegate, launch storyboard, resizable, all orientations, iOS 16.4+), and a live chat through the app's client against Hermes (`reply="pong"`, first word in 8 s).
- iPhone Duo: native (iOS 27.1 SDK), portrait-locked when folded, two panes (list | fold gutter | chat) when open in landscape. Not yet tried on a real Duo; the fold frame is Sports Week's design default (455.5 / 40), not the live hinge position.
- Expo project `@brenw2/dork-bot` exists. The TestFlight workflow is in place but has never run. The first release goes straight to TestFlight (docs/TESTFLIGHT.md).
- Dork runs `gemma4:31b` in Ollama at `localhost:11434`. Hermes API server is on (`127.0.0.1:8642`) and shared over Tailscale at `https://b-lab.tail7e27a7.ts.net` (checked 2026-11-02), and the `assistant` profile is pinned to Dork and has a key.

## Next up (milestone 1)

Tracked on the Trello board "Dork Bot" (cards need updating to this plan).

1. First TestFlight build (needs Brennan's Apple login once, docs/TESTFLIGHT.md), then fix what's wrong on the Duo: folded, open portrait, open landscape, keyboard, streaming.
2. Routines screen (`/api/jobs`).
3. Group chat, orchestrated in the app.
4. Avatars (shape + color) and bot titles.

## Blockers (Brennan)

- One-time Apple login for the first TestFlight build (docs/TESTFLIGHT.md, step 1).
- `EXPO_TOKEN` repo secret, so GitHub Actions can build the releases after that.

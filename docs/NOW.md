# Now

Last updated: 2026-11-03 (evening)

## State

- Rewritten as an Expo (React Native) iPhone app that talks straight to Hermes over Tailscale. The old Node server + Vite web app (PR #1, branch `server/hermes-api`) are dropped.
- Works today: create a bot in the app (name + job → a new Hermes profile on Dork with its own key, ready in about a second), add bots already on Hermes, delete a bot (typed confirm), bot list with connection status, one streamed chat per bot with tool calls inline and a Stop button, history reloads from Hermes. Pairing QR codes still work.
- Verified: type check, unit tests on a real Hermes SSE capture and the Duo window sizes, iOS bundle export, expo-doctor 20/20, a prebuild check (SceneDelegate, launch storyboard, resizable, all orientations, iOS 16.4+), and a live chat through the app's client against Hermes (`reply="pong"`, first word in 8 s).
- iPhone Duo: native (iOS 27.1 SDK), portrait-locked when folded, two panes (list | fold gutter | chat) when open in landscape. Not yet tried on a real Duo; the fold frame is Sports Week's design default (455.5 / 40), not the live hinge position. Layout tests for every Duo posture are in CI (PR #8, merged).
- Bot looks: animated pixel characters per bot (color, character, style) and the new app icon (PR #11, merged).
- TestFlight: 0.1.0 (1) and 0.2.0 (2) shipped 2026-11-02 (EAS cloud builds). 0.3.0 (3) shipped 2026-11-03 through the GitHub release workflow (`ios-testflight.yml`, local build on the xcode-27 runner); its submission FINISHED on EAS even though the run went red (the wait step lost DNS after the upload; the workflow now submits with `--no-wait`). 0.4.0 (4) adds model switching (#13). Next release: bump `ios.buildNumber` to 5. Check a submission with the EAS GraphQL `submissions` query, not the run's color.
- Bot manager: `hermes serve` runs as the user service `dork-bot-hermes-serve`, shared at `:8443` behind Hermes's login (docs/HERMES.md). Verified live: create → own key accepted by the gateway with no restart → chat on Dork with the new SOUL.md → delete.
- Dork runs `gemma4:31b` in Ollama at `localhost:11434`. Hermes API server is on (`127.0.0.1:8642`) and shared over Tailscale at `https://b-lab.tail7e27a7.ts.net` (checked 2026-11-03), and the `assistant` profile is pinned to Dork and has a key.
- Connectors (milestone 1 item 7): PR #10. Add, check, sign in to (OAuth in an in-app browser that closes itself) and remove MCP servers per bot. **Works with no gateway restart**: the gateway loads a new connector within about a minute (two minutes for a brand-new bot). The earlier "never loads" finding was wrong: the load is logged in the bot's own `profiles/<bot>/logs/agent.log`, not the main gateway.log. What really failed was the model repeating its own earlier "I don't have that tool" reply; the app now shows a short "still connecting" line and sends a one-turn system note until the bot uses the connector (docs/HERMES.md → Connectors).
- Gateway health: the repeating `state.db was replaced` error is back (main profile's state.db, every 5 s since 12:12 on 2026-11-03). Bots' chats are unaffected; a Hermes restart cleared it last time.
- Models (PR on `app/models`): the model line at the top of each chat shows what it's on; tap to pick any model Hermes is signed in to (Dork, Anthropic, Copilot, Nous free tier). Picking sets the bot's model and switches the open chat, from the next message. A chat whose model doesn't match the bot's provider shows a red warning. chief is on Opus 5.5 (Anthropic) since 2026-11-03 at Brennan's ask; its chat was stuck sending gemma4:31b to Anthropic until it was switched by hand.

## Next up (milestone 1)

Tracked on the Trello board "Dork Bot".

1. Merge PR #10 (connectors), then bump to 0.3.0 (3) and run the first GitHub release workflow (`gh workflow run ios-testflight.yml`).
2. Brennan: run `scripts/pair-hermes.sh`, scan it on the Duo, create a bot, and try the app folded, open portrait and open landscape. Fix what's wrong.
3. Brennan: one real OAuth sign-in from the phone (e.g. Linear or Notion), then use it in a chat.
4. Routines screen (`/api/jobs`).
5. Group chat, orchestrated in the app.
6. Titles and rename (looks are done).
7. Check that every bot is pinned to Dork.

## Blockers (Brennan)

- The Duo test (step 2) and the OAuth sign-in (step 3): hands on the phone.

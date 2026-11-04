# Dork Bot

My own take on Grok Bot, as an iPhone app. AI teammates you message like people. Each bot has a job, its own memory and routines, and bots can work together in group chats. The brains run at home: **Hermes** on my computer, running my local model **Dork** in Ollama or a frontier model, per bot. The phone reaches them over Tailscale.

This is a personal project, built for me. Feel free to fork it.

## How it fits together

- `app/`: the Expo (React Native) app. Bot list, add a bot, one chat per bot.
- `lib/`: plain TypeScript client for the Hermes API server (sessions, streaming chat over SSE), plus pairing links and chat state. Unit-tested.
- `scripts/expose-hermes.sh`: shares Hermes with my own devices over Tailscale (HTTPS).
- `scripts/setup-bot-manager.sh`: runs `hermes serve` (behind its login) so the app can create and delete bots.
- `scripts/pair-hermes.sh`: shows a QR code that signs the app in to Hermes. After that, bots are made in the app.
- `scripts/pair-bot.sh <bot>`: shows a QR code that adds one existing Hermes profile to the app (the old way; still works).

## Run it

```bash
npm install
npm run check && npm test       # type check + unit tests
DORK_LIVE=1 npm test            # also chat with a real bot on Hermes
```

Releases go to TestFlight: see `docs/TESTFLIGHT.md`.

## Milestone 1

- [x] iPhone app that connects to Hermes over Tailscale
- [x] Runs natively on iPhone Duo (two panes when open)
- [x] Bot list, add a bot by QR code
- [x] One streamed chat per bot, tool calls inline, Stop
- [x] First TestFlight build
- [x] Create and delete bots from the app
- [ ] Routines (scheduled tasks per bot)
- [ ] Group chat with @-mentions
- [x] Any model per bot: Dork (Ollama, local) or a frontier model

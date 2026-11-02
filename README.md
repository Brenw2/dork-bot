# Dork Bot

My own take on Grok Bot, as an iPhone app. AI teammates you message like people. Each bot has a job, its own memory and routines, and bots can work together in group chats. The brains run at home: **Hermes** on my computer, with **Dork**, my local model in Ollama. The phone reaches them over Tailscale.

This is a personal project, built for me. Feel free to fork it.

## How it fits together

- `app/`: the Expo (React Native) app. Bot list, add a bot, one chat per bot.
- `lib/`: plain TypeScript client for the Hermes API server (sessions, streaming chat over SSE), plus pairing links and chat state. Unit-tested.
- `scripts/expose-hermes.sh`: shares Hermes with my own devices over Tailscale (HTTPS).
- `scripts/pair-bot.sh <bot>`: shows a QR code that adds a Hermes profile to the app.

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
- [ ] First TestFlight build
- [ ] Routines (scheduled tasks per bot)
- [ ] Group chat with @-mentions
- [ ] All of it on Dork (Ollama, local)

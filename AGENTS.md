# Agent instructions: Dork Bot

Read `docs/PLAN.md` (what we're building and why) and `docs/NOW.md` (current state and next up) before starting. Hermes details: `docs/HERMES.md`. Releases: `docs/TESTFLIGHT.md`.

## Project

- A personal Grok Bot clone as an iPhone app (Expo SDK 58, React Native, expo-router). Owner and only user: Brennan (GitHub Brenw2). The repo is public, MIT-licensed, and forks are welcome, but don't add features for other users.
- The app talks straight to Hermes on b-lab over Tailscale: the gateway's API server for chat (`:443` → 8642) and `hermes serve` for creating and deleting bots (`:8443` → 9119, behind Hermes's login gate). There is no Dork Bot server; don't add one.
- The engine is Hermes. Bots can run on any model Hermes has: Dork (local Ollama) or a frontier model (Anthropic, OpenAI, …). Brennan picks per bot and per chat.
- A bot = a Hermes profile. Don't invent a second bot store.

## Rules

- Branch → PR → squash-merge to `main`. Branch prefix by area: `app/`, `scripts/`, `docs/`.
- Never commit secrets: `.env`, API server keys, `.p8` keys, Expo tokens. Bot keys live in `~/.hermes/profiles/<bot>/.env` and, on the phone, in the Keychain.
- Keep Hermes API logic in `lib/` as plain TypeScript with an injectable `fetch`, so it's unit-tested in Node. Screens in `app/` stay thin.
- Treat `~/.hermes/` as owned by Hermes. Change it through `hermes` commands or the API server, never by writing its databases or `config.yaml` by hand.
- Don't restart the Hermes gateway without asking Brennan. Other sessions run on it.
- Apple team is `C7Z2H37BVG` (personal). Never the Sallie Mae team.
- Stage only your own paths (`git status --short`, `git diff --cached --stat`) before committing.

## Verify

- `npm run check`: type check.
- `npm test`: unit tests (the SSE parser and chat reducer run on a real Hermes capture).
- `npm run bundle:ios`: the app compiles into an iOS bundle.
- Anything that touches chat: `DORK_LIVE=1 npm test` (add `DORK_HERMES_URL=https://b-lab.tail7e27a7.ts.net` to go through Tailscale like the phone) and paste the reply line into the PR.

## When you stop

Update `docs/NOW.md` (what's in flight, next up, blockers) and push it.

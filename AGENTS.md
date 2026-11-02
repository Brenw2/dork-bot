# Agent instructions: Dork Bot

Read `docs/PLAN.md` (what we're building and why) and `docs/NOW.md` (current state and next up) before starting.

## Project

- A personal Grok Bot clone. Owner and only user: Brennan (GitHub Brenw2). The repo is public, MIT-licensed, and forks are welcome, but don't add features for other users.
- The engine is Hermes and the model is Dork (local Ollama). Never add calls to cloud models.
- A bot = a Hermes profile. Don't invent a second bot store.

## Rules

- Branch → PR → squash-merge to `main`. Branch prefix by area: `server/`, `web/`, `docs/`.
- Never commit secrets: `.env`, API server keys, OAuth tokens. Keys live in `~/.hermes/profiles/<bot>/.env`.
- Call `hermes` with argument arrays (`execFile`), never a shell string built from user input.
- Treat `~/.hermes/` as owned by Hermes. Change it through `hermes` commands or the API server, never by writing its databases or `config.yaml` by hand.
- Don't restart the Hermes gateway without asking Brennan. Other sessions run on it.
- Keep it small: one server, one web app, no extra services.

## Verify

- `npm run check`: type check and lint.
- `npm test`: unit tests.
- Anything that touches chat: send a real message to a real bot on Dork and paste what came back into the PR.

## When you stop

Update `docs/NOW.md` (what's in flight, next up, blockers) and push it.

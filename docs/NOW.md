# Now

Last updated: 2026-11-02

## State

- The repo has README, LICENSE, AGENTS.md and docs/PLAN.md. No code yet.
- Dork runs `gemma4:31b` in Ollama (0.40.13) at `localhost:11434`, 100% on the GPU with a 64K context.
- Hermes `assistant` profile is pinned to Dork, and real replies were checked (about 50 s cold, about 16 s warm).
- The Hermes API server is **not enabled** yet. The gateway serves profiles multiplexed (`multiplex_profiles: true`).

## Next up (milestone 1)

Tracked on the Trello board "Dork Bot".

1. Turn on the Hermes API server (needs Brennan's OK for a gateway restart). Then prove one streamed chat with one profile through `/p/<profile>/v1/runs`.
2. Scaffold: `server/` (Node + TypeScript + Hono) and `web/` (Vite + React + TypeScript), with `npm run check` and `npm test`.
3. Bot list and create/edit/delete (profiles).
4. One chat per bot (streaming, tool calls inline).
5. Memory panel.
6. Routines (cron).
7. Group chat.

## Blockers

- The gateway restart for the API server (item 1).

# Now

Last updated: 2026-11-04 (midday)

## State

- Expo (React Native) iPhone app plus a Linux desktop app (#17, Electron around the same web build; docs/DESKTOP.md), both talking straight to Hermes over Tailscale.
- **Same bots and chats on every device** (#16): the bot list, looks, model picks and Hide follow Hermes (a `dork_bot:` block in each profile's config); open chats pick up messages sent on the other device and show the bot working on them (docs/HERMES.md → Same bots and chats on every device). The phone uploads its existing looks on its first sync, so they only match once the phone runs 0.5.0.
- Desktop app installed on b-lab (`scripts/install-desktop.sh --pair`, app menu → Dork Bot), signed in, with assistant and chief. Fixed on 2026-11-04: a black screen (`clearTimeout` called unbound in Chromium), jumpy chat scrolling (no inverted list on web), pop-ups as panels over the app.
- Works: create, add, hide and delete bots; one streamed chat per bot with tool calls inline and Stop; history from Hermes; still-working indicator when a chat is left mid-reply (#15); per-bot connectors with in-app OAuth (#10); model switching (#13); animated pixel characters (#11).
- iPhone Duo: native (iOS 27.1 SDK), portrait-locked when folded, two panes when open in landscape. Not yet tried on a real Duo; the fold frame is Sports Week's design default (455.5 / 40). Layout tests for every posture in CI.
- TestFlight: 0.1.0 (1) to 0.4.0 (4) shipped. **0.5.0 (5)**: sync + the desktop fixes, released 2026-11-04 at Brennan's ask. Check a submission with the EAS GraphQL `submissions` query, not the run's color.
- Bot manager: `hermes serve` as the user service `dork-bot-hermes-serve` at `:8443` behind Hermes's login.
- Models: chief and assistant are both on Opus 5.5 (Anthropic). assistant is the template New bot clones, and New bot refuses a template that isn't on Dork, so **New bot is blocked until assistant is back on Dork** (Brennan's call).
- Hermes chat accepts images inline (`message: [{type: text}, {type: image_url, image_url: {url: data:…}}]`, 10 MB request limit; probe: chief read "BLUE 42" from a PNG in 2 s). History keeps them as `[Image attached at: <profile>/cache/documents/native-inputs/…]`. gemma4:31b reports vision.
- Ollama's model runner crashed once on 2026-11-04 11:23 (a desktop test turn hung until stopped). Watch for it.

## In progress (Brennan's asks, 2026-11-04)

1. Custom ⋯ menu and confirm dialogs on desktop, in place of the native Linux ones.
2. Chat buttons in the bot's own color (readable text on it).
3. Rich replies: markdown, code blocks with syntax highlighting and a Copy button, inline code, lists, tables, links.
4. Send photos and screenshots: camera and library on the phone (expo-image-picker, so a new native build), paste, drop and pick on the desktop. Images shown in the chat on both devices.
Then release 0.6.0.

## Next up (milestone 1)

1. Brennan: try 0.5.0 on the Duo: looks match the desktop, a message sent on one shows on the other, Hide on one hides on both.
2. Routines screen (`/api/jobs`).
3. Group chat, orchestrated in the app.
4. Titles and rename.

## Blockers (Brennan)

- The Duo checks above, and one real OAuth sign-in from the phone: hands on the phone.
- assistant's model (Dork or Opus) decides whether New bot works.

# Now

Last updated: 2026-11-04 (evening)

## State

- Expo (React Native) iPhone app plus a Linux desktop app (#17, Electron around the same web build; docs/DESKTOP.md), both talking straight to Hermes over Tailscale.
- **Same bots and chats on every device** (#16): the bot list, looks, model picks and Hide follow Hermes (a `dork_bot:` block in each profile's config); open chats pick up messages sent on the other device and show the bot working on them (docs/HERMES.md → Same bots and chats on every device). The phone uploads its existing looks on its first sync, so they only match once the phone runs 0.5.0.
- Desktop app installed on b-lab (`scripts/install-desktop.sh --pair`, app menu → Dork Bot), signed in, with assistant and chief. Fixed on 2026-11-04: a black screen (`clearTimeout` called unbound in Chromium), jumpy chat scrolling (no inverted list on web), pop-ups as panels over the app.
- Works: create, add, hide and delete bots; one streamed chat per bot with tool calls inline and Stop; history from Hermes; still-working indicator when a chat is left mid-reply (#15); per-bot connectors with in-app OAuth (#10); model switching (#13); animated pixel characters (#11).
- iPhone Duo: native (iOS 27.1 SDK), portrait-locked when folded, two panes when open in landscape. Not yet tried on a real Duo; the fold frame is Sports Week's design default (455.5 / 40). Layout tests for every posture in CI.
- TestFlight: 0.1.0 (1) to 0.4.0 (4) shipped. **0.5.0 (5)**: sync + the desktop fixes, built 2026-11-04, but its EAS submission ended CANCELED (0.6.0 includes all of it). **0.6.0 (6)**: formatted replies, code blocks, photos/screenshots, bot-colored buttons (#19), submission FINISHED. **0.7.0 (7)**: header button + hideable two-pane bot list (#21), released 2026-11-04 evening at Brennan's ask. Check a submission with the EAS GraphQL `submissions` query, not the run's color.
- Bot manager: `hermes serve` as the user service `dork-bot-hermes-serve` at `:8443` behind Hermes's login.
- Models: chief and assistant are both on Opus 5.5 (Anthropic). assistant is the template New bot clones, and New bot refuses a template that isn't on Dork, so **New bot is blocked until assistant is back on Dork** (Brennan's call).
- Hermes chat accepts images inline (`message: [{type: text}, {type: image_url, image_url: {url: data:…}}]`, 10 MB request limit; probe: chief read "BLUE 42" from a PNG in 2 s). History keeps them as `[Image attached at: <profile>/cache/documents/native-inputs/…]`. gemma4:31b reports vision.
- Ollama's model runner crashed once on 2026-11-04 11:23 (a desktop test turn hung until stopped). Watch for it.

## Done 2026-11-04 (#21, in 0.7.0)

Chat header button no longer drawn as a grey liquid-glass capsule on iOS 26+ (closed and open-portrait Duo). Open Duo in landscape: 300 pt bot list (smaller rows) + chat, with a Hide / Bots button in the chat header; the chat now crosses the fold (layout test's fold keep-out removed for landscape). Same sidebar and Hide on the wide desktop window. Needs a Duo check: the header button look, and whether text across the fold reads OK.

## Done 2026-11-04 (#19, in 0.6.0)

Custom ⋯ menu and dialogs on desktop; chat buttons in the bot's color; formatted replies with highlighted code and Copy; photos and screenshots (camera/library on the phone, pick/paste/drop on desktop), shown on both devices.

## Next up (milestone 1)

1. Brennan: try 0.7.0 on the Duo: looks match the desktop, a message sent on one shows on the other, Hide on one hides on both, take a photo and send it, Copy a code block, the header button look, the hideable bot list in landscape, text across the fold.
2. Routines screen (`/api/jobs`).
3. Group chat, orchestrated in the app.
4. Titles and rename.

## Blockers (Brennan)

- The Duo checks above, and one real OAuth sign-in from the phone: hands on the phone.
- assistant's model (Dork or Opus) decides whether New bot works.

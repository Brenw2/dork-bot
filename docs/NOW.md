# Now

Last updated: 2026-11-12

## State

- Expo (React Native) iPhone app plus a Linux desktop app (#17, Electron around the same web build; docs/DESKTOP.md), both talking straight to Hermes over Tailscale.
- **Same bots and chats on every device** (#16): the bot list, looks, model picks and Hide follow Hermes (a `dork_bot:` block in each profile's config); open chats pick up messages sent on the other device and show the bot working on them (docs/HERMES.md → Same bots and chats on every device). The phone uploads its existing looks on its first sync, so they only match once the phone runs 0.5.0.
- Desktop app installed on b-lab (`scripts/install-desktop.sh --pair`, app menu → Dork Bot), signed in, with assistant and chief. Fixed on 2026-11-04: a black screen (`clearTimeout` called unbound in Chromium), jumpy chat scrolling (no inverted list on web), pop-ups as panels over the app.
- Works: create, add, hide and delete bots; several chats per bot with tool calls inline, Stop and approvals; routines; history from Hermes; still-working indicator when a chat is left mid-reply (#15); per-bot connectors with in-app OAuth (#10); model switching (#13); animated pixel characters (#11).
- iPhone Duo: native (iOS 27.1 SDK), portrait-locked when folded, two panes when open in landscape. Not yet tried on a real Duo; the fold frame is Sports Week's design default (455.5 / 40). Layout tests for every posture in CI.
- TestFlight: 0.1.0 (1) to 0.4.0 (4) shipped. **0.5.0 (5)**: sync + the desktop fixes, built 2026-11-04, but its EAS submission ended CANCELED (0.6.0 includes all of it). **0.6.0 (6)**: formatted replies, code blocks, photos/screenshots, bot-colored buttons (#19), submission FINISHED. **0.7.0 (7)**: header button + hideable two-pane bot list (#21), released 2026-11-04 evening at Brennan's ask. **0.8.0 (8)**: several chats per bot, approvals, routines, any model, glass-free back button (#23, #24), released 2026-11-04 night at Brennan's ask. **0.9.0 (9)**: phone notifications and the per-bot Routine results chat (#26); release PR open, not built yet (needs the Push capability synced on the App ID first: eas credentials, docs/TESTFLIGHT.md). Check a submission with the EAS GraphQL `submissions` query, not the run's color.
- Bot manager: `hermes serve` as the user service `dork-bot-hermes-serve` at `:8443` behind Hermes's login.
- Models: assistant on Dork (gemma4:31b), chief on Sonnet 5.5 (Anthropic), checked 2026-11-04 evening. Any model is fine now: New bot clones assistant whatever model it's on (the Dork-only rule is gone, Brennan's call).
- Hermes chat accepts images inline (`message: [{type: text}, {type: image_url, image_url: {url: data:…}}]`, 10 MB request limit; probe: chief read "BLUE 42" from a PNG in 2 s). History keeps them as `[Image attached at: <profile>/cache/documents/native-inputs/…]`. gemma4:31b reports vision.
- Ollama's model runner crashed once on 2026-11-04 11:23 (a desktop test turn hung until stopped). Watch for it.

## Done 2026-11-04 evening (app/chats, for 0.8.0)

Several chats per bot (Chats screen, New chat, rename, delete; Hermes titles new chats), approvals (Allow once / in this chat / always / Deny card; verified live with test/live-approval.test.ts), Routines screen (add, pause, run now, delete, last result), "‹ Bots" back button without the glass capsule on the chat screen, "can't reach b-lab" message with auto-retry. Needs a Duo check: the back button and ⋯ look, approvals on a real bot.

## In flight: notification avatars (branch app/notification-avatars, card 15)

A bot's notification shows the bot's own picture and display name (Communication Notifications; docs/NOTIFICATION-AVATARS.md). Built and unit-tested in Node: the app renders each bot's idle sprite to a PNG into the App Group on launch and on every look change/sync (lib/avatar.ts), the dork-bot-push plugin (0.3.0) sends mutableContent with the display name, and a Notification Service Extension (targets/notification-service, @bacons/apple-targets) donates the INSendMessageIntent. **Not compiled or run** (no Mac): the Swift extension needs a TestFlight build to check. Needs Brennan once: the credentials step in docs/NOTIFICATION-AVATARS.md (new App ID + App Group + Communication Notifications, Apple ID login). The plugin update on the real bots (scripts/install-push-plugin.sh), a gateway restart and a build all wait for his yes.

## In flight: notifications (PR #26, branch app/notifications)

Built and tested in Node: the dork-bot-push Hermes plugin (install with scripts/install-push-plugin.sh; not installed on any real bot yet), the Notifications screen (phone switch + per-bot switch), tap-to-open, and the per-bot Routine results screen (reads the cron sessions, skips empty/[SILENT]; docs/HERMES.md). **Notify me** (this PR, branch app/routine-notify, plugin 0.3.0): a per-routine switch; a marked routine's output goes into the bot's most recent chat (Hermes's no-turn mirror) and pushes; unmarked routines no longer push at all (card 12 pushed every non-silent run). Run live against a throwaway bot (output in the PR). Not tried on a device. Install the plugin and a real push need Brennan's yes (plugin enable rescans without a restart); a TestFlight build is Chief/Brennan's call.

Still needed for real push:

Real push needs an Apple push key on EAS (none exists) and a provisioning profile with the Push capability, which takes Brennan's Apple login once. Plan: a Hermes plugin (post_llm_call / pre_approval_request hooks) that sends Expo push to device tokens kept in each bot's `dork_bot` config, plus expo-notifications in the app.

## Done 2026-11-04 (#21, in 0.7.0)

Chat header button no longer drawn as a grey liquid-glass capsule on iOS 26+ (closed and open-portrait Duo). Open Duo in landscape: 300 pt bot list (smaller rows) + chat, with a Hide / Bots button in the chat header; the chat now crosses the fold (layout test's fold keep-out removed for landscape). Same sidebar and Hide on the wide desktop window. Needs a Duo check: the header button look, and whether text across the fold reads OK.

## Done 2026-11-04 (#19, in 0.6.0)

Custom ⋯ menu and dialogs on desktop; chat buttons in the bot's color; formatted replies with highlighted code and Copy; photos and screenshots (camera/library on the phone, pick/paste/drop on desktop), shown on both devices.

## Next up (milestone 1)

1. Brennan: try 0.7.0 on the Duo: looks match the desktop, a message sent on one shows on the other, Hide on one hides on both, take a photo and send it, Copy a code block, the header button look, the hideable bot list in landscape, text across the fold.
2. Notifications (see above; one Apple-login step for Brennan).
3. Group chat, orchestrated in the app.

## Blockers (Brennan)

- The Duo checks above, and one real OAuth sign-in from the phone: hands on the phone.

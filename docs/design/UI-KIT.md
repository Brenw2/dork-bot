# Dork Bot UI kit: LOCKED

**Status: LOCKED 2026-11-20** (Brennan: "We need to make sure we have a uniform UI."). Design, card 31. Base: main d15cfe1. Chief signs off as PO.
Companion: `UI-AUDIT.md` (what drifts today, with file:line). Comps: `docs/design/comps/` (locked 2026-11-12) stay the pixel truth for the screens they cover. Where this kit and a comp disagree, the comp wins and this file gets fixed.

Rule: if a screen needs something the kit does not have, add it to the kit first (Design PASS), then use it. No one-off headers, buttons, icons, menus or colours in a screen.

## Where this comes from
- **Today's app** (REVIEW.md, cards 18-29): every value below marked Classic is what ships now. Nothing here changes how a correct screen looks.
- **The 2026-11-19 theme direction** (`design-comps/dork-bot-redesign-2026-11-19`: Appearance setting with Classic, Terminal, Paper, Arcade; bots stay the same). It is not locked yet (Chief to confirm). This kit is built to survive it:
  - Components read colours, radii and fonts from tokens, never literals. Token names follow `themes.proposed.ts` (`onAccent`, `badgeText`, `dialog`, `chevron`, `inlineCode`, `codeText`, `track`, `mixBase`, radius set, `fonts`).
  - Structure is identical in every theme (same header, same button set, same menu). Themes change colour, font, radius and component skin only.
  - Appearance… is an app menu item after Notifications…, and its sheet uses the shared sheet header with Done only (K6).
  - Send/Stop take the theme; every other in-chat button keeps the accent rule (K4).
  - No yellow or gold UI, in any theme. Warn stays orange.
- Values below are **Classic**. Other themes override tokens; they do not add new component variants.

## K1. Header (one pattern)
Two kinds. Nothing else.

**Page header** (1:1 chat, group chat, Usage, bot-level pages): `[back] [title block] [⋯ circle]`.
- Back: `Icon back` 31pt, stroke 2.6, plus the parent's name at 17 ("Bots", "Usage"). Tint colour. 44 pt hit area. Hidden in two panes, where a sidebar-toggle icon (24 phone, 19 desktop) takes its place.
- Title block: 32pt avatar (bot sprite, or the member stack for a group) + name 16/20 semibold + one 12/16 dim line (model, or member names). The **title is tappable** and opens the details sheet: bot sheet for a bot, group sheet for a group (members, rename, disband). Pressed: `raised` fill, radius 10.
- Right: the **⋯ circle** (`Icon ellipsis`, 24 phone / 19 desktop, 44 / 32 hit). ⋯ is the *only* overflow control. **No gear, no ⚙, no "Settings" icon, no bare "⋯" text.** Chat and room pages may add one more icon before it (Chats) and nothing else.
- Height: 52 + safe area on phone; 56 with a bottom hairline in a pane. Row padding 4 left on phone, 12 desktop / 8 iOS pane, gap 8.
- Tint: the bot's colour inside a bot's context; accent for rooms and app-level pages (K4).
- **Large title** (bot list, Usage top level): 34/41 bold, ⋯ and compose icons to its right, back only on Usage. Allowed on top-level lists only.
- Rooms use the *same* `ChatHeader` component as bots, with a room variant. No separate `paneHeader`.

**Sheet header** (K6): for anything opened on top of a page.

## K2. Icons: AppIcons only
All icons come from `components/AppIcons.tsx` through `<Icon name size color stroke>`. Line icons on a 24 grid, stroke 1.8 default (2.2 on small checks), round caps. Sizes: 24 phone header, 19 desktop header, 16 menu and small buttons, 18 banner.

Current set (16): `compose`, `ellipsis`, `chats`, `sidebar`, `back`, `check`, `search`, `warning`, `clock`, `plug`, `palette`, `info`, `trash`, `pencil`, `plus`, `close`.
To add (so no glyph or second file is needed): `chevron` (disclosure ›), `chevron-down`, `arrow-up` (Send), `arrow-down` (Jump to latest), `stop` (filled rounded square), `copy`, `refresh`, `cross` (failed step; same shape as `close` at stroke 2.2, so reuse `close`).
- `ChatIcons.tsx` and `icons.tsx` are folded into AppIcons and deleted.
- No emoji or text glyph as an icon: `⚙ ⋯ ✓ ✕ › ‹ ⌄ ▾ ▸ ↻ ＋`. (Text such as "…" in a label is fine; "✓" in a message is content, not UI.)
- Icons carry no meaning alone: every icon button has an `accessibilityLabel`.
- Bot sprites are not icons; they stay in `BotSprite`.

## K3. Buttons (one set, from `components/Buttons.tsx` and the theme's `button`)
| Button | Phone | Desktop | Use |
|---|---|---|---|
| Primary `<Button>` | 50 tall, radius 25, 17/600, tint fill, `onColor` text | 40, radius 20 | One per screen. In a sheet, the action lives in the header instead |
| Secondary `<Button kind="secondary">` | same, `mix(tint, 0.2)` fill, text `colors.text` | same | The other choice next to a primary (Cancel) |
| `<SmallButton tone>` | 30 tall, radius 15, 13/600, 44 pt hit | 28 | Row actions. `filled`, `tint`, `neutral`, `danger` |
| Header icon button | 44 x 44 | 32 x 32, radius 8, hover `raised` | Header icons (K1) |
| Header text button | Done / Cancel / Save, 17, tint (semibold for commit) | panel header: 32 tall pill | K6 |
| Send / Stop | 30 circle in the field, theme colour | same | Composer only |
| Disabled | `card` fill, `faint` text, no border | same | all |
- Dialog buttons (desktop alert) are `<Button>` at desktop size. The phone uses system alerts.
- Approval buttons are one shared component (4 choices, 2 x 2, height 44 phone, radius 12, 15/600, deny = `bad` outline). Chat and group use it.
- No `Pressable` with its own `backgroundColor` and `borderRadius` pair to make a button.
- Hit target: 44 pt on phone and Duo, 32 on desktop; the look may be smaller with `hitSlop`.

## K4. Colour and the accent rule (unchanged from REVIEW.md)
Inside a bot's context, interactive colour is that bot's colour (`useTint(bot)`). Elsewhere it is `colors.accent`: bot list, New bot, Add, Notifications, Usage, group rooms, dialogs. Bot tints: `mix(c, .18)` avatar disc, `.20` secondary, `.30` your bubble, `.55` approval border. Silver, `bad` for errors and destructive, `ok` for switches and success, `warn` for usage 70-90%. No yellow.

## K5. Menus and dialogs
- One menu API: `Menu.show(title, items, anchor)`. Items: `{ text, icon?, shortcut?, sepBefore?, style? }`. Phone shows the system sheet (ignores icon, shortcut, sepBefore, and adds Cancel). Desktop shows the in-app menu.
- Desktop menu: 248 wide (`MENU_WIDTH`), `raised` fill, radius 12, hairline `menuBorder`, padding 6, items 32 tall, radius 7, 14pt, 16pt icon (`dim`; destructive `bad`), shortcut 12 `faint`, hover `menuHover`. Order: create, rename, [sep] details/settings, [sep] destructive last. Destructive text ends in "…" and asks to confirm.
- Every ⋯ menu gives its items icons (so the desktop menus match each other). A chat's ⋯ has chat actions only; the bot sheet holds the rest (REVIEW.md fix 10).
- Dialog (desktop): 420 wide, radius 16, `dialog` fill, title 18/700, message 15/22 dim, buttons right-aligned (K3). Phone: system alert.
- Bot list ⋯ (app menu): Usage…, Notifications…, Add with a code…, Show hidden bots (Appearance… when it ships). Compose opens New bot, or a New bot / New group chat menu when rooms exist.

## K6. Sheet and panel header
`<Sheet title bot? action? close commit?>` is the only way a screen sets this header.
- Phone: centered title 17/22 semibold with the bot's name under it (12/16 dim); **Done** on the right for lists, **Cancel** left + commit (**Save**, **Create**) right for forms; the create action (New chat, New routine) as a 44 icon on the left. One left item only.
- Desktop panel (`Overlay`): 60 tall, avatar 32 for bot sheets, title + name, create action as a 32 tall tint pill with icon, then `close` 32 box. Panel 560 x 760 max, radius 16, scrim `rgba(0,0,0,.6)`. Bot sheet is a 360 popover under the chat title.
- Forms commit in the header. A long form may also end with one full-width primary (New bot), and then the header shows Cancel only. Never a footer button on desktop and a header button on phone for the same form.
- Every sheet has a title. The bot sheet's title is "Settings" over the bot's name.

## K7. List rows, groups, cards
- Group (`components/Grouped.tsx`): `card` fill, radius 12, rows min 52, hairline separators inset 16 (60 with a leading icon or avatar), section headers 13/18 uppercase dim, footnotes 13/18 dim. Every settings list uses it.
- Bot list row: full-bleed, min 76, 52 avatar (desktop 40), name 17 (desktop 15) semibold, preview 15 (13) dim, time 15 (12) dim, separator from x 80. Selected `raised`, hover `hover`.
- Standalone card (Work item, Routine result, Usage tile): `card` fill, radius 12, hairline `border`. A state may tint the border (routine result), never the radius.
- Disclosure: `Icon chevron` in `disclosure` colour. Selection: trailing `Icon check` in tint (single choice); a ring checkbox with `Icon check`, ring `chevron` colour (multiple choice).
- Pressed `raised`. No hard-coded `#22252A`.

## K8. Switches
`<Switch {...switchProps}>`: on = `colors.ok`, off = `border`, thumb white, same on web. 44 hit row. Always inside a Group row's `right`, with an `accessibilityLabel`.

## K9. Chips, badges, tags
- Chip (tappable choice or status): 32 tall, radius 16, padding 12, 13/600; selected = tint fill + `onColor`; unselected = `border` outline.
- Badge ("Needs you"): 20 tall, radius 10, `bad` fill, 12 bold, `badgeText` colour. One component for list, room list and transcript.
- Tag (non-tappable label, group member name in a message): 22 tall, radius 11, `card` fill, 12.

## K10. Empty, loading, error
- **Empty**: `<EmptyState icon? title? body>`, centered, body 15/22 dim, 24 side padding, 48 from the top. Real copy only; never invented data. Bot list uses the icon + title form (52 tint disc).
- **Loading**: `<Loading>`, a centered `ActivityIndicator` in `colors.dim`, 48 from the top. Keep the last good content on refresh instead of showing it.
- **Error, page**: `<ErrorBanner>`: `errorBg`, hairline `errorLine`, `warning` icon 18 in `bad`, text 13/18 `errorText`, optional "Try again" small button. **Error, form field**: 13/18 `bad` under the field. **Error, message**: the error card (ChatErrors) with the "Hermes said" line.
- Offline or unreachable: same banner, plain words (REVIEW.md fix 1 copy).

## K11. Fields
- `<Field>`: 44 tall, radius 12, `card` fill, hairline `border`, 17pt, placeholder `faint`, padding 14. Focus border = tint (not white). Multiline min 90.
- `<SearchField>`: 36 tall, radius 10, `card` fill, search icon 16 `dim`, clear button.
- Labels 13 dim above; hints 13/18 dim below.

## K12. Spacing, type, radii (tokens)
- Spacing: 4, 8, 12, 16, 20, 24. Screen margin 16; gap between groups 16; between rows in a list 8.
- Type (phone, pt): large title 34/41 700; nav title 17/22 600 (sheet), 16/20 600 (page); subtitle 12/16 dim; body 17/22; row name 17/22 600; preview, time 15/20 dim; group row 17/22 + detail 13/18; section header 13/18 uppercase +0.3; chip, banner, footnote 13/18; code 13/20 mono. Minimum 12. Desktop: body 16/24, row 15/20, preview 13/18, menu 14, section 12.
- Radii: 18 bubbles and message field, 16 cards in chat, dialogs and panels, 12 groups, sheets, standalone cards, fields, approval buttons, 10 desktop rows and search, 8 code and desktop icon buttons, 25/20 primary buttons, 15 small buttons, 50% avatars.
- `maxFontSizeMultiplier={1.4}` on every label that can clip.
- Tokens to add (replace literals; names from the theme spec): `onAccent` (`#fff` in buttons), `badgeText` (`#1A0B0B`), `dialog` (`#1A1C21`), `chevron` use for ring checkbox (`#4B4F56`), `code` (`#0B0C0E`), `menuBorder` (`#343840`), `menuHover` (`#2E3238`), `track` (`#2A2D33` bar track), plus `mix(colors.accent, …)` instead of `mix('#8B7CF6', …)`. Hex literals live only in `lib/theme.ts` (and sprites).

## K13. Chat surface (1:1 and group share it)
One `ChatHeader` (K1), one transcript list with `JumpPill`, one `Composer` (field + round Send/Stop inside, + attach), one keyboard strategy (header drawn by the app, `KeyboardAvoidingView` offset 0). Rooms pass accent instead of a bot colour and may hide the attach button. Delete `keyboardOffset` once rooms draw the shared header.

## Guard tests Mobile should add (so drift fails CI)
Plain Node/vitest source scans in the style of `test/headerItems.test.ts` (scan `app/` and `components/`). Each has a short allow-list of the shared file itself.
- **G1 headers**: `headerLeft`, `headerRight`, `unstable_headerLeftItems`, `unstable_headerRightItems` and `headerTitle` only in `components/Sheet.tsx`, `components/ChatHeader.tsx`, `lib/headerItems.ts`. Fail on `Stack.Screen` options with those keys anywhere else (rooms, RoomNew, usage today).
- **G2 icons**: every `<Icon name="…">` literal is in the `IconName` union (tsc already helps); no `react-native-svg` import outside `components/AppIcons.tsx`; no other file with `Svg` icons (`ChatIcons.tsx`, `icons.tsx` deleted).
- **G3 buttons**: no `Pressable` whose style sets both `borderRadius` >= 15 and `backgroundColor` outside `Buttons.tsx`, `Sheet.tsx`, `Overlay.tsx` and the Composer round buttons; `height: 50` / `height: 44` + `borderRadius` combinations fail. Tests the primary and dialog buttons.
- **G4 no glyph icons**: fail on `⚙ ⋯ ✓ ✕ › ‹ ⌄ ▾ ▸ ↻ ＋ ⚠` inside JSX `<Text>` in `app/` and `components/` (allow `…`, and Markdown, which renders message content). Catches the gear and the bare ⋯.
- **G5 no hex**: fail on `#[0-9a-fA-F]{3,8}` string literals in `app/` and `components/` (except sprites, `Markdown` syntax colours until themed, and `rgba(` shadows). Also fail on `mix('#…'`.
- **G6 switches**: every `<Switch` spreads `switchProps`.
- **G7 states**: every screen in `app/` that has an `ActivityIndicator` imports `Loading`; no inline `styles.empty`/`styles.error` text style; empty and error go through `EmptyState` and `ErrorBanner`.
- **G8 rooms share chat**: `RoomChat.tsx` imports `ChatHeader`, `Composer` and `JumpPill`; does not import `KeyboardAvoidingView` or `keyboardOffset`.
- **G9 sheet header**: every `app/**` screen that is a `popup(...)` in `_layout.tsx` renders `<Sheet title="…">` with a non-empty title (reads the layout and the screen source).
- **G10 hit area**: a layout-test check (extends `test/layout.test.ts`): on iPhone, every header button's box is >= 44 x 44; on desktop >= 32 x 32.
- **G11 menu icons**: every `Menu.show` item list has an `icon` on every non-cancel item (source scan).
- **G12 layout fixtures**: add `iphone--room-chat` and `desktop--room-chat` header crops to the strict-RGB set so a changed header shows as a diff. The desktop gear is invisible to the layout test today (the harness is a plain browser); run the harness with a stubbed desktop bridge so `isDesktop` is true for `desktop--*`.

## Done when (for the PRs that follow)
- Card 29: group header uses ⋯ circle on every posture (K1, G1, G4).
- Follow-up cards (Chief to cut): rooms share `ChatHeader`/transcript (K13); icon merge (K2); shared `EmptyState`/`Loading`/`ErrorBanner`/`Field`/`Chip`/`Badge` (K9-K11); button cleanups (K3); token sweep (K12; ties into the theme plumbing card). Each lands with its guard test.
- Design PASS per PR against this kit plus the layout fixtures. Classic stays pixel-identical except for the fixes the audit names.

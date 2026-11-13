# Dork Bot UI review and locked comps

Card 18 (Trello JszEKgVG). Design, 2026-11-12. Base: main b3ff516.

Brennan's ask: "I like it but it still feels clunky." This is a polish pass, not a rebrand. The pixel bots, bot colors, dark look and Messages feel all stay. Mobile builds the fixes in card 19 and group chat in card 8.

LOCKED: every PNG in `docs/design/comps/` is locked as of 2026-11-12. The id is printed small in each image. Merge rule: a Mobile UI PR merges only after Design gives a PASS against these comps, pinned to the PR's head SHA.

How I reviewed:
- `npm run test:layout` (54/54 clean): every screen on iPhone, the folded Duo, the open Duo in portrait and the open Duo in landscape, with mock data.
- My own capture of the states the layout test doesn't reach: thinking, live tools, approval, send error, typing, menus, dialogs, Look, Notifications. This ran at iPhone 393x852 and at desktop 1280x800, with the real desktop chrome (panels, in-app menus).
- One look at the live desktop app on b-lab (look only, nothing sent, nothing changed). Only a crop of the message box is committed, because the repo is public.

Before screenshots are in `docs/design/before/`. Comp sources (HTML/CSS plus the real sprites from `lib/sprites.ts`) are in `docs/design/comps/src/`. To re-render: `node docs/design/comps/src/render.mjs`.

---

## Top 10 fixes (ranked by how clunky they feel)

| # | Fix | Before | Locked comps |
|---|-----|--------|--------------|
| 1 | Bot list works like Messages | `before/01-bot-list--iphone.png`, `01-bot-list--desktop.png`, `01-two-pane--duo-landscape.png` | `01-bot-list--iphone`, `01-bot-list--desktop`, `01-bot-list--duo-landscape` |
| 2 | Chat header fits on one row | `before/02-chat--iphone.png`, `02-chat-model-problem--iphone.png`, `02-chat--duo-closed.png` | `02-chat--iphone`, `02-chat-model-problem--iphone`, `02-chat-list-hidden--desktop` |
| 3 | Message box: round Send/Stop inside the field | `before/03-composer--iphone.png`, `03-composer-live--desktop.png` | `03-composer--iphone`, `03-composer-states--iphone`, `03-composer--desktop` |
| 4 | Thinking and working states that feel alive | `before/04-thinking--iphone.png`, `04-tools-live--iphone.png` | `04-working--iphone`, `04-working-long--iphone`, `04-working--desktop` |
| 5 | Approvals: inline, one tap, no mixed signals | `before/05-approval--iphone.png`, `05-approval--desktop.png` | `05-approval--iphone`, `05-approval-answered--iphone`, `05-approval--desktop` |
| 6 | Errors in plain words, with Try again | `before/06-error--iphone.png`, `06-error--desktop.png` | `06-errors--iphone`, `06-errors--desktop` |
| 7 | Transcript rhythm: no repeated names, 17 pt body, short links | `before/07-rich--iphone.png`, `07-chat--duo-portrait.png` | `07-transcript--iphone`, `07-transcript--desktop` |
| 8 | Sheets and panels share one header pattern | `before/08-chats--iphone.png`, `08-routines--iphone.png`, `08-chats--desktop.png` | `08-sheet-chats--iphone`, `08-panel-chats--desktop` |
| 9 | One button set, grouped lists, one accent rule | `before/09-connectors--iphone.png`, `09-look--iphone.png`, `09-notifications--iphone.png`, `09-new-bot--iphone.png` | `09-lists-connectors--iphone`, `09-buttons--iphone`, `09-panel-connectors--desktop` |
| 10 | Menus: chat ⋯ has chat actions only; a bot sheet holds the rest | `before/10-chat-menu--desktop.png`, `10-bot-menu--desktop.png`, `10-dialog--desktop.png` | `10-bot-sheet--iphone`, `10-chat-menu--iphone`, `10-menus--desktop` |

Group chat (card 8): `g1-list--iphone`, `g1-room--desktop`, `g2-new-room--iphone`, `g2-new-room--desktop`, `g3-room--iphone`, `g4-mention--iphone`, `g4-mention--desktop`, `g5-needs-you--iphone`, `g5-needs-you--desktop`, `g6-held--iphone`, `g6-held--desktop`.

All comp files are `docs/design/comps/<id>.png`. iPhone comps are 393x852 pt, rendered @2x. Desktop comps are 1280x800. The Duo comp is 951x669.

---

## Tokens (use these; hex is exact)

Colors. The existing `lib/theme.ts` colors stay. Three are new:

| Token | Hex | Use |
|---|---|---|
| bg | #0F1012 | screens |
| card | #1A1C20 | rows, fields, grouped lists, chips, the typing bubble |
| raised (new) | #22252A | selected row, menus, popovers, the mention list |
| hover (new, desktop) | #1C1E22 | hovered row |
| border | #2A2D33 | hairlines (StyleSheet.hairlineWidth) |
| text | #ECEDEF | primary text |
| dim | #9298A0 | secondary text, timestamps |
| faint (new) | #6B7078 | placeholder, disabled text |
| accent | #8B7CF6 | app-level accent: anything with no bot context |
| ok | #4CC38A | switches on |
| bad | #F06A6A | errors, the Needs you badge, destructive actions |
| code | #0B0C0E | code block and command backgrounds |
| sidebar (new, desktop) | #0D0E10 | desktop and Duo sidebar background |
| error-bg / error-line (new) | #24171A / #4A2A2E | error and model-problem banners and cards |
| error-text / error-detail (new) | #F0C7C9 / #C9A9AC | banner text / the "Hermes said" line |

Bot tints come from the existing `mix(color, t)` in `lib/color.ts`:
- `mix(c, 0.18)` is the avatar disc.
- `mix(c, 0.20)` is a secondary or tinted button.
- `mix(c, 0.30)` is your bubble (unchanged).
- `mix(c, 0.55)` is the approval card border.
- `onColor(c)` is text on a bot-colored fill.

Accent rule (fix 9):
- Inside a bot's context, interactive color is that bot's color. That covers its chat, Chats, Routines, Routine results, Connectors, Look, Model and its bot sheet.
- Everywhere else, it's accent #8B7CF6. That covers the bot list, New bot, Add with a code, the Notifications screen, group rooms and dialogs.
- Today Connectors, Look Save, Model and Notifications use purple inside a bot's screens, while Chats and Routines use the bot color. That's the inconsistency this rule removes.

Type, iPhone (pt; system font, weights 400 regular, 600 semibold, 700 bold):

| Role | Size/line | Weight |
|---|---|---|
| Large title (bot list) | 34/41 | 700 |
| Nav title | 16/20 (chat), 17/22 (sheets) | 600 |
| Nav subtitle | 12/16 | 400 dim |
| Message body (yours and the bot's) | 17/22 (bubble), 17/24 (reply) | 400 |
| Row name | 17/22 | 600 |
| Row preview, row time | 15/20 | 400 dim |
| Grouped-list row | 17/22 name, 13/18 detail | 400/600 |
| Section header | 13/18, uppercase, +0.3 tracking | 400 dim |
| Chip, banner, footnote | 13/18 | 400 |
| Timestamp separator | 12/16 | 500 dim, the day part 600 |
| Code | 13/20 mono (inline code 14.5) | |

Nothing on iPhone may go below 12 pt. Today step lines (`ChatView.tsx:928`), the approval note (`:855`) and the bot name over replies (`:889`) are 12, and the thumbnail ✕ is 11 (`:913`).

Type, desktop (px): body 16/24, row name 15/20, row preview 13/18, header title 16/20, subtitle 12/16, menu items 14, section headers 12 uppercase.

Spacing: 4, 8, 12, 16, 20, 24. The screen margin is 16 on iPhone. The desktop chat column max is 760, centered (today it's 820 for the transcript and wider for the header).

Radii: 18 bubbles and the field, 16 cards (approval, error), 12 grouped lists, sheets, the Duo and 2x2 buttons, 10 desktop rows, 8 code headers and commands, 50% avatars and round buttons.

Tap targets: 44x44 pt minimum on iPhone and Duo for every control (visual can be smaller with hitSlop). Desktop controls are at least 32x32.

---

## Fix 1. Bot list works like Messages

Before: `before/01-bot-list--iphone.png`, `before/01-bot-list--desktop.png`; live desktop with 7 bots.
- Every row is a boxed card that says "Connected" with a green dot, so seven rows of identical noise (`components/BotList.tsx:135-137`).
- There's no last message and no time, so you can't tell who said what or who needs you.
- "+ New bot" is a 180x48 floating pill at the bottom (`:196`).
- Desktop spends a 64 px full-width title bar on "Dork Bot" alone.

Fix (comp `01-bot-list--iphone`):
- **Nav bar**: large title "Dork Bot" 34/41 bold, 16 from the left. On the right, two 44x44 icon buttons in accent: ⋯ (app menu: Notifications…, Add with a code…, Show hidden bots) and compose (square-and-pencil). Compose opens New bot directly. Once group chat ships, it opens a 2-item menu: New bot, New group chat.
- **Rows** are full-bleed, not cards, and at least 76 tall:
  - The avatar is the pixel sprite at 76% inside a 52 disc of `mix(color, 0.18)`, 16 from the left.
  - The text block starts at x 80. Line 1: name 17/22 semibold, ellipsized; time 15 dim on the right; a "›" chevron 15 #4B4F56.
  - Line 2: preview 15/20 dim, at most 2 lines.
  - The hairline separator runs from x 80 to the right edge.
  - Pressed state: row bg #22252A.
- **Preview** = the newest message in the bot's most recent chat, with markdown stripped and `[Image attached…]` shown as "Picture". If only the session preview is cheap to get, use that and fetch the real last message lazily. Never invent text: with nothing, show "No messages yet".
- **Time**: "now" (under 1 min), "9:41 AM" (today), "Yesterday", weekday for under 7 days ("Tue"), else "Oct 30".
- **States** (replace the dot and "Connected"):
  - Idle: preview.
  - Thinking, working or replying: line 2 reads "Thinking…", "Working…" or "Replying…" in #ECEDEF, and the sprite animates (as today).
  - Approval waiting: a "Needs you" badge (20 tall, radius 10, #F06A6A fill, #1A0B0B text 12 bold) on the right of line 2, and the preview reads "Wants to run a command: <command>".
  - Can't connect: line 2 turns #F06A6A with short copy. 401 shows "Key rejected. Tap to pair again."; network shows "Can't reach b-lab."; anything else shows "Can't connect. Tap for details." The sprite sleeps (as today).
  - Checking: keep the last preview. Don't flash "Checking…".
- Order: most recent activity first. A bot with Needs you sorts to the top.
- Long-press a row opens the bot sheet (fix 10), not the 9-item menu.
- Empty state: keep the copy, centered, with a 52 accent-tinted compose disc above it. Compose stays in the nav bar.

Desktop (comp `01-bot-list--desktop`):
- **Window chrome**: no app title bar. The sidebar is 320 wide, bg #0D0E10, with a right hairline.
- **Sidebar header** (56 tall): "Dork Bot" 17 bold at x 18. On the right, ⋯ and compose as 32x32 icon buttons (radius 8; hover bg #22252A).
- **Rows**: 64 tall, inset 8 left and right, radius 10.
  - Avatar disc 40. Name 15/20 semibold, time 12 dim, preview 13/18 one line.
  - The selected row has a #22252A fill (no colored border); hover is #1C1E22.
  - The row's ⋯ (24x20) shows only on hover, replacing the time.

Duo open in landscape (comp `01-bot-list--duo-landscape`):
- The sidebar keeps the existing 300 width with the desktop row layout.
- Icon buttons are 44x44 hit. The name is 16 and the preview 14 on iOS.
- The header's sidebar toggle replaces the "‹ Hide" / "› Bots" text (fix 2).

Done when:
- The rows match the comp.
- No row says "Connected".
- The time follows the rules above.
- Needs you shows within one poll of an approval arriving and clears once it's answered.
- Long-press opens the bot sheet.
- The desktop has no title bar.
- Layout tests stay clean on every posture.

## Fix 2. Chat header fits on one row

Before: `before/02-chat--iphone.png`, `before/02-chat--duo-closed.png`.
- Two rows of chrome: the nav bar, plus a 30 pt "gemma4:31b · Dork … Change" model bar under it (`ChatView.tsx:376`, `:869-879`). That's about 74 pt above the first message on a 393x852 screen.
- "Chats" is text and "⋯" is a glyph, so the two buttons look mismatched.
- On the folded Duo the header is crowded.

Fix (comp `02-chat--iphone`):
- **Nav bar** 52 tall, three zones:
  - Left: back "‹ Bots": chevron 13x22 at 2.6 stroke plus "Bots" 17, in the bot color (as `app/chat/[bot].tsx` BackToBots).
  - Center: a title block (avatar disc 32, gap 8, name 16/20 semibold over the model "gemma4:31b · Dork" 12/16 dim, both ellipsized). Pressed state: bg #22252A, radius 10. Tapping it opens the bot sheet (fix 10), where Model is the first row.
  - Right: two 44x44 icon buttons in the bot color: Chats (two bubbles, 24) and ⋯ (ellipsis in a circle, 24).
- No hairline under the nav until the transcript scrolls under it.
- **The model bar row is removed.** When the model is broken (`useChatModel().problem`), show a banner under the nav (comp `02-chat-model-problem--iphone`):
  - Bg #24171A, bottom hairline #4A2A2E. Warning icon 18 in #F06A6A, then the text 13/18 in #F0C7C9.
  - On the right, a small "Pick model" button (30 tall, radius 15, `mix(#F06A6A,0.25)` fill, #ECEDEF text) that opens the model picker.
- Desktop and Duo landscape pane header (comp `02-chat-list-hidden--desktop`):
  - 56 tall with a bottom hairline. A sidebar-toggle icon button (32x32) replaces "‹ Hide" / "› Bots".
  - Then the same title block, and on the right Chats and ⋯ (32x32, icons 19).
  - Shortcut Ctrl+\ toggles the sidebar.

Done when:
- One header row on every posture.
- The model shows under the name.
- The banner shows only on a model problem.
- Header icons have 44 pt hit areas on iOS.
- The first message starts at most 52 pt under the status bar.

Chief to confirm: changing the model moves from 1 tap (model bar) to 2 (title, then Model). I think one less row of chrome on every chat is worth it.

## Fix 3. Message box: round Send/Stop inside the field

Before: `before/03-composer--iphone.png`, `before/03-composer-live--desktop.png`.
- Three separate pills: "+" (44 circle with a colored ring), the field, and a grey "Send" pill (44 tall, 18 padding, `ChatView.tsx:955`) that looks disabled even when it isn't.
- Stop is a red pill in the same slot, so the composer jumps width.
- On the live desktop app a one-line box draws a native scrollbar with arrow buttons inside it, and the transcript uses Chromium's default grey scrollbar.

Fix (comps `03-composer--iphone`, `03-composer-states--iphone`, `03-composer--desktop`):
- **Bar**: padding 8 top, 12 sides, 8 bottom, then the safe area. No top hairline; the bar sits on bg.
- **"+"**: a 36 circle in #1A1C20, plus icon 18 at 2 stroke in #9298A0, 44 hit. No colored ring.
- **Field**:
  - Min 36, radius 18, #1A1C20, hairline border #2A2D33, padding 14 left, 3 right.
  - Text 17/22, placeholder #6B7078 "Message <name>".
  - It grows to 6 lines on iPhone, then scrolls.
- **Send**: a 30 circle inside the field at its bottom-right (3 inset), bot color fill, ↑ icon 16 at 2.6 stroke in `onColor`. Hidden when the field is empty.
- **Stop**: same spot and size, #ECEDEF fill, a 10x10 #0F1012 square with radius 2. It shows while a reply is running.
- If you type while it's running, Send comes back and queues the message (Hermes queues it behind the run). Stop stays reachable from the ⋯ menu or by clearing the text.
- Disconnected: the field is at 50% opacity and the placeholder reads "Can't reach b-lab".
- **Keyboard**: Send keeps the keyboard up and keeps the newest message in view. Interactive dismiss on drag stays. No jump when the field grows: the list's bottom inset follows the composer height.
- **Desktop**:
  - Field min 44, radius 22, text 16. The "+" circle is 44. Send and Stop are 32 circles, 6 from the field's bottom edge.
  - Hint under the box: "Enter to send · Shift+Enter for a new line", 12 #6B7078, shown only while the box has focus.
  - The textarea keeps `overflow-y: hidden` until its content reaches the 40% cap, then `auto`.
  - App-wide desktop scrollbars: 8 px, transparent track, thumb #2A2D33 radius 4 (#3A3E45 on hover), no arrow buttons.

Done when:
- The comp states match.
- No scrollbar shows in a box under the cap.
- The layout test's composer check still passes (1 line = 44 on desktop).
- Send and Stop never shift the field's width.

## Fix 4. Thinking and working states that feel alive

Before: `before/04-thinking--iphone.png`, `before/04-tools-live--iphone.png`.
- While waiting you get a dim 14 pt line, "assistant is thinking… 3s", that ticks every second from 0.
- The live tool line shows raw names ("… web_search · 2 steps", "mcp__trello__trelloSearch"), and the "+1" makes it hard to read.

Fix (comps `04-working--iphone`, `04-working-long--iphone`, `04-working--desktop`):
- **Typing row** at the reply position: avatar disc 28 (sprite in its thinking mood), gap 8, then a bubble 36 tall, radius 18, #1A1C20, holding 3 dots (7 px, #9298A0). The dots pulse in sequence over 1.2 s; with Reduce Motion they hold still.
- **Live step chip** above it:
  - 32 tall, radius 16, #1A1C20, 13 #9298A0.
  - A 12 px spinner, then the friendly name of the running step, updated in place: "Trello: search cards…" or "Searching the web…".
  - It turns into the finished chip "✓ Used Trello, Web search · 4 steps ›" when done.
  - Tap it to open the step list (as today). Hit area 44.
- **Elapsed** only after 10 s: "Still working · 48 s" 13 dim, under the typing row, indented 36. When the reply resumed from another device or after you left: "Still working · 2 min".
- **Friendly tool names** (label only; open the steps to see the raw name):

| Tool | Live | Finished |
|---|---|---|
| terminal | Running a command… | Terminal |
| web_search | Searching the web… | Web search |
| web_extract / browser_* | Reading a page… | Reading a page |
| read_file / search_files | Reading files… | Files |
| write_file / patch | Editing files… | Files |
| memory / session_search | Checking memory… | Memory |
| skill_view / skills_list | Checking a skill… | Skills |
| cronjob | Setting up a routine… | Routines |
| mcp__<server>__<tool> | "<Server>: <tool words>…" (trelloSearch → "Trello: search…") | <Server> |
| anything else | the raw name | the raw name |

- The bot list row and the header avatar animate as they do now.

Done when:
- No elapsed text shows before 10 s.
- Friendly names show for the table's tools and raw names for anything else.
- The typing bubble shows within 100 ms of Send.

## Fix 5. Approvals: inline, one tap, no mixed signals

Before: `before/05-approval--iphone.png`, `before/05-approval--desktop.png`.
- The card docks over the transcript above the composer and covers your own message.
- "assistant is still working… 2s" and a red Stop show at the same time as "needs your OK".
- Buttons are 36 tall (`ChatView.tsx:853`) and wrap unevenly, 2 then 2 at different widths.
- The note is 12 pt.

Fix (comps `05-approval--iphone`, `05-approval-answered--iphone`, `05-approval--desktop`):
- **Placement**: the card is the last item in the transcript, where the bot's next step would be, and it scrolls with the chat. Never docked.
- **Card**: #1A1C20, radius 16, padding 14, 1 px border `mix(color,0.55)`.
  - Header: avatar disc 24, "Run this command?" 15/20 semibold, "<name> needs your OK" 13/18 dim.
  - The command in a #0B0C0E block, radius 8, 13/18 mono, scrolls sideways.
  - Hermes's description: "Hermes flagged it: <description>" 13/18 dim.
- **iPhone buttons**: a 2x2 grid, gap 8, each 44 tall, radius 12, 15 semibold.
  - Row 1: Allow once (bot color fill, `onColor` text), Deny (1 px #F06A6A border, #F06A6A text).
  - Row 2: Allow in this chat, Always allow (`mix(color,0.2)` fill, #ECEDEF text).
  - Show only the choices Hermes sent.
- **Footer**: "Answers right away. No answer counts as Deny." 12 dim on the left, a mm:ss countdown on the right (from the 300 s timeout).
- One tap answers. While the answer is in flight, buttons go to 60% opacity.
- **While waiting**: the typing row and elapsed are hidden. The bot list row shows Needs you. Stop stays in the field (it cancels the run).
- **After an answer**: the card collapses to a chip, "✓ Allowed once · <command>" (✓ in the bot color), or "✕ Denied · <command>" (✕ #F06A6A). The run continues below it.
- **Desktop**: one row of 4 buttons, 36 tall, in the order Allow once, Allow in this chat, Always allow, Deny. Card max width 560.

Done when:
- The card is in the transcript.
- Buttons are 44 tall on iOS.
- No "still working" shows while waiting.
- Answering collapses the card.
- `test/live-approval.test.ts` still passes.

## Fix 6. Errors in plain words, with Try again

Before: `before/06-error--iphone.png`, `before/06-error--desktop.png`.
- A red 14 pt line above the composer: `Chat failed: HTTP 500 {"error":"model runner crashed"}`. It's raw JSON with nothing to tap.
- The bot list shows `The key for "scout" was rejected (401).`

Fix (comps `06-errors--iphone`, `06-errors--desktop`):
- **Can't reach b-lab** (network or unreachable): a banner under the nav, styled like the model banner. Text "Can't reach b-lab. Trying again in 5 s." and a "Retry now" small button. Auto-retry stays as is.
- **Turn failed** (HTTP 5xx, the stream's `error` event, `run.failed`): a card in the transcript under your message.
  - Bg #24171A, hairline #4A2A2E, radius 14, padding 12x14.
  - Title: warning icon 18 #F06A6A plus "<name> hit an error" 15 semibold.
  - Detail line: "Hermes said: <Hermes's message> (HTTP <code>)" 13/18 #C9A9AC.
  - Buttons: "Try again" (small, bot color) resends your last message to the same chat; "Details" (small, #22252A) expands the raw error, selectable, with Copy.
- **Send failed before Hermes took it**: under your bubble, a 16 #F06A6A circle with "!" and "Not sent. Tap to retry." 12 #F06A6A.
- **Copy table**:

| Cause | Where | Text |
|---|---|---|
| Network / timeout | banner | Can't reach b-lab. Trying again in N s. |
| 401 / 403 | banner | <name>'s key was rejected. [Pair again] |
| 404 on the chat | card | This chat isn't on Hermes anymore. [New chat] |
| 429 | card | Hermes is busy. [Try again] |
| 5xx / stream error | card | <name> hit an error. Hermes said: … [Try again] [Details] |
| run.failed / cancelled by Hermes | card | <name>'s reply stopped. [Try again] |

Never paraphrase Hermes's message. Quote it after "Hermes said:" and keep the raw text under Details.

Done when no raw `HTTP nnn {json}` shows outside Details, and every error has an action.

## Fix 7. Transcript rhythm: no repeated names, 17 pt body, short links

Before: `before/07-rich--iphone.png`, `before/07-chat--duo-portrait.png`, `before/02-chat--iphone.png`.
- Every reply in a 1:1 chat starts with the bot's name in 12 pt caps-ish (`ChatView.tsx:739`, `:889`).
- Body is 16 pt (`:916`).
- Raw URLs break mid-word over 3-4 lines in the bot color with underline.
- Turns are evenly spaced at 10 (`:881`), so your messages and the bot's run together.

Fix (comps `07-transcript--iphone`, `07-transcript--desktop`, and every chat comp):
- **No name label** over replies in 1:1 chats. It stays in group rooms (fix G3).
- **Body**: bot replies 17/24 and your bubbles 17/22 on iPhone; 16/24 and 16/22 on desktop.
- **Your bubble**: unchanged `mix(color,0.3)`, radius 18, padding 9x14, max width 78% on iPhone and 70% on desktop.
- **Spacing**:
  - 4 between items from the same sender.
  - 16 from your bubble to the bot's chip or reply.
  - 20 from a bot reply to your next bubble.
  - 10 between a chip and the reply.
  - 10 between paragraphs, code, tables and lists.
- **Time separators**: "Today 9:41 AM" (12/16, day 600 #B3B8BF, time 500 dim, centered, 8 above and 12 below) when more than 15 min passes between messages. Use the message timestamps Hermes returns. If a message has none, show no separator.
- **Bare URLs** show without the scheme, one line, ellipsized in the middle at most 40 characters ("github.com/Brenw2/dork-bot/blob/main/…"), in the bot color with a 1 px underline at offset 3. Tap opens the full URL; long-press copies it. Markdown links keep their own text.
- **Code blocks**:
  - #0B0C0E, hairline #2A2D33, radius 12.
  - Header 36: language 12 dim on the left, "Copy" (copy icon 15 plus 13 semibold #ECEDEF) on the right, with a 44 hit area. After a tap it shows "Copied" for 1.5 s.
  - Body 13/20 mono, padding 10x12, scrolls sideways.
- **Tables**: hairline border, radius 10, header row #1A1C20 13 semibold dim, cells 15/20, padding 8x12.
- **Pictures**: radius 14. Unchanged otherwise.

Done when nothing in a 1:1 chat repeats the bot's name and the spacing matches the comp within 2 pt.

## Fix 8. Sheets and panels share one header pattern

Before: `before/08-chats--iphone.png`, `before/08-routines--iphone.png`, `before/08-chats--desktop.png`.
- Each sheet shows a web-style ← plus a plain 20 pt title "assistant's chats".
- The main action is a full-width 46 pt bot-colored slab ("+ New chat", "+ New routine") pushed into the content.
- Rows are separate boxed cards, and the open chat has a colored border.
- On iOS a modal sheet has no Done button, only swipe down.

Fix (comps `08-sheet-chats--iphone`, `08-panel-chats--desktop`):
- **iPhone sheets** (Chats, Routines, Routine results, Connectors, Model, Look, Notifications, New bot, Add with a code):
  - iOS page sheet with a grabber (36x5 #3A3D44).
  - Header 56. The title is centered: 17/22 semibold, with the bot name as a 12/15 dim subtitle when the sheet belongs to a bot.
  - Right: "Done" (17 semibold, bot color or accent). Forms that commit use Cancel on the left and Save/Create on the right, semibold.
  - The sheet's create action is a header icon on the left: compose for New chat, "+" for New routine. 44x44, bot color.
- **Chats**:
  - Search field (36 tall, radius 10, #1A1C20, search icon 16, "Search chats" 17 #6B7078) filters by title and preview.
  - Then one grouped list (#1A1C20, radius 12, 16 margin). Rows: title 17 semibold and time 15 dim on line 1, preview 15 dim one line.
  - The open chat gets a ✓ (22, bot color), not a colored border.
  - Swipe left to Rename or Delete (Delete is red and asks to confirm). Footnote: "Swipe left on a chat to rename or delete it." 13 dim.
- **Desktop panels** (`components/Overlay.tsx`):
  - 560 wide. Header 60: avatar disc 32 when the panel belongs to a bot, title 17 semibold, subtitle 12 dim.
  - The panel's main action as a small primary button: 32 tall, radius 16, 14 semibold, with an icon. Then ✕ as a 32x32 icon button.
  - Row ⋯ shows on hover only (#1C1E22 row fill).

Done when every sheet and panel uses this header, no full-width "+ New …" slabs are left, and every iOS sheet has Done or Cancel.

## Fix 9. One button set, grouped lists, one accent rule

Before: `before/09-connectors--iphone.png`, `before/09-look--iphone.png`, `before/09-notifications--iphone.png`, `before/09-new-bot--iphone.png`, `before/08-routines--iphone.png`.
- I count 8 button heights: 50 (`connectors/[bot].tsx:319`, `look/[bot].tsx:49`), 48 (`lib/theme.ts`), 46 (`chats/[bot].tsx:125`, `routines/[bot].tsx:271`), 44 (Send, routine form), 40 (sidebar New bot), 36 (approvals), 34 (`routines/[bot].tsx:292`) and about 31 (`connectors/[bot].tsx:316`).
- I count 8 radii: 10, 16, 18, 22, 23, 24 and 25 on buttons, and 14 on rows.
- Connectors buttons are purple inside an assistant (green or pink) screen. Look's Save is purple.
- Notification switches render purple with a teal thumb on web.
- Every list is a stack of boxed cards with 8-10 gaps.

Fix (comps `09-buttons--iphone`, `09-lists-connectors--iphone`, `09-panel-connectors--desktop`):
- **Primary**: 50 tall, pill, 17 semibold, fill per the accent rule, text `onColor`. One per screen. In sheets it lives in the header as a text button instead.
- **Secondary**: 50 tall, pill, `mix(color,0.2)` fill, #ECEDEF text.
- **Small (row actions)**: 30 tall, radius 15, padding 0 12, 13 semibold, 44 hit.
  - Filled (bot color) only for the one action the row needs now, like "Sign in".
  - Tinted `mix(color,0.2)` for "Connect", "Add" and "Run now".
  - #22252A for neutral actions ("Details").
  - `mix(#F06A6A,0.2)` with #F06A6A text for "Remove". Prefer swipe or ⋯ for destructive row actions.
- **Desktop**: primary 40 tall (forms) or 32 (panel headers), small 28, radius pill.
- **Disabled**: #1A1C20 fill, #6B7078 text, no border (replaces `button.disabled`'s border).
- **Switches**: the iOS default with the on color #4CC38A (`trackColor`), white thumb, the same on web.
- **Grouped lists** (Chats, Routines, Connectors, Model, Notifications, New bot's "Already on Hermes", Look's style list):
  - Rows sit in one container (#1A1C20, radius 12, 16 margin), min 52 tall, padding 0 16.
  - Hairline separators are inset 16 (60 when rows have a leading icon or avatar).
  - Section headers 13/18 uppercase dim, 32 from the left, 18 above and 7 below.
  - Disclosure "›" 17 #5D626A.
- **Connectors**: a connected row shows its tool count and opens a detail with its tools and Remove. Remove is no longer a per-row button. "Sign in" is the filled small button.
- **Look**: "Save" moves to the sheet header. The character grid stays.
- **Notifications**: grouped list with a switch per bot (the avatar disc 32 leads each row).

Done when:
- Only these button sizes exist (iOS: 50, 30; desktop: 40, 32, 28).
- No purple shows inside a bot's screens.
- Lists are grouped as in the comp.

## Fix 10. Menus: chat ⋯ has chat actions only; a bot sheet holds the rest

Before: `before/10-chat-menu--desktop.png`, `before/10-bot-menu--desktop.png`.
- The chat ⋯ mixes 8 bot and chat actions (Rename bot, New chat, Rename this chat, Delete this chat, Routines, Routine results, Connectors, Notifications) with no grouping (`ChatView.tsx:529-544`).
- The bot row menu has 9 items (`BotList.tsx:92-106`).
- "New chat" sits in both the ⋯ and the Chats screen.
- Notifications is app-wide but only reachable from a bot's menu.

Fix (comps `10-bot-sheet--iphone`, `10-chat-menu--iphone`, `10-menus--desktop`):
- **Bot sheet**: opened by tapping the chat title, by long-pressing a bot row, or with "Bot settings" in the ⋯. Contents top to bottom:
  - Avatar disc 72, name 22/28 semibold, job (the profile description) 15/20 dim, centered.
  - 4 tiles in a row: Chats, Routines, Connectors, Look. Each is 68 tall, radius 12, #1A1C20, with a 22 icon in the bot color over a 13 medium label.
  - Group 1: Model › (the value "gemma4:31b · Dork"), Routine results ›, Notifications (switch, this bot's mute), Rename ›.
  - Group 2: Hide bot; Delete bot… in #F06A6A (keeps the typed confirm).
  - iPhone: a sheet with Done. Desktop: a 360 wide popover under the title.
- **Chat ⋯** (iPhone uses the native UIMenu look: 250 wide, 44 rows, 17 text, trailing icons, thick separators):
  - New chat, Rename this chat
  - Bot settings
  - Delete this chat (red)
- **Desktop menus**:
  - #22252A, hairline #343840, radius 12, padding 6, shadow 0 12 40 rgba(0,0,0,.5).
  - Items are 32 tall, radius 7, with a 16 icon in #9298A0 plus 14 text; hover #2E3238.
  - Separators are 0.5 #343840. Shortcuts show right-aligned 12 #6B7078 ("New chat  Ctrl+N").
  - Keep Esc to close and arrow-key navigation.
- **App ⋯** (bot list header): Notifications…, Add with a code…, Show hidden bots.
- **Dialogs** (`components/Dialogs.tsx`) are fine as they are. Keep them, with the tokens above (radius 16 panel, buttons 36 desktop pills).

Done when the chat ⋯ has 4 items in 3 groups, everything bot-level is in the bot sheet, and Notifications is reachable from the bot list.

---

## Fix 11: routine cards (card 24) — LOCKED 2026-11-13

Replaces the card 17 look (3 pt bot-colour left bar, "Routine · name · time" 12 pt dim, output always open). Brennan's ask: routines appear in the chat, collapse, look different from chat, and a notification tap lands on the entry.

Comps (in context: your bubble → routine card → your bubble → bot reply), `docs/design/comps/`:
- `24-routine-collapsed--iphone` / `--desktop`
- `24-routine-expanded--iphone` / `--desktop`
- `24-routine-highlight--iphone` / `--desktop` (the ~1 s frame, shown expanded)

Same layout on phone and desktop; only the body type size and the card's width differ. Existing tokens only. Written for the assistant bot (c = #4CC38A); every tint is `mix(c, t)` over bg #0F1012, so use the bot's own colour. Example values below are for c = #4CC38A.

**Container (LOCKED)**
- Full width of the transcript column: iPhone 361 (16 margin each side), desktop the 760 column. Never a left or right bubble, never narrower. `alignSelf: stretch`.
- Radius 16 (the card radius), overflow hidden.
- Fill `mix(c, 0.08)` = #141E1C. Border 0.5 `mix(c, 0.22)` = #1C372C (hairline).
- Your bubbles stay `mix(c, 0.30)` (right aligned, radius 18, max 78%). The card is a much fainter tint, full width, radius 16 with a hairline border, and carries the icon, so it can't be mistaken for a bubble or a bot reply. No left bar anymore.
- Vertical spacing: 16 above and 16 below, from bubbles and replies alike. The "Friday 8:00 PM" timestamp separator above it stays as in fix 7 (12/16, 500 dim).

**Header row (collapsed and expanded, LOCKED)**
- The whole row is one Pressable, min height 44, padding 10 top and bottom, 12 left, 4 right. Collapsed the header is 58 (10 + 20 name + 18 preview + 10); with the hairline border the card is 59 (measured 60 in the 1x web render). Expanded the header is 48 (the 28 icon disc + 10 + 10). Both are over the 44 minimum, and the chevron box is 44×44.
- Icon: 28 disc, fill `mix(c, 0.18)` = #1A3028 (same as the avatar disc), clock glyph 16 in c, stroke 1.8. This is the same clock as the Routines tile in the bot sheet. Gap 10 to the text.
- Name: 15/20 semibold #ECEDEF, one line, ellipsis. Time: 13/18 regular dim #9298A0, right of the name, 8 gap, never wraps ("Fri 8:00 PM", the same `whenLabel`).
- Preview (collapsed only): 13/18 regular dim #9298A0, ONE line, ellipsis, under the name. It is the output's first text with Markdown stripped (reuse `stripMarkdown` as the bot list preview does). Hidden when expanded.
- Chevron: › glyph 9×15, stroke 2.2, colour #5D626A (the same as the list chevrons), in a 44×44 hit box at the right edge. Collapsed points right (0°). Expanded rotates to 90° (points down). Rotation 200 ms ease-out.
- Tap anywhere on the header toggles. Accessibility: role button, label "Routine {name}, {when}", state expanded/collapsed, hint "Double tap to expand".
- Pressed state: fill `mix(c, 0.12)`, no other change. Desktop hover: same `mix(c, 0.12)`, cursor pointer.

**Expanded (LOCKED)**
- Header as above (preview gone), then a 0.5 divider `mix(c, 0.22)` (#1C372C) full width, then the body.
- Body: padding 12 top, 16 left and right, 14 bottom. Output through the shared `<Markdown>` with the bot's accent, exactly the reply styles: iPhone 17/24, desktop 16/24, paragraph gap 10, code blocks, tables and links as fix 7. No second font size.
- No footer, no buttons.
- Animation: height 200 ms ease-out, body opacity 0 → 1 over 150 ms, chevron 200 ms together. Collapse is the reverse (180 ms ease-in, no fade delay). Reduce Motion on: no animation, state changes instantly (chevron included).
- Collapsed is the default for every routine card on first render. State is per message and lives only in memory: scrolling away and back keeps it, leaving the chat resets it. Not persisted.
- A routine with no output text has no body and no chevron; the row is not tappable.
- Long output: no inner scroll, the card grows with the chat (the transcript scrolls).

**Opened from a notification (LOCKED)**
- Tap on a routine notification: open that bot's chat, scroll the card into view (align its top 16 below the header, or centred if the card is taller than the screen), expand it, highlight it. The notification payload must carry the chat id and the message id.
- Expands on arrival (that is what the tap asked for), with the normal 200 ms animation.
- Highlight: fill `mix(c, 0.22)` = #1C372C and border 1.5 `mix(c, 0.60)` = #347B5A. Holds 600 ms, then fades back to the resting fill and border over 400 ms ease-out (about 1 s total). Runs once. No glow, no shadow, no movement, no haptic.
- Reduce Motion on: same colours, no fade; hold 1 s, then snap back.
- If the message is not loaded yet (older than the loaded page): load until it is found, then do the above. If it can't be found, open at the bottom with no highlight and no error.
- A tap on a notification for a chat that is already open does the same (scroll, expand, highlight).

**Other places**
- Bot list and desktop sidebar preview keep "Routine · name" (already shipped, `lib/routineNotes.ts`).
- Group rooms (later): same card, with the bot's name 14 semibold in the bot colour above it per fix G3.

**Done when** collapsed routine cards are about 59 tall, full width, tinted, with the clock disc, name, time, one-line preview and › on iPhone and desktop; tapping the header toggles with the 200 ms rotation and height animation; the header row is at least 44; a notification tap lands on the card, expands it and runs the 1 s highlight; and nothing else in the transcript changed.

---

## Group chat (card 8)

These comps follow Hermes Bot Mode rooms (`hermes-agent/website/docs/user-guide/bot-mode.md` → Groups and group chats): 2-6 members, @-mentions scope a round and everyone answers when nobody is mentioned, bots may pass, `@user` raises Needs you, Stop holds members, and approvals answer on one click. Same tokens as above. The accent rule: rooms use accent #8B7CF6 for chrome, and each reply uses its bot's color for the name and mentions.

G1. Room row in the bot list (comps `g1-list--iphone`, `g1-room--desktop`):
- **Avatar**: the room picture if set, else a member stack in the 52 box.
  - 3+ members: three discs of 0.56x (29), at (11,0), (0,23) and (23,23).
  - 2 members: two discs of 0.64x (33), at (0,0) and (19,19).
  - Each disc is `mix(color,0.22)` with a 2 px bg ring.
  - Desktop uses the same layout in a 40 box.
- **Line 1**: room name 17 semibold, then " · 4" (member count, 400 dim), the time, and "›".
- **Line 2**: "<speaker>: <text>", with the speaker in #ECEDEF and the text dim, 2 lines.
- **States**: Needs you badge (an `@user` mention or a pending approval or question in the room). "<bot> is working…" in #ECEDEF while any member has a turn. "You stopped the room." while held.
- Rooms and bots share one recency-ordered list. A room with Needs you sorts to the top. Pin to top is a later card.
- **Compose**: a menu with New bot and New group chat.

G2. New group chat (comps `g2-new-room--iphone`, `g2-new-room--desktop`):
- **iPhone sheet**: Cancel | "New group chat" | Create (semibold, accent). Create stays disabled (#6B7078) until there's a name and at least 2 members.
- **Picture**: an 84 disc showing the member stack, with a 28 camera badge at the bottom right, then "Add picture (optional)" 13 accent below. It picks from library or camera, like Look.
- **Name field**: 44 tall, radius 12, #1A1C20, 17. Renaming to a taken name is rejected inline: "That name's taken", 13 #F06A6A.
- **Members**:
  - Section header "MEMBERS · 4 OF 6", then a grouped list: avatar disc 32, name 17 semibold, job 13 dim.
  - A 24 check circle on the right: filled accent with a white ✓, or a 1.5 #4B4F56 ring.
  - At 6 selected, unselected rows go to 40% and don't toggle.
- **Footnote**: "2 to 6 bots. Each one replies when it has something to add; @mention a bot to ask just that one."
- **Desktop panel**: 560x640. The picture (64 stack) sits beside the Name field. The footer has Cancel (#22252A) and "Create group chat" (accent), both 32 tall.

G3. The room (comps `g3-room--iphone`, `g1-room--desktop`):
- **Header**:
  - Back "‹ Bots" in accent, then the title block: a 32 stack, "Ops room" 16 semibold, members "chief, design, mobile, schedules" 12 dim.
  - Right: Members (people icon) and ⋯ on iPhone. Members, then Group settings (gear) on desktop.
  - Group settings: rename, picture, members, Detect stop directives switch, Compress history per member, Leave or Disband.
- **Messages**:
  - Each bot reply has a 28 avatar disc in a 28 gutter (gap 8), then a name line: name 14/18 semibold in the bot color, plus the time 12 dim. Then the body, 17/24 iPhone or 16/24 desktop.
  - Consecutive replies from the same bot within 2 min drop the avatar and name and sit 4 apart. Otherwise 14 apart.
  - Your messages are right-aligned bubbles in `mix(#8B7CF6,0.3)` (rooms have no single bot color).
- **Mentions**: `@bot` renders in that bot's color, semibold. `@all` and `@everyone` render in accent. No pills. Unknown @words and emails stay plain.
- **Passes**: a bot that passes (`[SILENT]`) shows nothing.
- **Working strip**: 36 tall, top hairline, above the composer, while any member has a turn.
  - Each working member gets a 20 disc (thinking sprite) plus the name in #ECEDEF and the state in 13 dim ("is thinking", "is working", "is waiting for your OK"), separated by "·".
  - Elapsed shows on the right after 10 s. Tap opens Activity, the turn list with tools and failures (Hermes's collapsed Activity summary).
- **Failures**: "<bot> hit an error: <first line>" as a 13 dim system line, with the card from fix 6 under Activity.
- **Composer**: placeholder "Message <room>". Send uses accent. Stop shows while any member works.

G4. @-mention autocomplete (comps `g4-mention--iphone`, `g4-mention--desktop`):
- Typing "@" at the start of a word opens a popover above the composer.
  - iPhone: full width minus 12 margins. Desktop: 360 wide, aligned to the field.
  - Style: #22252A, radius 14, hairline #343840.
- **Rows**: 44 tall on iPhone (40 desktop). Avatar disc 28 (26), display name 15 semibold, "@handle" 13 dim, and the job right-aligned 12 #6B7078 (ellipsized).
- A separator, then "Everyone @all" with a people icon on an accent-tinted disc.
- It filters by display name or handle as you type. The first match is highlighted (#2E3238).
- Return or tap inserts "@handle " (with a trailing space). On desktop, ↑ and ↓ move, Enter or Tab inserts, Esc closes.
- With no match, the popover closes and the text stays plain.
- Inserted mentions show in the field as colored text.

G5. Needs you and approvals in a room (comps `g5-needs-you--iphone`, `g5-needs-you--desktop`):
- **A message that mentions you** (`@user`): a 3 px #F06A6A bar at the left edge of the message (10 left of the gutter), a "Needs you" badge (18 tall, 11 bold) after the time, and "@you" in accent semibold.
- The room row keeps its Needs you badge until you reply in the room or open the message. Prompts and approvals clear only when answered.
- **Approval**: the same card as fix 5, indented to the 36 gutter, with the subtitle "<bot> needs your OK in <room>". One tap answers (once, session, always or deny), matching Hermes. The strip says "<bot> is waiting for your OK".

G6. Stop and held (comps `g6-held--iphone`, `g6-held--desktop`):
- Stop in the room cancels the active run and holds the members, as Hermes does.
- A system line, 13/18 dim and centered: "You stopped the room. design and mobile are held."
- The strip shows "Held" chips: 22 tall, radius 11, #1A1C20, an 18 sleeping-sprite disc plus "Held" 12 medium dim. "Resume all" (13 semibold accent) on the right sends "@all resume".
- Composer placeholder: "@mention a bot, or @all to resume". Mentioning a held bot releases just that bot.

Chief to confirm (group chat): in a room, your bubble uses the app accent tint, not a bot color.

---

## HIG check (current app)

- **Text under 12 pt** on iPhone: step lines 12 (`ChatView.tsx:928`), approval note 12 (`:855`), reply name label 12 (`:889`), thumbnail ✕ 11 (`:913`). Fixes 4, 5 and 7 remove or resize them.
- **Body** is 16. The iOS default and Messages use 17. Fix 7 sets 17.
- **Tap targets under 44 pt**:
  - Approval buttons are 36.
  - Connectors small buttons are about 31 (`connectors/[bot].tsx:316`).
  - The routine small buttons are 34.
  - The activity chip is about 28 + 6 hitSlop.
  - The thumbnail ✕ is 22 + 6 hitSlop.
  - The code Copy is about 20 tall.
  - Fixes 3, 5, 7 and 9 bring all of these to a 44 hit area.
- **Dynamic Type**: chat text and rows must scale with the user's text size. Cap chrome (nav titles, chips, badges) at `maxFontSizeMultiplier` 1.4 so headers don't break. Needs a device check at xxxL.
- **Reduce Motion**: the typing dots and sprite animations hold still (sprites already do).
- **Contrast** (measured): dim #9298A0 is 6.55:1 on bg and 5.87:1 on card. Faint #6B7078 is 3.82:1 and 3.42:1, so use it only for placeholders, disabled text and hints, never for content. #F06A6A is 6.32:1 on bg.

## Chief to confirm (my calls; building can start on them)

1. Model change goes from 1 tap to 2 (fix 2).
2. Avatars get a tinted disc behind the pixel sprite everywhere (fix 1). The sprite itself is unchanged.
3. Bot list previews need each bot's last message. That's one extra request per bot on list load, cached (fix 1).
4. "Needs you" also shows on 1:1 bot rows when an approval is waiting, not only on rooms (fix 1).
5. The bot sheet replaces the long-press menu and takes over the per-bot Notifications switch. The Notifications screen keeps the phone switch and moves to the app ⋯ (fix 10).
6. In rooms, your bubble uses the app accent tint (G3).

## Device-only checks (after card 19 lands)

These need Brennan's iPhone or the Duo, not the web build:
- The iOS 26 header items look (no glass capsule) with the new icon buttons.
- Swipe actions on Chats.
- The UIMenu look.
- Keyboard follow on Send.
- Dynamic Type xxxL.
- VoiceOver labels on the new icon buttons ("Chats", "More", "Bot settings", "Send", "Stop").
- The fold on the Duo in portrait.

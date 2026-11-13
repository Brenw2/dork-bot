# dork-bot-push

A Hermes plugin that sends the Dork Bot app a push notification when a bot:

| When | Hook | Push |
|---|---|---|
| finishes a reply in one of the app's chats (`dork-bot-<bot>`, `dork-bot-<bot>--<id>`) | `post_llm_call` | **chief**: first ~100 characters of the reply |
| needs Allow / Deny on a command in one of those chats | `pre_approval_request` | **chief**: needs approval |
| finishes a run of a routine marked **Notify me** | `post_llm_call` (+ `ctx.current_cron_execution()`) | **chief · Morning news**: first ~100 characters; the output is also added to the bot's most recent chat |

A routine that isn't marked sends nothing and adds nothing (its runs still show in Routine results). The mark is the routine's id in `dork_bot.push.routines`, which the app's Notify me switch writes; every routine starts off.

The title is the bot's display name (`dork_bot.name`, set with Rename…), else its profile id. Every push is sent with `mutableContent`, so the app's Notification Service Extension can swap the Dork Bot icon for the sending bot's avatar (docs/NOTIFICATION-AVATARS.md); the push's `data` carries `bot` (profile id) and `name`. Without the extension or the bot's avatar file, iOS shows it as is.

Tapping a reply or approval opens that chat. Tapping a Notify me routine opens the chat the output was added to, scrolled to it (`data.chat`, `data.at`); with no chat to put it in, the bot's Routine results. Nothing goes out for
an empty or `[SILENT]` reply, Hermes's own smart approvals (`surface: smart`), chats the app didn't
make (CLI, desktop Hermes, tests), or a muted bot (the mute also stops the chat message). An approval push never carries the command, and a
chat sends at most one approval push per 30 s.

## A bot needs you in a group room

Hermes's gateway-hosted rooms run each member's turn in a hidden session titled `Group: <room_id>` (id `room_<hash>`). The gateway doesn't flag `@user`, so `room_push.py` watches the member's finished reply (`post_llm_call`): if it contains `@user` as a word (not in an email or a longer word), it sends one push, title `<bot name> in <room name>`, body the start of the reply, `data: {bot, name, kind: "room", room, roomName}`. A tap opens the room. A normal room reply or a pass (`[SILENT]`) sends nothing. The bot's mute switch and display name apply. The room's name is read from the install's `shared-state.db` (read-only); with no name the title says "in a room". Room sessions are kept out of the "finished" work push.

## The routine's output in the chat

Hermes has no API route for "add a message to a session without a turn", so the plugin uses what Hermes's own cron delivery uses: `gateway.mirror.mirror_to_session(..., role="user", session_id=<chat>)`, which appends to the session transcript with no agent turn. It is user-role because the text isn't the agent speaking (an assistant-role mirror replays as a real turn and breaks strict-alternation providers). The text starts with a marker line the app recognises and draws as a routine card from the bot:

```
[Routine · Morning news · 2026-11-12T15:04:05-05:00]
<the routine's output>
```

The target is the exact session id of the bot's most recent app chat (a `dork-bot-<bot>…` session with messages, newest `last_active`), so Hermes never scans for it. The write happens at a turn boundary: the plugin takes Hermes's turn lease on that chat first (`try_acquire_session_turn_lease`); if a turn is running it isn't granted, the plugin retries with a growing wait (2 s, 4 s … up to 30 s) and gives up after about 10 minutes, logging it. The push doesn't wait for this. Nothing here touches `state.db` directly.

## Settings

The app keeps them in the bot's profile config, through hermes serve (`PUT /api/config`); the plugin
only reads them:

```yaml
dork_bot:
  name: "Big Chief"                   # optional display name; read-only here, the app writes it
  push:
    tokens: ["ExponentPushToken[…]"]   # each phone that turned notifications on
    muted: false                        # the bot's switch in Notifications (mutes replies, approvals and routines)
    routines: ["<job id>", …]           # routines marked Notify me (the switch on each routine)
```

Pushes go to Expo (`https://exp.host/--/api/v2/push/send`), which hands them to Apple. No key is
needed on b-lab; the Apple push key lives on EAS (docs/NOW.md).

`endpoint: http://127.0.0.1:<port>/…` in the same block sends to a fake Expo server on b-lab
instead (tests only; anything that isn't localhost is ignored).

## Install

```bash
scripts/install-push-plugin.sh chief assistant   # or --all; --remove to take it out
```

It copies `plugin.yaml`, `__init__.py` and `push.py` into `~/.hermes/profiles/<bot>/plugins/dork-bot-push/`
and runs `hermes -p <bot> plugins enable dork-bot-push`. Hermes loads plugins per profile, and
`plugins enable` tells the running gateway to rescan, so hooks work from the next turn with no
restart. Check with `hermes -p <bot> plugins list --plain`.

## Tests

```bash
python3 -m unittest discover -s hermes-plugin/dork-bot-push/tests -v
```

Plain stdlib; a fake Expo server on 127.0.0.1 stands in for exp.host.

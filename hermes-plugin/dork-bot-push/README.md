# dork-bot-push

A Hermes plugin that sends the Dork Bot app a push notification when a bot:

| When | Hook | Push |
|---|---|---|
| finishes a reply in one of the app's chats (`dork-bot-<bot>`, `dork-bot-<bot>--<id>`) | `post_llm_call` | **chief**: first ~100 characters of the reply |
| needs Allow / Deny on a command in one of those chats | `pre_approval_request` | **chief**: needs approval |
| finishes a routine (cron job) run | `post_llm_call` (+ `ctx.current_cron_execution()`) | **chief · Morning news**: first ~100 characters |

Tapping it opens that chat (approvals and replies) or the bot's Routines screen. Nothing goes out for
an empty or `[SILENT]` reply, Hermes's own smart approvals (`surface: smart`), chats the app didn't
make (CLI, desktop Hermes, tests), or a muted bot. An approval push never carries the command, and a
chat sends at most one approval push per 30 s.

## Settings

The app keeps them in the bot's profile config, through hermes serve (`PUT /api/config`); the plugin
only reads them:

```yaml
dork_bot:
  push:
    tokens: ["ExponentPushToken[…]"]   # each phone that turned notifications on
    muted: false                        # the bot's mute switch
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

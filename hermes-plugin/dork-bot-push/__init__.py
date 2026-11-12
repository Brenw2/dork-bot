"""dork-bot-push: Hermes plugin that pushes Dork Bot notifications to the phone.

Hooks (hermes_cli.plugins.VALID_HOOKS, docs: website/docs/user-guide/features/hooks.md):
- post_llm_call: a turn finished with a final answer. App chats → "<bot>: <start of reply>";
  a routine (cron job) run → only if the routine is marked "Notify me" (dork_bot.push.routines):
  "<bot> · <routine>: <start of result>", and the result is added to the bot's most recent chat
  (gateway.mirror.mirror_to_session, user-role, no bot turn, at a turn boundary).
- pre_approval_request: a command is waiting for Allow / Deny in an app chat → "<bot>: needs approval".

The logic is in push.py; this file only binds it to Hermes.
"""

from __future__ import annotations

import os
import uuid

from typing import Any, Optional

from .push import Notifier, in_background, mirror_if_no_turn, pick_chat, pinned


def _load_config() -> Any:
    # Read-only: the profile's merged config. The app writes the dork_bot block through hermes serve.
    from hermes_cli.config import load_config_readonly

    return load_config_readonly() or {}


def _session_id() -> str:
    try:
        from gateway.session_context import get_session_env

        return get_session_env("HERMES_SESSION_ID") or ""
    except Exception:
        return ""


def _session_rows() -> Any:
    # The bot's session list, read the way the API server's GET /api/sessions?source=api_server does.
    from hermes_state_registry import acquire, release_or_close

    db = acquire()
    try:
        return db.list_sessions_rich(source="api_server", limit=200, min_message_count=1)
    finally:
        release_or_close(db)


def _mirror_into_chat(chat: str, text: str) -> bool:
    # Hermes's own no-turn append (gateway/mirror.py, what cron delivery uses), under the chat's turn lease.
    from gateway.mirror import mirror_to_session
    from hermes_state_registry import acquire, release_or_close

    db = acquire()
    try:
        return mirror_if_no_turn(db, mirror_to_session, chat, text, holder=f"dork-bot-push:pid={os.getpid()}:{uuid.uuid4().hex[:8]}")
    finally:
        release_or_close(db)


def _run_in_this_profile(fn: Any) -> None:
    # Called on the hook's thread: remember its profile home, re-enter it on the background thread.
    from hermes_constants import get_hermes_home, reset_hermes_home_override, set_hermes_home_override

    home = str(get_hermes_home())
    in_background(pinned(fn, lambda: set_hermes_home_override(home), reset_hermes_home_override))


def register(ctx: Any) -> None:
    def cron_job() -> Optional[tuple[str, str]]:
        run = ctx.current_cron_execution()
        return (run.job_id, run.job_name) if run is not None else None

    notifier = Notifier(
        profile_name=lambda: ctx.profile_name,
        load_config=_load_config,
        cron_job=cron_job,
        session_id=_session_id,
        run=_run_in_this_profile,
        chat_target=lambda bot: pick_chat(bot, _session_rows()),
        mirror=_mirror_into_chat,
    )
    ctx.register_hook("post_llm_call", notifier.on_reply)
    ctx.register_hook("pre_approval_request", notifier.on_approval)

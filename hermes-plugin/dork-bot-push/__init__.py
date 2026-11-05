"""dork-bot-push: Hermes plugin that pushes Dork Bot notifications to the phone.

Hooks (hermes_cli.plugins.VALID_HOOKS, docs: website/docs/user-guide/features/hooks.md):
- post_llm_call: a turn finished with a final answer. App chats → "<bot>: <start of reply>";
  a routine (cron job) run → "<bot> · <routine>: <start of result>".
- pre_approval_request: a command is waiting for Allow / Deny in an app chat → "<bot>: needs approval".

The logic is in push.py; this file only binds it to Hermes.
"""

from __future__ import annotations

from typing import Any, Optional

from .push import Notifier


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


def register(ctx: Any) -> None:
    def cron_job() -> Optional[tuple[str, str]]:
        run = ctx.current_cron_execution()
        return (run.job_id, run.job_name) if run is not None else None

    notifier = Notifier(
        profile_name=lambda: ctx.profile_name,
        load_config=_load_config,
        cron_job=cron_job,
        session_id=_session_id,
    )
    ctx.register_hook("post_llm_call", notifier.on_reply)
    ctx.register_hook("pre_approval_request", notifier.on_approval)

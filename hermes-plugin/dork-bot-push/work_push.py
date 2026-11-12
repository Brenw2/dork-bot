"""Push for outside work that finished: "<bot> finished: <title>" plus the outcome, opens that session.

"Outside work" is any Hermes session in this bot's profile that is neither one of the app's chats
(dork-bot-<bot>…) nor a routine run (cron; routines have their own push). It is finished when Hermes
finalizes the session (`on_session_finalize`: the end of `hermes chat -q`, a terminal chat quitting).
One push per session, never one per tool call or per turn.

The hooks carry no title or reply text at finalize time, so the task (`pre_llm_call`) and the latest
reply (`post_llm_call`) are remembered per session until it ends. The title is the start of the task;
the app's Work list shows Hermes's own title once it has one (same session, same id in the push).

Kept apart from push.py (Notifier) so the two merge cleanly. Plain Python, no Hermes imports.
"""

from __future__ import annotations

import logging
from collections import OrderedDict
from typing import Any, Callable, Optional

try:  # loaded as part of the plugin package by Hermes
    from .push import (
        EXPO_PUSH_URL,
        Notice,
        PostJson,
        expo_messages,
        is_bot_chat,
        post_json,
        preview,
        send,
        settings_from_config,
    )
except ImportError:  # loaded as a top-level module by the tests
    from push import (  # type: ignore[no-redef]
        EXPO_PUSH_URL,
        Notice,
        PostJson,
        expo_messages,
        is_bot_chat,
        post_json,
        preview,
        send,
        settings_from_config,
    )

logger = logging.getLogger(__name__)

TITLE_CHARS = 70  # lib/work.ts
REMEMBER = 200  # sessions kept in memory at once
NO_REPLY = "Ended without a reply."


def _text(message: Any) -> str:
    """A user message as text: plain, or the text parts of a multimodal list."""
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        return " ".join(p.get("text", "") for p in message if isinstance(p, dict) and isinstance(p.get("text"), str))
    return ""


def work_title(task: str) -> str:
    """The start of the task on one line, cut to fit (the app's workTitle)."""
    t = preview(task, TITLE_CHARS)
    return t or "Untitled work"


def is_outside_work(bot: str, session_id: str, platform: str = "", on_cron: bool = False) -> bool:
    if not session_id or is_bot_chat(bot, session_id):
        return False
    return not (on_cron or platform == "cron" or session_id.startswith("cron_"))


def work_notice(bot: str, session_id: str, task: str, reply: str, name: Optional[str] = None) -> Notice:
    shown = name or bot
    body = preview(reply) if reply.strip() and reply.strip() != "[SILENT]" else NO_REPLY
    return Notice(
        title=f"{shown} finished: {work_title(task)}",
        body=body,
        data={"bot": bot, "name": shown, "kind": "work", "session": session_id},
    )


class WorkNotifier:
    """Hook callbacks for finished outside work. Everything Hermes-specific is passed in."""

    def __init__(
        self,
        profile_name: Callable[[], str],
        load_config: Callable[[], Any],
        cron_job: Callable[[], Optional[tuple[str, str]]] = lambda: None,
        post: PostJson = post_json,
        # Inline, not a thread: `hermes chat -q` exits right after finalize and would kill a daemon thread.
        run: Callable[[Callable[[], Any]], None] = lambda fn: fn(),
        url: str = EXPO_PUSH_URL,
    ):
        self._profile = profile_name
        self._config = load_config
        self._cron_job = cron_job
        self._post = post
        self._run = run
        self._url = url
        self._seen: "OrderedDict[str, dict[str, str]]" = OrderedDict()
        self._sent: "OrderedDict[str, None]" = OrderedDict()

    def _entry(self, session_id: str) -> dict[str, str]:
        entry = self._seen.get(session_id)
        if entry is None:
            entry = self._seen[session_id] = {"task": "", "reply": ""}
            while len(self._seen) > REMEMBER:
                self._seen.popitem(last=False)
        return entry

    def _outside(self, session_id: str, platform: str) -> Optional[str]:
        bot = self._profile()
        return bot if is_outside_work(bot, session_id, platform, self._cron_job() is not None) else None

    def on_task(self, session_id: str = "", user_message: Any = "", platform: str = "", **_: Any) -> None:
        """pre_llm_call: a turn starts. The first one is the task."""
        try:
            if self._outside(session_id or "", platform):
                entry = self._entry(session_id)
                if not entry["task"]:
                    entry["task"] = _text(user_message)
        except Exception:
            logger.warning("dork-bot-push: work task hook failed", exc_info=True)

    def on_reply(self, session_id: str = "", assistant_response: str = "", platform: str = "", **_: Any) -> None:
        """post_llm_call: the bot answered. The latest answer is the outcome."""
        try:
            if self._outside(session_id or "", platform):
                self._entry(session_id)["reply"] = assistant_response or ""
        except Exception:
            logger.warning("dork-bot-push: work reply hook failed", exc_info=True)

    def on_finalize(self, session_id: str = "", platform: str = "", **_: Any) -> None:
        """on_session_finalize: Hermes ended the session. Sends the one push for it."""
        try:
            if not session_id or session_id in self._sent:
                return
            bot = self._outside(session_id, platform)
            entry = self._seen.pop(session_id, None)
            if bot is None or entry is None:
                return  # not outside work, or nothing happened in it that this process saw
            self._sent[session_id] = None
            while len(self._sent) > REMEMBER * 5:
                self._sent.popitem(last=False)
            settings = settings_from_config(self._config())
            if settings.muted or not settings.tokens:
                return
            notice = work_notice(bot, session_id, entry["task"], entry["reply"], settings.name)
            messages = expo_messages(settings.tokens, notice)
            url = settings.endpoint or self._url
            self._run(lambda: send(messages, self._post, url))
        except Exception:
            logger.warning("dork-bot-push: work finalize hook failed", exc_info=True)

"""Dork Bot push notifications: what to send, to whom, and the Expo push call.

Plain Python with no Hermes imports, so it's unit-tested on its own (tests/). The hook wiring is in
__init__.py. Settings come from the profile's `dork_bot:` config block, which the app writes
through hermes serve:

    dork_bot:
      push:
        tokens: ["ExponentPushToken[...]"]   # one per phone that turned notifications on
        muted: false                         # this bot's mute switch, on every phone
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
PREVIEW_CHARS = 100
EXPO_BATCH = 100  # Expo takes at most 100 messages per request
APPROVAL_GAP_S = 30.0  # one "needs approval" push per chat in this window

_TOKEN = re.compile(r"^(Exponent|Expo)PushToken\[[^\]\s]+\]$")
_IMAGE_MARK = re.compile(r"\[Image attached at:[^\]]*\]|\[screenshot\]")


@dataclass
class PushSettings:
    tokens: list[str] = field(default_factory=list)
    muted: bool = False
    #: The bot's display name (Rename…, lib/names.ts); None means the profile id is shown.
    name: Optional[str] = None
    #: Tests only: a fake Expo server on this machine (`endpoint: http://127.0.0.1:<port>/`).
    endpoint: Optional[str] = None


_LOOPBACK = re.compile(r"^http://(127\.0\.0\.1|localhost)(:\d+)?(/|$)")
MAX_NAME_LENGTH = 30  # lib/names.ts


def clean_name(raw: Any) -> Optional[str]:
    """Same rule as the app's cleanDisplayName: inner whitespace collapsed, 1 to 30 characters."""
    if not isinstance(raw, str):
        return None
    name = re.sub(r"\s+", " ", raw).strip()
    return name if name and len(name) <= MAX_NAME_LENGTH else None


@dataclass
class Notice:
    """One notification, before it's addressed to each phone."""

    title: str
    body: str
    data: dict[str, str]


def settings_from_config(config: Any) -> PushSettings:
    """The `dork_bot.push` block, keeping only well-formed values (anyone can edit the YAML)."""
    block = config.get("dork_bot") if isinstance(config, dict) else None
    push = block.get("push") if isinstance(block, dict) else None
    name = clean_name(block.get("name")) if isinstance(block, dict) else None
    if not isinstance(push, dict):
        return PushSettings(name=name)
    raw = push.get("tokens")
    tokens = [t for t in raw if isinstance(t, str) and _TOKEN.match(t)] if isinstance(raw, list) else []
    endpoint = push.get("endpoint")
    # Only a server on this machine: a pushed preview never goes anywhere but Expo or a local test.
    endpoint = endpoint if isinstance(endpoint, str) and _LOOPBACK.match(endpoint) else None
    return PushSettings(tokens=list(dict.fromkeys(tokens)), muted=push.get("muted") is True, name=name, endpoint=endpoint)


def is_bot_chat(bot: str, session_id: str) -> bool:
    """A chat made by the app (lib/chats.ts isBotChat): `dork-bot-<bot>` or `dork-bot-<bot>--<id>`."""
    first = f"dork-bot-{bot}"
    return session_id == first or session_id.startswith(f"{first}--")


def preview(text: str, limit: int = PREVIEW_CHARS) -> str:
    """The start of a reply, on one line: no picture markers, code fences or markdown marks."""
    t = _IMAGE_MARK.sub("", text or "")
    t = re.sub(r"```[^\n]*", "", t)
    t = re.sub(r"[*_`#>]+", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) <= limit:
        return t
    return t[: limit - 1].rstrip() + "…"


def _silent(text: str) -> bool:
    return not text.strip() or text.strip() == "[SILENT]"


def reply_notice(bot: str, session_id: str, text: str, name: Optional[str] = None) -> Optional[Notice]:
    """A finished reply in one of the app's chats. None for an empty or silent reply."""
    if _silent(text) or not is_bot_chat(bot, session_id):
        return None
    shown = name or bot
    return Notice(title=shown, body=preview(text), data={"bot": bot, "name": shown, "kind": "reply", "chat": session_id})


def routine_notice(bot: str, job_id: str, job_name: str, text: str, name: Optional[str] = None) -> Optional[Notice]:
    """A routine (cron job) run that ended with something to say."""
    if _silent(text):
        return None
    shown = name or bot
    title = f"{shown} · {job_name}" if job_name else shown
    return Notice(title=title, body=preview(text), data={"bot": bot, "name": shown, "kind": "routine", "job": job_id})


def approval_notice(bot: str, session_id: str, name: Optional[str] = None) -> Notice:
    """A command waiting for Allow / Deny. The command itself never goes into the push."""
    shown = name or bot
    return Notice(title=shown, body="needs approval", data={"bot": bot, "name": shown, "kind": "approval", "chat": session_id})


def expo_messages(tokens: list[str], notice: Notice) -> list[dict[str, Any]]:
    # mutableContent: lets the app's Notification Service Extension run, which swaps the Dork Bot icon
    # for the sending bot's avatar. Without the extension (or its avatar file) iOS shows the push as is.
    return [
        {
            "to": t,
            "title": notice.title,
            "body": notice.body,
            "data": notice.data,
            "sound": "default",
            "priority": "high",
            "mutableContent": True,
        }
        for t in tokens
    ]


PostJson = Callable[[str, list[dict[str, Any]]], Any]


def post_json(url: str, messages: list[dict[str, Any]]) -> Any:
    req = urllib.request.Request(
        url,
        data=json.dumps(messages).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read() or b"null")


def send(messages: list[dict[str, Any]], post: PostJson = post_json, url: str = EXPO_PUSH_URL) -> int:
    """Sends in batches of 100. Returns how many Expo accepted. Never raises."""
    ok = 0
    for i in range(0, len(messages), EXPO_BATCH):
        batch = messages[i : i + EXPO_BATCH]
        try:
            res = post(url, batch)
        except Exception as exc:  # network, HTTP error: a missed push must never break a turn
            logger.warning("dork-bot-push: Expo push failed: %s", exc)
            continue
        tickets = res.get("data") if isinstance(res, dict) else None
        for ticket in tickets if isinstance(tickets, list) else []:
            if isinstance(ticket, dict) and ticket.get("status") == "ok":
                ok += 1
            elif isinstance(ticket, dict):
                # e.g. DeviceNotRegistered: the phone turned notifications off or the app is gone.
                details = ticket.get("details") if isinstance(ticket.get("details"), dict) else {}
                logger.info("dork-bot-push: Expo refused a message: %s", details.get("error") or ticket.get("message"))
    return ok


def in_background(fn: Callable[[], Any]) -> None:
    threading.Thread(target=fn, name="dork-bot-push", daemon=True).start()


class Notifier:
    """The hook callbacks. Everything Hermes-specific is passed in, so tests drive it directly.

    profile_name / load_config / cron_job run on the hook's thread (they read the profile the turn
    runs in); only the HTTP call goes to a background thread, so a slow Expo never holds a turn up.
    """

    def __init__(
        self,
        profile_name: Callable[[], str],
        load_config: Callable[[], Any],
        cron_job: Callable[[], Optional[tuple[str, str]]] = lambda: None,
        session_id: Callable[[], str] = lambda: "",
        post: PostJson = post_json,
        run: Callable[[Callable[[], Any]], None] = in_background,
        url: str = EXPO_PUSH_URL,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._profile = profile_name
        self._config = load_config
        self._cron_job = cron_job
        self._session_id = session_id
        self._post = post
        self._run = run
        self._url = url
        self._clock = clock
        self._last_approval: dict[str, float] = {}
        self._lock = threading.Lock()

    def _deliver(self, make: Callable[[Optional[str]], Optional[Notice]]) -> None:
        """`make` builds the notice from the bot's display name (None: not renamed)."""
        settings = settings_from_config(self._config())
        if settings.muted or not settings.tokens:
            return
        notice = make(settings.name)
        if notice is None:
            return
        messages = expo_messages(settings.tokens, notice)
        url = settings.endpoint or self._url
        self._run(lambda: send(messages, self._post, url))

    def on_reply(self, session_id: str = "", assistant_response: str = "", platform: str = "", **_: Any) -> None:
        """post_llm_call: a turn finished with a final answer."""
        try:
            bot = self._profile()
            job = self._cron_job()
            text = assistant_response or ""
            if job is not None or platform == "cron":
                job_id, job_name = job or ("", "")
                self._deliver(lambda name: routine_notice(bot, job_id, job_name, text, name))
            else:
                self._deliver(lambda name: reply_notice(bot, session_id or "", text, name))
        except Exception:
            logger.warning("dork-bot-push: reply hook failed", exc_info=True)

    def on_approval(self, surface: str = "", session_key: str = "", session_id: str = "", coalesced: bool = False, **_: Any) -> None:
        """pre_approval_request: a command is about to wait for a person."""
        try:
            if surface == "smart" or coalesced:
                return  # Hermes's own check decides without anyone, or a duplicate of a prompt already sent
            bot = self._profile()
            chat = next((s for s in (session_id, session_key, self._session_id()) if s and is_bot_chat(bot, s)), None)
            if chat is None:
                return  # not one of the app's chats (CLI, desktop Hermes, …): nothing on the phone can answer it
            now = self._clock()
            with self._lock:
                if now - self._last_approval.get(chat, -APPROVAL_GAP_S) < APPROVAL_GAP_S:
                    return
                self._last_approval[chat] = now
            self._deliver(lambda name: approval_notice(bot, chat, name))
        except Exception:
            logger.warning("dork-bot-push: approval hook failed", exc_info=True)

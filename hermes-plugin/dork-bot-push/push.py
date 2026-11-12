"""Dork Bot push notifications: what to send, to whom, and the Expo push call.

Plain Python with no Hermes imports, so it's unit-tested on its own (tests/). The hook wiring is in
__init__.py. Settings come from the profile's `dork_bot:` config block, which the app writes
through hermes serve:

    dork_bot:
      push:
        tokens: ["ExponentPushToken[...]"]   # one per phone that turned notifications on
        muted: false                         # this bot's mute switch, on every phone
        routines: ["<job id>", ...]          # routines marked "Notify me" (the app's switch)

Only a marked routine pushes and adds its result to the bot's chat; the per-bot mute overrides both.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
PREVIEW_CHARS = 100
EXPO_BATCH = 100  # Expo takes at most 100 messages per request
APPROVAL_GAP_S = 30.0  # one "needs approval" push per chat in this window
MIRROR_GIVE_UP_S = 600.0  # a routine's chat message waits at most this long for the chat's turn to end
MIRROR_FIRST_WAIT_S = 2.0
MIRROR_MAX_WAIT_S = 30.0
MAX_JOB_ID = 200
ROUTINE_MARK = "Routine"  # lib/routineNotes.ts parses `[Routine · <name> · <time>]` the same way

_TOKEN = re.compile(r"^(Exponent|Expo)PushToken\[[^\]\s]+\]$")
_IMAGE_MARK = re.compile(r"\[Image attached at:[^\]]*\]|\[screenshot\]")


@dataclass
class PushSettings:
    tokens: list[str] = field(default_factory=list)
    muted: bool = False
    #: Ids of the routines marked "Notify me". Every other routine stays silent.
    routines: list[str] = field(default_factory=list)
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
    jobs = push.get("routines")
    routines = [j for j in jobs if isinstance(j, str) and 0 < len(j) <= MAX_JOB_ID] if isinstance(jobs, list) else []
    return PushSettings(
        tokens=list(dict.fromkeys(tokens)), muted=push.get("muted") is True, routines=list(dict.fromkeys(routines)),
        name=name, endpoint=endpoint,
    )


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


def routine_notice(
    bot: str, job_id: str, job_name: str, text: str, name: Optional[str] = None, chat: Optional[str] = None,
    at: Optional[str] = None,
) -> Optional[Notice]:
    """A routine (cron job) run that ended with something to say.

    With `chat` (the bot's chat the result is added to) a tap opens that chat at the message stamped
    `at`; without one, the bot's Routine results."""
    if _silent(text):
        return None
    shown = name or bot
    title = f"{shown} · {job_name}" if job_name else shown
    data = {"bot": bot, "name": shown, "kind": "routine", "job": job_id}
    if chat and is_bot_chat(bot, chat):
        data["chat"] = chat
        if at:
            data["at"] = at
    return Notice(title=title, body=preview(text), data=data)


def now_stamp() -> str:
    """Local time with offset, to the second: `2026-11-12T15:04:05-05:00`."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def routine_message(job_name: str, at: str, text: str) -> str:
    """The text added to the bot's chat: a fixed marker line, then the routine's output.

    Stored as a user-role row (Hermes's rule for text that isn't the agent speaking), so the app
    recognises the marker and draws a routine card, not a bubble. lib/routineNotes.ts parses it."""
    name = re.sub(r"\s+", " ", (job_name or "").replace("]", "")).strip()[:80] or "Routine"
    return f"[{ROUTINE_MARK} · {name} · {at}]\n{text.strip()}"


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


MirrorFn = Callable[[str, str], bool]


def pick_chat(bot: str, rows: Any) -> Optional[str]:
    """The chat the app opens the bot on: its most recently used `dork-bot-<bot>` session with
    something in it (lib/chats.ts toChatSummaries). `rows` are Hermes session rows."""
    best: Optional[tuple[float, str]] = None
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not is_bot_chat(bot, r["id"]):
            continue
        if not isinstance(r.get("message_count"), (int, float)) or r["message_count"] <= 0:
            continue
        last = r.get("last_active") if isinstance(r.get("last_active"), (int, float)) else r.get("started_at")
        last = float(last) if isinstance(last, (int, float)) else 0.0
        if best is None or last > best[0]:
            best = (last, r["id"])
    return best[1] if best else None


def mirror_if_no_turn(db: Any, mirror_to_session: Callable[..., bool], chat: str, text: str, holder: str, ttl_s: float = 30.0) -> bool:
    """One try at adding `text` to `chat` without a bot turn, only if the chat has no turn running.

    Takes Hermes's turn lease on the chat for the write (the same lease a running turn holds, so a
    turn in flight makes this return False, and a turn can't start mid-write), then lets Hermes's own
    `gateway.mirror.mirror_to_session` append it. The row is user-role: text that isn't the agent
    speaking, as that function's docs require."""
    if not db.try_acquire_session_turn_lease(chat, holder, ttl_seconds=ttl_s):
        return False
    try:
        return bool(mirror_to_session("api_server", chat, text, source_label="dork-bot-routine", role="user", session_id=chat))
    finally:
        try:
            db.release_session_turn_lease(chat, holder)
        except Exception:
            logger.warning("dork-bot-push: couldn't release the turn lease on %s", chat, exc_info=True)


def mirror_when_idle(
    mirror: MirrorFn,
    chat: str,
    message: str,
    sleep: Callable[[float], Any] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    give_up_s: float = MIRROR_GIVE_UP_S,
) -> bool:
    """Adds `message` to the chat at a turn boundary. `mirror` returns False while a turn is running
    (or when the write failed): retry with a growing wait, give up after `give_up_s` and log it."""
    start = clock()
    wait = MIRROR_FIRST_WAIT_S
    while True:
        try:
            if mirror(chat, message):
                return True
        except Exception:
            logger.warning("dork-bot-push: adding a routine result to %s failed", chat, exc_info=True)
        if clock() - start + wait > give_up_s:
            logger.warning("dork-bot-push: gave up adding a routine result to %s after %.0fs", chat, clock() - start)
            return False
        sleep(wait)
        wait = min(wait * 2, MIRROR_MAX_WAIT_S)


def in_background(fn: Callable[[], Any]) -> None:
    threading.Thread(target=fn, name="dork-bot-push", daemon=True).start()


def pinned(fn: Callable[[], Any], enter: Callable[[], Any], leave: Callable[[Any], Any]) -> Callable[[], Any]:
    """`fn` wrapped so it runs between `enter()` and `leave(token)`. Hermes's active profile is a
    context-local value that a new thread doesn't inherit, so the background thread must re-enter the
    profile the hook ran in, or its database calls open the wrong profile's state.db."""

    def run() -> Any:
        token = enter()
        try:
            return fn()
        finally:
            leave(token)

    return run


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
        chat_target: Callable[[str], Optional[str]] = lambda bot: None,
        mirror: MirrorFn = lambda chat, text: False,
        stamp: Callable[[], str] = now_stamp,
        sleep: Callable[[float], Any] = time.sleep,
    ):
        self._profile = profile_name
        self._config = load_config
        self._cron_job = cron_job
        self._session_id = session_id
        self._post = post
        self._run = run
        self._url = url
        self._clock = clock
        self._chat_target = chat_target
        self._mirror = mirror
        self._stamp = stamp
        self._sleep = sleep
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

    def _routine_done(self, bot: str, job_id: str, job_name: str, text: str) -> None:
        """A routine run finished. Only a routine marked "Notify me" does anything: a push right away,
        and its output added to the bot's most recent chat once that chat has no turn running."""
        settings = settings_from_config(self._config())
        if settings.muted or job_id not in settings.routines or _silent(text):
            return
        chat = None
        try:
            chat = self._chat_target(bot)
        except Exception:
            logger.warning("dork-bot-push: couldn't find %s's chat", bot, exc_info=True)
        if chat and not is_bot_chat(bot, chat):
            chat = None  # only ever the app's own chats
        at = self._stamp()
        notice = routine_notice(bot, job_id, job_name, text, settings.name, chat=chat, at=at)
        if notice is not None and settings.tokens:
            messages = expo_messages(settings.tokens, notice)
            url = settings.endpoint or self._url
            self._run(lambda: send(messages, self._post, url))
        if chat:
            message = routine_message(job_name, at, text)
            self._run(lambda: mirror_when_idle(self._mirror, chat, message, self._sleep))

    def on_reply(self, session_id: str = "", assistant_response: str = "", platform: str = "", **_: Any) -> None:
        """post_llm_call: a turn finished with a final answer."""
        try:
            bot = self._profile()
            job = self._cron_job()
            text = assistant_response or ""
            if job is not None or platform == "cron":
                job_id, job_name = job or ("", "")
                self._routine_done(bot, job_id, job_name, text)
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

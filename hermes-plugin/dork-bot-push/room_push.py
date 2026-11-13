"""Push when a bot in a group room needs the user (card 8): "<bot name> in <room>: <preview>".

Hermes's gateway-hosted rooms run each member's turn in a hidden session titled `Group: <room_id>`
(source `bot_room`, id `room_<hash>`). The gateway does not flag `@user`, so this watches the member's
finished reply (`post_llm_call`) and pushes once when it contains `@user`. A normal room reply, a pass
(`[SILENT]`) and a reply that only mentions other members push nothing. The bot's notification switch
(`dork_bot.push.muted`) applies, and so does its display name. A tap opens the room (`kind: "room"`).

Kept apart from push.py (Notifier) and work_push.py so the three merge cleanly. Plain Python, no Hermes
imports: the title and room-name lookups are passed in.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections import OrderedDict
from typing import Any, Callable, Optional

try:  # loaded as part of the plugin package by Hermes
    from .push import EXPO_PUSH_URL, Notice, PostJson, expo_messages, post_json, preview, send, settings_from_config
except ImportError:  # loaded as a top-level module by the tests
    from push import EXPO_PUSH_URL, Notice, PostJson, expo_messages, post_json, preview, send, settings_from_config  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

ROOM_SESSION_PREFIX = "room_"
ROOM_TITLE_PREFIX = "Group: "
REMEMBER = 500
MAX_ROOM_ID = 100

# `@user` as a word, like the app's mentionsUser (lib/rooms.ts): not inside an email or a longer word.
_AT_USER = re.compile(r"(?<![A-Za-z0-9_@.\-+])@user(?![A-Za-z0-9_\-])", re.IGNORECASE)
_ROOM_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]*$")


def is_room_session(session_id: str) -> bool:
    return bool(session_id) and session_id.startswith(ROOM_SESSION_PREFIX)


def room_id_from_title(title: Any) -> Optional[str]:
    """`Group: <room_id>` -> the room id, else None."""
    if not isinstance(title, str) or not title.startswith(ROOM_TITLE_PREFIX):
        return None
    rid = title[len(ROOM_TITLE_PREFIX) :].strip()
    return rid if rid and len(rid) <= MAX_ROOM_ID and _ROOM_ID.match(rid) else None


def mentions_user(text: str) -> bool:
    return bool(_AT_USER.search(text or ""))


def room_notice(bot: str, room_id: str, room_name: str, text: str, name: Optional[str] = None) -> Notice:
    shown = name or bot
    room = room_name or "a room"
    return Notice(
        title=f"{shown} in {room}",
        body=preview(text),
        data={"bot": bot, "name": shown, "kind": "room", "room": room_id, "roomName": room},
    )


class RoomNotifier:
    """Hook callback for finished room turns. Everything Hermes-specific is passed in."""

    def __init__(
        self,
        profile_name: Callable[[], str],
        load_config: Callable[[], Any],
        session_title: Callable[[str], Optional[str]],
        room_name: Callable[[str], Optional[str]] = lambda room_id: None,
        post: PostJson = post_json,
        run: Callable[[Callable[[], Any]], None] = lambda fn: fn(),
        url: str = EXPO_PUSH_URL,
    ):
        self._profile = profile_name
        self._config = load_config
        self._title = session_title
        self._room_name = room_name
        self._post = post
        self._run = run
        self._url = url
        self._sent: "OrderedDict[str, None]" = OrderedDict()

    def on_reply(self, session_id: str = "", assistant_response: Any = "", **_: Any) -> None:
        """post_llm_call: a member's turn ended with `assistant_response`."""
        try:
            text = assistant_response if isinstance(assistant_response, str) else ""
            # Cheap checks first: this runs after every turn of every chat.
            if not is_room_session(session_id or "") or not mentions_user(text):
                return
            room_id = room_id_from_title(self._title(session_id))
            if room_id is None:
                return
            # One push per turn, even if the hook runs twice for it.
            key = f"{session_id}:{hashlib.sha1(text.encode()).hexdigest()}"
            if key in self._sent:
                return
            self._sent[key] = None
            while len(self._sent) > REMEMBER:
                self._sent.popitem(last=False)
            settings = settings_from_config(self._config())
            if settings.muted or not settings.tokens:
                return
            notice = room_notice(self._profile(), room_id, self._lookup_name(room_id), text, settings.name)
            messages = expo_messages(settings.tokens, notice)
            url = settings.endpoint or self._url
            self._run(lambda: send(messages, self._post, url))
        except Exception:
            logger.warning("dork-bot-push: room hook failed", exc_info=True)

    def _lookup_name(self, room_id: str) -> str:
        try:
            return (self._room_name(room_id) or "").strip()
        except Exception:
            return ""

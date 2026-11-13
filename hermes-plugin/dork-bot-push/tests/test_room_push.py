"""Tests for the "a bot needs you in a room" push (room_push.py), against a fake Expo push server.

    python3 -m unittest discover -s hermes-plugin/dork-bot-push/tests -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import room_push  # noqa: E402
import work_push  # noqa: E402
from test_push import TOKEN, TOKEN2, FakeExpo, config  # noqa: E402

SID = "room_0123456789abcdef0123456789abcdef"
ROOM = "7f1c2a40-1111-4222-8333-444455556666"


def notifier(expo: FakeExpo, cfg=None, bot="chief", titles=None, names=None):
    titles = {SID: f"Group: {ROOM}"} if titles is None else titles
    names = {ROOM: "Ops room"} if names is None else names
    return room_push.RoomNotifier(
        profile_name=lambda: bot,
        load_config=lambda: config() if cfg is None else cfg,
        session_title=lambda sid: titles.get(sid),
        room_name=lambda rid: names.get(rid),
        url=expo.url,
    )


class RoomPushTests(unittest.TestCase):
    def setUp(self):
        self.expo = FakeExpo()
        self.addCleanup(self.expo.close)

    def test_a_reply_with_at_user_pushes_once_with_bot_room_and_preview(self):
        n = notifier(self.expo)
        n.on_reply(session_id=SID, assistant_response="Red or blue, @user? I need you to pick.")
        [m] = self.expo.messages
        self.assertEqual(m["to"], TOKEN)
        self.assertEqual(m["title"], "chief in Ops room")
        self.assertEqual(m["body"], "Red or blue, @user? I need you to pick.")
        self.assertEqual(m["data"], {"bot": "chief", "name": "chief", "kind": "room", "room": ROOM, "roomName": "Ops room"})
        self.assertTrue(m["mutableContent"])  # the avatar extension runs

    def test_a_normal_room_reply_pushes_nothing(self):
        n = notifier(self.expo)
        for text in ("Sounds good to me.", "@design can you take this?", "", "[SILENT]", None):
            n.on_reply(session_id=SID, assistant_response=text)
        self.assertEqual(self.expo.requests, [])

    def test_at_user_inside_a_word_or_email_is_not_a_mention(self):
        n = notifier(self.expo)
        for text in ("mail user@example.com", "the @username field", "see foo@user.net", "@users, all"):
            n.on_reply(session_id=SID, assistant_response=text)
        self.assertEqual(self.expo.requests, [])
        self.assertTrue(room_push.mentions_user("Hey @User, ok?"))
        self.assertTrue(room_push.mentions_user("(@user)"))
        self.assertTrue(room_push.mentions_user("@user."))

    def test_other_sessions_never_push(self):
        n = notifier(self.expo, titles={"dork-bot-chief": "Group: " + ROOM, "room_other": "Not a group"})
        n.on_reply(session_id="dork-bot-chief", assistant_response="@user hi")  # a 1:1 app chat
        n.on_reply(session_id="room_other", assistant_response="@user hi")  # a room-looking id with another title
        n.on_reply(session_id="room_unknown", assistant_response="@user hi")  # no title
        n.on_reply(session_id="", assistant_response="@user hi")
        self.assertEqual(self.expo.requests, [])

    def test_the_bots_notification_switch_applies(self):
        n = notifier(self.expo, config(muted=True))
        n.on_reply(session_id=SID, assistant_response="@user need you")
        self.assertEqual(self.expo.requests, [])
        n = notifier(self.expo, config(tokens=()))
        n.on_reply(session_id=SID, assistant_response="@user need you")
        self.assertEqual(self.expo.requests, [])

    def test_uses_the_display_name_and_goes_to_every_phone(self):
        cfg = config(tokens=(TOKEN, TOKEN2))
        cfg["dork_bot"]["name"] = "Chief of Staff"
        notifier(self.expo, cfg).on_reply(session_id=SID, assistant_response="@user ok?")
        self.assertEqual(sorted(m["to"] for m in self.expo.messages), [TOKEN, TOKEN2])
        self.assertEqual(self.expo.messages[0]["title"], "Chief of Staff in Ops room")
        self.assertEqual(self.expo.messages[0]["data"]["bot"], "chief")  # taps and the avatar use the profile id

    def test_the_same_turn_pushes_only_once(self):
        n = notifier(self.expo)
        n.on_reply(session_id=SID, assistant_response="@user ok?")
        n.on_reply(session_id=SID, assistant_response="@user ok?")
        self.assertEqual(len(self.expo.messages), 1)
        n.on_reply(session_id=SID, assistant_response="@user still there?")  # a new turn
        self.assertEqual(len(self.expo.messages), 2)

    def test_still_pushes_when_the_room_name_is_unknown(self):
        notifier(self.expo, names={}).on_reply(session_id=SID, assistant_response="@user ok?")
        self.assertEqual(self.expo.messages[0]["title"], "chief in a room")

    def test_a_failing_lookup_never_breaks_the_turn(self):
        def boom(_):
            raise RuntimeError("db locked")

        n = room_push.RoomNotifier(lambda: "chief", lambda: config(), boom, url=self.expo.url)
        n.on_reply(session_id=SID, assistant_response="@user ok?")  # swallowed
        self.assertEqual(self.expo.requests, [])

    def test_room_id_from_the_hidden_session_title(self):
        self.assertEqual(room_push.room_id_from_title(f"Group: {ROOM}"), ROOM)
        for bad in (None, "", "Group: ", "group: x", "Group: a b", "Chat about Group: x", 5):
            self.assertIsNone(room_push.room_id_from_title(bad))

    def test_room_sessions_are_not_outside_work(self):
        # Without this, a room turn's session ending would also push "<bot> finished: ...".
        self.assertFalse(work_push.is_outside_work("chief", SID))
        self.assertTrue(work_push.is_outside_work("chief", "local-abc"))


if __name__ == "__main__":
    unittest.main()

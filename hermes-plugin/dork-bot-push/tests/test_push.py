"""Tests for dork-bot-push, against a fake Expo push server on 127.0.0.1.

    python3 -m unittest discover -s hermes-plugin/dork-bot-push/tests -v
"""

from __future__ import annotations

import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import push  # noqa: E402

TOKEN = "ExponentPushToken[abc123]"
TOKEN2 = "ExponentPushToken[def456]"
AT = "2026-11-12T15:04:05-05:00"


class FakeExpo:
    """Answers like exp.host: one ticket per message; a token in `refuse` gets DeviceNotRegistered."""

    def __init__(self, refuse: tuple[str, ...] = (), status: int = 200):
        self.requests: list[list[dict]] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append(body)
                tickets = [
                    {"status": "error", "message": "not registered", "details": {"error": "DeviceNotRegistered"}}
                    if m["to"] in refuse
                    else {"status": "ok", "id": f"ticket-{i}"}
                    for i, m in enumerate(body)
                ]
                out = json.dumps({"data": tickets}).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/--/api/v2/push/send"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    @property
    def messages(self) -> list[dict]:
        return [m for r in self.requests for m in r]


def config(tokens=(TOKEN,), muted=False, **extra):
    return {"model": {"default": "gemma4:31b"}, "dork_bot": {"look": {}, "push": {"tokens": list(tokens), "muted": muted, **extra}}}


class Harness:
    """A Notifier wired like __init__.py, with the HTTP call run inline (no background thread)."""

    def __init__(self, expo: FakeExpo, cfg=None, bot="chief", cron=None, session_env="", chat="dork-bot-chief--lq2x9a1b"):
        self.cfg = config() if cfg is None else cfg
        self.cron = cron
        self.clock = [0.0]
        self.chat = chat
        self.mirrored: list[tuple[str, str]] = []
        self.mirror_answers: list[bool] = []  # False = a turn is running; empty = free
        self.sleeps: list[float] = []
        self.notifier = push.Notifier(
            profile_name=lambda: bot,
            load_config=lambda: self.cfg,
            cron_job=lambda: self.cron,
            session_id=lambda: session_env,
            run=lambda fn: fn(),
            url=expo.url,
            clock=lambda: self.clock[0],
            chat_target=lambda b: self.chat,
            mirror=self._mirror,
            stamp=lambda: AT,
            sleep=self.sleeps.append,
        )

    def _mirror(self, chat, text):
        if self.mirror_answers and not self.mirror_answers.pop(0):
            return False
        self.mirrored.append((chat, text))
        return True


class ReplyTests(unittest.TestCase):
    def setUp(self):
        self.expo = FakeExpo()
        self.addCleanup(self.expo.close)

    def test_a_reply_in_an_app_chat_pushes_the_bot_name_and_the_start_of_the_reply(self):
        h = Harness(self.expo)
        reply = "**Done.** " + "The build passed and I pushed the branch. " * 5
        h.notifier.on_reply(session_id="dork-bot-chief--lq2x9a1b", assistant_response=reply, platform="api_server", model="x")
        [m] = self.expo.messages
        self.assertEqual(m["to"], TOKEN)
        self.assertEqual(m["title"], "chief")
        self.assertTrue(m["body"].startswith("Done. The build passed"))
        self.assertLessEqual(len(m["body"]), push.PREVIEW_CHARS)
        self.assertTrue(m["body"].endswith("…"))
        self.assertEqual(m["data"], {"bot": "chief", "name": "chief", "kind": "reply", "chat": "dork-bot-chief--lq2x9a1b"})
        self.assertEqual(m["sound"], "default")

    def test_every_push_is_mutable_so_the_avatar_extension_runs(self):
        h = Harness(self.expo, config(tokens=(TOKEN, TOKEN2), routines=["j"]), cron=None)
        h.notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi", platform="api_server")
        h.notifier.on_approval(surface="gateway", session_key="dork-bot-chief")
        h.cron = ("j", "Morning news")
        h.notifier.on_reply(session_id="cron_j", assistant_response="ok", platform="cron")
        self.assertEqual(len(self.expo.messages), 6)
        self.assertTrue(all(m["mutableContent"] is True for m in self.expo.messages))

    def test_the_title_is_the_display_name_and_the_data_keeps_the_profile_id(self):
        cfg = config()
        cfg["dork_bot"]["name"] = "  Big   Chief "
        h = Harness(self.expo, cfg)
        h.notifier.on_reply(session_id="dork-bot-chief--a1", assistant_response="hi", platform="api_server")
        h.notifier.on_approval(surface="gateway", session_key="dork-bot-chief--a1")
        self.assertEqual([m["title"] for m in self.expo.messages], ["Big Chief", "Big Chief"])
        for m in self.expo.messages:
            self.assertEqual((m["data"]["bot"], m["data"]["name"]), ("chief", "Big Chief"))
            self.assertEqual(m["data"]["chat"], "dork-bot-chief--a1")  # a tap still opens the right chat

    def test_a_missing_or_bad_display_name_falls_back_to_the_profile_id(self):
        for bad in (None, "", "   ", 7, ["x"], "x" * 31):
            cfg = config()
            cfg["dork_bot"]["name"] = bad
            Harness(self.expo, cfg).notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi")
        self.assertEqual({m["title"] for m in self.expo.messages}, {"chief"})
        self.assertEqual({m["data"]["name"] for m in self.expo.messages}, {"chief"})

    def test_a_muted_renamed_bot_still_sends_nothing(self):
        cfg = config(muted=True)
        cfg["dork_bot"]["name"] = "Big Chief"
        Harness(self.expo, cfg).notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi")
        self.assertEqual(self.expo.requests, [])

    def test_the_first_chat_counts_too(self):
        Harness(self.expo).notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi", platform="api_server")
        self.assertEqual(len(self.expo.messages), 1)

    def test_every_phone_gets_it(self):
        Harness(self.expo, config(tokens=(TOKEN, TOKEN2))).notifier.on_reply(
            session_id="dork-bot-chief", assistant_response="hi", platform="api_server"
        )
        self.assertEqual(sorted(m["to"] for m in self.expo.messages), [TOKEN, TOKEN2])

    def test_no_push_for_an_empty_or_silent_reply(self):
        h = Harness(self.expo)
        for text in ("", "   \n", "[SILENT]", None):
            h.notifier.on_reply(session_id="dork-bot-chief", assistant_response=text, platform="api_server")
        self.assertEqual(self.expo.requests, [])

    def test_no_push_for_chats_the_app_did_not_make(self):
        h = Harness(self.expo)
        for sid in ("20261104_101500_abcd", "dork-bot-chiefly", "dork-bot-assistant--x", "test-sync-1"):
            h.notifier.on_reply(session_id=sid, assistant_response="hi", platform="cli")
        self.assertEqual(self.expo.requests, [])

    def test_muted_bot_or_no_phones_sends_nothing(self):
        Harness(self.expo, config(muted=True)).notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi")
        Harness(self.expo, config(tokens=())).notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi")
        Harness(self.expo, {"model": {}}).notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi")
        self.assertEqual(self.expo.requests, [])

    def test_malformed_tokens_are_dropped(self):
        cfg = config(tokens=("not-a-token", 42, TOKEN, TOKEN, "ExponentPushToken[]"))
        Harness(self.expo, cfg).notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi")
        self.assertEqual([m["to"] for m in self.expo.messages], [TOKEN])

    def test_picture_markers_and_code_fences_stay_out_of_the_preview(self):
        text = "Here it is\n\n[Image attached at: ~/.hermes/profiles/chief/cache/x.png]\n```python\nprint(1)\n```"
        Harness(self.expo).notifier.on_reply(session_id="dork-bot-chief", assistant_response=text)
        self.assertEqual(self.expo.messages[0]["body"], "Here it is print(1)")


class RoutineTests(unittest.TestCase):
    """A routine acts only when marked "Notify me" (dork_bot.push.routines): a push, and its output in the chat."""

    def setUp(self):
        self.expo = FakeExpo()
        self.addCleanup(self.expo.close)

    def marked(self, **extra):
        return config(routines=["job42"], **extra)

    def run_job(self, h, text="Three stories today.", job=("job42", "Morning news")):
        h.cron = job
        h.notifier.on_reply(session_id="cron_job42_20261104", assistant_response=text, platform="cron")

    def test_a_marked_routine_pushes_and_adds_its_output_to_the_chat(self):
        h = Harness(self.expo, self.marked())
        self.run_job(h)
        [m] = self.expo.messages
        self.assertEqual(m["title"], "chief · Morning news")
        self.assertEqual(m["body"], "Three stories today.")
        self.assertEqual(
            m["data"],
            {"bot": "chief", "name": "chief", "kind": "routine", "job": "job42", "chat": "dork-bot-chief--lq2x9a1b", "at": AT},
        )
        self.assertTrue(m["mutableContent"])  # the #32 avatar path still runs
        self.assertEqual(
            h.mirrored, [("dork-bot-chief--lq2x9a1b", f"[Routine · Morning news · {AT}]\nThree stories today.")]
        )

    def test_an_unmarked_routine_sends_nothing_and_adds_nothing(self):
        for cfg in (config(), config(routines=["other"]), config(routines=[])):
            h = Harness(self.expo, cfg)
            self.run_job(h)
            self.assertEqual(h.mirrored, [])
        self.assertEqual(self.expo.requests, [])

    def test_an_empty_or_silent_marked_run_sends_nothing(self):
        h = Harness(self.expo, self.marked())
        for text in ("", "  \n", "[SILENT]", " [SILENT] ", None):
            self.run_job(h, text)
        self.assertEqual(self.expo.requests, [])
        self.assertEqual(h.mirrored, [])

    def test_the_per_bot_mute_overrides_a_marked_routine(self):
        h = Harness(self.expo, self.marked(muted=True))
        self.run_job(h)
        self.assertEqual(self.expo.requests, [])
        self.assertEqual(h.mirrored, [])

    def test_a_marked_routine_with_no_phones_still_adds_to_the_chat(self):
        h = Harness(self.expo, config(tokens=(), routines=["job42"]))
        self.run_job(h)
        self.assertEqual(self.expo.requests, [])
        self.assertEqual(len(h.mirrored), 1)

    def test_a_bot_with_no_chat_yet_pushes_to_routine_results(self):
        h = Harness(self.expo, self.marked(), chat=None)
        self.run_job(h)
        [m] = self.expo.messages
        self.assertEqual(m["data"], {"bot": "chief", "name": "chief", "kind": "routine", "job": "job42"})
        self.assertEqual(h.mirrored, [])

    def test_a_chat_that_is_not_the_apps_is_never_written_to(self):
        h = Harness(self.expo, self.marked(), chat="20261104_cli_session")
        self.run_job(h)
        self.assertNotIn("chat", self.expo.messages[0]["data"])
        self.assertEqual(h.mirrored, [])

    def test_the_title_leads_with_the_display_name(self):
        cfg = self.marked()
        cfg["dork_bot"]["name"] = "Big Chief"
        self.run_job(Harness(self.expo, cfg))
        [m] = self.expo.messages
        self.assertEqual(m["title"], "Big Chief · Morning news")
        self.assertEqual((m["data"]["bot"], m["data"]["name"]), ("chief", "Big Chief"))

    def test_platform_cron_without_the_run_identity_is_unmarked(self):
        Harness(self.expo, self.marked()).notifier.on_reply(session_id="cron_x", assistant_response="ok", platform="cron")
        self.assertEqual(self.expo.requests, [])

    def test_the_push_goes_out_even_while_the_chat_is_mid_turn(self):
        h = Harness(self.expo, self.marked())
        h.mirror_answers = [False, False, True]  # a turn runs for two tries
        self.run_job(h)
        self.assertEqual(len(self.expo.messages), 1)
        self.assertEqual(h.sleeps, [2.0, 4.0])
        self.assertEqual(len(h.mirrored), 1)

    def test_the_first_chat_counts_as_the_target(self):
        h = Harness(self.expo, self.marked(), chat="dork-bot-chief")
        self.run_job(h)
        self.assertEqual(h.mirrored[0][0], "dork-bot-chief")


class SwitchStorageTests(unittest.TestCase):
    def test_routines_are_read_from_the_push_block(self):
        s = push.settings_from_config(config(routines=["a", "b", "a"]))
        self.assertEqual(s.routines, ["a", "b"])

    def test_it_is_off_for_every_routine_by_default(self):
        self.assertEqual(push.settings_from_config(config()).routines, [])
        self.assertEqual(push.settings_from_config({"dork_bot": {"name": "x"}}).routines, [])
        self.assertEqual(push.settings_from_config({}).routines, [])

    def test_malformed_values_are_dropped(self):
        self.assertEqual(push.settings_from_config(config(routines="job1")).routines, [])
        self.assertEqual(push.settings_from_config(config(routines={"job1": True})).routines, [])
        self.assertEqual(push.settings_from_config(config(routines=["ok", 7, None, "", "x" * 201, ["n"]])).routines, ["ok"])


class MessageFormatTests(unittest.TestCase):
    def test_marker_line_then_the_output(self):
        self.assertEqual(push.routine_message("Morning news", AT, "Line one\n\nLine two\n"), f"[Routine · Morning news · {AT}]\nLine one\n\nLine two")

    def test_the_name_cannot_break_the_marker(self):
        msg = push.routine_message("Digest ] [x]\n  today · now", AT, "ok")
        self.assertEqual(msg.split("\n")[0], f"[Routine · Digest [x today · now · {AT}]")
        self.assertEqual(push.routine_message("   ", AT, "ok").split("\n")[0], f"[Routine · Routine · {AT}]")
        self.assertLessEqual(len(push.routine_message("n" * 500, AT, "ok").split(" · ")[1]), 80)

    def test_the_stamp_is_local_time_with_an_offset(self):
        self.assertRegex(push.now_stamp(), r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$")


class FakeDb:
    def __init__(self, busy=False):
        self.busy = busy
        self.events: list[tuple] = []

    def try_acquire_session_turn_lease(self, chat, holder, ttl_seconds=0):
        self.events.append(("acquire", chat, ttl_seconds))
        return not self.busy

    def release_session_turn_lease(self, chat, holder):
        self.events.append(("release", chat))


class MirrorTests(unittest.TestCase):
    """The Hermes side: gateway.mirror.mirror_to_session under the chat's turn lease."""

    def test_writes_user_role_into_the_exact_session_and_releases_the_lease(self):
        db, calls = FakeDb(), []

        def mirror_to_session(platform, chat_id, text, **kw):
            calls.append((platform, chat_id, text, kw))
            db.events.append(("write",))
            return True

        self.assertTrue(push.mirror_if_no_turn(db, mirror_to_session, "dork-bot-chief--a1", "hello", holder="h"))
        [(platform, chat_id, text, kw)] = calls
        self.assertEqual((platform, chat_id, text), ("api_server", "dork-bot-chief--a1", "hello"))
        self.assertEqual((kw["role"], kw["session_id"], kw["source_label"]), ("user", "dork-bot-chief--a1", "dork-bot-routine"))
        self.assertEqual([e[0] for e in db.events], ["acquire", "write", "release"])

    def test_a_chat_with_a_turn_running_is_not_written_to(self):
        db, calls = FakeDb(busy=True), []
        ok = push.mirror_if_no_turn(db, lambda *a, **k: calls.append(a) or True, "dork-bot-chief", "hello", holder="h")
        self.assertFalse(ok)
        self.assertEqual(calls, [])
        self.assertEqual([e[0] for e in db.events], ["acquire"])  # nothing to release

    def test_the_lease_is_released_when_the_write_fails(self):
        db = FakeDb()

        def boom(*a, **k):
            raise RuntimeError("disk")

        with self.assertRaises(RuntimeError):
            push.mirror_if_no_turn(db, boom, "dork-bot-chief", "hello", holder="h")
        self.assertEqual([e[0] for e in db.events], ["acquire", "release"])

    def test_retry_backs_off_and_succeeds_when_the_turn_ends(self):
        clock, sleeps, answers = [0.0], [], [False, False, False, True]

        def sleep(s):
            sleeps.append(s)
            clock[0] += s

        ok = push.mirror_when_idle(lambda c, t: answers.pop(0), "dork-bot-chief", "x", sleep=sleep, clock=lambda: clock[0])
        self.assertTrue(ok)
        self.assertEqual(sleeps, [2.0, 4.0, 8.0])

    def test_it_gives_up_after_about_ten_minutes_and_logs_it(self):
        clock, sleeps = [0.0], []

        def sleep(s):
            sleeps.append(s)
            clock[0] += s

        with self.assertLogs(push.logger, "WARNING") as logs:
            ok = push.mirror_when_idle(lambda c, t: False, "dork-bot-chief", "x", sleep=sleep, clock=lambda: clock[0])
        self.assertFalse(ok)
        self.assertLessEqual(sum(sleeps), push.MIRROR_GIVE_UP_S)
        self.assertGreater(sum(sleeps), push.MIRROR_GIVE_UP_S - push.MIRROR_MAX_WAIT_S - 1)
        self.assertLessEqual(max(sleeps), push.MIRROR_MAX_WAIT_S)
        self.assertIn("gave up", logs.output[-1])

    def test_a_mirror_that_raises_is_retried_not_fatal(self):
        answers = [RuntimeError("locked"), True]

        def mirror(c, t):
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a

        with self.assertLogs(push.logger, "WARNING"):
            self.assertTrue(push.mirror_when_idle(mirror, "dork-bot-chief", "x", sleep=lambda s: None))


class PinnedTests(unittest.TestCase):
    def test_the_background_work_runs_inside_the_profile_it_was_started_in(self):
        events = []
        run = push.pinned(lambda: events.append("work"), lambda: events.append("enter") or "tok", lambda t: events.append(f"leave:{t}"))
        run()
        self.assertEqual(events, ["enter", "work", "leave:tok"])

    def test_it_leaves_the_profile_even_when_the_work_fails(self):
        events = []

        def boom():
            raise RuntimeError("x")

        with self.assertRaises(RuntimeError):
            push.pinned(boom, lambda: "t", events.append)()
        self.assertEqual(events, ["t"])


class PickChatTests(unittest.TestCase):
    def rows(self):
        return [
            {"id": "dork-bot-chief", "last_active": 100, "message_count": 4},
            {"id": "dork-bot-chief--b2", "last_active": 300, "message_count": 2},
            {"id": "dork-bot-chief--a1", "last_active": 200, "message_count": 6},
            {"id": "dork-bot-chiefly--x", "last_active": 900, "message_count": 6},
            {"id": "dork-bot-chief--empty", "last_active": 800, "message_count": 0},
            {"id": "cron_job42", "last_active": 999, "message_count": 3},
            "junk",
        ]

    def test_the_most_recently_used_chat_with_messages(self):
        self.assertEqual(push.pick_chat("chief", self.rows()), "dork-bot-chief--b2")

    def test_none_when_the_bot_has_no_chat(self):
        self.assertIsNone(push.pick_chat("chief", []))
        self.assertIsNone(push.pick_chat("other", self.rows()))
        self.assertIsNone(push.pick_chat("chief", None))


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.expo = FakeExpo()
        self.addCleanup(self.expo.close)

    def test_an_approval_says_needs_approval_and_never_the_command(self):
        h = Harness(self.expo)
        h.notifier.on_approval(
            command="rm -rf /srv/secret-project", description="recursive delete", pattern_key="rm_rf",
            pattern_keys=["rm_rf"], session_key="dork-bot-chief--abc", surface="gateway", turn_id="t1",
        )
        [m] = self.expo.messages
        self.assertEqual((m["title"], m["body"]), ("chief", "needs approval"))
        self.assertEqual(m["data"], {"bot": "chief", "name": "chief", "kind": "approval", "chat": "dork-bot-chief--abc"})
        self.assertNotIn("secret", json.dumps(self.expo.requests))

    def test_the_chat_can_come_from_session_id_or_the_session_env(self):
        Harness(self.expo).notifier.on_approval(surface="gateway", session_key="agent:main:api", session_id="dork-bot-chief")
        Harness(self.expo, session_env="dork-bot-chief--zz").notifier.on_approval(surface="gateway", session_key="opaque")
        self.assertEqual([m["data"]["chat"] for m in self.expo.messages], ["dork-bot-chief", "dork-bot-chief--zz"])

    def test_smart_decisions_duplicates_and_other_sessions_send_nothing(self):
        h = Harness(self.expo)
        h.notifier.on_approval(surface="smart", session_key="dork-bot-chief")
        h.notifier.on_approval(surface="gateway", session_key="dork-bot-chief", coalesced=True)
        h.notifier.on_approval(surface="cli", session_key="20261104_cli_session")
        self.assertEqual(self.expo.requests, [])

    def test_one_push_per_chat_while_approvals_pile_up(self):
        h = Harness(self.expo)
        h.notifier.on_approval(surface="gateway", session_key="dork-bot-chief")
        h.clock[0] = 10
        h.notifier.on_approval(surface="gateway", session_key="dork-bot-chief")  # second command, same turn
        h.notifier.on_approval(surface="gateway", session_key="dork-bot-chief--other")
        h.clock[0] = 45
        h.notifier.on_approval(surface="gateway", session_key="dork-bot-chief")
        self.assertEqual([m["data"]["chat"] for m in self.expo.messages], ["dork-bot-chief", "dork-bot-chief--other", "dork-bot-chief"])


class SendTests(unittest.TestCase):
    def test_counts_accepted_tickets_and_survives_refusals(self):
        expo = FakeExpo(refuse=(TOKEN2,))
        self.addCleanup(expo.close)
        with self.assertLogs(push.logger, "INFO") as logs:
            n = push.send(push.expo_messages([TOKEN, TOKEN2], push.Notice("chief", "hi", {"bot": "chief"})), url=expo.url)
        self.assertEqual(n, 1)
        self.assertIn("DeviceNotRegistered", logs.output[0])

    def test_batches_of_100(self):
        expo = FakeExpo()
        self.addCleanup(expo.close)
        tokens = [f"ExponentPushToken[t{i}]" for i in range(150)]
        self.assertEqual(push.send(push.expo_messages(tokens, push.Notice("a", "b", {})), url=expo.url), 150)
        self.assertEqual([len(r) for r in expo.requests], [100, 50])

    def test_a_dead_or_failing_server_never_raises(self):
        expo = FakeExpo(status=500)
        expo.close()  # nothing listening any more
        broken = FakeExpo(status=500)
        self.addCleanup(broken.close)
        with self.assertLogs(push.logger, "WARNING"):
            self.assertEqual(push.send(push.expo_messages([TOKEN], push.Notice("a", "b", {})), url=expo.url), 0)
            self.assertEqual(push.send(push.expo_messages([TOKEN], push.Notice("a", "b", {})), url=broken.url), 0)

    def test_a_hook_that_blows_up_inside_never_raises_into_hermes(self):
        def bad_config():
            raise RuntimeError("config unreadable")

        n = push.Notifier(profile_name=lambda: "chief", load_config=bad_config, run=lambda fn: fn())
        with self.assertLogs(push.logger, "WARNING") as logs:
            n.on_reply(session_id="dork-bot-chief", assistant_response="hi")
            n.on_approval(surface="gateway", session_key="dork-bot-chief")
        self.assertEqual(len(logs.records), 2)


class SettingsTests(unittest.TestCase):
    def test_endpoint_override_only_for_this_machine(self):
        self.assertEqual(push.settings_from_config(config(endpoint="http://127.0.0.1:9999/x")).endpoint, "http://127.0.0.1:9999/x")
        for bad in ("https://evil.example/collect", "http://127.0.0.1.evil.example/", "http://10.0.0.5:80/", 5):
            self.assertIsNone(push.settings_from_config(config(endpoint=bad)).endpoint, bad)

    def test_endpoint_override_is_used(self):
        expo = FakeExpo()
        self.addCleanup(expo.close)
        h = Harness(expo, config(endpoint=expo.url))
        h.notifier._url = "http://127.0.0.1:1/never"  # the default must not be used
        h.notifier.on_reply(session_id="dork-bot-chief", assistant_response="hi")
        self.assertEqual(len(expo.messages), 1)


class RegisterTests(unittest.TestCase):
    """__init__.register wires the two hooks with the names Hermes fires."""

    def test_register_binds_post_llm_call_and_pre_approval_request(self):
        import importlib.util

        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location("dork_bot_push", root / "__init__.py", submodule_search_locations=[str(root)])
        mod = importlib.util.module_from_spec(spec)
        sys.modules["dork_bot_push"] = mod
        spec.loader.exec_module(mod)

        hooks = {}

        class Ctx:
            profile_name = "chief"

            def current_cron_execution(self):
                return None

            def register_hook(self, name, fn):
                hooks[name] = fn

        mod.register(Ctx())
        self.assertEqual(sorted(hooks), ["on_session_finalize", "post_llm_call", "pre_approval_request", "pre_llm_call"])


if __name__ == "__main__":
    unittest.main()

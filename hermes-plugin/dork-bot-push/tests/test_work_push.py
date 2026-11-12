"""Tests for the outside-work push (work_push.py), against a fake Expo push server on 127.0.0.1.

    python3 -m unittest discover -s hermes-plugin/dork-bot-push/tests -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import work_push  # noqa: E402
from test_push import TOKEN, TOKEN2, FakeExpo, config  # noqa: E402


def notifier(expo: FakeExpo, cfg=None, bot="chief", cron=None):
    return work_push.WorkNotifier(
        profile_name=lambda: bot,
        load_config=lambda: config() if cfg is None else cfg,
        cron_job=lambda: cron,
        url=expo.url,
    )


def run_session(n, sid="local-abc", task="Fix the build please", reply="Fixed it. All tests pass.", platform="cli"):
    n.on_task(session_id=sid, user_message=task, platform=platform)
    n.on_reply(session_id=sid, user_message=task, assistant_response=reply, platform=platform)


class WorkPushTests(unittest.TestCase):
    def setUp(self):
        self.expo = FakeExpo()
        self.addCleanup(self.expo.close)

    def test_a_finished_terminal_run_pushes_finished_title_and_outcome_and_opens_that_session(self):
        n = notifier(self.expo)
        run_session(n)
        self.assertEqual(self.expo.requests, [])  # nothing until Hermes ends the session
        n.on_finalize(session_id="local-abc", platform="cli")
        [m] = self.expo.messages
        self.assertEqual(m["to"], TOKEN)
        self.assertEqual(m["title"], "chief finished: Fix the build please")
        self.assertEqual(m["body"], "Fixed it. All tests pass.")
        self.assertEqual(m["data"], {"bot": "chief", "name": "chief", "kind": "work", "session": "local-abc"})
        self.assertTrue(m["mutableContent"])  # the avatar extension runs

    def test_only_one_push_per_session_however_many_turns_tool_calls_or_finalizes(self):
        n = notifier(self.expo)
        n.on_task(session_id="local-abc", user_message="first", platform="cli")
        for i in range(5):  # a turn's tool calls never reach these hooks; five turns still make one push
            n.on_reply(session_id="local-abc", assistant_response=f"step {i}", platform="cli")
        self.assertEqual(self.expo.requests, [])
        n.on_finalize(session_id="local-abc", platform="cli")
        n.on_finalize(session_id="local-abc", platform="cli")  # CLI and gateway can both finalize
        self.assertEqual(len(self.expo.messages), 1)
        self.assertEqual(self.expo.messages[0]["body"], "step 4")  # the latest reply is the outcome
        self.assertEqual(self.expo.messages[0]["title"], "chief finished: first")

    def test_every_phone_gets_it_and_the_display_name_leads(self):
        cfg = config(tokens=(TOKEN, TOKEN2))
        cfg["dork_bot"]["name"] = "Big Chief"
        n = notifier(self.expo, cfg)
        run_session(n)
        n.on_finalize(session_id="local-abc", platform="cli")
        self.assertEqual([m["to"] for m in self.expo.messages], [TOKEN, TOKEN2])
        self.assertEqual(self.expo.messages[0]["title"], "Big Chief finished: Fix the build please")
        self.assertEqual(self.expo.messages[0]["data"]["bot"], "chief")

    def test_follows_the_bots_notification_switch(self):
        n = notifier(self.expo, config(muted=True))
        run_session(n)
        n.on_finalize(session_id="local-abc", platform="cli")
        self.assertEqual(self.expo.requests, [])
        n2 = notifier(self.expo, config(tokens=()))
        run_session(n2)
        n2.on_finalize(session_id="local-abc", platform="cli")
        self.assertEqual(self.expo.requests, [])

    def test_the_apps_own_chats_and_routine_runs_are_not_work(self):
        n = notifier(self.expo)
        for sid, platform in (("dork-bot-chief", "api_server"), ("dork-bot-chief--abc", "api_server"), ("cron_job1_2026", "cron"), ("local-x", "cron")):
            run_session(n, sid=sid, platform=platform)
            n.on_finalize(session_id=sid, platform=platform)
        n2 = notifier(self.expo, cron=("job1", "Morning news"))
        run_session(n2, sid="local-y")
        n2.on_finalize(session_id="local-y", platform="cli")
        self.assertEqual(self.expo.requests, [])

    def test_a_session_that_ended_without_a_reply_says_so_and_never_invents_one(self):
        n = notifier(self.expo)
        n.on_task(session_id="local-abc", user_message="Do the thing", platform="cli")
        n.on_finalize(session_id="local-abc", platform="cli")
        [m] = self.expo.messages
        self.assertEqual(m["title"], "chief finished: Do the thing")
        self.assertEqual(m["body"], work_push.NO_REPLY)

    def test_a_session_this_process_never_saw_a_turn_of_sends_nothing(self):
        n = notifier(self.expo)
        n.on_finalize(session_id="local-abc", platform="cli")
        n.on_finalize(session_id="", platform="cli")
        self.assertEqual(self.expo.requests, [])

    def test_long_tasks_are_cut_and_multimodal_tasks_use_their_text(self):
        n = notifier(self.expo)
        n.on_task(session_id="local-abc", user_message=[{"type": "text", "text": "word " * 40}, {"type": "image_url"}], platform="cli")
        n.on_finalize(session_id="local-abc", platform="cli")
        title = self.expo.messages[0]["title"][len("chief finished: "):]
        self.assertLessEqual(len(title), work_push.TITLE_CHARS)
        self.assertTrue(title.endswith("…"))

    def test_a_silent_reply_is_not_shown_as_the_outcome(self):
        n = notifier(self.expo)
        run_session(n, reply="[SILENT]")
        n.on_finalize(session_id="local-abc", platform="cli")
        self.assertEqual(self.expo.messages[0]["body"], work_push.NO_REPLY)

    def test_hooks_never_raise_into_hermes(self):
        def boom():
            raise RuntimeError("no profile")

        n = work_push.WorkNotifier(profile_name=boom, load_config=lambda: {})
        n.on_task(session_id="x", user_message="y")
        n.on_reply(session_id="x", assistant_response="y")
        n.on_finalize(session_id="x")

    def test_the_push_is_sent_before_finalize_returns(self):
        # `hermes chat -q` exits right after finalize: a background thread would be killed with it.
        n = notifier(self.expo)
        run_session(n)
        n.on_finalize(session_id="local-abc", platform="cli")
        self.assertEqual(len(self.expo.requests), 1)


if __name__ == "__main__":
    unittest.main()

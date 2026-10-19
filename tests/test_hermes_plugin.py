"""Hermes plugin wiring: registration and hook behaviour. Run: python3 -m unittest discover -s tests -p 'test_*.py'"""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load_plugin():
    spec = importlib.util.spec_from_file_location("job_hunt_hermes_plugin", ROOT / "__init__.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeCtx:
    def __init__(self):
        self.skills, self.hooks, self.injected = {}, {}, []

    def register_skill(self, name, path, description="", frontmatter=None):
        self.skills[name] = (Path(path), description)

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def inject_message(self, content, role="user", **_):
        self.injected.append(content)
        return True


class PluginTest(unittest.TestCase):
    def setUp(self):
        os.environ["JOB_HUNT_HOME"] = tempfile.mkdtemp(prefix="jh-py-")
        os.environ.pop("JOB_HUNT_NODE", None)
        self.ctx = FakeCtx()
        load_plugin().register(self.ctx)

    def test_registers_skills_commands_and_agents(self):
        names = set(self.ctx.skills)
        self.assertEqual(len(names), 9 + 11 + 3)
        for n in ("score-role", "verify-employer", "setup-guide", "sweep", "apply", "approve", "setup", "agent-scorer", "agent-sourcer", "agent-auditor"):
            self.assertIn(n, names)
        self.assertEqual(self.ctx.skills["setup"][0], ROOT / "commands" / "setup.md")
        self.assertEqual(self.ctx.skills["setup-guide"][0], ROOT / "skills" / "setup" / "SKILL.md")
        self.assertTrue(self.ctx.skills["sweep"][1].startswith("The daily job-hunt run"))

    def test_registers_the_four_hooks(self):
        self.assertEqual(set(self.ctx.hooks), {"pre_tool_call", "post_tool_call", "pre_llm_call", "post_llm_call"})

    def test_unrelated_tools_never_spawn_node(self):
        os.environ["JOB_HUNT_NODE"] = "/nonexistent/node"
        self.assertIsNone(self.ctx.hooks["pre_tool_call"](tool_name="terminal", args={"command": "ls"}, session_id="s"))

    def test_fails_closed_for_browser_and_mail_only_when_node_is_missing(self):
        os.environ["JOB_HUNT_NODE"] = "/nonexistent/node"
        self.assertEqual(self.ctx.hooks["pre_tool_call"](tool_name="browser_click", args={"ref": "@e1"}, session_id="s")["action"], "block")
        self.assertEqual(self.ctx.hooks["pre_tool_call"](tool_name="connectors__gmail__send_email", args={}, session_id="s")["action"], "block")
        self.assertIsNone(self.ctx.hooks["pre_tool_call"](tool_name="mcp__github__list_issues", args={}, session_id="s"))

    def test_connector_send_is_blocked_end_to_end(self):
        r = self.ctx.hooks["pre_tool_call"](tool_name="connectors__gmail__send_email", args={"to": "a@b.c", "body": "hi"}, session_id="s2")
        self.assertEqual(r["action"], "block")
        self.assertIn("drafts", r["message"])

    def test_unfinished_sweep_injects_a_nudge(self):
        self.ctx.hooks["pre_llm_call"](session_id="s3", user_message="/job-hunt:sweep", parent_session_id="")
        self.ctx.hooks["post_llm_call"](session_id="s3")
        self.assertEqual(len(self.ctx.injected), 1)
        self.assertIn("sweep is not finished", self.ctx.injected[0])

    def test_finds_node_in_the_windows_default_location(self):
        mod = load_plugin()
        win = r"C:\Program Files\nodejs\node.exe"
        with mock.patch.object(mod.shutil, "which", return_value=None), \
             mock.patch.object(mod.Path, "exists", lambda self: str(self) == win):
            self.assertEqual(mod._node(), win)


if __name__ == "__main__":
    unittest.main()

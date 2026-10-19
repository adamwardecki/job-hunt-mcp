"""Hermes adapter for the job-hunt plugin.

Registers the plugin's skills, commands (as /job-hunt:<name> slash skills) and agent prompts, and wires
four Hermes hooks to `node hooks/hermes.ts <event>`. All gate logic lives in hooks/gates.ts and is
shared with Claude Code; keep this file thin.
"""
from __future__ import annotations

import glob
import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent
HOOK = ROOT / "hooks" / "hermes.ts"
TIMEOUT_S = 15  # below Hermes' 30 s plugin hook timeout, which fails pre_tool_call closed
GATED_PREFIXES = ("mcp__", "connectors__", "browser_")
# Mirrors main.ts/hermes.ts: if the gate cannot run, block browser and mail/LinkedIn tools, pass the rest.
FAIL_CLOSED = re.compile(r"browser|chrome|playwright|puppeteer|computer|mail|outlook|linkedin", re.I)
NUDGE = "[job-hunt] The sweep is not finished. Continue it; the details are in the [job-hunt] note."


def _description(md: Path) -> str:
    lines = md.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return ""
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line.startswith("description:"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return ""


def _node() -> Optional[str]:
    env = os.environ.get("JOB_HUNT_NODE")
    if env:
        return env
    found = shutil.which("node")
    if found:
        return found
    # GUI-launched Hermes (desktop app) may not inherit the shell PATH.
    candidates = [str(Path.home() / ".volta/bin/node"), "/opt/homebrew/bin/node", "/usr/local/bin/node", r"C:\Program Files\nodejs\node.exe"]
    candidates += sorted(glob.glob(str(Path.home() / ".hermes/tools/node-*/bin/node")), reverse=True)
    return next((c for c in candidates if Path(c).exists()), None)


def _run(event: str, payload: dict) -> Optional[dict]:
    node = _node()
    if not node:
        raise RuntimeError("node not found; set JOB_HUNT_NODE to a Node >= 22.18 binary")
    proc = subprocess.run(
        [node, "--no-warnings", str(HOOK), event],
        input=json.dumps(payload, default=str), capture_output=True, text=True, timeout=TIMEOUT_S,
    )
    if proc.stderr.strip():
        logger.warning("job-hunt %s: %s", event, proc.stderr.strip()[:400])
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip()[:400] or f"exit {proc.returncode}")
    out = proc.stdout.strip()
    return json.loads(out) if out else None


def _register_skills(ctx) -> None:
    skill_dirs = sorted(d for d in (ROOT / "skills").iterdir() if (d / "SKILL.md").is_file())
    commands = sorted((ROOT / "commands").glob("*.md"))
    command_names = {c.stem for c in commands}
    for d in skill_dirs:
        # Claude namespaces commands and skills separately; Hermes has one namespace. On a clash the
        # command keeps the name (users type it) and the skill gets "-guide".
        name = f"{d.name}-guide" if d.name in command_names else d.name
        ctx.register_skill(name, d / "SKILL.md", description=_description(d / "SKILL.md"))
    for c in commands:
        ctx.register_skill(c.stem, c, description=_description(c))
    for a in sorted((ROOT / "agents").glob("*.md")):
        ctx.register_skill(f"agent-{a.stem}", a, description=_description(a))


def register(ctx) -> None:
    _register_skills(ctx)

    def pre_tool_call(tool_name: str = "", args: Any = None, task_id: str = "", session_id: str = "", **_: Any):
        if not str(tool_name).startswith(GATED_PREFIXES):
            return None
        try:
            res = _run("pre_tool_call", {"session_id": session_id or task_id, "tool_name": tool_name, "args": args or {}})
        except Exception as err:  # noqa: BLE001 - any failure means the gate could not decide
            logger.warning("job-hunt pre_tool_call gate failed: %s", err)
            if FAIL_CLOSED.search(str(tool_name)):
                return {"action": "block", "message": f"[job-hunt] The gate could not run ({err}), so this browser or mail action is blocked. Tell the user."}
            return None
        return res if isinstance(res, dict) and res.get("action") == "block" else None

    def post_tool_call(tool_name: str = "", args: Any = None, result: Any = None, task_id: str = "", session_id: str = "", tool_call_id: str = "", **_: Any):
        if not str(tool_name).startswith(GATED_PREFIXES):
            return None
        try:
            _run("post_tool_call", {"session_id": session_id or task_id, "tool_name": tool_name, "args": args or {}, "result": result, "tool_call_id": tool_call_id})
        except Exception as err:  # noqa: BLE001
            logger.warning("job-hunt post_tool_call log failed: %s", err)
        return None

    def pre_llm_call(session_id: str = "", task_id: str = "", user_message: Any = "", parent_session_id: str = "", **_: Any):
        try:
            res = _run("pre_llm_call", {"session_id": session_id or task_id, "user_message": user_message, "parent_session_id": parent_session_id})
        except Exception as err:  # noqa: BLE001
            logger.warning("job-hunt pre_llm_call failed: %s", err)
            return None
        return {"context": res["context"]} if isinstance(res, dict) and res.get("context") else None

    def post_llm_call(session_id: str = "", task_id: str = "", **_: Any):
        try:
            res = _run("post_llm_call", {"session_id": session_id or task_id})
        except Exception as err:  # noqa: BLE001
            logger.warning("job-hunt post_llm_call failed: %s", err)
            return None
        if isinstance(res, dict) and res.get("action") == "continue":
            try:
                if not ctx.inject_message(NUDGE):
                    logger.info("job-hunt: nudge not injected; it will ride on the next user turn")
            except Exception as err:  # noqa: BLE001
                logger.warning("job-hunt inject_message failed: %s", err)
        return None

    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("pre_llm_call", pre_llm_call)
    ctx.register_hook("post_llm_call", post_llm_call)

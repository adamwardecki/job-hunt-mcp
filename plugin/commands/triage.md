---
description: Reconcile and clean a third-party job tracker board (e.g. JobCopilot, Jack & Jill) safely, scoped by column header, with a guard before every delete.
argument-hint: "<source>  (e.g. jobcopilot | jack-and-jill | wellfound)"
---

Triage the tracker board for source `$ARGUMENTS` with the user present.

**If the tracker tools are missing** (search for them first if tools are deferred), or a hook error says `node` could not start: Node.js, which the plugin runs on, is missing or too old. Tell the user that in one sentence, offer to run `/job-tracker:setup` (it installs Node.js), and stop.

Load the `triage-tracker` skill and follow it exactly.

1. Call `start_run` with `kind: "triage"` and the detected capabilities. A browser is required. Without one, stop and say so.
2. Find the board URL from something that has it (the source's recap email, `get_profile`, or the user). Never guess a hostname: a login redirect on a guessed URL is not evidence that the session expired.
3. **Reconcile the Applied column first** (every run): compare each Applied card with the tracker via `find_company`. Anything filed in the user's name that the tracker does not have gets recorded, and any that break hard filters go to the user.
4. Harvest the Saved column, dedupe each card, and turn new plausible ones into `found` leads.
5. Agree the delete criteria with the user once, then delete in rounds. Before every delete round run the guard (`${CLAUDE_PLUGIN_ROOT}/skills/triage-tracker/guard.js` on Claude Code, `${HERMES_SKILL_DIR}/../skills/triage-tracker/guard.js` on Hermes; use whichever path is expanded) with `javascript_tool` (Claude in Chrome) or `browser_console` with `expression` (Hermes); a hook denies the delete without a fresh `JOBHUNT_TRIAGE_GUARD` line showing `ok: true`.
6. After each round, confirm the protected column counts are unchanged. If any changed, stop immediately and tell the user.
7. Call `set_source_status` for the source, then `finish_run` with counts (reconciled, new leads, deleted, protected counts before and after).

Never turn on auto-apply or change account settings on the board.

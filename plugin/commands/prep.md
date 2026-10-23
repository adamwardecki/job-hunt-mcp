---
description: Interview prep for one company, built from the user's own STAR stories and research on the company.
argument-hint: "<company>"
---

Prepare the user for an interview at `$ARGUMENTS`.

**If the tracker tools are missing** (search for them first if tools are deferred), or a hook error says `node` could not start: Node.js, which the plugin runs on, is missing or too old. Tell the user that in one sentence, offer to run `/job-tracker:setup` (it installs Node.js), and stop.

Load the `interview-prep` skill and follow it.

1. Call `find_company` with `$ARGUMENTS`. If there are several matches, ask which one. If there is no role in the tracker, ask for the role or posting link and `upsert_role` it.
2. Call `open_items` to find the interview (stage, time, people, link).
3. Build the prep from the `stories` and `profile` documents, the role's posting and score notes, and research on the company.
4. Output the prep sheet in the chat. Save it with `add_artifact` (`kind: "note"`).

Every claim in the prep must trace to `profile` or `stories`. If a likely question has no honest story behind it, say so to the user privately; do not invent one.

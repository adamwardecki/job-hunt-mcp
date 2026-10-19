---
description: User approval to submit the application for one role in this session. Only the user types this.
argument-hint: "<role-id>"
---

The user typed `/job-hunt:approve $ARGUMENTS`.

A prompt hook (Claude Code `UserPromptSubmit`, Hermes `pre_llm_call`) has already processed this message: it recorded the approval for role `$ARGUMENTS` in this session (valid for 2 hours) and ran `gate_check`, and its result is in your context as a `[job-hunt]` note. You do not record anything yourself and there is no tool that grants approval.

1. Read the `[job-hunt]` note.
   - **gate_check fails** (for example: role not verified, `no_cold_apply`, a live application elsewhere at the company, unknown role id): the submit hook will keep denying the click. Tell the user plainly which check failed and what would fix it, quoting `problems`. Do not submit.
   - **gate_check passed**: say in one line that approval for role `$ARGUMENTS` is noted.
   - **No note at all**: hooks may not be running in this host. Say so, and do not submit.
2. If an apply flow for this role is in progress, continue it at the submit step of the `fill-form` skill: re-read the form values once more (a re-render can clear fields), re-run `find` for the submit button, click it once, then capture the confirmation text, `transition` to `applied` with the text as `evidence`, and `add_artifact` with `kind: "confirmation"`.
3. If no apply flow is in progress for this role, say so and offer to run `/job-hunt:apply $ARGUMENTS`.

The approval covers this one role in this session only. It does not cover consent boxes (`/job-hunt:allow-consent`) or personal-data fields.

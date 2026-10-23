---
description: Turn a user correction or override into a standing rule, and fix the affected role's state.
argument-hint: "[what was wrong, e.g. 'role 42 was not hybrid, apply anyway']"
---

The user is correcting the pipeline: `$ARGUMENTS`

**If the tracker tools are missing** (search for them first if tools are deferred), or a hook error says `node` could not start: Node.js, which the plugin runs on, is missing or too old. Tell the user that in one sentence, offer to run `/job-tracker:setup` (it installs Node.js), and stop.

If the correction is not clear from the arguments and the conversation, ask one question to pin down: which role (if any), what the pipeline did, and what it should have done.

1. **Write the rule.** Generalise the correction into one rule a future run can apply without this conversation. Call `add_rule` with:
   - `text`: the rule, imperative, one or two sentences. Say what to do, and where the line is.
   - `reason`: why, in the user's words where possible, plus what went wrong (e.g. "Dropped on a 3-year-old aggregator industry tag; the employer's page shows no such business").
   - `example`: the concrete case (company, role, the quote involved).
   Check `list_rules` first. If an existing rule conflicts, show both to the user and ask whether to `deactivate_rule` the old one. Keep scope narrow: an override of one case is not a reversal of the whole rule unless the user says so.
2. **Fix the role.** If a role is affected, `record` an event with `actor: "user"`, the corrected `status` (or none for a note), a `reason` that quotes the user, and the evidence. Examples:
   - Wrongly dropped, user wants to apply: `record` with `status: "scored"` and reason "user override: <quote>", then offer `/job-tracker:apply <the real role id>`, written out with the number.
   - Wrongly kept: `record` with `status: "dropped"` and `evidence: "rule:<new rule id>"`.
   - Profile fact wrong (e.g. a technology was scored as a gap but the user has it): also update the `profile` document with `save_document`, adding the fact to the right role's stack line.
3. Reply in two lines: the rule as saved (with its id), and the role's new state.

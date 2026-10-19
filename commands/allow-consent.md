---
description: User permission to tick consent boxes on the application form for one role in this session. Only the user types this.
argument-hint: "<role-id>"
---

The user typed `/job-hunt:allow-consent $ARGUMENTS`.

A prompt hook (Claude Code `UserPromptSubmit`, Hermes `pre_llm_call`) has already processed this message: it records permission to tick consent checkboxes or radios for role `$ARGUMENTS` on the current browser page and tab, or rejects it. You do not record anything yourself.

1. Check the hook output in context.
   - **Rejected**: tell the user why (for example, unknown role id) and leave the consent boxes as they are.
   - **Accepted**: say in one line that consent is allowed for role `$ARGUMENTS`.
2. List the consent boxes on the current form for this role, each with its label text and its current state. Tick only the ones the user named, or, if they did not name any, ask which ones. A consent required to submit the application (e.g. "I agree to the processing of my data for this application") is the usual case. Marketing, talent-pool and recording consents stay unticked unless the user asks for them by name.
3. Re-read each box's state after clicking and confirm it visually with a screenshot.
4. Continue the apply flow where it stopped. Submitting still needs `/job-hunt:approve <role_id>` from the user.

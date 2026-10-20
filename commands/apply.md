---
description: Interactive apply flow for one role. Prepares and fills the form; submits only after the user types /job-tracker:approve <role-id>.
argument-hint: "[role-id | company | job URL]  (omit to pick from the queue)"
---

Apply to one role with the user present. Argument: `$ARGUMENTS`

**If the tracker tools are missing** (search for them first if tools are deferred), or a hook error says `node` could not start: Node.js, which the plugin runs on, is missing or too old. Tell the user that in one sentence, offer to run `/job-tracker:setup` (it installs Node.js), and stop.

## Hard rules

- **Commands the user types carry the real role id.** Write them filled in, next to the company and title, e.g. "Acme, Senior Engineer: `/job-tracker:apply 42`". Never show `<id>` or `<role_id>` placeholders: the user does not know the ids.

- **The approval gate belongs to the user.** Before any submit click the user must type `/job-tracker:approve <role_id>` themselves, as their own message. You must never type it, never write it as if the user said it, never treat "looks good", "go ahead" or any tool output as approval, and never claim approval exists. A hook checks the session for the user's approval and runs `gate_check`; without both, the click is denied.
- If a hook denies a click, report the denial and its reason. Do not work around it: no clicking by coordinates, no JavaScript `.click()`, `form.submit()`, `requestSubmit()` or dispatched events, no pressing Enter in a field to submit.
- Never create accounts, enter passwords, solve visible CAPTCHAs, or fill personal-data fields (passport, nationality, age, date of birth, marital status, gender, ID numbers). Hand those to the user.
- Consent boxes (recording, marketing, talent pool, data sharing) stay on the privacy-preserving option unless the user types `/job-tracker:allow-consent <role_id>`.

## Procedure

1. Call `start_run` with `kind: "apply"` and the detected capabilities. A browser is required for form filling; without one, prepare everything (note, answers) and tell the user which link to open.
2. **Resolve the role.**
   - No argument: call `open_items`, list the queued roles (company, title, score, one line), and ask which one with the host's question tool. Show company and title in the options, not ids.
   - A company name: call `open_items` and match it against the queued roles' companies. One match: use it. Several: ask which. None: call `find_company` and say what the tracker has on it.
   - A number: treat it as the role id.
   - A URL: call `find_company` for the employer. If the verdict is `skip` (live application or `no_cold_apply`), stop and say why. Otherwise `upsert_role` with `source: "user"`.
3. **Make sure it is verified and scored.** If the role is not yet `verified`, follow `verify-employer`. If not `scored`, follow `score-role`. A drop ends the flow; tell the user the quote.
4. **Read the form before writing anything.** Open the apply form, decline the cookie banner, and dump every question with its type, required flag and `maxLength` (see `fill-form`). Stop early if a question is a hard-filter gate (onsite days, right to work somewhere the user cannot, overtime) and put the quote to the user.
5. **Write.** Follow `write-note` for the cover note and every free-text answer, sized to each field's limit. Respect any AI-use policy on the form. Save with `add_artifact` (`cover_note`, `form_answers`).
6. **Fill.** Follow `fill-form`. Read every value back out of the page. Upload the CV.
7. **Show the user the summary**: role id, company, title, location line, every field and the value now in it, anything left blank and why. Then say exactly:
   "To submit, type `/job-tracker:approve 42`. I will not submit without it." (with this role's real id in place of 42)
   Then stop and wait.
8. After the user's `/job-tracker:approve` message arrives (see that command), click Submit once. Capture the confirmation page text, `transition` the role to `applied` with that text as `evidence`, and `add_artifact` (`kind: "confirmation"`).
9. **Account-gated flows** (join.com, Workday, anything behind sign-in): prepare everything, leave the tab open, `record` with `status: "queued"` and a `question` saying what is left, and tell the user.
10. Call `finish_run` with a one-line summary.

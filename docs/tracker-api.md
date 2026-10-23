# Tracker MCP: tool reference

The tracker is the only writer to the job-hunt database. Skills, commands and agents read and write
state through these tools only. There is no raw SQL tool.

Server name in `.mcp.json`: `tracker`. The tools appear as `mcp__plugin_j-hunt_tracker__<tool>` in
Claude Code and as `mcp__job_hunt_tracker__<tool>` in Hermes. Skills refer to them by the short tool name.

Runtime: Node 22.18+ (`node:sqlite`, TypeScript run directly), zero runtime npm dependencies. Local only:
`.mcp.json` starts `node servers/tracker/src/index.ts` over stdio. The MCP server has no network listener
and no token; the optional board (see [Board](#board)) listens on `127.0.0.1` with a per-start token and
stops after 30 idle minutes. Access is the OS user's permissions on `$JOB_HUNT_HOME` (default
`~/.job-hunt/`, created `0700`; the database and session files are `0600`). Tightening is best effort: on
a filesystem that cannot chmod, a warning is logged and the tracker still starts. Data never lives in the
plugin directory.

The schema is versioned with `PRAGMA user_version` and migrated on open, under the write lock. A database
written by a newer plugin is refused rather than downgraded, including on read-only opens. Writers wait
up to 5 s for another session's lock, and write transactions take the lock up front (`BEGIN IMMEDIATE`),
so concurrent first opens and migrations are safe.

**Days and runs.** Timestamps are stored in UTC. A `date` argument (`YYYY-MM-DD`) means that local day in
`filters.timezone` (UTC if unset). `render_report`, `audit` and `list_artifacts` also take `run_id`. It
wins over `date`, and the result covers the run's own events and artifacts plus untagged ones written
while it ran. Interview `starts_at` is stored in UTC. A time without an offset is read in `tz` (or
`filters.timezone`), and the report shows interview times in local time.

## Status machine

```
found → verified → scored → queued → applied → interviewing → offer
  ↘        ↘         ↘        ↘
   dropped (from found | verified | scored | queued)
closed (from queued | applied | interviewing | offer), with outcome: rejected | withdrawn | role_closed
```

- Every event needs a `reason`.
- `dropped` needs `evidence`: a verbatim employer quote, a URL plus quote, or `rule:<id>`.
- `verified` needs `evidence` (the employer ATS URL and the verbatim location line) and
  `location_line` + `location_type`. It is the only way `roles.verified_at` gets set.
- `applied` needs `evidence` containing the captured confirmation text. The one exception is a move the
  user makes on the board (below): it is their own report, recorded without it. `transition` and `record`
  can never skip it, whatever `actor` says.
- `closed` needs `outcome`.

## Tools

| Tool | Args | Returns |
|---|---|---|
| `setup_status` | — | Checklist: each item `{key, state: green|amber|red, detail, decision?}`, plus `all_green` and `db_path`. Call at the start of every run. |
| `record_setup_decision` | `key`, `decision` | Records the user's decision on an amber item (e.g. "no browser, accepted"); setup can then complete. |
| `start_run` | `kind` (`sweep`\|`apply`\|`triage`\|`setup`\|`calibration`), `capabilities` `{connectors:{gmail,calendar,linkedin,drive,...}, browser: "claude-in-chrome"\|"built-in"\|null, local_folder: bool}` | `{run_id}`. Also stores capabilities in profile. |
| `finish_run` | `run_id`, `summary` | ok |
| `get_profile` | — | All config sections (filters, prefs, writing, accounts, autonomy, schedule, capabilities) |
| `save_config` | `section`, `data` | Validated against the schema; errors list bad fields |
| `get_document` / `save_document` | `name` (`profile`\|`stories`\|`reusable-answers`\|`voice`), `content` | User-owned markdown documents |
| `find_company` | `name?`, `domain?`, `url?` | Fuzzy match on name, aliases, domain and ATS slug. `{matches:[{company, score, certain, roles:[{id,title,status,url}]}], live_application, no_cold_apply, verdict: "new"\|"seen"\|"skip", why}`. **This is the dedupe check.** |
| `set_no_cold_apply` | `company_id`, `on?`, `reason` | Mark (or clear) a company with an open intro or recruiter process. |
| `add_alias` | `company_id`, `alias` | Add a brand, former name or parent so dedupe catches it. |
| `upsert_role` | `{id?, company, company_aliases?, company_domain?, title, url, ats?, location_line?, location_type?, comp_min?, comp_max?, comp_currency?, comp_period?, equity?, stack?, industry?, source, posted_at?}` | `{role, company, created, dedupe}`. New roles get a `found` event. Matching url or company+title updates instead of duplicating. |
| `transition` | `role_id`, `to`, `reason`, `evidence?`, `outcome?`, `category?` (drops), `question?` + `blocked_by?` (queued), `location_line?`, `location_type?`, `score?`, `score_notes?`, `run_id?` | Enforces the machine above. |
| `get_role` | `role_id` | Role, company, full event history, artifacts, interviews. |
| `record` | `role_id`, `status?`, `reason`, `evidence?`, `outcome?`, `category?`, `question?`, `blocked_by?`, `actor` (`user`\|`employer`\|`pipeline`), `run_id?` | Appends a validated event without the machine check. For outcomes that arrive from outside (rejection, invite, user decision) and for notes (`status` omitted = note). A `question` on the latest event shows under Needs you. |
| `check_pay` | `comp_min?`, `comp_max`, `currency`, `period` (`year`\|`month`\|`day`\|`hour`), `fx_rate?` (units of floor currency per 1 unit of `currency`), `equity?` | `{verdict: "keep"\|"straddles"\|"drop"\|"unknown", reason}`. Drop only if the band max is below the floor. |
| `gate_check` | `role_id` | `{ok, role_id, company, title, url, verified, dedupe_clean, no_cold_apply, live_elsewhere, problems[]}`. Hooks call this before a submit click and bind approval to `url`. |
| `add_artifact` | `role_id`, `kind` (`cover_note`\|`cover_letter_pdf`\|`gmail_draft`\|`form_answers`\|`confirmation`\|`note`), `ref`, `content?` | `{artifact_id}`. Prose kinds are linted; issues are returned. `gmail_draft` starts unverified. |
| `list_artifacts` | `run_id?`, `date?`, `role_id?`, `kind?` | Artifacts with lint results and read-back state (the auditor uses this). |
| `verify_artifact` | `artifact_id`, `readback` (the text returned by `get_draft`/`list_drafts`) | Marks verified. The tracker checks the draft id is in the read-back; a hook checks a real `get_draft`/`list_drafts` result in the session contains it. |
| `lint_prose` | `text`, `max_words?` | `{ok, issues:[{kind, match, hint}]}`: em/en dashes, "not X but Y", fake-candid openers, volunteered gaps, word count. |
| `open_items` | `stale_after_days?` (14) | Fresh queue, stale queue, questions on non-queued roles, unverified drafts, interviews to book, upcoming interviews |
| `add_rule` / `list_rules` / `deactivate_rule` | `text`, `reason`, `example?` / — / `id` | Rules with provenance |
| `source_health` / `set_source_status` | — / `name`, `status` (`ok`\|`degraded`\|`failed`\|`disabled`), `found?`, `applied?`, `error?` | Per-source health; N consecutive failures flips to `degraded` |
| `add_interview` | `role_id`, `stage`, `starts_at?` (ISO with offset, or a wall time read in `tz`), `tz?` (IANA), `people?`, `link?`, `booked_by?`, `notes?` | Also records an `interviewing` event if needed |
| `render_report` | `date` (YYYY-MM-DD, local day), `run_id?` (preferred: that run only), `headline?` | Markdown daily report (spec §9). Only verified drafts and confirmed submissions are claimed. Missing capabilities and what was queued because of them are listed. Interview times are shown in local time. |
| `audit` | `run_id?` or `date?` (one is required) | Post-run rule check: excluded industries touched, drops without evidence, applied without confirmation, prose lint failures in artifacts, unverified drafts. `{ok, failures[]}` |
| `pipeline_summary` | `stale_after_days?` (14) | Counts by status, live processes (interviewing, offer), awaiting reply, rejections, fresh and stale queue |
| `open_board` | `open?` (bool, default false: also open the default browser) | `{reused, opened, url?}`. With `open: true` and the browser opened, no `url`: the token stays out of the model's context. Otherwise `url`, and the text result is `Board: <url>`. Starts the local board for this database, or reuses the running one. See [Board](#board). |
| `import_legacy` | `applied_log?` (markdown), `preferences?` (markdown), `queue?` (`[{filename, content}]`), `documents?` (`{profile, stories, reusable-answers}`), `path?` (local only: a `pipeline/` folder) | Import counts and unparsed rows |

## Board

`open_board` starts `node servers/tracker/src/board.ts --db <same database>` as a detached process. It
reuses the board named in `board.json` next to the database while that process is alive and answers
`GET /api/health` with the board's token. It refuses an in-memory tracker. The board:

- listens on `127.0.0.1` only, on a port the OS picks, with a new 256-bit token per start. The token is
  in the link's fragment (`#t=`), so it is never sent in a request line, and every API call sends it as
  `Authorization: Bearer <token>`.
- rejects any `Host` other than `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), sends no CORS
  headers, and accepts only `application/json` posts up to 64 KB.
- stops after 30 minutes without an authenticated API call and removes `board.json`.
- moves roles with `transition`, recorded with `actor: user`. Moves to `verified` and `scored` are
  refused: they need the verify-employer and score-role skills.
- accepts changes (`POST`) only from its own page: the browser's `Origin` must be the board's and
  `Sec-Fetch-Site`, when sent, `same-origin`. A script holding the token gets 403. With `open: true`,
  `open_board` gives the link to the browser and not to the model, and the `PreToolUse` hook stops
  browser tools from opening the board or acting on its page in any session.
- records `applied` without confirmation text: the user is the authority on their own application.
  `render_report` lists these as "Marked applied by you on the board" so one the user didn't make stands
  out, and `audit` does not count them as `applied_without_confirmation`.
- shows the columns from `scored` on, with `dropped` and `closed` folded; `found` and `verified` roles
  are counted in the header. A drop on `queued`, `applied`, `interviewing` or `offer` moves at
  once; `dropped` and `closed` ask for their evidence or outcome first.

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/health` | none | `{ok: true}` |
| `GET /api/board` | none | `{statuses, roles, moves, rules}`: roles with company, score, location type, URL, last event time and blocking question; allowed drag targets per status; active rules for drops |
| `POST /api/move` | `{role_id, to, reason?, evidence?, outcome?}` | `{role, from, to}`, or 400 with the status machine's message. Without a reason the event says "Moved on the board" |
| `POST /api/note` | `{role_id, reason}` | `{role}`: the user's own reason for a move, recorded as a note (no status change) |

## Session approvals (hooks, not tools)

Approvals come only from a standalone command in the user's own prompt, never from a command mention
or tool call. The `UserPromptSubmit` hook recognises `/j-hunt:approve <role_id>` (or `/approve
<role_id>`) and stores a one-use approval for that role, browser page and tab in the session state at
`$JOB_HUNT_HOME/sessions/<session_id>.json`. The submit-click hook requires an exact target match and
consumes the approval before allowing the attempt. Similarly `/j-hunt:allow-consent <role_id>` lets
consent boxes be ticked only on that role's current page and tab.

## Triage guard (hooks)

Before any delete on a tracker board, run `skills/triage-tracker/guard.js` with `javascript_tool`
(replace the INPUT placeholder on its last line). It prints `JOBHUNT_TRIAGE_GUARD {json} JOBHUNT_END`.
The delete hook requires the latest guard output to show `ok: true` (selection exactly equals the
intended list, every protected column has 0 checked, counts match `expectedCounts`), no more than
about 40 tool calls old, with only the delete control and its confirm button clicked since.

---
name: source-roles
description: Per-source adapters for finding new job leads (LinkedIn MCP, employer ATS boards, YC Work at a Startup, Wellfound, HN Who is hiring, Welcome to the Jungle, Jack & Jill, JobCopilot). Use when a sweep or sourcer agent needs to pull leads from a source, when choosing which sources to run given the available capabilities, or when a source starts failing.
---

# Source roles

A source produces **leads**. A lead is never a verdict: every tag on it (location, salary, industry, seniority, remote) is unverified until `verify-employer` quotes the employer's own page.

## Hard rules

- **Mark every aggregator field UNVERIFIED.** Pass location and comp tags through as `raw_location` / `raw_comp`, never into `location_line` or `comp_*`. Why: wrong drops happened on stale tags (a years-old industry tag, a "UK only" that wasn't), and wrong approvals on "Remote" tags the ATS contradicted.
- **Dedupe before upsert.** Call `find_company` (name plus domain when known) for every lead. `skip` (live application or `no_cold_apply`) means do not upsert a new role; `seen` means update only if it is a different req.
- **Capability-aware.** Skip browser sources when no browser is reachable, and say so in the report ("skipped: no browser"). Do not mark the source `failed` for that: only real errors from the source count towards degradation.
- **Retry limits.** A failing call is retried at most twice, then the source is recorded with `set_source_status(name, "failed", error: <verbatim error>)` and the run moves on. Never loop.
- **Never guess a URL.** Take board and tracker URLs from config, the user, or an email that contains them. A login redirect on a guessed URL is not evidence the session expired.
- **Never print secrets.** Some sources embed API keys in request URLs (e.g. the YC index). Do not echo those URLs into output or the tracker.
- **Read-only.** No saving, liking, following, messaging, applying or changing preferences on any source. If a source's account settings would improve yield, tell the user and let them change it.
- **One pass where one pass is enough.** Some boards return the same list for every keyword (see the table). Do not burn the run on repeat queries.

## Choosing today's sources

1. Read enabled sources from `source_health` (status `ok` or `degraded`; skip `disabled`).
2. Drop browser-mode sources if `start_run` capabilities have `browser: null`. List them in the report as skipped.
3. A `degraded` source runs once more per day only if it is cheap; the report mentions degradation once, not every day.
4. Use `last_run` from `source_health` to fetch only what is new since the last run where the source supports it.

## Source catalogue

| Source | Mode | Reliability and quirks | Retry limit |
|---|---|---|---|
| LinkedIn job search (MCP) | connector | Keyword relevance is poor; recruiter-farm spam repeats. Tags are leads only. A jobs-search error is not proof of logout: check the LinkedIn inbox call before reporting it unavailable. | 2 |
| Employer ATS boards (Ashby, Greenhouse, Lever posting APIs) | fetch | Most reliable source of truth. Also the verification target for every other source. | 2 per board |
| YC Work at a Startup | browser (logged in) or index | Infinite scroll resists automation: query the page's own search index instead (see reference). A saved "US visa not required" chip can silently re-apply on navigation and zero the results; remove it if counts drop to zero. | 2 |
| Wellfound | browser (logged in) | Hides roles unavailable to the user's location, so the pool is small and every keyword returns the same list. One keyword pass. | 1 |
| HN "Who is hiring" | fetch (Algolia API) | Monthly thread. Only read comments newer than `last_run`. | 2 |
| Welcome to the Jungle | browser (logged in) | Matcher ignores remote preference unless a location is set in the user's profile; tell the user once. Cards only render while the tab is painted. | 1 |
| Jack & Jill | browser + email | Intro broker. "Jack's take" may describe the recruiter's client, not the employer; salary figures are often its own estimates; cards often have no location. Open intros mean `no_cold_apply`. | 1 |
| WWR JobCopilot | browser | **Save-only.** Never enable auto-apply. Reconcile its Applied column every run via `triage-tracker`. | 1 |
| justjoin.it, nofluffjobs, RemoteOK, Remotive | n/a | Retired by default: low yield, stale feeds, or blocked. Enable only if the user asks. | n/a |

Per-source recipes (endpoints, selectors, index queries) are in `reference.md` next to this file. Read the relevant section before running a source.

## Lead format

Return one line per lead, and upsert it as `found`:

```
company | title | url | source | raw_location (UNVERIFIED) | raw_comp (UNVERIFIED) | dedupe verdict
```

`upsert_role` fields: `company`, `company_domain` if known, `title`, `url` (prefer the employer ATS link over the aggregator link when the card has one), `ats` if obvious from the URL, `source`, `posted_at` if given. Do **not** set `location_line`, `location_type` or `comp_*` from aggregator data. Put the raw tags in the reason of the `found` event if useful.

## Early drops at source

Only these can be dropped without opening the employer page, and only with the lead's own text quoted as evidence:
- The title itself contains an excluded shape (e.g. "Backend Engineer", "Forward Deployed Engineer", "Engineering Manager") and the user's filters exclude it.
- An offshore staffing tell in the title: a country suffix like `(PK)`, `(IN)`, `(PHL)`, or a bracketed req code like `[AB123]`, for a country the user cannot work from.
- AI-training, data-labelling or expert-network review gigs, if the user's rules exclude them.

Everything else goes to `verify-employer`.

## After the source

- `set_source_status(name, "ok", found: <count>)` on success.
- If every lead was already in the tracker, report "caught up" for that source. Do not widen queries to make up numbers.

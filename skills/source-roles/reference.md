# Source recipes

Read the section for the source you are running. Endpoints and page structures change; if a recipe fails twice, record the verbatim error with `set_source_status` and stop.

Build queries from `prefs.titles`, `prefs.stack_want` and `filters.work_mode`. Keep them few and specific.

## LinkedIn job search (MCP connector)

- Use the connector's job search tool with 2 to 4 title queries, remote filter, posted in the last 24 hours (or since `last_run`).
- Expect recruiter farms posting the same title under many company pages. Collapse near-duplicates before dedupe.
- External apply links are often wrapped. Resolve them with `new URL(href).searchParams.get('url')` when reading in a browser, and prefer the employer ATS URL for `url`.
- A search error (e.g. HTTP response failure) while the inbox call works means the search endpoint is failing, not that the user is logged out. Report it as a connector error.
- Read-only: never message, connect, follow or Easy Apply from a sweep.

## Employer ATS boards (fetch)

Public posting APIs, no login. Use them to list a known employer's openings and as the verification source. The boards to sweep are the URLs in `sources.boards`; read the board token or company slug from each URL.

- **Ashby**: `GET https://api.ashbyhq.com/posting-api/job-board/<board>?includeCompensation=true`. Each job has `title`, `location`, `secondaryLocations`, `workplaceType` / `isRemote`, `jobUrl`, `applyUrl`, and compensation when published. The HTML board also shows "Open Positions (N)".
- **Greenhouse**: `GET https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true`. Single job with screening questions: `.../jobs/<id>?questions=true`. A board that answers "no longer active" is dead; aggregators may keep circulating its listings.
- **Lever**: `GET https://api.lever.co/v0/postings/<company>?mode=json` (EU-hosted boards: `api.eu.lever.co`). Fields: `categories.location`, `workplaceType`, `salaryRange`, `hostedUrl`.
- **Workable, Teamtailor, Personio, join.com**: no stable public API assumed. Fetch the posting HTML and read the location and workplace lines.

Funnel tell: a board with a four-figure open-position count at a company of a few hundred people, or the same title repeated once per country, means the req is probably not a real seat. Note the count in the lead.

## YC Work at a Startup

Start URL: `https://www.workatastartup.com/jobs`. Logged out it shows a small subset; the logged-in view is the useful one.

- Do not try to scroll the infinite list. JS scrolling does not advance it.
- Instead capture the page's own search-index request (patch `window.fetch` / XHR in the page, then trigger a search) and replay it in the page with a large `hitsPerPage`, `distinct=false` and all attributes. Hits include locations, a US-visa-required field, engineering type and the full description.
- **Never print the captured request URL or headers.** They carry an API key.
- If results drop to zero after navigation, a saved filter chip (e.g. "US visa not required") may have been re-applied. Remove it and re-run.

## Wellfound

- Start URL: `https://wellfound.com/jobs`.
- Logged-in feed only. It already hides roles closed to the user's location, so the pool is small.
- One keyword pass per run. More keywords return the same cards.
- Expect many under-floor or US-gated cards; they still go through `verify-employer` unless an early drop applies.

## HN "Who is hiring" (Algolia API)

1. Find the current month's thread: `GET https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5` and pick the story titled "Ask HN: Who is hiring? (<Month> <Year>)".
2. Fetch only new top-level comments: `GET https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_<id>&numericFilters=created_at_i><last_run epoch>&hitsPerPage=1000`. Keep comments whose `parent_id` equals the story id.
3. Filter in text for the user's work mode and region words (e.g. "REMOTE", "Europe", "EU", "worldwide") and title words. The first line usually reads `Company | Role | Location | Type | URL`.
4. HN posts are the employer's own words, but they can disagree with the employer's ATS. When they do, `verify-employer` flags it with both quotes.

## Welcome to the Jungle

- Start URL: `https://www.welcometothejungle.com/en/jobs-matches`. Logged in, `?page=N` (10 per page).
- The matcher ignores the remote preference unless the user's profile has a location set. If the feed is mostly onsite or another continent, tell the user once (account settings are theirs to change).
- Cards only mount while the tab is painted. Keep the tab in front; a screenshot forces a render. The page can freeze the renderer every few pages; accept a partial sweep and record how far you got.
- Keep only cards whose own label says fully remote (or matches the user's work mode), then verify each on the employer page.

## Jack & Jill

- Two inputs: the agent's pick emails in Gmail (search by the sender of the most recent pick email) and the logged-in dashboard kanban at `https://app.jackandjill.ai/jack/dashboard/home`.
- On each card, take the "View job post" link (`[...document.querySelectorAll('a')].filter(a => /view job post/i.test(a.innerText))`) and open the employer's ATS. Read the location line and the About block first.
- The card's summary can describe the recruiter's client while the posting belongs to a recruiting agency. The employer is whoever the ATS says.
- Salary on the card is often the broker's estimate (small print says so). Never use it for a pay verdict.
- Cards in an intro or "in process" state: the company is `no_cold_apply` (see `inbox-and-calendar` for how to record it).

## WWR JobCopilot

- **Save-only.** Never enable auto-apply, never change the copilot's settings.
- The tracker URL comes from the daily recap email's "View Job Applications" link. Do not guess the hostname.
- Sweeping it means reconciling the Applied column and harvesting Saved cards. Both are done by the `triage-tracker` skill, interactively.

## Retired by default

- **justjoin.it**: heavy virtualised list that often renders zero cards in automation. Its Apply button opens the employer's ATS in a new tab (popups may be blocked silently).
- **nofluffjobs**: blocked by a CDN error in past runs.
- **RemoteOK**: feed went weeks stale.
- **Remotive**: public API mostly recruiter spam.

Enable any of these only at the user's request, and retire again after two empty runs.

# Privacy policy

Effective 20 October 2026. This policy covers the Job Tracker plugin for Claude Code, Claude Desktop and
Hermes Agent, and its website, [jobhuntmcp.com](https://jobhuntmcp.com/). The website shows the same
text at [jobhuntmcp.com/privacy.html](https://jobhuntmcp.com/privacy.html).

Job Tracker is open-source software maintained by Adam Wardecki ("we"). We do not run a server for it.
We do not collect, receive, store or sell any of your data, and the plugin contains no telemetry,
analytics or crash reporting.

## What the plugin stores on your computer

The plugin keeps its data in a folder on your computer: `~/.job-hunt`, or the folder set in
`JOB_HUNT_HOME`. It never stores data inside the plugin's own folder.

- **The tracker database** (`tracker.db`): your profile and CV summary, hard filters and preferences
  (including your pay floor), stories, reusable answers and writing rules; the companies and roles you
  look at, with quotes from their postings and the reason for each status change; drafts and cover notes;
  application confirmations; interview details (time, stage, interviewer names, links, notes); source
  health; and a log of each run.
- **Session files** (`sessions/`): small files that record what you approved in each session (for
  example a `/job-tracker:approve`) so the safety hooks can check it. On Hermes Agent, a session file also
  keeps a copy of each tool call and its result, because Hermes does not give hooks a transcript; that
  copy can include email or page text the model read.
- **Files you ask for**, such as a cover letter PDF, saved where you or your Claude or Hermes app put them.

The folder is created readable only by your user account (`0700`), and the database and session files
are `0600`. On a filesystem that does not support these permissions, the tracker logs a warning and
still starts.

The tracker is a local server that talks to Claude or Hermes over stdio. It has no network listener and
no account.

## What leaves your computer

Local storage does not mean nothing leaves your computer. The plugin uses the AI app and the connectors
you choose, and each one handles data under its own policy:

- **Your AI provider.** Anything the model reads or writes in a session (your profile, job postings,
  emails it classifies, drafts) is sent to the provider behind your app: Anthropic for Claude Code and
  Claude Desktop, or whichever provider you configured in Hermes Agent.
- **Gmail and Google Calendar**, if you connect them: the plugin reads recruiter mail and calendar
  events, and creates reply drafts in your mailbox. It never sends email; a hook blocks every send tool.
- **LinkedIn**, if you connect a LinkedIn server: read-only use (job search and inbox). Message and
  connection tools are blocked.
- **Your browser**, if you connect one: the plugin visits job boards and employer pages and fills
  application forms. An application is submitted only after you type `/job-tracker:approve` for that
  role. What you submit goes to the employer and its applicant tracking system, under their privacy
  policy. The plugin never fills passport, nationality, age, date of birth, gender, marital status or ID
  number fields, and leaves consent boxes unticked unless you allow them.
- **Third-party job trackers** you ask it to tidy (for example JobCopilot), through your browser.

The plugin's own code makes one kind of network request: if Node.js is missing, setup can install it.
On macOS this downloads the installer from nodejs.org; on Windows it uses winget, or nodejs.org when
winget is not available. These requests contain no personal data beyond what any download sends (such
as your IP address).

## Your choices and deleting data

- Every connector is optional. Without a browser, the daily run still works and queues browser work for
  later.
- Your data stays until you delete it. The plugin does not delete old records or session files on its
  own.
- To delete everything the plugin stored, delete the `~/.job-hunt` folder. Uninstalling the plugin does
  not delete it.
- Drafts in Gmail, events in your calendar, and conversation history in your AI app are kept by those
  services. Delete them there.

## The website

[jobhuntmcp.com](https://jobhuntmcp.com/) is a static site hosted on GitHub Pages. It sets no cookies
and uses no analytics, trackers or third-party scripts, and its fonts are served from the same site. The
copy buttons write to your clipboard in your browser only. GitHub, as the host, may log visitors' IP
addresses for security; see the
[GitHub privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Changes and contact

If this policy changes, the new version is published here with a new effective date, and the history is
in the [repository](https://github.com/adamwardecki/job-hunt-mcp/commits/main/PRIVACY.md).

Questions: open an [issue](https://github.com/adamwardecki/job-hunt-mcp/issues). Issues are public, so
do not include personal data in them.

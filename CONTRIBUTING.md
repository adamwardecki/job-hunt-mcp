# Contributing

Thanks for helping. This is a small project, so the process is light.

## Before you start

- For anything bigger than a fix, open an issue first so we can agree on the shape.
- Read the hard rules in the [README](README.md#what-it-will-never-do). Changes that weaken a gate
  (sending, submitting without approval, consent, personal data, guarded deletes) will not be merged.
- **Never commit personal data.** No real CVs, application logs, recruiter emails, company names from
  your own search, or tracker databases. Test fixtures use made-up companies.

## Setup

Node 22.18 or newer and Python 3 (for the Hermes plugin tests).

```
npm run setup   # installs TypeScript, the Node types and Biome into dev/
npm test
```

`npm test` type-checks with `tsc`, then runs the Node and Python tests. The triage guard tests need
Google Chrome and the Windows installer tests need PowerShell (`pwsh`); each is skipped without it.

## Conventions

- **TypeScript that Node runs directly.** No build step and no runtime dependencies. Keep it that way:
  the plugin must work from a plain checkout.
- **Dev tools live in `dev/`.** Never add a lockfile next to the root `package.json`: Claude Code installs
  whatever a lockfile in the plugin root lists, on every user's install and update.
- **Tracker tools.** Input schemas live in `servers/tracker/src/tools.ts`. If you change a tool's
  schema, update the snapshot in `servers/tracker/test/fixtures/tools-list.json` and
  [`docs/tracker-api.md`](docs/tracker-api.md).
- **Skills and commands** explain the reason for each rule ("Why: ..."). Keep that when you edit them;
  the reasons are what stop a later edit from undoing a lesson.
- **Versions.** `plugin.yaml`, `.claude-plugin/plugin.json` and `package.json` carry the same version; a
  test checks it.
- **Hermes.** Changes to hooks or skill wiring should keep both hosts working. See
  [`docs/hermes.md`](docs/hermes.md).

## Source adapters

Job sites change often. When a source breaks, the most useful report is the source name, what you ran,
and what the page or API returned. A fix usually belongs in `skills/source-roles/`.

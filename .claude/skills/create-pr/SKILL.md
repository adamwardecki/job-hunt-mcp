---
name: create-pr
description: Create a GitHub PR from current changes using gh CLI. Use this when the user says "create a PR", "open a pull request", "make a PR", "hand over the work", or wants to submit their branch for review. Also use as the final handover step after completing any coding task in this repo.
---

# Create PR — with local CI preflight

**Goal: the PR's GitHub checks are a formality.** Before opening the PR, run the same checks CI will run, locally, and fix what fails. Never open a PR you expect to go red.

`main` requires five checks from `.github/workflows/ci.yml`: `lint` and `test` on Ubuntu and macOS with Node 22.18 and 24.x. That workflow is the source of truth; if it changes, update this skill in the same PR.

## Step 1 — Run the preflight

```bash
npm run setup                              # only if dev/node_modules is missing or dev/package-lock.json changed
npm test                                   # tsc typecheck + Node tests + Python Hermes tests (the `test` jobs)
npm --prefix dev exec --no -- biome ci .   # exactly what the `lint` job runs; stricter than `npm run lint`
git diff --check origin/main...            # whitespace errors
```

Never `npm install` or `npm ci` in the repo root. Why: a root lockfile makes Claude Code install its packages for every user, and a test fails if one appears.

**Every failure is yours to fix before opening the PR.** Do not skip a failing test, do not use `--no-verify`, do not open the PR "to see if it fails on CI too".

## Step 2 — Checks that depend on what changed

Look at `git diff --stat origin/main...` (plus uncommitted work) and run whatever applies:

- **Tool name, description or schema** (`plugin/servers/tracker/src/tools.ts`): `tests/tracker/fixtures/tools-list.json` and `docs/tracker-api.md` are updated in the same PR. Why: clients cache `tools/list`.
- **Plugin manifest, skills, commands, agents or hooks**: `claude plugin validate --strict ./plugin` and `claude plugin validate --strict .` (the marketplace) pass.
- **Hooks or skill wiring**: the matching change is in `plugin/hooks/hermes.ts` / `plugin/__init__.py`, with a test on both sides (Hermes parity).
- **Schema** (`db.ts`): a new function appended to `MIGRATIONS`, no shipped migration edited, and a test in `db.test.ts` that migrates an older database.
- **Version bump**: `package.json`, `plugin/package.json`, `plugin/plugin.yaml`, `plugin/.claude-plugin/plugin.json`, `SERVER_INFO.version` in `mcp.ts` and `plugin/servers/tracker/package.json` all match.
- **Wording in skills, commands or agents**: `tests/runtime-docs.test.ts` asserts exact sentences; `npm test` covers it, but read the failure before rewording the test.
- **Node APIs**: CI runs Node 22.18, the floor. If your local Node is newer (`node --version`) and the change uses a Node API, check it exists in 22.18.

**Suites that skip locally.** The triage guard tests need Google Chrome and the installer tests need `pwsh`; each skips without it, but CI runs them. If the change touches `plugin/skills/triage-tracker/` or `plugin/scripts/install-node.*` and the tool is missing here, say so in the PR description and watch those jobs closely.

**Gates.** If the diff touches send, submit, consent, personal-data or delete gates, or a matcher in `plugin/hooks/hooks.json`, stop and confirm with the user before opening the PR (AGENTS.md: ask first).

**Personal data.** The repo is public. Scan the diff for real CVs, company names from the user's own search, recruiter mail, `.db` files or secrets. Fixtures use made-up companies and people.

## Step 3 — Commit, push, open the PR

Using GitHub CLI only.

1. Run `git config user.email`. It must be a GitHub noreply address (`1017097+adamwardecki@users.noreply.github.com` for the maintainer). If not, stop and ask. Never pass `--author`, `-c user.email` or `GIT_AUTHOR_EMAIL`.
2. If the current branch is `main`, create a new branch first; otherwise commit to the current branch.
3. Commit subjects are plain imperative sentences in sentence case, no conventional-commit prefix (`Show the plugin as "Job Hunt" in listings`). Match `git log --oneline`.
4. Push, then:

```bash
gh pr create --base main --title "..." --body-file <file>
```

Open it ready for review, never as a draft (no `--draft`). If something must be resolved before merging, call it out in bold in the body instead.

**Title.** The repo squash-merges, so the PR title becomes the commit subject on `main` (`<title> (#N)`). Write it the same way as a commit subject.

**Body.** Friendly, readable, concise: everything a reviewer needs to evaluate the PR, in the style of recent PRs (`gh pr view <n>`):

- One short paragraph: what changes and why.
- Bullets for the individual changes when there is more than one.
- A **Validation** section listing each check that ran with its result (for `npm test`, the typecheck plus Node pass/skip counts and Python counts), plus anything skipped and why.
- Anything the reviewer must decide or resolve, called out in bold.

No personal data in the title or body.

## Step 4 — Watch CI

```bash
gh pr checks <number> --watch
```

Stay engaged until every required check is green. If something goes red that the preflight missed, fix it, push, and add the missing check to Step 2 of this skill so the preflight catches it next time.

If the branch falls behind `main` or conflicts, rebase onto `origin/main` and `git push --force-with-lease`; do not merge `main` into the branch. Do not merge the PR unless the user asks.

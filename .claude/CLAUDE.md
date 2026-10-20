@../AGENTS.md

## Claude Code

- This file lives in `.claude/` because a `CLAUDE.md` in the plugin root fails
  `claude plugin validate --strict`.
- This repo is itself a plugin. Edits here do not change the installed `job-tracker` plugin you may have
  loaded in this session; do not call its `mcp__plugin_job-tracker_tracker__*` tools to test changes. Use
  `npm test` or `npm run tracker -- --db <scratch path>` instead.

@AGENTS.md

## Claude Code

- Project plugins are enabled in `.claude/settings.json` (`superpowers`, `security-guidance`). Use their
  skills where they apply: test-driven development for fixes, verification before claiming done.
- This repo is itself a plugin. Edits here do not change the installed `job-hunt` plugin you may have
  loaded in this session; do not call its `mcp__plugin_job-hunt_tracker__*` tools to test changes. Use
  `npm test` or `npm run tracker -- --db <scratch path>` instead.

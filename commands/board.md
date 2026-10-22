---
description: Open the job-hunt kanban board in your browser. Drag cards to move roles.
---

Open the user's job-hunt board.

**If the tracker tools are missing** (search for them first if tools are deferred), or a hook error says `node` could not start: Node.js, which the plugin runs on, is missing or too old. Tell the user that in one sentence, offer to run `/j-hunt:setup` (it installs Node.js), and stop.

1. Call `open_board` with `open: true`. Why: the user typed this command, so a browser window is expected; scheduled runs never pass `open`.
2. Reply with one line: the board link. If the result says the browser did not open, say so and ask the user to open the link.

The link works until the board has been idle for 30 minutes; after that, `/j-hunt:board` starts a new one with a new link. Moves on the board are recorded as the user's own and follow the same evidence rules as `transition`. Do not change any state yourself. Why: board moves are recorded as the user's; a change made by you would be recorded as the pipeline's and blur who decided.

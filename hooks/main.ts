#!/usr/bin/env node

// Hook entry point: node hooks/main.ts pre-tool | prompt | stop
// Reads the hook payload on stdin and answers in Claude Code's hook JSON format.

import { errorText, oneOf } from '../servers/tracker/src/util.ts';
import { HOOK_EVENTS, handlers } from './gates.ts';
import { isBrowser, isSendTool, splitToolName } from './lib/classify.ts';
import type { HookPayload } from './lib/types.ts';

const event = process.argv[2];
let payload: HookPayload = {};
try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  payload = JSON.parse(raw || '{}') as HookPayload; // Claude Code's hook input.
  if (!oneOf(HOOK_EVENTS, event)) throw new Error(`unknown event "${event}"`);
  await handlers[event](payload);
} catch (err) {
  process.stderr.write(`[job-hunt hook] ${errorText(err)}\n`);
  // A crash must not let a submit or a send through; anything else passes.
  const { server, short } = splitToolName(payload.tool_name);
  if (event === 'pre-tool' && (isBrowser(server) || isSendTool(server, short))) process.exit(2);
}

// hooks/hooks.json: shell form everywhere; PreToolUse fails closed for mail, LinkedIn and browser tools only.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

type Hook = { type: string; command: string; timeout: number; onFailure?: string; args?: unknown };
type HookGroup = { matcher?: string; hooks: Hook[] };
type HookConfig = { hooks: { PreToolUse: HookGroup[]; UserPromptSubmit: HookGroup[]; Stop: HookGroup[] } };

const config = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8')) as HookConfig;
const { PreToolUse, UserPromptSubmit, Stop } = config.hooks;

const TOOLS = {
  closed: [
    'mcp__claude_ai_Gmail__send_message',
    'mcp__claude_ai_Gmail__create_draft',
    'mcp__linkedin__search_jobs',
    'mcp__linkedin__send_message',
    'mcp__outlook__reply_to_message',
    'mcp__claude-in-chrome__computer',
    'mcp__claude-in-chrome__find',
    'mcp__Claude_Browser__click',
    'mcp__remote-devices__Claude_Browser__click',
    'mcp__computer-use__left_click',
    'mcp__playwright__browser_click',
    'mcp__puppeteer__puppeteer_click',
  ],
  open: [
    'mcp__plugin_job-tracker_tracker__find_company',
    'mcp__claude_ai_Google_Drive__search_files',
    'mcp__claude_ai_Slack__slack_read_channel',
    'mcp__claude_ai_Linear__list_issues',
    'mcp__github__list_issues',
  ],
};

// Claude Code may or may not anchor matchers; ours must mean the same either way.
function matches(group: HookGroup, name: string) {
  assert.ok(group.matcher, 'matcher is required');
  const loose = new RegExp(group.matcher).test(name);
  const full = new RegExp(`^(?:${group.matcher})$`).test(name);
  assert.equal(loose, full, `${group.matcher} on ${name}: anchoring changes the result`);
  return loose;
}
const groupFor = (name: string) => {
  const group = PreToolUse.find((g) => matches(g, name));
  assert.ok(group, `no hook group for ${name}`);
  return group;
};

test('every hook runs main.ts with node in shell form', () => {
  // Shell form works on every Claude Code version; exec form would turn the gates off where `args` is unsupported.
  const expected = (event: string) => `node --no-warnings "\${CLAUDE_PLUGIN_ROOT}/hooks/main.ts" ${event}`;
  assert.equal(PreToolUse.length, 2);
  const closed = PreToolUse[0];
  const open = PreToolUse[1];
  const prompt = UserPromptSubmit[0];
  const stop = Stop[0];
  assert.ok(closed && open && prompt && stop);
  const groups: Array<[HookGroup, string]> = [[closed, 'pre-tool'], [open, 'pre-tool'], [prompt, 'prompt'], [stop, 'stop']];
  for (const [group, event] of groups) {
    assert.equal(group.hooks.length, 1);
    const h = group.hooks[0];
    assert.ok(h);
    assert.equal(h.type, 'command');
    assert.equal(h.command, expected(event));
    assert.ok(!('args' in h), 'no args: exec form is not used');
    assert.equal(h.timeout, 15);
  }
});

test('the two PreToolUse groups split MCP tools with no gap and no overlap', () => {
  for (const name of [...TOOLS.closed, ...TOOLS.open]) {
    assert.equal(PreToolUse.filter((g) => matches(g, name)).length, 1, name);
  }
  assert.ok(!PreToolUse.some((g) => matches(g, 'Bash')), 'non-MCP tools are not gated');
});

test('only mail, LinkedIn and browser tools fail closed', () => {
  for (const name of TOOLS.closed) assert.equal(groupFor(name).hooks[0]?.onFailure, 'block', name);
  for (const name of TOOLS.open) assert.equal(groupFor(name).hooks[0]?.onFailure, undefined, name);
  for (const g of [...UserPromptSubmit, ...Stop]) assert.equal(g.hooks[0]?.onFailure, undefined, 'prompt and stop stay fail open');
});

test('the fail-closed set agrees with the Hermes adapter', () => {
  const src = readFileSync(new URL('../__init__.py', import.meta.url), 'utf8');
  const m = /FAIL_CLOSED = re\.compile\(r"([^"]+)", re\.I\)/.exec(src);
  assert.ok(m?.[1], 'FAIL_CLOSED not found in __init__.py');
  const hermes = new RegExp(m[1], 'i');
  for (const name of [...TOOLS.closed, ...TOOLS.open]) {
    assert.equal(groupFor(name).hooks[0]?.onFailure === 'block', hermes.test(name), name);
  }
});

test('the PreToolUse matchers list the same keywords as Hermes FAIL_CLOSED', () => {
  const lists = PreToolUse.map((g) => /\(\?:([^)]+)\)/.exec(g.matcher ?? '')?.[1]?.split('|'));
  const first = lists[0];
  const second = lists[1];
  assert.ok(first && second, 'keyword group not found in a matcher');
  assert.deepEqual(first, second);
  // The matchers only vary the first letter's case (matchers take no regex flags), while Hermes is fully
  // case-insensitive; real MCP server names use those casings.
  const normalised = first.map((k) => k.replace(/\[(.)(.)\]/g, '$2').toLowerCase()).sort();
  const src = readFileSync(new URL('../__init__.py', import.meta.url), 'utf8');
  const m = /FAIL_CLOSED = re\.compile\(r"([^"]+)", re\.I\)/.exec(src);
  assert.ok(m?.[1], 'FAIL_CLOSED not found in __init__.py');
  assert.deepEqual(normalised, m[1].split('|').sort());
});

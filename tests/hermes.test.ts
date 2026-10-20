// Hermes host adapter: tool-name mapping, step log, skill unwrapping, and hooks/hermes.ts end to end.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { browserAction, isBrowser, isSendTool, resolveLabel, splitToolName } from '../hooks/lib/classify.ts';
import { normalizeToolName } from '../hooks/lib/hosts/hermes.ts';
import type { ToolStep } from '../hooks/lib/types.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'jh-hermes-'));
  process.env.JOB_HUNT_HOME = home;
  delete process.env.JOB_HUNT_DB;
});

test('Hermes tool names map onto the mcp__server__tool shape the gates classify', () => {
  assert.equal(normalizeToolName('mcp__job_hunt_tracker__open_items'), 'mcp__job_hunt_tracker__open_items');
  assert.equal(normalizeToolName('connectors__gmail__send_email'), 'mcp__gmail__send_email');
  assert.equal(normalizeToolName('browser_click'), 'mcp__hermes_browser__browser_click');
  assert.equal(normalizeToolName('terminal'), 'terminal');
  const send = splitToolName(normalizeToolName('connectors__gmail__send_email'));
  assert.ok(isSendTool(send.server, send.short));
  assert.ok(isBrowser(splitToolName(normalizeToolName('browser_click')).server));
});

test('step logs are owner-only', { skip: process.platform === 'win32' }, () => {
  appendStep({ session_id: 'perm', tool_call_id: 'p1', tool_name: 'browser_snapshot', args: {}, result: '{}' });
  assert.equal(statSync(stepsPath('perm')).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, 'sessions')).mode & 0o777, 0o700);
});

test('Hermes browser actions and @refs are understood', () => {
  assert.equal(browserAction('browser_click', { ref: '@e5' }), 'click');
  assert.equal(browserAction('browser_type', { ref: '@e3', text: 'x' }), 'input');
  assert.equal(browserAction('browser_console', { expression: 'document.title' }), 'js');
  assert.equal(browserAction('browser_console', {}), 'other');
  assert.equal(browserAction('browser_exec', { code: 'js("1")' }), 'js');
  const steps: ToolStep[] = [{ kind: 'result', id: 'a', name: 'mcp__hermes_browser__browser_snapshot', text: 'snapshot: - button "Submit application" [ref=e5]\n- link "Jobs" [ref=e50]', isError: false }];
  assert.equal(resolveLabel({ ref: '@e5' }, steps), 'snapshot: - button "Submit application" [ref=e5]');
});

// --- Steps log ---

import { appendStep, stepsPath, unwrapSkillInvocation, userText } from '../hooks/lib/hosts/hermes.ts';
import { currentUrl, readTranscript, toolSteps } from '../hooks/lib/transcript.ts';

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hermes-skill-invocation.txt'), 'utf8');

test('post_tool_call steps are stored in Claude transcript shape with readable result text', () => {
  appendStep({ session_id: 's1', tool_call_id: 'c1', tool_name: 'browser_navigate', args: { url: 'https://jobs.ashbyhq.com/beta/1' }, result: JSON.stringify({ success: true, url: 'https://jobs.ashbyhq.com/beta/1' }) });
  appendStep({ session_id: 's1', tool_call_id: 'c2', tool_name: 'browser_snapshot', args: {}, result: JSON.stringify({ success: true, snapshot: '- button "Submit application" [ref=e7]' }) });
  appendStep({ session_id: 's1', tool_call_id: 'c3', tool_name: 'mcp__job_hunt_tracker__open_items', args: {}, result: JSON.stringify({ error: 'boom' }) });
  const steps = toolSteps(readTranscript(stepsPath('s1')));
  assert.equal(steps.length, 6);
  assert.deepEqual(steps[0], { kind: 'use', id: 'c1', name: 'mcp__hermes_browser__browser_navigate', input: { url: 'https://jobs.ashbyhq.com/beta/1' } });
  const snapshot = steps[3];
  assert.ok(snapshot?.kind === 'result');
  assert.match(snapshot.text, /^snapshot: - button "Submit application" \[ref=e7\]/m);
  const failed = steps[5];
  assert.ok(failed?.kind === 'result');
  assert.equal(failed.isError, true);
  assert.equal(currentUrl(steps), 'https://jobs.ashbyhq.com/beta/1');
});

test('slash-skill messages unwrap to the typed command; only the user instruction counts', () => {
  assert.deepEqual(unwrapSkillInvocation('/job-tracker:approve 12'), { text: '/job-tracker:approve 12', skill: null, args: null });
  assert.deepEqual(unwrapSkillInvocation(FIXTURE), { text: '/job-tracker:approve 12', skill: 'job-tracker:approve', args: '12' });
  assert.equal(userText([{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: {} }]), 'hello');
  assert.equal(userText(FIXTURE), '/job-tracker:approve 12');
});

// --- hooks/hermes.ts e2e ---

import { openDb } from '../servers/tracker/src/db.ts';
import { Tracker } from '../servers/tracker/src/tracker.ts';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'hermes.ts');
const TRACKER = 'mcp__job_hunt_tracker__';

function hermes(event: string, payload: Record<string, unknown>) {
  const r = spawnSync(process.execPath, ['--no-warnings', HOOK, event], { input: JSON.stringify(payload), env: { ...process.env, JOB_HUNT_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

function verifiedRole() {
  const t = new Tracker(openDb(join(home, 'tracker.db')));
  const role = t.upsertRole({ company: 'Beta', title: 'Founding Engineer', url: 'https://jobs.ashbyhq.com/beta/1', source: 'ashby' }).role;
  t.transition({ role_id: role.id, to: 'verified', reason: 'checked', evidence: 'https://jobs.ashbyhq.com/beta/1 "Remote (EU)"', location_line: 'Remote (EU)', location_type: 'remote' });
  t.db.close();
  return role;
}

test('hermes.ts: connector send tools are blocked, unrelated tools pass silently', () => {
  const out = hermes('pre_tool_call', { session_id: 'h1', tool_name: 'connectors__gmail__send_email', args: { to: 'a@b.c', body: 'hi' } });
  assert.equal(out.action, 'block');
  assert.match(out.message, /drafts/);
  assert.equal(hermes('pre_tool_call', { session_id: 'h1', tool_name: 'mcp__github__list_issues', args: {} }), null);
});

test('hermes.ts: a submit click needs the user approval typed as /job-tracker:approve', () => {
  const role = verifiedRole();
  const sid = 'h2';
  hermes('pre_tool_call', { session_id: sid, tool_name: `${TRACKER}open_items`, args: {} }); // marks the session
  hermes('post_tool_call', { session_id: sid, tool_call_id: 'n1', tool_name: 'browser_navigate', args: { url: 'https://jobs.ashbyhq.com/beta/1' }, result: JSON.stringify({ success: true, url: 'https://jobs.ashbyhq.com/beta/1' }) });
  hermes('post_tool_call', { session_id: sid, tool_call_id: 'n2', tool_name: 'browser_snapshot', args: {}, result: JSON.stringify({ success: true, snapshot: '- button "Submit application" [ref=e7]' }) });
  const click = { session_id: sid, tool_name: 'browser_click', args: { ref: '@e7' } };
  assert.match(hermes('pre_tool_call', click).message, /needs the user's approval/);
  const approved = hermes('pre_llm_call', { session_id: sid, user_message: FIXTURE.replace(/: 12\s*$/, `: ${role.id}`) });
  assert.match(approved.context, /gate_check passed/);
  assert.match(approved.context, new RegExp(`\\$ARGUMENTS = "${role.id}"`));
  assert.equal(hermes('pre_tool_call', click), null);
  assert.match(hermes('pre_tool_call', click).message, /needs the user's approval/, 'approval is consumed by one submit attempt');
});

test('hermes.ts: a subagent turn cannot grant approval', () => {
  const role = verifiedRole();
  const out = hermes('pre_llm_call', { session_id: 'child', parent_session_id: 'h3', user_message: `/job-tracker:approve ${role.id}` });
  assert.equal(out, null);
  assert.match(hermes('pre_tool_call', { session_id: 'child', tool_name: 'browser_console', args: { expression: "document.querySelector('form').requestSubmit()" } }) ?.message ?? 'not-marked', /not-marked|approval/);
});

test('hermes.ts: an unfinished sweep queues a nudge that the next turn receives', () => {
  const sid = 'h4';
  hermes('pre_llm_call', { session_id: sid, user_message: '/job-tracker:sweep' });
  hermes('post_tool_call', { session_id: sid, tool_call_id: 'u1', tool_name: `${TRACKER}upsert_role`, args: { company: 'A', title: 'B' }, result: JSON.stringify({ role: { id: 1, title: 'B' }, created: true }) });
  const stop = hermes('post_llm_call', { session_id: sid });
  assert.equal(stop.action, 'continue');
  assert.match(stop.message, /render_report/);
  const next = hermes('pre_llm_call', { session_id: sid, user_message: 'ok' });
  assert.match(next.context, /The sweep is not finished/);
  assert.equal(hermes('pre_llm_call', { session_id: sid, user_message: 'ok' }), null, 'the nudge is delivered once');
});

test('plugin.yaml, plugin.json and package.json carry the same version', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const yaml = readFileSync(join(root, 'plugin.yaml'), 'utf8').match(/^version:\s*"?([^"\n]+)"?/m)?.[1];
  const claude = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  assert.equal(yaml, claude);
  assert.equal(pkg, claude);
});

test('the plugin root has no lockfile, so Claude Code installs nothing for users', () => {
  // Claude Code installs the packages a lockfile next to the root package.json lists, on every install and
  // update. The plugin needs none at runtime; the dev tools and their lockfile live in dev/.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb']) {
    assert.equal(existsSync(join(root, lock)), false, `${lock} in the plugin root`);
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
  assert.equal(pkg.devDependencies, undefined, 'dev dependencies belong in dev/package.json');
});

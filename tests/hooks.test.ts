// Hook gates (spec §11): AC6 send blocked, AC7 unverified submit blocked, AC8 delete guard, AC9 read-back.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { preTool, prompt, setOutput, stop } from '../hooks/gates.ts';
import { saveSession } from '../hooks/lib/session.ts';
import type { HookOutput } from '../hooks/lib/types.ts';
import { openDb } from '../servers/tracker/src/db.ts';
import { Tracker } from '../servers/tracker/src/tracker.ts';

// One tool call in a test transcript: [toolName, input, resultText].
type Call = [name: string, input: Record<string, unknown>, result?: string];

let outputs: HookOutput[];
let home: string;
let n = 0;
setOutput((o) => outputs.push(o));

beforeEach(() => {
  outputs = [];
  home = mkdtempSync(join(tmpdir(), 'jh-hooks-'));
  process.env.JOB_HUNT_HOME = home;
  delete process.env.JOB_HUNT_DB;
});

const session = () => `s${++n}`;
const denied = () => outputs.find((o) => o.hookSpecificOutput?.permissionDecision === 'deny');
const reason = () => denied()?.hookSpecificOutput?.permissionDecisionReason || '';

// Transcript: a list of [toolName, input, resultText] calls.
function transcript(calls: Call[]) {
  const file = join(home, `t${++n}.jsonl`);
  const lines = calls.flatMap(([name, input, result], i) => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: `tu${i}`, name, input }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `tu${i}`, content: [{ type: 'text', text: result ?? 'ok' }] }] } },
  ]);
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return file;
}

function trackerWithRoles() {
  const t = new Tracker(openDb(join(home, 'tracker.db')));
  const unverified = t.upsertRole({ company: 'Acme', title: 'Product Engineer', url: 'https://jobs.ashbyhq.com/acme/1', source: 'ashby' }).role;
  const verified = t.upsertRole({ company: 'Beta', title: 'Founding Engineer', url: 'https://jobs.ashbyhq.com/beta/1', source: 'ashby' }).role;
  t.transition({ role_id: verified.id, to: 'verified', reason: 'checked', evidence: 'https://jobs.ashbyhq.com/beta/1 "Remote (EU)"', location_line: 'Remote (EU)', location_type: 'remote' });
  t.db.close();
  return { unverified, verified };
}

const CHROME = 'mcp__claude-in-chrome__';
const TRACKER = 'mcp__plugin_job-hunt_tracker__';
const markSession = async (sid: string) => preTool({ session_id: sid, tool_name: `${TRACKER}open_items`, tool_input: {} });

test('AC6: send tools are blocked in every session, drafts are not', async () => {
  const sid = session();
  for (const tool of ['mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward', 'mcp__linkedin__send_message', 'mcp__linkedin__send_connection_request']) {
    outputs = [];
    await preTool({ session_id: sid, tool_name: tool, tool_input: { to: 'x@example.com', body: 'hi' } });
    assert.ok(denied(), tool);
    assert.match(reason(), /drafts/);
  }
  outputs = [];
  await preTool({ session_id: sid, tool_name: 'mcp__claude_ai_Gmail__create_draft', tool_input: { body: 'Thanks, Tuesday works.' } });
  assert.equal(denied(), undefined);
  await preTool({ session_id: sid, tool_name: 'mcp__claude_ai_Slack__slack_send_message', tool_input: {} });
  assert.equal(denied(), undefined, 'unrelated send tools are left alone');
});

test('AC6: clicking Send in a browser is blocked in a job-hunt session', async () => {
  const sid = session();
  await markSession(sid);
  const tp = transcript([[`${CHROME}read_page`, { tabId: 1 }, 'textbox "Message" [ref_3]\nbutton "Send" [ref_9]']]);
  await preTool({ session_id: sid, transcript_path: tp, tool_name: `${CHROME}computer`, tool_input: { action: 'left_click', ref: 'ref_9' } });
  assert.match(reason(), /send a message/);
});

test('draft bodies with em dashes or volunteered gaps are denied in job-hunt sessions', async () => {
  const sid = session();
  await markSession(sid);
  await preTool({ session_id: sid, tool_name: 'mcp__claude_ai_Gmail__create_draft', tool_input: { body: "Happy to talk — though I don't have direct experience with Go." } });
  assert.match(reason(), /em_dash/);
  assert.match(reason(), /volunteered_gap/);
});

test('AC7: a submit click needs the user approval and a verified role', async () => {
  const { unverified, verified } = trackerWithRoles();
  const sid = session();
  await markSession(sid);
  const tp = transcript([[`${CHROME}find`, { query: 'submit button' }, 'Found:\n- button "Submit application" [ref_45]']]);
  const click = () => preTool({ session_id: sid, transcript_path: tp, tool_name: `${CHROME}computer`, tool_input: { action: 'left_click', ref: 'ref_45' } });

  await click();
  assert.match(reason(), /needs the user's approval/);

  outputs = [];
  await prompt({ session_id: sid, prompt: `/job-hunt:approve ${unverified.id}` });
  assert.match(outputs[0]?.hookSpecificOutput?.additionalContext ?? '', /gate_check fails: Role not verified/);
  outputs = [];
  await click();
  assert.match(reason(), /not verified/);

  outputs = [];
  await prompt({ session_id: sid, prompt: `/job-hunt:approve ${verified.id}` });
  assert.match(outputs[0]?.hookSpecificOutput?.additionalContext ?? '', /gate_check passed/);
  outputs = [];
  await click();
  assert.equal(denied(), undefined, 'approved and verified: allowed');
});

test('AC7: scripted submits are gated too; the model cannot approve itself', async () => {
  trackerWithRoles();
  const sid = session();
  await markSession(sid);
  await preTool({ session_id: sid, tool_name: `${CHROME}javascript_tool`, tool_input: { action: 'javascript_exec', text: "document.querySelector('form').requestSubmit()" } });
  assert.match(reason(), /needs the user's approval/);
  // A tool call that mentions approve does not create an approval; only a user prompt does.
  outputs = [];
  await preTool({ session_id: sid, tool_name: `${TRACKER}record`, tool_input: { role_id: 2, reason: '/job-hunt:approve 2', actor: 'user' } });
  await preTool({ session_id: sid, tool_name: `${CHROME}javascript_tool`, tool_input: { text: "document.querySelector('button[type=submit]').click()" } });
  assert.match(reason(), /needs the user's approval/);
});

test('submit gate fails closed when no tracker is reachable', async () => {
  const sid = session();
  await markSession(sid);
  await prompt({ session_id: sid, prompt: '/approve 1' });
  const tp = transcript([[`${CHROME}read_page`, {}, 'button "Apply now" [ref_2]']]);
  outputs = [];
  await preTool({ session_id: sid, transcript_path: tp, tool_name: `${CHROME}computer`, tool_input: { action: 'left_click', ref: 'ref_2' } });
  assert.match(reason(), /No tracker database/);
});

test('personal-data fields and consent boxes are blocked', async () => {
  const sid = session();
  await markSession(sid);
  const tp = transcript([[`${CHROME}read_page`, {}, 'textbox "Passport number" [ref_1]\ncombobox "Gender" [ref_2]\ncheckbox "Keep my CV in your talent pool for future roles" [ref_3]\ntextbox "LinkedIn profile" [ref_4]\nradio "No" [ref_5]']]);
  const call = async (tool: string, input: Record<string, unknown>) => {
    outputs = [];
    await preTool({ session_id: sid, transcript_path: tp, tool_name: `${CHROME}${tool}`, tool_input: input });
    return denied();
  };
  assert.ok(await call('form_input', { ref: 'ref_1', value: 'X123' }));
  assert.ok(await call('form_input', { ref: 'ref_2', value: 'Male' }));
  assert.ok(await call('form_input', { ref: 'ref_3', value: true }));
  assert.ok(await call('computer', { action: 'left_click', ref: 'ref_3' }));
  assert.equal(await call('form_input', { ref: 'ref_3', value: false }), undefined, 'unticking is the privacy-preserving option');
  assert.equal(await call('form_input', { ref: 'ref_4', value: 'https://linkedin.com/in/x' }), undefined);
  await prompt({ session_id: sid, prompt: '/job-hunt:allow-consent 7' });
  assert.equal(await call('form_input', { ref: 'ref_3', value: true }), undefined, 'user allowed consent');
});

test('AC8: board deletes need a fresh, passing guard and no stray clicks since', async () => {
  const sid = session();
  await markSession(sid);
  const board: Call = [`${CHROME}navigate`, { url: 'https://weworkremotely.jobcopilot.com/applications' }, 'Navigated'];
  const tree: Call = [`${CHROME}read_page`, {}, 'button "Delete selected" [ref_7]\nbutton "Confirm" [ref_8]\ncheckbox "Product Engineer" [ref_9]'];
  const guardOk: Call = [`${CHROME}javascript_tool`, { text: '/* guard */ JOBHUNT_TRIAGE_GUARD' }, 'JOBHUNT_TRIAGE_GUARD {"ok":true,"problems":[],"protected":{"Applied":{"count":5,"checked":0}}} JOBHUNT_END'];
  const guardBad: Call = [`${CHROME}javascript_tool`, { text: '/* guard */ JOBHUNT_TRIAGE_GUARD' }, 'JOBHUNT_TRIAGE_GUARD {"ok":false,"problems":["protected column \\"Applied\\" has 1 checked: Senior Engineer"]} JOBHUNT_END'];
  const del = (tp: string) => preTool({ session_id: sid, transcript_path: tp, tool_name: `${CHROME}computer`, tool_input: { action: 'left_click', ref: 'ref_7' } });

  await del(transcript([board, tree]));
  assert.match(reason(), /needs a fresh triage guard/);

  outputs = [];
  await del(transcript([board, tree, guardBad]));
  assert.match(reason(), /Applied.*has 1 checked/);

  outputs = [];
  await del(transcript([board, tree, guardOk]));
  assert.equal(denied(), undefined, 'fresh passing guard');

  // The trash click and then the confirm dialog are both fine after one guard.
  outputs = [];
  await preTool({ session_id: sid, transcript_path: transcript([board, tree, guardOk, [`${CHROME}computer`, { action: 'left_click', ref: 'ref_7' }, 'clicked']]), tool_name: `${CHROME}computer`, tool_input: { action: 'left_click', ref: 'ref_8' } });
  assert.equal(denied(), undefined, 'confirm dialog after the delete click');

  // Selecting another card after the guard invalidates it.
  outputs = [];
  await del(transcript([board, tree, guardOk, [`${CHROME}computer`, { action: 'left_click', ref: 'ref_9' }, 'clicked']]));
  assert.match(reason(), /was clicked after the guard ran/);

  // A guard escaped inside JSON (as some tools return it) still parses.
  outputs = [];
  const escaped: Call = [`${CHROME}javascript_tool`, { text: 'guard' }, JSON.stringify({ result: 'JOBHUNT_TRIAGE_GUARD {"ok":true,"problems":[]} JOBHUNT_END' })];
  await del(transcript([board, tree, escaped]));
  assert.equal(denied(), undefined, 'escaped guard output');
});

test('"Remove" inside an application form is not a board delete', async () => {
  const sid = session();
  await markSession(sid);
  const tp = transcript([[`${CHROME}navigate`, { url: 'https://jobs.ashbyhq.com/acme/1/application' }, 'ok'], [`${CHROME}read_page`, {}, 'button "Remove file" [ref_3]']]);
  await preTool({ session_id: sid, transcript_path: tp, tool_name: `${CHROME}computer`, tool_input: { action: 'left_click', ref: 'ref_3' } });
  assert.equal(denied(), undefined);
});

test('AC9: verify_artifact is denied without a real get_draft/list_drafts read-back', async () => {
  const sid = session();
  const fake = transcript([['mcp__claude_ai_Gmail__create_draft', { body: 'x' }, '{"id":"r-55512345"}']]);
  await preTool({ session_id: sid, transcript_path: fake, tool_name: `${TRACKER}verify_artifact`, tool_input: { artifact_id: 1, readback: '{"id":"r-55512345"}' } });
  assert.match(reason(), /real read-back/);
  outputs = [];
  const real = transcript([
    ['mcp__claude_ai_Gmail__create_draft', { body: 'x' }, '{"id":"r-55512345"}'],
    ['mcp__claude_ai_Gmail__get_draft', { id: 'r-55512345' }, '{"id":"r-55512345","message":{"snippet":"x"}}'],
  ]);
  await preTool({ session_id: sid, transcript_path: real, tool_name: `${TRACKER}verify_artifact`, tool_input: { artifact_id: 1, readback: '{"id":"r-55512345","message":{"snippet":"x"}}' } });
  assert.equal(denied(), undefined);
});

test('Stop: a sweep cannot finish with unrecorded roles or no report', async () => {
  const sid = session();
  await prompt({ session_id: sid, prompt: '/job-hunt:sweep' });
  const up = (id: number): Call => [`${TRACKER}upsert_role`, { company: 'A', title: 'B' }, JSON.stringify({ role: { id, title: 'B' }, created: true })];
  outputs = [];
  await stop({ session_id: sid, transcript_path: transcript([up(1), up(2), [`${TRACKER}transition`, { role_id: 1, to: 'dropped' }, '{}']]) });
  assert.equal(outputs[0]?.decision, 'block');
  assert.match(outputs[0]?.reason ?? '', /no transition\/record event: 2/);
  assert.match(outputs[0]?.reason ?? '', /render_report/);
  outputs = [];
  await stop({ session_id: sid, transcript_path: transcript([up(1), up(2), [`${TRACKER}transition`, { role_id: 1, to: 'dropped' }, '{}'], [`${TRACKER}record`, { role_id: 2 }, '{}'], [`${TRACKER}render_report`, { date: '2026-10-01' }, '# Daily report']]) });
  assert.equal(outputs.length, 0);
  // Other sessions are never blocked.
  await stop({ session_id: session(), transcript_path: transcript([up(1)]) });
  assert.equal(outputs.length, 0);
});

test('browser gates stay out of sessions that never touched the job hunt', async () => {
  const sid = session();
  const tp = transcript([[`${CHROME}read_page`, {}, 'button "Submit" [ref_1]']]);
  await preTool({ session_id: sid, transcript_path: tp, tool_name: `${CHROME}computer`, tool_input: { action: 'left_click', ref: 'ref_1' } });
  assert.equal(denied(), undefined);
});

test('session files are owner-only', { skip: process.platform === 'win32' }, () => {
  const state = { marked: true, kind: null, approvals: [], consents: [], denials: [], stop_blocks: 0 };
  saveSession('perm-test', state);
  assert.equal(statSync(join(home, 'sessions')).mode & 0o777, 0o700);
  assert.equal(statSync(join(home, 'sessions', 'perm-test.json')).mode & 0o777, 0o600);
  // A loose directory and file from an older version are tightened on the next save.
  chmodSync(join(home, 'sessions'), 0o755);
  chmodSync(join(home, 'sessions', 'perm-test.json'), 0o644);
  saveSession('perm-test', state);
  assert.equal(statSync(join(home, 'sessions')).mode & 0o777, 0o700);
  assert.equal(statSync(join(home, 'sessions', 'perm-test.json')).mode & 0o777, 0o600);
});

test('a deny is still emitted when the session cannot be saved', async () => {
  const notDir = join(home, 'a-file');
  writeFileSync(notDir, '');
  process.env.JOB_HUNT_HOME = notDir; // sessions/ cannot be created under a regular file
  await preTool({ session_id: session(), tool_name: 'mcp__claude_ai_Gmail__send_message', tool_input: { to: 'x@example.com', body: 'hi' } });
  assert.match(reason(), /Sending is blocked/);
});

test('a leftover session tmp file does not keep its old mode', { skip: process.platform === 'win32' }, () => {
  const state = { marked: true, kind: null, approvals: [], consents: [], denials: [], stop_blocks: 0 };
  saveSession('tmp-test', state);
  const tmp = join(home, 'sessions', 'tmp-test.json.tmp');
  writeFileSync(tmp, 'stale', { mode: 0o644 });
  chmodSync(tmp, 0o644);
  saveSession('tmp-test', state);
  assert.equal(statSync(join(home, 'sessions', 'tmp-test.json')).mode & 0o777, 0o600);
});

test('Stop fails open when its reminder counter cannot be saved', { skip: process.platform === 'win32' }, async () => {
  const sid = session();
  await prompt({ session_id: sid, prompt: '/job-hunt:sweep' });
  assert.equal(outputs.length, 0);
  mkdirSync(join(home, 'sessions', `${sid}.json.tmp`)); // saveSession cannot clear this, so it throws
  // Without a saved counter the reminder cap cannot work, so blocking would loop forever.
  await stop({ session_id: sid, transcript_path: transcript([]) });
  await stop({ session_id: sid, transcript_path: transcript([]), stop_hook_active: true });
  assert.equal(outputs.length, 0);
});

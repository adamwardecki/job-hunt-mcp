import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardMove, boardNote, boardView } from '../src/board-api.ts';
import { ToolError } from '../src/errors.ts';
import { STATUSES } from '../src/tracker.ts';
import { seeded } from './board-seed.ts';

const lastEvent = (s: ReturnType<typeof seeded>, id: number) => s.t.roleDetail({ role_id: id }).events.at(-1);

test('the board view lists roles with company and blocking question, drag targets and active rules', () => {
  const s = seeded();
  const v = boardView(s.t);
  assert.deepEqual(v.statuses, STATUSES);
  const byId = new Map(v.roles.map((r) => [r.id, r]));
  assert.equal(byId.get(s.found)?.company, 'Northwind');
  assert.equal(byId.get(s.found)?.status, 'found');
  assert.equal(byId.get(s.found)?.question, null);
  assert.equal(byId.get(s.queued)?.question, 'Is a quarterly week in Lisbon OK?');
  assert.ok(byId.get(s.queued)?.last_event);
  // verified and scored need Claude's research, so they are never drag targets.
  assert.deepEqual(v.moves.found, ['dropped']);
  assert.deepEqual(v.moves.verified, ['dropped']);
  assert.deepEqual(v.moves.scored, ['queued', 'dropped']);
  assert.deepEqual(v.moves.queued, ['applied', 'dropped', 'closed']);
  assert.deepEqual(v.moves.closed, []);
  assert.deepEqual(v.rules.map((r) => ({ ...r })), [{ id: s.rule, text: 'Skip staffing agencies' }]);
});

test('a legal move is recorded as the user', () => {
  const s = seeded();
  const out = boardMove(s.t, { role_id: s.scored, to: 'queued', reason: 'Moved on the board' });
  assert.equal(out.to, 'queued');
  assert.equal(lastEvent(s, s.scored)?.actor, 'user');
});

test('the status machine and evidence rules still apply', () => {
  const s = seeded();
  const eventsBefore = s.t.roleDetail({ role_id: s.found }).events.length;
  assert.throws(() => boardMove(s.t, { role_id: s.found, to: 'applied', reason: 'r', evidence: 'e' }), /Illegal transition found → applied/);
  assert.throws(() => boardMove(s.t, { role_id: s.found, to: 'dropped', reason: 'not for me' }), /A drop needs evidence/);
  assert.throws(() => boardMove(s.t, { role_id: s.queued, to: 'closed', reason: 'r' }), /closed needs outcome/);
  // A refused move writes nothing.
  assert.equal(s.t.roleRow(s.found)?.status, 'found');
  assert.equal(s.t.roleDetail({ role_id: s.found }).events.length, eventsBefore);
  assert.throws(() => boardMove(s.t, { role_id: 9999, to: 'dropped', reason: 'r', evidence: 'e' }), /No role 9999/);
  boardMove(s.t, { role_id: s.found, to: 'dropped', reason: 'agency', evidence: `rule:${s.rule}` });
  assert.equal(s.t.roleRow(s.found)?.status, 'dropped');
});

test('moves that need Claude, no-op moves and malformed bodies are refused', () => {
  const s = seeded();
  assert.throws(() => boardMove(s.t, { role_id: s.found, to: 'verified', reason: 'r' }), /needs Claude/);
  assert.throws(() => boardMove(s.t, { role_id: s.queued, to: 'queued', reason: 'r' }), /already queued/);
  assert.throws(() => boardMove(s.t, null), ToolError);
  assert.throws(() => boardMove(s.t, { role_id: '1', to: 'dropped', reason: 'r' }), /role_id must be an integer/);
  assert.throws(() => boardMove(s.t, { role_id: s.found, to: 'nowhere', reason: 'r' }), /to must be one of/);
  assert.throws(() => boardMove(s.t, { role_id: s.found, to: 'dropped', reason: 'r', actor: 'pipeline' }), /Unknown field: actor/);
  assert.throws(() => boardMove(s.t, { role_id: s.found, to: 'dropped', reason: 7 }), /reason must be a string/);
});

test('a move without a reason records the board default; a given reason wins', () => {
  const s = seeded();
  boardMove(s.t, { role_id: s.scored, to: 'queued' });
  assert.equal(lastEvent(s, s.scored)?.reason, 'Moved on the board');
  boardMove(s.t, { role_id: s.queued, to: 'closed', outcome: 'withdrawn', reason: '  ' });
  assert.equal(lastEvent(s, s.queued)?.reason, 'Moved on the board');
  boardMove(s.t, { role_id: s.found, to: 'dropped', evidence: `rule:${s.rule}`, reason: 'Agency, not the employer' });
  assert.equal(lastEvent(s, s.found)?.reason, 'Agency, not the employer');
});

test('a note adds the user\'s own reason without changing the status', () => {
  const s = seeded();
  boardMove(s.t, { role_id: s.scored, to: 'queued' });
  boardNote(s.t, { role_id: s.scored, reason: 'Great team, apply this week' });
  const ev = lastEvent(s, s.scored);
  assert.equal(ev?.status, null);
  assert.equal(ev?.actor, 'user');
  assert.equal(ev?.reason, 'Great team, apply this week');
  assert.equal(s.t.roleRow(s.scored)?.status, 'queued');
  assert.throws(() => boardNote(s.t, { role_id: s.scored, reason: '   ' }), /reason is required/);
  assert.throws(() => boardNote(s.t, { role_id: s.scored, reason: 'x', status: 'offer' }), /Unknown field: status/);
  assert.throws(() => boardNote(s.t, { role_id: 9999, reason: 'x' }), /No role 9999/);
});

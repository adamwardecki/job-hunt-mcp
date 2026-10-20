import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorMessage, errorText, isRecord, oneOf, parseJson } from '../../plugin/servers/tracker/src/util.ts';

test('parseJson: parses, and falls back on null, undefined or bad JSON', () => {
  assert.deepEqual(parseJson<string[]>('["a"]', []), ['a']);
  assert.deepEqual(parseJson<string[]>(null, []), []);
  assert.deepEqual(parseJson<string[]>(undefined, []), []);
  assert.equal(parseJson<number | null>('{bad', null), null);
});

test('oneOf: only strings in the list', () => {
  const STATUSES = ['found', 'verified'] as const;
  assert.equal(oneOf(STATUSES, 'found'), true);
  assert.equal(oneOf(STATUSES, 'dropped'), false);
  assert.equal(oneOf(STATUSES, null), false);
  assert.equal(oneOf(STATUSES, 1), false);
});

test('isRecord: plain objects only', () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord('x'), false);
});

test('errorText and errorMessage handle Errors and anything else thrown', () => {
  const err = new Error('boom');
  assert.equal(errorMessage(err), 'boom');
  assert.match(errorText(err), /^Error: boom\n/);
  assert.equal(errorMessage('plain'), 'plain');
  assert.equal(errorText(42), '42');
});

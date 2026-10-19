import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolError } from '../src/errors.ts';
import { dayBounds, toUtcIso, localDate, isValidTimeZone, formatLocal } from '../src/time.ts';

const isToolError = (e: unknown) => e instanceof ToolError;

test('dayBounds: a local day as UTC instants, DST-safe', () => {
  assert.deepEqual(dayBounds('2026-10-18', 'UTC'), ['2026-10-18T00:00:00.000Z', '2026-10-19T00:00:00.000Z']);
  assert.deepEqual(dayBounds('2026-10-18', 'Europe/Berlin'), ['2026-10-17T22:00:00.000Z', '2026-10-18T22:00:00.000Z']);
  // DST ends on 25 Oct 2026 in Europe: a 25-hour day.
  assert.deepEqual(dayBounds('2026-10-25', 'Europe/Berlin'), ['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z']);
  assert.throws(() => dayBounds('18/10/2026', 'UTC'), /YYYY-MM-DD/);
});

test('dayBounds: DST that starts at midnight, and impossible input', () => {
  // Santiago and Havana skip 00:00; the day starts at 01:00 local, which is 04:00Z.
  assert.equal(dayBounds('2026-09-06', 'America/Santiago')[0], '2026-09-06T04:00:00.000Z');
  assert.equal(dayBounds('2026-03-08', 'America/Havana')[0], '2026-03-08T05:00:00.000Z');
  assert.throws(() => dayBounds('2026-02-30', 'UTC'), /YYYY-MM-DD/);
  assert.throws(() => dayBounds('2026-10-18', 'Mars/Base'), isToolError);
  assert.throws(() => dayBounds('2026-10-18', 'Mars/Base'), /Unknown timezone/);
});

test('toUtcIso: offsets are honoured, wall times are read in the given zone', () => {
  assert.equal(toUtcIso('2026-10-18T10:00+02:00'), '2026-10-18T08:00:00.000Z');
  assert.equal(toUtcIso('2026-10-18T08:00:00Z'), '2026-10-18T08:00:00.000Z');
  assert.equal(toUtcIso('2026-10-18T10:00', 'Europe/Berlin'), '2026-10-18T08:00:00.000Z');
  assert.equal(toUtcIso('2026-12-18 10:00', 'Europe/Berlin'), '2026-12-18T09:00:00.000Z');
  assert.throws(() => toUtcIso('next Tuesday', 'UTC'), /Cannot parse/);
  assert.throws(() => toUtcIso('2026-10-18T10:00', 'Mars/Base'), /Unknown timezone/);
  assert.throws(() => toUtcIso('2026-02-30T10:00', 'UTC'), isToolError);
  assert.throws(() => toUtcIso('2026-10-18T24:00', 'UTC'), /no such date or time/);
  assert.throws(() => toUtcIso('2026-10-18T10:60', 'UTC'), /no such date or time/);
});

test('toUtcIso: gaps resolve forward', () => {
  assert.equal(toUtcIso('2026-03-08T02:30', 'America/New_York'), '2026-03-08T07:30:00.000Z');
  assert.equal(toUtcIso('2026-03-29T02:30', 'Europe/Berlin'), '2026-03-29T01:30:00.000Z');
});

test('localDate and isValidTimeZone', () => {
  assert.equal(localDate(Date.parse('2026-10-17T22:30:00Z'), 'Europe/Berlin'), '2026-10-18');
  assert.equal(localDate(Date.parse('2026-10-17T22:30:00Z'), 'UTC'), '2026-10-17');
  assert.equal(isValidTimeZone('Europe/Berlin'), true);
  assert.equal(isValidTimeZone('Nowhere/City'), false);
  assert.equal(isValidTimeZone(undefined), false);
  assert.throws(() => localDate(0, 'Mars/Base'), isToolError);
});

test('formatLocal: wall time in a zone, DST-aware', () => {
  assert.equal(formatLocal('2026-10-20T08:00:00.000Z', 'Europe/Berlin'), '2026-10-20 10:00');
  assert.equal(formatLocal('2026-12-20T08:00:00.000Z', 'Europe/Berlin'), '2026-12-20 09:00');
  assert.equal(formatLocal('2026-10-17T22:30:00.000Z', 'Europe/Berlin'), '2026-10-18 00:30');
  assert.equal(formatLocal('2026-10-17T22:30:00.000Z', 'UTC'), '2026-10-17 22:30');
  assert.equal(formatLocal('Tuesday 10am', 'Europe/Berlin'), 'Tuesday 10am'); // legacy free text
  assert.throws(() => formatLocal('2026-10-17T22:30:00.000Z', 'Mars/Base'), isToolError);
});

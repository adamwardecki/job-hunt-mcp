import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { boardStatePath, readBoardState, removeBoardState, writeBoardState } from '../src/board-state.ts';

const scratch = () => mkdtempSync(join(tmpdir(), 'jh-state-'));
const state = (db: string, pid = 4242) => ({ port: 4317, token: 'c'.repeat(64), pid, db });

test('the state file sits next to the database', () => {
  const dir = scratch();
  assert.equal(boardStatePath(join(dir, 'tracker.db')), join(dir, 'board.json'));
});

test('state round-trips and is owner-only', () => {
  const dir = scratch();
  const file = join(dir, 'board.json');
  writeBoardState(file, state(join(dir, 'tracker.db')));
  assert.deepEqual(readBoardState(file), state(join(dir, 'tracker.db')));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('a missing, broken or wrongly shaped file reads as no board', () => {
  const dir = scratch();
  const file = join(dir, 'board.json');
  assert.equal(readBoardState(file), null);
  writeFileSync(file, '{not json');
  assert.equal(readBoardState(file), null);
  writeFileSync(file, JSON.stringify({ port: '4317', token: 'x', pid: 1, db: '/x' }));
  assert.equal(readBoardState(file), null);
  const bad = [
    '{"port":1e999,"token":"x","pid":1,"db":"/x"}',
    '{"port":0,"token":"x","pid":1,"db":"/x"}',
    '{"port":65536,"token":"x","pid":1,"db":"/x"}',
    '{"port":4317,"token":"x","pid":-1,"db":"/x"}',
    '{"port":4317,"token":"x","pid":0,"db":"/x"}',
    '{"port":4317,"token":"x","pid":1.5,"db":"/x"}',
    '{"port":4317,"token":"","pid":1,"db":"/x"}',
    '{"port":4317,"token":"x","pid":1,"db":""}',
    '{"port":4317,"token":"x","pid":1}',
  ];
  for (const text of bad) {
    writeFileSync(file, text);
    assert.equal(readBoardState(file), null, text);
  }
});

test('a second write replaces the first, stays owner-only and leaves no temp file', () => {
  const dir = scratch();
  const file = join(dir, 'board.json');
  writeBoardState(file, state('/db', 1));
  writeBoardState(file, state('/db', 2));
  assert.equal(readBoardState(file)?.pid, 2);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ['board.json']);
});

test('a failed write throws and cleans up its temp file', () => {
  const dir = scratch();
  const file = join(dir, 'board.json');
  mkdirSync(join(file, 'in-the-way'), { recursive: true }); // renaming a file onto a non-empty directory fails
  assert.throws(() => writeBoardState(file, state('/db')));
  assert.deepEqual(readdirSync(dir), ['board.json']);
});

test('removing a missing or corrupt file does not throw', () => {
  const dir = scratch();
  const file = join(dir, 'board.json');
  removeBoardState(file, 1);
  writeFileSync(file, '{not json');
  removeBoardState(file, 1);
  assert.equal(readBoardState(file), null);
});

test('only the board that wrote the file removes it', () => {
  const dir = scratch();
  const file = join(dir, 'board.json');
  writeBoardState(file, state('/db', 111));
  removeBoardState(file, 222);
  assert.equal(readBoardState(file)?.pid, 111);
  removeBoardState(file, 111);
  assert.equal(readBoardState(file), null);
});

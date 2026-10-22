import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { LaunchDeps } from '../src/board-launch.ts';
import { DEFAULT_DEPS, openBoard, spawnBoard } from '../src/board-launch.ts';
import { boardStatePath, readBoardState, writeBoardState } from '../src/board-state.ts';

const TOKEN = 'b'.repeat(64);

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'jh-launch-'));
  const db = join(dir, 'tracker.db');
  return { db, file: boardStatePath(db) };
}

// Fakes record what happened; spawnBoard can pretend to be a board by writing a state file.
function fakes(over: Partial<LaunchDeps> = {}) {
  const spawned: string[] = [];
  const opened: string[] = [];
  const deps: LaunchDeps = {
    spawnBoard: (db) => {
      spawned.push(db);
    },
    healthy: async () => true,
    openBrowser: async (url) => {
      opened.push(url);
    },
    startTimeoutMs: 300,
    ...over,
  };
  return { deps, spawned, opened };
}

test('a healthy board for the same database is reused, and no browser opens by default', async () => {
  const { db, file } = scratch();
  writeBoardState(file, { port: 4317, token: TOKEN, pid: process.pid, db });
  const f = fakes();
  const out = await openBoard({ dbPath: db }, f.deps);
  assert.equal(out.url, `http://127.0.0.1:4317/#t=${TOKEN}`);
  assert.equal(out.reused, true);
  assert.equal(out.opened, false);
  assert.equal(out.markdown, `Board: ${out.url}`);
  assert.deepEqual(f.spawned, []);
  assert.deepEqual(f.opened, []);
});

test('a stale state file is replaced by a newly started board', async () => {
  const { db, file } = scratch();
  writeBoardState(file, { port: 1, token: TOKEN, pid: 999_999, db });
  const spawned: string[] = [];
  const f = fakes({
    healthy: async () => false,
    spawnBoard: (p) => {
      spawned.push(p);
      writeBoardState(file, { port: 5000, token: 'd'.repeat(64), pid: 1234, db: p });
    },
  });
  const out = await openBoard({ dbPath: db }, f.deps);
  assert.equal(out.reused, false);
  assert.equal(out.url, `http://127.0.0.1:5000/#t=${'d'.repeat(64)}`);
  assert.deepEqual(spawned, [db]);
});

test('a board for another database in the same directory is not reused', async () => {
  const { db, file } = scratch();
  writeBoardState(file, { port: 4317, token: TOKEN, pid: process.pid, db: `${db}.other` });
  const f = fakes();
  await assert.rejects(openBoard({ dbPath: db }, f.deps), /did not start/);
  assert.deepEqual(f.spawned, [db]);
});

test('open: true opens the browser, and a browser failure still returns the link', async () => {
  const { db, file } = scratch();
  writeBoardState(file, { port: 4317, token: TOKEN, pid: process.pid, db });
  const ok = fakes();
  const out = await openBoard({ dbPath: db, open: true }, ok.deps);
  assert.equal(out.opened, true);
  assert.deepEqual(ok.opened, [out.url]);
  const broken = fakes({ openBrowser: async () => Promise.reject(new Error('no display')) });
  const out2 = await openBoard({ dbPath: db, open: true }, broken.deps);
  assert.equal(out2.opened, false);
  assert.match(out2.markdown, /did not open \(no display\)/);
});

test('an in-memory tracker has no board', async () => {
  await assert.rejects(openBoard({ dbPath: null }, fakes().deps), /in memory/);
});

test('open_board starts a real board process and reuses it on the next call', { timeout: 20_000 }, async () => {
  const { db, file } = scratch();
  const deps: LaunchDeps = {
    ...DEFAULT_DEPS,
    spawnBoard: (p) => spawnBoard(p, ['--idle-ms', '5000']),
    openBrowser: async () => assert.fail('must not open a browser'),
  };
  const first = await openBoard({ dbPath: db }, deps);
  const second = await openBoard({ dbPath: db }, deps);
  try {
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.url, first.url);
  } finally {
    const pid = readBoardState(file)?.pid;
    if (pid) process.kill(pid);
  }
});

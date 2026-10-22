import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { test } from 'node:test';
import type { LaunchDeps } from '../src/board-launch.ts';
import { DEFAULT_DEPS, healthy, openBoard, spawnBoard } from '../src/board-launch.ts';
import { boardStatePath, readBoardState, writeBoardState } from '../src/board-state.ts';

const TOKEN = 'b'.repeat(64);

function scratch(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'jh-launch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const db = join(dir, 'tracker.db');
  return { db, file: boardStatePath(db) };
}

// A pid that existed a moment ago and is gone now.
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  assert.ok(r.pid);
  return r.pid;
}

// Fakes record what happened; spawnBoard can pretend to be a board by writing a state file.
// The default spawn never reports an exit, like a board that keeps running.
function fakes(over: Partial<LaunchDeps> = {}) {
  const spawned: string[] = [];
  const opened: string[] = [];
  const healthChecks: number[] = [];
  const deps: LaunchDeps = {
    spawnBoard: (db) => {
      spawned.push(db);
      return new Promise(() => {});
    },
    healthy: async (s) => {
      healthChecks.push(s.port);
      return true;
    },
    openBrowser: async (url) => {
      opened.push(url);
    },
    startTimeoutMs: 300,
    ...over,
  };
  return { deps, spawned, opened, healthChecks };
}

test('a healthy board for the same database is reused, and no browser opens by default', async (t) => {
  const { db, file } = scratch(t);
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

test('a state file whose board does not answer is replaced by a newly started board', async (t) => {
  const { db, file } = scratch(t);
  writeBoardState(file, { port: 1, token: TOKEN, pid: process.pid, db });
  const spawned: string[] = [];
  const f = fakes({
    healthy: async () => false,
    spawnBoard: (p) => {
      spawned.push(p);
      writeBoardState(file, { port: 5000, token: 'd'.repeat(64), pid: 1234, db: p });
      return new Promise(() => {});
    },
  });
  const out = await openBoard({ dbPath: db }, f.deps);
  assert.equal(out.reused, false);
  assert.equal(out.url, `http://127.0.0.1:5000/#t=${'d'.repeat(64)}`);
  assert.deepEqual(spawned, [db]);
});

test('a dead pid in the state file skips the health check and starts a new board', async (t) => {
  const { db, file } = scratch(t);
  writeBoardState(file, { port: 4317, token: TOKEN, pid: deadPid(), db });
  const f = fakes({
    spawnBoard: (p) => {
      f.spawned.push(p);
      writeBoardState(file, { port: 5001, token: 'e'.repeat(64), pid: process.pid, db: p });
      return new Promise(() => {});
    },
  });
  const out = await openBoard({ dbPath: db }, f.deps);
  assert.equal(out.reused, false);
  assert.equal(out.url, `http://127.0.0.1:5001/#t=${'e'.repeat(64)}`);
  assert.deepEqual(f.healthChecks, []);
  assert.deepEqual(f.spawned, [db]);
});

test('a board for another database in the same directory is not reused', async (t) => {
  const { db, file } = scratch(t);
  writeBoardState(file, { port: 4317, token: TOKEN, pid: process.pid, db: `${db}.other` });
  const f = fakes();
  await assert.rejects(openBoard({ dbPath: db }, f.deps), /did not start/);
  assert.deepEqual(f.spawned, [db]);
});

test('a state file for another database that appears while waiting is not accepted', async (t) => {
  const { db, file } = scratch(t);
  const f = fakes({
    spawnBoard: (p) => {
      f.spawned.push(p);
      writeBoardState(file, { port: 4317, token: TOKEN, pid: process.pid, db: `${p}.other` });
      return new Promise(() => {});
    },
  });
  await assert.rejects(openBoard({ dbPath: db }, f.deps), /did not start/);
});

test('open: true opens the browser, and a browser failure still returns the link', async (t) => {
  const { db, file } = scratch(t);
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

test('concurrent calls for one database start one board and get the same link', async (t) => {
  const { db, file } = scratch(t);
  const f = fakes({
    spawnBoard: (p) => {
      f.spawned.push(p);
      setTimeout(() => writeBoardState(file, { port: 5002, token: 'f'.repeat(64), pid: process.pid, db: p }), 50);
      return new Promise(() => {});
    },
    startTimeoutMs: 2000,
  });
  const [a, b] = await Promise.all([openBoard({ dbPath: db }, f.deps), openBoard({ dbPath: db }, f.deps)]);
  assert.deepEqual(f.spawned, [db]);
  assert.equal(a.url, b.url);
  assert.equal(a.url, `http://127.0.0.1:5002/#t=${'f'.repeat(64)}`);
  // the shared lookup is forgotten once it settles, so a later call checks again
  const c = await openBoard({ dbPath: db }, f.deps);
  assert.equal(c.reused, true);
  assert.deepEqual(f.spawned, [db]);
});

test('a board that exits at once fails fast with its exit code', async (t) => {
  const { db } = scratch(t);
  const f = fakes({
    spawnBoard: async (p) => {
      f.spawned.push(p);
      return 1;
    },
    startTimeoutMs: 10_000,
  });
  const started = Date.now();
  await assert.rejects(openBoard({ dbPath: db }, f.deps), /exited with code 1 before it started/);
  assert.ok(Date.now() - started < 2000, 'must not wait out the start timeout');
});

test('healthy accepts only a 200 answer with { ok: true } and the right token', async () => {
  let status = 200;
  let body = '{"ok":true}';
  const auth: Array<string | undefined> = [];
  const server = createServer((req, res) => {
    auth.push(req.headers.authorization);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const state = { port: address.port, token: TOKEN, pid: process.pid, db: '/x' };
    assert.equal(await healthy(state), true);
    assert.deepEqual(auth, [`Bearer ${TOKEN}`]);
    body = '{}';
    assert.equal(await healthy(state), false);
    body = 'not json';
    assert.equal(await healthy(state), false);
    status = 401;
    body = '{"ok":true}';
    assert.equal(await healthy(state), false);
    status = 302;
    assert.equal(await healthy(state), false);
  } finally {
    server.close();
  }
  const closed = createServer();
  await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
  const addr = closed.address();
  assert.ok(addr && typeof addr === 'object');
  const { port } = addr;
  await new Promise((r) => closed.close(r));
  assert.equal(await healthy({ port, token: TOKEN, pid: process.pid, db: '/x' }), false);
});

test('open_board starts a real board process and reuses it on the next call', { timeout: 20_000 }, async (t) => {
  const { db, file } = scratch(t);
  const deps: LaunchDeps = {
    ...DEFAULT_DEPS,
    spawnBoard: (p) => spawnBoard(p, ['--idle-ms', '5000']),
    openBrowser: async () => assert.fail('must not open a browser'),
  };
  try {
    const first = await openBoard({ dbPath: db }, deps);
    const second = await openBoard({ dbPath: db }, deps);
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.url, first.url);
  } finally {
    const pid = readBoardState(file)?.pid;
    if (pid) {
      try {
        process.kill(pid);
      } catch {
        // ESRCH: the board already exited, which is what cleanup wanted
      }
    }
  }
});

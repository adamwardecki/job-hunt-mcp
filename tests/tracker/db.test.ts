// Database layer: locking, migrations and file permissions.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openDb, SCHEMA_V1, SCHEMA_VERSION, tx } from '../../plugin/servers/tracker/src/db.ts';
import { secureDir, secureFile } from '../../plugin/servers/tracker/src/fsperm.ts';
import { Tracker } from '../../plugin/servers/tracker/src/tracker.ts';

const tempDb = () => join(mkdtempSync(join(tmpdir(), 'jh-db-')), 'tracker.db');
const addRule = (db: ReturnType<typeof openDb>, text: string) =>
  db.exec(`INSERT INTO rules(text, reason, added_by, added_on) VALUES('${text}', 'b', 'user', '2026-01-01')`);
const ruleTexts = (db: ReturnType<typeof openDb>) =>
  db.prepare('SELECT text FROM rules ORDER BY id').all().map((r) => r.text);

test('a second writer waits for the lock instead of failing', { timeout: 10_000 }, async () => {
  const path = tempDb();
  openDb(path).close();
  const dbUrl = new URL('../../plugin/servers/tracker/src/db.ts', import.meta.url).href;
  // Another process (another Claude session) holds the write lock for 300 ms.
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    import { openDb } from ${JSON.stringify(dbUrl)};
    const db = openDb(${JSON.stringify(path)});
    db.exec('BEGIN IMMEDIATE');
    db.exec("INSERT INTO rules(text, reason, added_by, added_on) VALUES('a', 'b', 'user', '2026-01-01')");
    process.stdout.write('locked\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    db.exec('COMMIT');
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (d) => /locked/.test(String(d)) && resolve());
    void exited.then((code) => reject(new Error(`child exited (${code}) before taking the lock`)));
  });
  const db = openDb(path);
  try {
    assert.equal(new Tracker(db).addRule({ text: 'c', reason: 'd' }).rule_id, 2);
  } finally {
    db.close();
  }
  assert.equal(await exited, 0);
});

test('a nested tx joins the outer transaction and commits once', () => {
  const db = openDb(':memory:');
  tx(db, () => {
    addRule(db, 'outer');
    tx(db, () => addRule(db, 'inner'));
    assert.equal(db.isTransaction, true);
  });
  assert.equal(db.isTransaction, false);
  assert.deepEqual(ruleTexts(db), ['outer', 'inner']);
});

test('a throw inside a nested tx rolls back the outer writes too', () => {
  const db = openDb(':memory:');
  assert.throws(() => tx(db, () => {
    addRule(db, 'outer');
    tx(db, () => {
      addRule(db, 'inner');
      throw new Error('boom');
    });
  }), /boom/);
  assert.equal(db.isTransaction, false);
  assert.deepEqual(ruleTexts(db), []);
  tx(db, () => addRule(db, 'after')); // the inTx marker was cleared
  assert.deepEqual(ruleTexts(db), ['after']);
});

const userVersion = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

test('a pre-versioning database is marked v1 and migrated to the current version', () => {
  const path = tempDb();
  const raw = new DatabaseSync(path);
  raw.exec(SCHEMA_V1);
  raw.exec(`
    INSERT INTO profile(key, value) VALUES('filters', '{"timezone":"Europe/Berlin"}');
    INSERT INTO companies(id, name, created_at) VALUES(1, 'Acme', '2026-01-01T00:00:00Z');
    INSERT INTO roles(id, company_id, title, first_seen, updated_at, status) VALUES(1, 1, 'Eng', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'applied');
    INSERT INTO interviews(role_id, starts_at, tz, stage, created_at) VALUES(1, '2026-10-20T10:00+02:00', NULL, 'screen', '2026-01-01T00:00:00Z');
    INSERT INTO interviews(role_id, starts_at, tz, stage, created_at) VALUES(1, '2026-10-21T10:00', NULL, 'tech', '2026-01-01T00:00:00Z');
    INSERT INTO interviews(role_id, starts_at, tz, stage, created_at) VALUES(1, '2026-10-22T10:00', 'Asia/Tokyo', 'final', '2026-01-01T00:00:00Z');
    INSERT INTO interviews(role_id, starts_at, tz, stage, created_at) VALUES(1, 'next week', NULL, 'offer chat', '2026-01-01T00:00:00Z');
    INSERT INTO interviews(role_id, starts_at, tz, stage, created_at) VALUES(1, '2026-10-23T10:00', 'Mars/Base', 'bad zone', '2026-01-01T00:00:00Z');
  `);
  raw.close();
  const db = openDb(path);
  assert.equal(userVersion(db), SCHEMA_VERSION);
  assert.equal((db.prepare('SELECT title FROM roles WHERE id = 1').get() as { title: string }).title, 'Eng');
  assert.ok(db.prepare('PRAGMA table_info(artifacts)').all().some((c) => c.name === 'run_id'));
  assert.deepEqual(db.prepare('SELECT starts_at FROM interviews ORDER BY id').all().map((r) => r.starts_at), [
    '2026-10-20T08:00:00.000Z',
    '2026-10-21T08:00:00.000Z',
    '2026-10-22T01:00:00.000Z',
    'next week',
    '2026-10-23T08:00:00.000Z', // invalid row tz: falls back to filters.timezone (Europe/Berlin)
  ]);
  db.close();
  // Reopening is a no-op.
  const again = openDb(path);
  assert.equal(userVersion(again), SCHEMA_VERSION);
  again.close();
});

test('a database from a newer plugin is refused, read-write and read-only', () => {
  const path = tempDb();
  openDb(path).close();
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA user_version = 99');
  raw.close();
  assert.throws(() => openDb(path), /schema version 99/);
  assert.throws(() => openDb(path, { readOnly: true }), /schema version 99/);
});

test('concurrent opens of a pre-versioning database migrate it exactly once', { timeout: 30_000 }, async () => {
  const path = tempDb();
  const raw = new DatabaseSync(path);
  raw.exec(SCHEMA_V1);
  raw.close();
  const dbUrl = new URL('../../plugin/servers/tracker/src/db.ts', import.meta.url).href;
  const start = Date.now() + 500; // all children open together, after their startup cost
  const run = () => new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
      import { openDb } from ${JSON.stringify(dbUrl)};
      while (Date.now() < ${start});
      openDb(${JSON.stringify(path)}).close();
    `], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolve({ code, stderr }));
  });
  const results = await Promise.all(Array.from({ length: 6 }, run));
  for (const r of results) assert.deepEqual(r, { code: 0, stderr: '' });
  const db = openDb(path);
  try {
    assert.equal(userVersion(db), SCHEMA_VERSION);
    assert.equal(db.prepare('PRAGMA table_info(artifacts)').all().filter((c) => c.name === 'run_id').length, 1);
  } finally {
    db.close();
  }
});

test('opening an old database read-only leaves it untouched', () => {
  for (const version of [0, 1]) {
    const path = tempDb();
    const raw = new DatabaseSync(path);
    raw.exec(SCHEMA_V1);
    raw.exec(`PRAGMA user_version = ${version}`);
    raw.close();
    const db = openDb(path, { readOnly: true });
    try {
      assert.equal(userVersion(db), version);
      assert.ok(!db.prepare('PRAGMA table_info(artifacts)').all().some((c) => c.name === 'run_id'));
    } finally {
      db.close();
    }
  }
});

test('the newer-version error names the database file', () => {
  const path = tempDb();
  openDb(path).close();
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA user_version = 99');
  raw.close();
  assert.throws(() => openDb(path), (err) => err instanceof Error && err.message.startsWith(path));
});

const mode = (p: string) => statSync(p).mode & 0o777;
const withHome = (home: string, fn: () => void) => {
  const before = { home: process.env.JOB_TRACKER_HOME, db: process.env.JOB_TRACKER_DB };
  process.env.JOB_TRACKER_HOME = home;
  delete process.env.JOB_TRACKER_DB;
  try {
    fn();
  } finally {
    for (const [key, value] of [['JOB_TRACKER_HOME', before.home], ['JOB_TRACKER_DB', before.db]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('the tracker home and database are owner-only', { skip: process.platform === 'win32' }, () => {
  const home = join(mkdtempSync(join(tmpdir(), 'jh-perm-')), 'home');
  withHome(home, () => {
    const path = join(home, 'tracker.db');
    const db = openDb(path);
    try {
      assert.equal(mode(home), 0o700);
      assert.equal(mode(path), 0o600);
      for (const f of [`${path}-wal`, `${path}-shm`]) {
        assert.ok(existsSync(f), `${f} exists while the connection is open`);
        assert.equal(mode(f), 0o600);
      }
    } finally {
      db.close();
    }
  });
});

test('an existing loose home and database are tightened', { skip: process.platform === 'win32' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'jh-perm-'));
  const path = join(home, 'tracker.db');
  openDb(path).close();
  chmodSync(home, 0o755);
  chmodSync(path, 0o644);
  withHome(home, () => openDb(path).close());
  assert.equal(mode(home), 0o700);
  assert.equal(mode(path), 0o600);
});

test('a database outside the tracker home leaves its directory alone', { skip: process.platform === 'win32' }, () => {
  const other = mkdtempSync(join(tmpdir(), 'jh-other-'));
  chmodSync(other, 0o755);
  const path = join(other, 'tracker.db');
  withHome(join(mkdtempSync(join(tmpdir(), 'jh-perm-')), 'home'), () => openDb(path).close());
  assert.equal(mode(other), 0o755);
  assert.equal(mode(path), 0o600);
});

test('permission tightening is best effort: unsupported chmod warns, anything else throws', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'jh-perm-'));
  const file = join(dir, 'f');
  writeFileSync(file, '');
  const failWith = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };
  const lines: string[] = [];
  const realWrite = process.stderr.write;
  process.stderr.write = ((chunk: string) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    for (const code of ['EPERM', 'ENOTSUP', 'EROFS']) {
      secureFile(file, failWith(code));
      secureDir(dir, failWith(code));
    }
  } finally {
    process.stderr.write = realWrite;
  }
  assert.equal(lines.length, 6);
  assert.equal(lines[0], `[job-hunt] could not restrict permissions on ${file}: EPERM\n`);
  assert.throws(() => secureFile(file, failWith('EIO')), /EIO/);
  assert.throws(() => secureDir(dir, failWith('ENOENT')), /ENOENT/);
  secureFile(join(dir, 'missing')); // a missing file is ignored
});

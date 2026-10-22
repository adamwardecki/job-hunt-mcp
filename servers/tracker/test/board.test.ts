// The real board process: state file, health, idle exit. Uses a scratch directory, never ~/.job-hunt.

import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { BoardState } from '../src/board-state.ts';
import { readBoardState } from '../src/board-state.ts';

const ENTRY = fileURLToPath(new URL('../src/board.ts', import.meta.url));

async function waitFor<T>(read: () => T | null, ms: number, what: () => string = () => ''): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out${what()}`);
}

// Starts board.ts against a scratch directory and always cleans up after `body`.
async function withBoard(args: (db: string) => string[], body: (b: { dir: string; db: string; file: string; child: ChildProcess; stdout: () => string; stderr: () => string; exited: Promise<number | null> }) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'jh-board-'));
  const db = join(dir, 'tracker.db');
  const child = spawn(process.execPath, ['--no-warnings', ENTRY, ...args(db)], { env: { ...process.env, JOB_HUNT_HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => {
    out += c;
  });
  child.stderr.on('data', (c) => {
    err += c;
  });
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  try {
    await body({ dir, db, file: join(dir, 'board.json'), child, stdout: () => out, stderr: () => err, exited });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

test('board.ts writes an owner-only state file, answers health checks and exits when idle', { timeout: 20_000 }, async () => {
  await withBoard(
    (db) => ['--db', db, '--idle-ms', '3000'],
    async ({ db, file, child, stdout, stderr, exited }) => {
      const state: BoardState = await waitFor(
        () => readBoardState(file),
        8000,
        () => `; stderr: ${stderr()}`,
      );
      assert.equal(state.pid, child.pid);
      assert.equal(state.db, db);
      assert.match(state.token, /^[0-9a-f]{64}$/);
      if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
      const res = await fetch(`http://127.0.0.1:${state.port}/api/health`, { headers: { authorization: `Bearer ${state.token}` } });
      assert.equal(res.status, 200);
      assert.equal(await exited, 0);
      assert.equal(existsSync(file), false);
      assert.equal(stdout(), '', 'nothing on stdout');
    },
  );
});

test('board.ts rejects a bad --idle-ms with exit code 2 and no state file', { timeout: 20_000 }, async () => {
  for (const bad of ['abc', '0', '-5', '1.5', '2147483648']) {
    await withBoard(
      (db) => ['--db', db, '--idle-ms', bad],
      async ({ file, stderr, exited }) => {
        assert.equal(await exited, 2, bad);
        assert.match(stderr(), /--idle-ms must be an integer from 1 to 2147483647/);
        assert.equal(existsSync(file), false);
      },
    );
  }
});

test('board.ts rejects a flag without a value instead of using the default database', { timeout: 20_000 }, async () => {
  for (const args of [['--db'], ['--db', '--idle-ms', '1000'], ['--idle-ms']]) {
    await withBoard(
      () => args,
      async ({ dir, file, stderr, exited }) => {
        assert.equal(await exited, 2, args.join(' '));
        assert.match(stderr(), /needs a value/);
        assert.equal(existsSync(file), false);
        assert.equal(existsSync(join(dir, 'tracker.db')), false, 'default database not opened');
      },
    );
  }
});

test('board.ts exits 0 and removes its state file on SIGTERM', { timeout: 20_000, skip: process.platform === 'win32' }, async () => {
  await withBoard(
    (db) => ['--db', db, '--idle-ms', '60000'],
    async ({ file, child, stderr, exited }) => {
      await waitFor(
        () => readBoardState(file),
        8000,
        () => `; stderr: ${stderr()}`,
      );
      child.kill('SIGTERM');
      assert.equal(await exited, 0);
      assert.equal(existsSync(file), false);
    },
  );
});

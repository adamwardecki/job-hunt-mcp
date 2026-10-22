// The real board process: state file, health, idle exit. Uses a scratch directory, never ~/.job-hunt.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { BoardState } from '../src/board-state.ts';
import { readBoardState } from '../src/board-state.ts';

const ENTRY = fileURLToPath(new URL('../src/board.ts', import.meta.url));

async function waitFor<T>(read: () => T | null, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

test('board.ts writes an owner-only state file, answers health checks and exits when idle', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jh-board-'));
  const db = join(dir, 'tracker.db');
  const file = join(dir, 'board.json');
  const child = spawn(process.execPath, ['--no-warnings', ENTRY, '--db', db, '--idle-ms', '1500'], { env: { ...process.env, JOB_HUNT_HOME: dir }, stdio: ['ignore', 'pipe', 'ignore'] });
  let stdout = '';
  child.stdout.on('data', (c) => {
    stdout += c;
  });
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  const state: BoardState = await waitFor(() => readBoardState(file), 8000);
  assert.equal(state.pid, child.pid);
  assert.equal(state.db, db);
  assert.match(state.token, /^[0-9a-f]{64}$/);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const res = await fetch(`http://127.0.0.1:${state.port}/api/health`, { headers: { authorization: `Bearer ${state.token}` } });
  assert.equal(res.status, 200);
  assert.equal(await exited, 0);
  assert.equal(existsSync(file), false);
  assert.equal(stdout, '', 'nothing on stdout');
});

// open_board: reuse the board process for this database if it answers, else start board.ts detached.
// The stdio server itself never listens on a port.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardState } from './board-state.ts';
import { boardStatePath, readBoardState } from './board-state.ts';
import { ToolError } from './errors.ts';
import { errorMessage, isRecord } from './util.ts';

const BOARD_ENTRY = fileURLToPath(new URL('./board.ts', import.meta.url));

// Injected so tests never open a browser or depend on a real process.
// spawnBoard resolves with the exit code if the board exits, and never resolves while it runs.
export interface LaunchDeps {
  spawnBoard: (dbPath: string) => Promise<number | null>;
  healthy: (state: BoardState) => Promise<boolean>;
  openBrowser: (url: string) => Promise<void>;
  startTimeoutMs: number;
}

export function spawnBoard(dbPath: string, extraArgs: string[] = []): Promise<number | null> {
  const child = spawn(process.execPath, ['--no-warnings', BOARD_ENTRY, '--db', dbPath, ...extraArgs], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); // a board that fails to start shows up as a missing state file
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
  child.unref();
  return exited;
}

export async function healthy({ port, token }: BoardState): Promise<boolean> {
  try {
    // Another service may own the port now: only our board answers { ok: true } to this token.
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      await res.body?.cancel();
      return false;
    }
    const body: unknown = await res.json();
    return isRecord(body) && body.ok === true;
  } catch {
    return false;
  }
}

// A reused pid may belong to someone else, so this only says whether the board can still be running. It never signals the pid.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// The URL goes in an argument array and no shell runs, so it is never parsed as a command.
export function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  return new Promise((done, fail) => {
    const child = spawn(cmd, [url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', fail);
    child.once('spawn', () => {
      child.unref();
      done();
    });
  });
}

export const DEFAULT_DEPS: LaunchDeps = { spawnBoard: (db) => spawnBoard(db), healthy, openBrowser, startTimeoutMs: 5000 };

// Concurrent calls for one database share one find-or-start, so they cannot spawn two boards.
const inflight = new Map<string, Promise<Found>>();

interface Found {
  state: BoardState;
  reused: boolean;
}

export async function openBoard({ dbPath, open = false }: { dbPath: string | null; open?: boolean }, deps: LaunchDeps = DEFAULT_DEPS) {
  if (!dbPath || dbPath === ':memory:') throw new ToolError('The board needs the on-disk tracker database; this tracker runs in memory.');
  const db = resolve(dbPath);
  let pending = inflight.get(db);
  if (!pending) {
    pending = findOrStart(db, deps).finally(() => inflight.delete(db));
    inflight.set(db, pending);
  }
  const { state, reused } = await pending;
  const url = `http://127.0.0.1:${state.port}/#t=${state.token}`;
  if (open) {
    try {
      await deps.openBrowser(url);
      // The result goes to the model. Once the browser has the link, the model doesn't need the token, so a
      // model can't use it to make moves as the user.
      return { reused, opened: true, markdown: 'The board opened in your browser.' };
    } catch (err) {
      return { url, reused, opened: false, markdown: `Board: ${url}\nThe browser did not open (${errorMessage(err)}). Open the link yourself.` };
    }
  }
  return { url, reused, opened: false, markdown: `Board: ${url}` };
}

async function findOrStart(db: string, deps: LaunchDeps): Promise<Found> {
  const file = boardStatePath(db);
  const existing = readBoardState(file);
  // One board per directory's board.json: a board for a different database in this directory is replaced, by design.
  if (existing && existing.db === db && alive(existing.pid) && (await deps.healthy(existing))) return { state: existing, reused: true };
  rmSync(file, { force: true });
  const exited = deps.spawnBoard(db);
  const started = await waitForState(file, db, deps.startTimeoutMs, exited);
  const run = `node --no-warnings "${BOARD_ENTRY}" --db "${db}"`;
  if (started === 'timeout') throw new ToolError(`The board did not start within ${deps.startTimeoutMs / 1000} s. Try again; if it keeps failing, run ${run} in a terminal and report its error.`);
  if ('exitCode' in started) throw new ToolError(`The board exited${started.exitCode === null ? '' : ` with code ${started.exitCode}`} before it started. Run ${run} in a terminal to see why.`);
  return { state: started.state, reused: false };
}

// Polls for our own state file, and gives up early if the board process has already exited.
async function waitForState(file: string, db: string, timeoutMs: number, exited: Promise<number | null>): Promise<{ state: BoardState } | { exitCode: number | null } | 'timeout'> {
  let exitCode: number | null | undefined;
  exited.then((code) => {
    exitCode = code;
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readBoardState(file);
    if (state && state.db === db) return { state };
    if (exitCode !== undefined) return { exitCode };
    await new Promise((r) => setTimeout(r, 50));
  }
  return 'timeout';
}

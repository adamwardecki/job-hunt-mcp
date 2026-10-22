// open_board: reuse the board process for this database if it answers, else start board.ts detached.
// The stdio server itself never listens on a port.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardState } from './board-state.ts';
import { boardStatePath, readBoardState } from './board-state.ts';
import { ToolError } from './errors.ts';
import { errorMessage } from './util.ts';

const BOARD_ENTRY = fileURLToPath(new URL('./board.ts', import.meta.url));

// Injected so tests never open a browser or depend on a real process.
export interface LaunchDeps {
  spawnBoard: (dbPath: string) => void;
  healthy: (state: BoardState) => Promise<boolean>;
  openBrowser: (url: string) => Promise<void>;
  startTimeoutMs: number;
}

export function spawnBoard(dbPath: string, extraArgs: string[] = []): void {
  const child = spawn(process.execPath, ['--no-warnings', BOARD_ENTRY, '--db', dbPath, ...extraArgs], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); // a board that fails to start shows up as a missing state file
  child.unref();
}

export async function healthy({ port, token }: BoardState): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

// The URL goes in an argument array and no shell runs, so it is never parsed as a command.
export function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  return new Promise((done, fail) => {
    const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
    child.once('error', fail);
    child.once('spawn', () => {
      child.unref();
      done();
    });
  });
}

export const DEFAULT_DEPS: LaunchDeps = { spawnBoard: (db) => spawnBoard(db), healthy, openBrowser, startTimeoutMs: 5000 };

export async function openBoard({ dbPath, open = false }: { dbPath: string | null; open?: boolean }, deps: LaunchDeps = DEFAULT_DEPS) {
  if (!dbPath || dbPath === ':memory:') throw new ToolError('The board needs the on-disk tracker database; this tracker runs in memory.');
  const db = resolve(dbPath);
  const file = boardStatePath(db);
  let reused = true;
  let state = readBoardState(file);
  if (!state || state.db !== db || !(await deps.healthy(state))) {
    reused = false;
    rmSync(file, { force: true });
    deps.spawnBoard(db);
    state = await waitForState(file, deps.startTimeoutMs);
    if (!state) throw new ToolError(`The board did not start within ${deps.startTimeoutMs / 1000} s. Try again; if it keeps failing, run node --no-warnings "${BOARD_ENTRY}" --db "${db}" in a terminal and report its error.`);
  }
  const url = `http://127.0.0.1:${state.port}/#t=${state.token}`;
  let opened = false;
  let note = '';
  if (open) {
    try {
      await deps.openBrowser(url);
      opened = true;
    } catch (err) {
      note = `\nThe browser did not open (${errorMessage(err)}). Open the link yourself.`;
    }
  }
  return { url, reused, opened, markdown: `Board: ${url}${note}` };
}

async function waitForState(file: string, timeoutMs: number): Promise<BoardState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readBoardState(file);
    if (state) return state;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

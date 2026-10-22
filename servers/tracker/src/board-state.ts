// The running board's address and token, written by board.ts and read by open_board.
// It sits next to the database, so a scratch --db never touches the real board's file.

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { secureFile } from './fsperm.ts';
import { isRecord } from './util.ts';

export interface BoardState {
  port: number;
  token: string;
  pid: number;
  db: string;
}

export const boardStatePath = (dbPath: string): string => join(dirname(resolve(dbPath)), 'board.json');

export function readBoardState(file: string): BoardState | null {
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  const { port, token, pid, db } = v;
  if (typeof port !== 'number' || typeof token !== 'string' || typeof pid !== 'number' || typeof db !== 'string') return null;
  return { port, token, pid, db };
}

// Written to a temp file and renamed, so a reader never sees half a file. The token makes it owner-only.
export function writeBoardState(file: string, state: BoardState): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  secureFile(tmp);
  renameSync(tmp, file);
}

// A newer board may have replaced the file; only the one it names removes it.
export function removeBoardState(file: string, pid: number): void {
  if (readBoardState(file)?.pid === pid) rmSync(file, { force: true });
}

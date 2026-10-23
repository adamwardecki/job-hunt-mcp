// The running board's address and token, written by board.ts and read by open_board.
// It sits next to the database, so a scratch --db never touches the real board's file.

import { randomBytes } from 'node:crypto';
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

// board.ts generates 32 random bytes as hex. The token goes into a URL and markdown, so a crafted file must not smuggle other text in.
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

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
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1) return null;
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token) || typeof db !== 'string' || db === '') return null;
  return { port, token, pid, db };
}

// A reused pid may belong to someone else, so this only says whether the board can still be running. It never signals the pid.
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Written to a temp file and renamed, so a reader never sees half a file. The token makes it owner-only.
export function writeBoardState(file: string, state: BoardState): void {
  // Random name, created exclusively: a planted symlink or leftover file in a shared dir like /tmp must not receive the token.
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  try {
    secureFile(tmp);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// A newer board may have replaced the file; only the one it names removes it.
export function removeBoardState(file: string, pid: number): void {
  if (readBoardState(file)?.pid === pid) rmSync(file, { force: true });
}

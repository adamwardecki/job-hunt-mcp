#!/usr/bin/env node
// Board entry: serves the kanban page and its API on 127.0.0.1 for one database. open_board starts it
// detached. It stops itself after --idle-ms (default 30 minutes) without an authenticated API call.
//
// Flags: --db <path> (default as index.ts), --idle-ms <ms>. Logs go to stderr; stdout stays empty.

import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createBoardServer } from './board-server.ts';
import { boardStatePath, removeBoardState, writeBoardState } from './board-state.ts';
import { defaultDbPath, openDb } from './db.ts';
import { Tracker } from './tracker.ts';

const argv = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = argv.indexOf(name);
  return (i >= 0 && argv[i + 1]) || fallback;
};
const log = (msg: string) => process.stderr.write(`[board] ${msg}\n`);

const dbPath = resolve(opt('--db', defaultDbPath()));
const idleMs = Number(opt('--idle-ms', String(30 * 60_000)));
const token = randomBytes(32).toString('hex');
const file = boardStatePath(dbPath);
const server = createBoardServer({ tracker: new Tracker(openDb(dbPath), { dbPath }), token, idleMs, onIdle: stop, log });

function stop(): void {
  removeBoardState(file, process.pid);
  server.closeAllConnections();
  server.close(() => process.exit(0));
}

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('board: no TCP address');
  writeBoardState(file, { port: addr.port, token, pid: process.pid, db: dbPath });
  log(`listening on 127.0.0.1:${addr.port}`);
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

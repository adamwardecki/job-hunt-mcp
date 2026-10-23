// Recognise the local board (servers/tracker/src/board.ts) in a browser URL.

import { alive, boardStatePath, readBoardState } from '../../servers/tracker/src/board-state.ts';

// The only Host values the board answers (board-server.ts).
const BOARD_HOSTS = new Set(['127.0.0.1', 'localhost']);
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

// The port of the board serving the default database, if one is running. A board on a scratch --db is
// still recognised by the token in its link.
export async function runningBoardPort(): Promise<number | null> {
  // Imported lazily like tracker-client.ts: db.ts loads node:sqlite, which most hook runs never need.
  const { defaultDbPath } = await import('../../servers/tracker/src/db.ts');
  const state = readBoardState(boardStatePath(defaultDbPath()));
  return state && alive(state.pid) ? state.port : null;
}

export function isBoardUrl(raw: string, port: number | null): boolean {
  let url: URL;
  try {
    // Browser tools accept "127.0.0.1:1234/" without a scheme; URL would read "127.0.0.1:" as one.
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return false;
  }
  if (!BOARD_HOSTS.has(url.hostname)) return false;
  return TOKEN_SHAPE.test(new URLSearchParams(url.hash.slice(1)).get('t') || '') || (port !== null && url.port === String(port));
}

// Per-session hook state: whether this is a job-hunt session, user approvals, stop-block count.
// Approvals are written only by the UserPromptSubmit hook, i.e. only from what the user typed.

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { secureDir, secureFile } from '../../servers/tracker/src/fsperm.ts';
import type { Approval, SessionState } from './types.ts';

export const APPROVAL_TTL_MS = 2 * 60 * 60 * 1000;

export function home(): string {
  return process.env.JOB_HUNT_HOME || join(homedir(), '.job-hunt');
}

function file(sessionId: string | undefined): string {
  return join(home(), 'sessions', `${String(sessionId || 'unknown').replace(/[^\w.-]/g, '_')}.json`);
}

export function loadSession(sessionId: string | undefined): SessionState {
  try {
    // Written by saveSession below.
    return { approvals: [], consents: [], denials: [], ...JSON.parse(readFileSync(file(sessionId), 'utf8')) } as SessionState;
  } catch {
    return { marked: false, kind: null, approvals: [], consents: [], denials: [], stop_blocks: 0 };
  }
}

export function saveSession(sessionId: string | undefined, state: SessionState): void {
  const f = file(sessionId);
  secureDir(home());
  secureDir(join(home(), 'sessions'));
  try {
    unlinkSync(f + '.tmp'); // a leftover keeps its old mode: { mode } below only applies on create
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  writeFileSync(f + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(f + '.tmp', f);
  secureFile(f); // best effort where the mode above was not honoured
}

export function activeApprovals(list: Approval[] | undefined, now = Date.now()): Approval[] {
  // Old, unscoped approvals are deliberately invalid after the target-binding upgrade.
  return (list || []).filter((a) => typeof a.target_url === 'string' && now - Date.parse(a.at) < APPROVAL_TTL_MS);
}

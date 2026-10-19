// Owner-only permissions for job-hunt data: a CV summary, pay floor, application history and approvals.
// Only paths the current user owns are changed, and nothing is changed where there is no uid (Windows).
// Tightening is best effort: filesystems that cannot chmod (vfat, SMB, read-only, immutable) get a note on stderr, not a crash.

import { chmodSync, mkdirSync, statSync } from 'node:fs';

const uid = process.getuid?.();
const mine = (p: string): boolean => uid !== undefined && statSync(p).uid === uid;

const UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EROFS']);
const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

type Chmod = (path: string, mode: number) => void;

function restrict(path: string, mode: number, chmod: Chmod, missingOk: boolean): void {
  try {
    if (mine(path)) chmod(path, mode);
  } catch (err) {
    const code = codeOf(err);
    if (missingOk && code === 'ENOENT') return;
    if (code === undefined || !UNSUPPORTED.has(code)) throw err;
    process.stderr.write(`[job-hunt] could not restrict permissions on ${path}: ${code}\n`);
  }
}

export function secureDir(dir: string, chmod: Chmod = chmodSync): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  restrict(dir, 0o700, chmod, false);
}

// A missing file is fine: SQLite creates and removes -wal and -shm as connections come and go.
export function secureFile(file: string, chmod: Chmod = chmodSync): void {
  restrict(file, 0o600, chmod, true);
}

// gate_check from a hook: reads the local tracker database read-only.

import { existsSync } from 'node:fs';

import type { GateResult } from '../../servers/tracker/src/tracker.ts';
import { errorMessage } from '../../servers/tracker/src/util.ts';

export async function gateCheck(roleId: number): Promise<GateResult> {
  try {
    const { defaultDbPath, openDb } = await import('../../servers/tracker/src/db.ts');
    const path = defaultDbPath();
    if (!existsSync(path)) return { ok: false, problems: [`No tracker database at ${path}. A submit cannot be checked, so it is blocked.`] };
    const { Tracker } = await import('../../servers/tracker/src/tracker.ts');
    const t = new Tracker(openDb(path, { readOnly: true }));
    return t.gateCheck({ role_id: roleId });
  } catch (err) {
    return { ok: false, problems: [`Tracker check failed (${errorMessage(err)}). Blocked.`] };
  }
}

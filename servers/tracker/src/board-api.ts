// What the board page reads and the one write it makes. board-server.ts calls these; the MCP server does not.

import { ToolError } from './errors.ts';
import type { Status, Tracker } from './tracker.ts';
import { MACHINE, STATUSES } from './tracker.ts';
import { isRecord, oneOf } from './util.ts';

// These steps need research with evidence (the verify-employer and score-role skills), so a drag can't do them.
const CLAUDE_ONLY: readonly Status[] = ['verified', 'scored'];
const MOVE_KEYS = ['role_id', 'to', 'reason', 'evidence', 'outcome'];

export interface BoardRole {
  id: number;
  company: string;
  title: string;
  status: Status;
  score: number | null;
  location_type: string | null;
  url: string | null;
  last_event: string | null;
  question: string | null;
}

export function boardView(t: Tracker) {
  const roles = t.q<BoardRole>(`SELECT r.id, c.name AS company, r.title, COALESCE(r.status, 'found') AS status, r.score, r.location_type, r.url,
      (SELECT MAX(ts) FROM events e WHERE e.role_id = r.id) AS last_event,
      CASE WHEN r.status = 'queued' THEN (SELECT question FROM events e WHERE e.role_id = r.id AND e.status = 'queued' ORDER BY e.ts DESC, e.id DESC LIMIT 1) END AS question
    FROM roles r JOIN companies c ON c.id = r.company_id ORDER BY r.score DESC NULLS LAST, r.updated_at DESC`);
  // Object.fromEntries loses key types; the keys come from STATUSES, so the cast cannot lie.
  const moves = Object.fromEntries(STATUSES.map((s) => [s, MACHINE[s].filter((to) => !CLAUDE_ONLY.includes(to))])) as Record<Status, Status[]>;
  // node:sqlite rows have a null prototype; plain objects keep the view comparable and serialisable like any other.
  const rules = t.q<{ id: number; text: string }>('SELECT id, text FROM rules WHERE active = 1 ORDER BY id').map(({ id, text }) => ({ id, text }));
  return { statuses: STATUSES, roles, moves, rules };
}

const optionalString = (key: string, v: unknown): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ToolError(`${key} must be a string.`);
  return v;
};

export function boardMove(t: Tracker, body: unknown) {
  if (!isRecord(body)) throw new ToolError('Send a JSON object: {role_id, to, reason, evidence?, outcome?}.');
  const extra = Object.keys(body).filter((k) => !MOVE_KEYS.includes(k));
  if (extra.length) throw new ToolError(`Unknown field: ${extra.join(', ')}`);
  const { role_id, to } = body;
  if (typeof role_id !== 'number' || !Number.isInteger(role_id)) throw new ToolError('role_id must be an integer.');
  if (!oneOf(STATUSES, to)) throw new ToolError(`to must be one of: ${STATUSES.join(', ')}`);
  if (CLAUDE_ONLY.includes(to)) throw new ToolError(`Moving to ${to} needs Claude: run a sweep, or ask Claude to verify and score role ${role_id}.`);
  // A same-status transition is legal (re-running a step with new evidence) but would only add a no-op event here.
  if (t.roleRow(role_id)?.status === to) throw new ToolError(`Role ${role_id} is already ${to}.`);
  const args = { role_id, to, reason: optionalString('reason', body.reason) ?? '', evidence: optionalString('evidence', body.evidence), outcome: optionalString('outcome', body.outcome) };
  return t.transition(args, { actor: 'user' });
}

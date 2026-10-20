// Hermes host adapter. Hermes hook payloads differ from Claude Code's: tool names can be
// connectors__x__y or built-in browser_* tools, and there is no transcript file. These helpers map
// Hermes onto the shapes hooks/gates.ts already understands, so the gate logic stays shared.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { secureDir, secureFile } from '../../../servers/tracker/src/fsperm.ts';
import { isRecord } from '../../../servers/tracker/src/util.ts';
import { home } from '../session.ts';
import type { ToolInput } from '../types.ts';

// The Hermes hook kwargs that __init__.py pipes to hooks/hermes.ts as JSON.
export interface HermesPayload {
  session_id?: string;
  task_id?: string;
  parent_session_id?: string;
  tool_call_id?: string;
  tool_name?: string;
  args?: ToolInput;
  result?: unknown;
  user_message?: unknown;
}

export function normalizeToolName(name: unknown): string {
  const n = String(name || '');
  if (n.startsWith('mcp__')) return n;
  if (n.startsWith('connectors__')) return `mcp__${n.slice('connectors__'.length)}`;
  if (n.startsWith('browser_')) return `mcp__hermes_browser__${n}`;
  return n;
}

const MAX_RESULT_CHARS = 100_000;
const safeId = (id: unknown) => String(id || 'unknown').replace(/[^\w.-]/g, '_');

export function stepsPath(sessionId: string | undefined): string {
  return join(home(), 'sessions', `${safeId(sessionId)}.steps.jsonl`);
}

function isErrorResult(parsed: unknown): boolean {
  return isRecord(parsed) && parsed.error != null && parsed.error !== false;
}

function flatten(value: unknown, key: string, out: string[]): string[] {
  if (value == null) return out;
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, Array.isArray(value) ? key : k, out);
    return out;
  }
  out.push(key ? `${key}: ${value}` : String(value));
  return out;
}

function resultText(result: unknown): { text: string; isError: boolean } {
  const raw = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: raw, isError: false };
  }
  const flat = typeof parsed === 'object' && parsed !== null ? flatten(parsed, '', []).join('\n') : String(parsed);
  return { text: `${flat}\n${raw}`, isError: isErrorResult(parsed) };
}

export function appendStep(p: HermesPayload): void {
  const id = p.tool_call_id || `hc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { text, isError } = resultText(p.result);
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: normalizeToolName(p.tool_name), input: p.args || {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text.slice(0, MAX_RESULT_CHARS), is_error: isError }] } },
  ];
  secureDir(join(home(), 'sessions'));
  const path = stepsPath(p.session_id);
  appendFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, { mode: 0o600 });
  secureFile(path);
}

// Markers copied from Hermes agent/skill_commands.py; keep them byte-identical.
const INVOKED = '[IMPORTANT: The user has invoked the ';
const LOADED = 'The full skill content is loaded below.]';
const INSTRUCTION = 'The user has provided the following instruction alongside the skill invocation: ';
const RUNTIME_NOTE = '\n\n[Runtime note:';

// A slash-skill turn embeds the whole skill body. Only the skill name and the user's own instruction
// (after the LAST instruction marker) may be read. The body can quote "/j-hunt:approve 999" and
// must never count as approval.
export function unwrapSkillInvocation(text: string): { text: string; skill: string | null; args: string | null } {
  if (!text.startsWith(INVOKED) || !text.includes(LOADED)) return { text, skill: null, args: null };
  const skill = (text.slice(INVOKED.length).match(/^"\/?([^"]*)"/) || [])[1] || null;
  const at = text.lastIndexOf(INSTRUCTION);
  let args = at < 0 ? '' : text.slice(at + INSTRUCTION.length);
  const end = args.indexOf(RUNTIME_NOTE);
  if (end >= 0) args = args.slice(0, end);
  args = args.trim();
  return { text: skill ? `/${skill}${args ? ` ${args}` : ''}` : args, skill, args };
}

export function userText(message: unknown): string {
  const text = typeof message === 'string'
    ? message
    : Array.isArray(message)
      ? message.map((c) => (typeof c === 'string' ? c : isRecord(c) && c.type === 'text' ? c.text || '' : '')).filter(Boolean).join('\n')
      : '';
  return unwrapSkillInvocation(text).text;
}

// Read the session transcript (JSONL) to see what the model has already seen and done:
// element labels behind browser refs, the current page URL, tool calls and their results.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { isRecord } from '../../servers/tracker/src/util.ts';
import type { ToolInput, ToolStep } from './types.ts';

// A content block in a transcript message, as Claude Code writes it (Hermes steps mimic it).
interface ContentBlock {
  type?: string;
  id: string;
  name: string;
  input?: ToolInput;
  tool_use_id: string;
  content?: unknown;
  is_error?: unknown;
}

const TAIL_BYTES = 4 * 1024 * 1024;

export function readTranscript(path: string | undefined): unknown[] {
  if (!path) return [];
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.flatMap((l): unknown[] => {
      try {
        return l.trim() ? [JSON.parse(l)] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : isRecord(c) ? (c.text ?? '') : '')).join('\n') : content == null ? '' : JSON.stringify(content);

// Flatten into ordered steps: {kind: 'use', id, name, input} and {kind: 'result', id, name, text, isError}.
export function toolSteps(entries: unknown[]): ToolStep[] {
  const names = new Map<string, string>();
  const steps: ToolStep[] = [];
  for (const e of entries) {
    const content = isRecord(e) && isRecord(e.message) ? e.message.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      const c = block as unknown as ContentBlock;
      if (c.type === 'tool_use') {
        names.set(c.id, c.name);
        steps.push({ kind: 'use', id: c.id, name: c.name, input: c.input || {} });
      } else if (c.type === 'tool_result') {
        steps.push({ kind: 'result', id: c.tool_use_id, name: names.get(c.tool_use_id) || '', text: textOf(c.content), isError: c.is_error === true || c.is_error === 'True' });
      }
    }
  }
  return steps;
}

// The accessibility-tree line that mentions `ref`, newest first: e.g. `button "Submit application" [ref_45]`.
export function labelForRef(steps: ToolStep[], ref: string | null | undefined): string | null {
  if (!ref) return null;
  const re = new RegExp(`(^|[^\\w])${String(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`);
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!; // i is within steps by the loop bounds.
    if (s.kind !== 'result' || !s.text || !re.test(s.text)) continue;
    const line = s.text.split('\n').find((l) => re.test(l));
    if (line) return line.trim().slice(0, 400);
  }
  return null;
}

// Most recent page URL seen in a browser tool's input or result.
export function currentUrl(steps: ToolStep[]): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!; // i is within steps by the loop bounds.
    if (!/browser|chrome|playwright|puppeteer|computer/i.test(s.name)) continue;
    if (s.kind === 'use' && typeof s.input?.url === 'string') return s.input.url;
    if (s.kind === 'result') {
      const m = s.text.match(/(?:url|URL|Page URL|Navigated to|Current URL)["']?\s*[:=]?\s*["']?(https?:\/\/[^\s"'<>)]+)/);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

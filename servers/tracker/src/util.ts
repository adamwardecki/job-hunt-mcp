// Small helpers shared by the tracker and the hooks.

// Parse JSON text from storage or the wire. The caller states what it expects; nothing is checked here.
export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s == null ? fallback : (JSON.parse(s) as T);
  } catch {
    return fallback;
  }
}

// Narrow a string to one of a fixed list of literals.
export function oneOf<const T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

// For logs: the stack when there is one.
export function errorText(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

// For messages returned to the model or the user.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A plain JSON object (not null, not an array).
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

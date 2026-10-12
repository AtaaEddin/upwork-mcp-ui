/**
 * Defensive shape helpers (plan 06 pattern, extracted for reuse in 07b).
 *
 * Upwork result field names are "server-decided": every mapper probes
 * documented names first, then plausible aliases, and degrades to `null`
 * instead of throwing. Unknown shapes must never crash a page.
 */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Trimmed non-empty string, or finite number as string; else null. */
export function stringOrNumber(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** Finite number; else null. */
export function numberOr(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Date-ish values pass through as strings. */
export function dateOf(v: unknown): string | null {
  return stringOrNumber(v);
}

/**
 * The preferred nested entity record (first key holding an object),
 * falling back to the top-level record itself.
 */
export function entityRecord(
  data: unknown,
  preferred: string[],
): Record<string, unknown> | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const rec = data as Record<string, unknown>;
  for (const key of preferred) {
    const v = rec[key];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }
  return rec;
}

/**
 * The list of items in a list result: the top-level array, the first
 * named container array, else the first array of plain objects.
 */
export function extractListItems(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  for (const key of keys) {
    const v = data[key];
    if (Array.isArray(v)) return v;
  }
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && typeof x === 'object')) {
      return v;
    }
  }
  return [];
}

/** String list, accepting `{name|title}` objects. */
export function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && x.trim() !== '') out.push(x.trim());
    else if (x !== null && typeof x === 'object') {
      const s = stringOrNumber((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).title);
      if (s !== null) out.push(s);
    }
  }
  return out;
}

/** `$1,234` for numeric values; other strings pass through. */
export function formatMoney(v: string | null): string | null {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `$${n.toLocaleString('en-US')}`;
}

/** Numeric ids only (`"123"`, 123); non-numeric strings → null. */
export function numericStringOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return v.trim();
  return null;
}

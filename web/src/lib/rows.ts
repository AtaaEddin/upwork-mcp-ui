/**
 * Generic list-result mapping (plan 06): invitations, offers, rooms, …
 * Field names are server-decided, so this looks for documented names and
 * falls back gracefully. Used for dashboard counts and preview rows.
 */

export interface ListRow {
  key: string;
  title: string;
  sub: string | null;
  url: string | null;
}

export interface ListResult {
  count: number;
  items: ListRow[];
}

const ITEM_KEYS = ['invitations', 'offers', 'rooms', 'items', 'results', 'data', 'list'];

export function mapListResult(data: unknown): ListResult {
  if (data === null || data === undefined || typeof data !== 'object') return { count: 0, items: [] };
  const rec = data as Record<string, unknown>;
  let items: unknown[] = [];
  for (const key of ITEM_KEYS) {
    if (Array.isArray(rec[key])) {
      items = rec[key] as unknown[];
      break;
    }
  }
  if (items.length === 0 && Array.isArray(rec)) items = rec as unknown[];
  const rows: ListRow[] = [];
  items.forEach((item, i) => {
    if (item === null || typeof item !== 'object') return;
    const rec2 = item as Record<string, unknown>;
    const title =
      stringOf(rec2.title ?? rec2.job_title ?? rec2.name ?? rec2.subject ?? rec2.job_name) ?? 'Item';
    const sub =
      stringOf(
        rec2.client_name ??
          rec2.job_title ??
          rec2.status ??
          (rec2.job !== null && typeof rec2.job === 'object'
            ? ((rec2.job as Record<string, unknown>).title as unknown)
            : null),
      );
    rows.push({
      key: stringOf(rec2.id ?? rec2.invitation_id ?? rec2.offer_id ?? rec2.room_id ?? rec2.key) ?? `row-${i}`,
      title,
      sub: sub !== null && sub !== title ? sub : null,
      url: stringOf(rec2.url ?? rec2.link),
    });
  });
  return { count: rows.length, items: rows };
}

function stringOf(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Connects balance from `upwork__get_profile action: 'connects_balance'`.
 * "Balance is the Connects wallet" (official plugin); field names are
 * server-decided, so probe the plausible ones.
 */
export function connectsBalanceOf(data: unknown): number | null {
  if (data === null || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  const flat = numberOr(rec.balance) ?? numberOr(rec.credits_balance) ?? numberOr(rec.connects_balance);
  if (flat !== null) return flat;
  const wallet = rec.wallet;
  if (wallet !== null && typeof wallet === 'object') {
    return numberOr((wallet as Record<string, unknown>).balance);
  }
  return null;
}

function numberOr(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Job search/detail data mapping (plan 06).
 *
 * Upwork's `find_jobs` result field names are documented as "the server
 * decides" — so every mapper here is defensive: it looks for the documented
 * names first, then plausible aliases, and degrades to `null` instead of
 * throwing. Unknown shapes must never crash a page.
 */

export interface JobFilters {
  query: string;
  category: string;
  budgetMin: string;
  budgetMax: string;
  jobType: 'any' | 'hourly' | 'fixed';
}

export const EMPTY_FILTERS: JobFilters = {
  query: '',
  category: '',
  budgetMin: '',
  budgetMax: '',
  jobType: 'any',
};

/**
 * Build the `find_jobs` arguments for `action: 'search'`.
 * Arg names follow the documented best known so far (plan 06, D6.1); the
 * server echoes its feedback (`empty_reason`, `filters_ignored`) in the
 * result, and the UI surfaces it. `page` is the echo of the previous
 * page's pagination values (pass-through pagination, D6.3).
 */
export function buildSearchArgs(
  filters: JobFilters,
  orgUid: string,
  page?: Record<string, unknown> | null,
): Record<string, unknown> {
  const args: Record<string, unknown> = { action: 'search', org_uid: orgUid };
  const query = filters.query.trim();
  if (query !== '') args.query = query;
  const category = filters.category.trim();
  if (category !== '') args.category = category;
  const min = parseBudget(filters.budgetMin);
  if (min !== null) args.budget_min = min;
  const max = parseBudget(filters.budgetMax);
  if (max !== null) args.budget_max = max;
  if (filters.jobType !== 'any') args.job_type = filters.jobType;
  if (page) Object.assign(args, page);
  return args;
}

/** Build the `find_jobs` arguments for `action: 'smart_search'`. */
export function buildSmartArgs(
  orgUid: string,
  mode: 'best_match' | 'most_recent' = 'best_match',
  page?: Record<string, unknown> | null,
): Record<string, unknown> {
  const args: Record<string, unknown> = { action: 'smart_search', org_uid: orgUid, mode };
  if (page) Object.assign(args, page);
  return args;
}

/**
 * Build the `find_jobs` arguments for `action: 'get'`. `jobKey` accepts the
 * numeric id, the `~02…` ciphertext, or the full job URL (D6.1).
 * Returns `null` for an empty key — callers must not send `get` without an id
 * (Upwork answers `id is required` with a trace id, which is useless).
 */
export function buildGetArgs(jobKey: string, orgUid: string): Record<string, unknown> | null {
  const key = jobKey.trim();
  if (key === '') return null;
  return { action: 'get', org_uid: orgUid, id: key };
}

/**
 * Placeholder keys are what `mapJobRow` emits for a search row that carries
 * no recognizable job reference (`row-<index>`). They are valid DOM/route
 * keys but are NOT acceptable `find_jobs get` ids — pages must not send
 * them upstream and must offer the paste-a-reference recovery instead.
 */
export function isPlaceholderJobKey(key: string): boolean {
  return /^row-\d+$/.test(key.trim());
}

function parseBudget(raw: string): number | null {
  const text = raw.trim().replace(/[$,\s]/g, '');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Server feedback + pagination extracted from a job search result. */
export interface JobMeta {
  emptyReason: string | null;
  filtersIgnored: string[] | null;
  needsDetails: string | null;
  suggestedNextStep: string | null;
  total: number | null;
  /** Echo of the returned pagination values; `null` ⇒ no further page. */
  nextPage: Record<string, unknown> | null;
  hasMore: boolean;
}

export interface JobRow {
  /** Stable DOM key. */
  key: string;
  /**
   * What to pass to `find_jobs get` (ciphertext > numeric id > URL). When
   * the live row carries no recognizable reference this is the `row-<index>`
   * placeholder (`isPlaceholderJobKey`) — the detail page then offers the
   * paste-a-reference recovery instead of calling Upwork.
   */
  jobKey: string;
  url: string | null;
  title: string;
  budget: string | null;
  skills: string[];
  client: string | null;
  clientMeta: string | null;
  posted: string | null;
  applied: boolean;
}

export interface JobResult {
  rows: JobRow[];
  meta: JobMeta;
}

const ITEM_KEYS = ['jobs', 'items', 'results', 'data', 'list', 'job_list'];
const PAGED_KEYS = /^(next|prev|previous|page|cursor|offset|after|from|token|tokens|limit|count|size)/i;

/** Normalize any plausible `find_jobs` result into rows + meta. */
export function mapJobResult(data: unknown): JobResult {
  if (data === null || data === undefined || typeof data !== 'object') {
    return { rows: [], meta: emptyMeta() };
  }
  const rec = data as Record<string, unknown>;
  const items = findItems(rec);
  const rows = items
    .map((item, i) => (item !== null && typeof item === 'object' ? mapJobRow(item as Record<string, unknown>, i) : null))
    .filter((r): r is JobRow => r !== null);
  return { rows, meta: readMeta(rec, rows.length) };
}

function emptyMeta(): JobMeta {
  return {
    emptyReason: null,
    filtersIgnored: null,
    needsDetails: null,
    suggestedNextStep: null,
    total: null,
    nextPage: null,
    hasMore: false,
  };
}

function findItems(rec: Record<string, unknown>): unknown[] {
  if (Array.isArray(rec)) return rec;
  for (const key of ITEM_KEYS) {
    const v = rec[key];
    if (Array.isArray(v)) return v;
  }
  for (const v of Object.values(rec)) {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && typeof x === 'object')) {
      return v;
    }
  }
  return [];
}

function mapJobRow(item: Record<string, unknown>, index: number): JobRow | null {
  const title = stringOf(item.title ?? item.job_title ?? item.heading ?? item.name);
  const id = stringOf(item.id ?? item.job_id ?? item.id_numeric ?? item.numeric_id);
  const ciphertext = ciphertextOf(item);
  const url = stringOf(item.url ?? item.job_url ?? item.link);
  const jobKey = ciphertext ?? id ?? url;
  if (jobKey === null && title === null) return null;
  const key = jobKey ?? `row-${index}`;
  return {
    key,
    jobKey: jobKey ?? key,
    url,
    title: title ?? 'Untitled job',
    budget: formatBudget(item),
    skills: stringList(item.skills ?? item.skill_list ?? item.top_skills ?? item.categories),
    client: clientName(item),
    clientMeta: clientMetaOf(item),
    posted: dateOf(item.posted_at ?? item.created_at ?? item.posted ?? item.date_posted),
    applied: item.applied === true,
  };
}

function stringOf(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** Ciphertext ids look like `~02…`; they are the safest `get` input. */
function ciphertextOf(item: Record<string, unknown>): string | null {
  for (const key of ['job_key', 'posting_key', 'key', 'ciphertext']) {
    const v = stringOf(item[key]);
    if (v !== null) return v;
  }
  for (const v of Object.values(item)) {
    if (typeof v === 'string' && v.startsWith('~02')) return v;
  }
  return null;
}

function formatBudget(item: Record<string, unknown>): string | null {
  const fixed = rangeOf(item.fixed_price ?? item.budget);
  if (fixed !== null) return `Fixed: ${formatRange(fixed)}`;
  const hourly = rangeOf(item.hourly_rate ?? item.rate);
  if (hourly !== null) return `${formatRange(hourly)}/hr`;
  return stringOf(item.budget_text ?? item.price_text);
}

function rangeOf(v: unknown): { min: number; max: number } | null {
  if (typeof v === 'number' && Number.isFinite(v)) return { min: v, max: v };
  if (v !== null && typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    const min = numberOr(rec.min);
    const max = numberOr(rec.max);
    if (min !== null || max !== null) {
      return { min: min ?? max ?? 0, max: max ?? min ?? 0 };
    }
  }
  return null;
}

function numberOr(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function formatRange(r: { min: number; max: number }): string {
  if (r.min === r.max) return `$${r.min}`;
  return `$${r.min} – $${r.max}`;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && x !== '') out.push(x);
    else if (x !== null && typeof x === 'object') {
      const s = stringOf((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).skill);
      if (s !== null) out.push(s);
    }
  }
  return out;
}

function clientName(item: Record<string, unknown>): string | null {
  const direct = stringOf(item.client_name);
  if (direct !== null) return direct;
  const client = item.client;
  if (client !== null && typeof client === 'object') {
    return stringOf((client as Record<string, unknown>).name) ?? stringOf((client as Record<string, unknown>).company);
  }
  const user = item.user;
  if (user !== null && typeof user === 'object') {
    return stringOf((user as Record<string, unknown>).name);
  }
  return null;
}

function clientMetaOf(item: Record<string, unknown>): string | null {
  const client = item.client;
  if (client === null || typeof client !== 'object') return null;
  const c = client as Record<string, unknown>;
  const bits: string[] = [];
  const rating = numberOr(c.rating) ?? numberOr(c.overall_rating);
  if (rating !== null) bits.push(`★ ${rating}`);
  const contracts = numberOr(c.num_contracts) ?? numberOr(c.contracts);
  if (contracts !== null) bits.push(`${contracts} contracts`);
  const location = stringOf(c.location);
  if (location !== null) bits.push(location);
  return bits.length > 0 ? bits.join(' · ') : null;
}

function dateOf(v: unknown): string | null {
  const s = stringOf(v);
  return s;
}

function readMeta(rec: Record<string, unknown>, rowCount: number): JobMeta {
  const meta = emptyMeta();
  meta.emptyReason = stringOf(rec.empty_reason ?? rec.emptyReason);
  const ignored = rec.filters_ignored ?? rec.filtersIgnored;
  if (Array.isArray(ignored)) {
    meta.filtersIgnored = ignored.map((x) =>
      typeof x === 'string' ? x : x !== null && typeof x === 'object'
        ? stringOf((x as Record<string, unknown>).term) ?? stringOf((x as Record<string, unknown>).name) ?? 'filter'
        : 'filter',
    );
  }
  const needs = rec.needs_details ?? rec.needsDetails;
  meta.needsDetails = typeof needs === 'string' && needs.trim() !== '' ? needs.trim() : null;
  meta.suggestedNextStep = stringOf(rec.suggested_next_step);
  const total = numberOr(rec.total) ?? numberOr(rec.total_count);
  meta.total = total;
  if (rowCount > 0) {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'page_size' || k === 'pageSize') continue;
      if (PAGED_KEYS.test(k) && (typeof v === 'string' || typeof v === 'number' || v !== null && typeof v === 'object')) {
        next[k] = v;
      }
    }
    meta.nextPage = Object.keys(next).length > 0 ? next : null;
    meta.hasMore =
      meta.nextPage !== null || rec.has_more === true || rec.more === true || rec.next === true;
  } else {
    meta.hasMore = rec.has_more === true || rec.more === true || rec.next === true;
  }
  return meta;
}

/** Detail payload for `find_jobs action: 'get'`. */
export interface JobDetailData {
  jobKey: string | null;
  title: string;
  url: string | null;
  budget: string | null;
  connectsCost: number | null;
  posted: string | null;
  client: string | null;
  clientMeta: string | null;
  description: string | null;
  requirements: string[];
  skills: string[];
  applied: boolean;
  /** The raw payload, for the "raw JSON" dev view. */
  raw: unknown;
}

export function mapJobDetail(data: unknown, fallbackKey: string): JobDetailData | null {
  const job = jobRecord(data);
  if (job === null) return null;
  return {
    jobKey: ciphertextOf(job) ?? stringOf(job.id ?? job.job_id ?? job.id_numeric) ?? fallbackKey,
    title: stringOf(job.title ?? job.job_title ?? job.heading) ?? 'Job',
    url: stringOf(job.url ?? job.job_url ?? job.link),
    budget: formatBudget(job),
    connectsCost: numberOr(job.connects_cost) ?? numberOr(job.credits_cost),
    posted: dateOf(job.posted_at ?? job.created_at ?? job.posted),
    client: clientName(job),
    clientMeta: clientMetaOf(job),
    description:
      stringOf(job.description) ?? stringOf(job.details) ?? stringOf(job.overview) ?? stringOf(job.job_description),
    requirements: requirementsOf(job),
    skills: stringList(job.skills ?? job.skill_list ?? job.top_skills ?? job.categories),
    applied: job.applied === true,
    raw: data,
  };
}

function jobRecord(data: unknown): Record<string, unknown> | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const rec = data as Record<string, unknown>;
  for (const key of ['job', 'item', 'data', 'job_details']) {
    const v = rec[key];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return rec;
}

function requirementsOf(job: Record<string, unknown>): string[] {
  const out: string[] = [];
  const screening = job.screening_questions ?? job.questions ?? job.screening;
  if (Array.isArray(screening)) {
    for (const q of screening) {
      if (typeof q === 'string' && q.trim() !== '') out.push(q.trim());
      else if (q !== null && typeof q === 'object') {
        const s = stringOf(
          (q as Record<string, unknown>).question ??
            (q as Record<string, unknown>).text ??
            (q as Record<string, unknown>).title,
        );
        if (s !== null) out.push(s);
      }
    }
  }
  const req = job.requirements ?? job.must_haves;
  if (Array.isArray(req)) {
    for (const r of req) {
      if (typeof r === 'string' && r.trim() !== '') out.push(r.trim());
    }
  }
  return out;
}

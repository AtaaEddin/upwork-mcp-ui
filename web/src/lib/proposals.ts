/**
 * Proposals data mapping + draft-confirm guard (plan 07a).
 *
 * Upwork's `list_freelancer_proposals` / `manage_proposals` / `confirm_preview`
 * result field names are "server-decided" — every mapper here is defensive
 * (plan 06 pattern): documented names first, plausible aliases, degrade to
 * `null` instead of throwing. Unknown shapes must never crash a page.
 *
 * Draft-confirm contract (official write-proposal skill, plan 07 D7.1):
 * `manage_proposals` action `create` returns a PREVIEW (`preview_id` + `type`)
 * and performs no marketplace action; `confirm_preview` action `confirm`
 * with the returned `type` + `preview_id` submits. This module owns
 * `canConfirmPreview` — the guard the UI enforces before any confirm call.
 */

export interface ProposalRow {
  /** Stable DOM key. */
  key: string;
  /** Numeric id for `list_freelancer_proposals` action `get` (null ⇒ no detail). */
  id: string | null;
  title: string;
  clientName: string | null;
  /** Raw status code (e.g. `Pending`). */
  status: string | null;
  /** Plain-English label — preferred for display over the raw code. */
  statusLabel: string | null;
  /** Formatted bid, if reported. */
  bid: string | null;
  posted: string | null;
  /** Link key for `/jobs/:jobKey` (ciphertext > numeric id > URL). */
  jobKey: string | null;
  raw: unknown;
}

const LIST_ITEM_KEYS = [
  'proposals',
  'proposals_list',
  'items',
  'results',
  'data',
  'list',
];

/** Normalize a `list_freelancer_proposals` action `list` result into rows. */
export function mapProposals(data: unknown): ProposalRow[] {
  const items = extractListItems(data, LIST_ITEM_KEYS);
  const rows: ProposalRow[] = [];
  items.forEach((item, i) => {
    if (item === null || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const id = stringOrNumber(rec.id ?? rec.proposal_id ?? rec.proposal);
    const title =
      stringOrNumber(rec.title ?? rec.job_title) ??
      (rec.job !== null && typeof rec.job === 'object'
        ? stringOrNumber((rec.job as Record<string, unknown>).title)
        : null) ??
      'Proposal';
    const jobRec = (rec.job ?? null) as Record<string, unknown> | null;
    const jobKey =
      stringOrNumber(rec.job_key ?? rec.job_id) ??
      (jobRec !== null ? stringOrNumber(jobRec.job_key ?? jobRec.id) : null) ??
      (typeof rec.url === 'string' ? rec.url : null) ??
      id;
    rows.push({
      key: id ?? `row-${i}`,
      id,
      title,
      clientName: stringOrNumber(rec.client_name ?? rec.client ?? rec.user_name),
      status: stringOrNumber(rec.status),
      statusLabel: stringOrNumber(rec.status_label ?? rec.statusLabel),
      bid: formatCharged(rec),
      posted: dateOf(rec.posted_at ?? rec.created_at ?? rec.date_posted ?? rec.updated_at),
      jobKey,
      raw: item,
    });
  });
  return rows;
}

/** Detail payload for `list_freelancer_proposals` action `get`. */
export interface ProposalDetailData {
  status: string | null;
  statusLabel: string | null;
  clientName: string | null;
  jobTitle: string | null;
  jobKey: string | null;
  url: string | null;
  /** The stored bid Upwork recorded (can differ from the sent amount). */
  chargedAmount: string | null;
  connectsBid: string | null;
  coverLetter: string | null;
  screening: Array<{ question: string; answer: string }>;
  attachments: string[];
  raw: unknown;
}

export function mapProposalDetail(data: unknown): ProposalDetailData | null {
  const rec = entityRecord(data, ['proposal', 'item', 'data']);
  if (rec === null) return null;
  const terms = (rec.terms ?? rec.proposal_terms) as Record<string, unknown> | null;
  const screening: Array<{ question: string; answer: string }> = [];
  const rawScreening = rec.screening_answers ?? rec.answers ?? rec.screening;
  if (Array.isArray(rawScreening)) {
    for (const item of rawScreening) {
      if (item === null || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const question = stringOrNumber(r.question ?? r.title);
      const answer = stringOrNumber(r.answer ?? r.response ?? r.text);
      if (question !== null && answer !== null) screening.push({ question, answer });
    }
  }
  return {
    status: stringOrNumber(rec.status),
    statusLabel: stringOrNumber(rec.status_label ?? rec.statusLabel),
    clientName: stringOrNumber(rec.client_name ?? rec.client),
    jobTitle: stringOrNumber(rec.title ?? rec.job_title),
    jobKey: stringOrNumber(rec.job_key ?? rec.job_id),
    url: stringOrNumber(rec.url ?? rec.job_url),
    chargedAmount:
      terms !== null
        ? formatMoney(stringOrNumber(terms.charged_amount ?? terms.bid ?? terms.amount))
        : formatMoney(stringOrNumber(rec.charged_amount)),
    connectsBid:
      terms !== null ? stringOrNumber(terms.connects_bid ?? terms.connectsBid) : null,
    coverLetter: stringOrNumber(rec.cover_letter ?? rec.proposal_text ?? rec.message),
    screening,
    attachments: stringList(rec.attachments ?? rec.files ?? rec.file_uids),
    raw: data,
  };
}

/**
 * Draft values collected by the form (`buildCreateArgs` input).
 * `jobNumericId` is the numeric job id from `find_jobs` action `get` —
 * `manage_proposals` create rejects the `~02…` ciphertext.
 */
export interface DraftValues {
  jobNumericId: string | null;
  chargedAmount: number;
  coverLetter: string;
  /** question → answer (only answered questions). */
  screeningAnswers: Array<{ question: string; answer: string }>;
  portfolioProjectIds: string[];
  certificateIds: string[];
}

/**
 * Items of `list_freelancer_proposals` action `invitations` (raw rows for
 * `matchesJob`). Field names are server-decided, so the list container is
 * probed like any other list result.
 */
export function invitationsOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data === null || typeof data !== 'object') return [];
  const rec = data as Record<string, unknown>;
  for (const key of ['invitations', 'items', 'results', 'data', 'list']) {
    if (Array.isArray(rec[key])) return rec[key];
  }
  for (const v of Object.values(rec)) {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && typeof x === 'object')) {
      return v;
    }
  }
  return [];
}

/**
 * Args for `manage_proposals` action `create` (plan 07, D7.2). `org_uid`
 * and `action` are injected by `callFeature`.
 */
export function buildCreateArgs(values: DraftValues): Record<string, unknown> {
  const args: Record<string, unknown> = {
    job_id: values.jobNumericId,
    charged_amount: values.chargedAmount,
  };
  const letter = values.coverLetter.trim();
  if (letter !== '') args.cover_letter = letter;
  if (values.screeningAnswers.length > 0) {
    args.screening_answers = values.screeningAnswers;
  }
  if (values.portfolioProjectIds.length > 0) {
    args.portfolio_project_ids = values.portfolioProjectIds;
  }
  if (values.certificateIds.length > 0) {
    args.certificate_ids = values.certificateIds;
  }
  return args;
}

/**
 * The parsed preview of a `create` result. The confirm step may only run
 * with the `preview_id` + `type` returned here (`canConfirmPreview`).
 */
export interface ProposalPreview {
  previewId: string | null;
  type: string | null;
  connectsRequired: number | null;
  connectsBalance: number | null;
  /** Whether the account can apply at all (null ⇒ not reported). */
  eligible: boolean | null;
  eligibilityNote: string | null;
  unmetQualifications: string[];
  requiredScreening: string[];
  competingBids: string | null;
  boost: BoostInfo | null;
  raw: unknown;
}

export interface BoostInfo {
  available: boolean;
  limit: number | null;
  suggestedBid: number | null;
  recommendation: string | null;
  reason: string | null;
}

/** Parse a `manage_proposals` action `create` result into a preview. */
export function parsePreview(data: unknown): ProposalPreview {
  const top = isRecord(data) ? data : {};
  // Entity fields win; top-level siblings are probed as fallback (e.g.
  // `eligible`/`reason` next to a nested `preview` container).
  const rec: Record<string, unknown> = {
    ...top,
    ...(entityRecord(data, ['preview']) ?? {}),
  };
  const boostRaw = (rec.boost ?? null) as Record<string, unknown> | null;
  let boost: BoostInfo | null = null;
  if (boostRaw !== null) {
    boost = {
      available: boostRaw.available === undefined ? true : boostRaw.available !== false,
      limit: numberOr(boostRaw.max_connects ?? boostRaw.limit ?? boostRaw.connects_limit),
      suggestedBid: numberOr(boostRaw.suggested_bid),
      recommendation: stringOrNumber(boostRaw.recommendation),
      reason: stringOrNumber(boostRaw.reason),
    };
  }
  return {
    previewId: stringOrNumber(rec.preview_id ?? rec.id) ?? null,
    type: stringOrNumber(rec.type ?? rec.preview_type) ?? null,
    connectsRequired: numberOr(rec.connects_required ?? rec.connects_cost ?? rec.connects),
    connectsBalance: numberOr(rec.connects_balance ?? rec.balance),
    eligible:
      rec.eligible === true || rec.can_apply === true
        ? true
        : rec.eligible === false || rec.can_apply === false
          ? false
          : null,
    eligibilityNote:
      stringOrNumber(rec.eligibility_note) ??
      (rec.eligible === false || rec.can_apply === false
        ? stringOrNumber(rec.reason)
        : null),
    unmetQualifications: stringList(
      rec.unmet_qualifications ?? rec.unmet_preferred_qualifications ?? rec.qualifications,
    ),
    requiredScreening: stringList(rec.required_screening ?? rec.screening_questions),
    competingBids: competingBidsOf(rec),
    boost,
    raw: data,
  };
}

/**
 * Draft-confirm guard (plan 07, D7.3): the confirm call may only run with
 * the `preview_id` + `type` returned by the latest successful `create`.
 */
export function canConfirmPreview(preview: Pick<ProposalPreview, 'previewId' | 'type'>): boolean {
  return (
    typeof preview.previewId === 'string' &&
    preview.previewId.trim() !== '' &&
    typeof preview.type === 'string' &&
    preview.type.trim() !== ''
  );
}

/**
 * Args for `confirm_preview` action `confirm`. `boostConnects` is included
 * only when the user approved a positive amount (plan 07, D7.1).
 */
export function buildConfirmArgs(
  preview: Pick<ProposalPreview, 'previewId' | 'type'>,
  boostConnects: number | null,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    type: preview.type,
    preview_id: preview.previewId,
  };
  if (boostConnects !== null && Number.isFinite(boostConnects) && boostConnects > 0) {
    args.boost_connects = boostConnects;
  }
  return args;
}

/**
 * Server feedback when a call is missing fields (`needs_details`) — the
 * documented recovery path (names the missing fields, inlines reference).
 */
export function needsDetailsOf(data: unknown): string | null {
  const rec = isRecord(data) ? data : null;
  if (rec === null) return null;
  const v = rec.needs_details ?? rec.needsDetails;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (Array.isArray(v)) {
    const parts = v.map((x) =>
      typeof x === 'string' ? x : x !== null && typeof x === 'object'
        ? stringOrNumber((x as Record<string, unknown>).field ?? (x as Record<string, unknown>).name)
        : null,
    );
    const joined = parts.filter((p): p is string => p !== null).join(', ');
    if (joined !== '') return `Missing fields: ${joined}`;
  }
  return null;
}

/**
 * A `find_room`/invitation/proposal row references a job if any of its
 * identifiers matches any of the known forms (numeric id, ciphertext, URL).
 */
export function matchesJob(item: unknown, jobIdentifiers: string[]): boolean {
  if (item === null || typeof item !== 'object') return false;
  const rec = item as Record<string, unknown>;
  const ids = jobIdentifiers.filter((s) => s.trim() !== '');
  if (ids.length === 0) return false;
  const want = new Set(ids);
  const refs: unknown[] = [
    rec.job_id,
    rec.job,
    rec.job_key,
    rec.job_url,
    rec.id,
    rec.url,
  ];
  const jobRec = rec.job;
  if (jobRec !== null && typeof jobRec === 'object') {
    const j = jobRec as Record<string, unknown>;
    refs.push(j.id, j.job_id, j.job_key, j.url);
  }
  for (const ref of refs) {
    if (typeof ref === 'string' && want.has(ref)) return true;
  }
  return false;
}

/** The numeric job id from a `find_jobs` action `get` payload. */
export function jobNumericIdOf(data: unknown): string | null {
  const rec = entityRecord(data, ['job', 'item', 'data']);
  if (rec === null) return null;
  for (const key of ['id_numeric', 'numeric_id', 'id', 'job_id']) {
    const v = rec[key];
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return v.trim();
  }
  return null;
}

/** Screening questions from a `find_jobs` action `get` payload. */
export function screeningQuestionsOf(data: unknown): string[] {
  const rec = entityRecord(data, ['job', 'item', 'data']);
  if (rec === null) return [];
  const out: string[] = [];
  const raw = rec.screening_questions ?? rec.questions ?? rec.screening;
  if (Array.isArray(raw)) {
    for (const q of raw) {
      if (typeof q === 'string' && q.trim() !== '') out.push(q.trim());
      else if (q !== null && typeof q === 'object') {
        const s = stringOrNumber(
          (q as Record<string, unknown>).question ??
            (q as Record<string, unknown>).text ??
            (q as Record<string, unknown>).title,
        );
        if (s !== null) out.push(s);
      }
    }
  }
  return out;
}

/** `client_feedback` from a `find_jobs` action `get` payload, if present. */
export function clientFeedbackOf(data: unknown): string | null {
  const rec = entityRecord(data, ['job', 'item', 'data']);
  if (rec === null) return null;
  const v = rec.client_feedback;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (v !== null && typeof v === 'object') {
    const r = v as Record<string, unknown>;
    return stringOrNumber(r.feedback ?? r.text ?? r.summary ?? r.content);
  }
  return null;
}

/**
 * `get_profile` action `list_highlights` payload → selectable portfolio
 * projects + certificates (`portfolio_project_ids` / `certificate_ids`).
 */
export interface ProfileHighlights {
  projects: Array<{ id: string; title: string }>;
  certificates: Array<{ id: string; title: string }>;
}

export function highlightsOf(data: unknown): ProfileHighlights {
  const rec = isRecord(data) ? data : {};
  const projects = highlightItems(rec.portfolio_projects ?? rec.projects ?? rec.portfolio);
  const certificates = highlightItems(rec.certificates ?? rec.certs ?? rec.certificate_list);
  return { projects, certificates };
}

/**
 * Result of `confirm_preview` action `confirm`: `action_required` results
 * carry a `finalize_url` the user must open on upwork.com (binding steps
 * are never completed by the server).
 */
export interface ConfirmResult {
  status: string | null;
  finalizeUrl: string | null;
}

export function parseConfirmResult(data: unknown): ConfirmResult {
  const rec = isRecord(data) ? data : null;
  if (rec === null) return { status: null, finalizeUrl: null };
  return {
    status: stringOrNumber(rec.status),
    finalizeUrl: stringOrNumber(rec.finalize_url ?? rec.finalizeUrl),
  };
}

function extractListItems(data: unknown, keys: string[]): unknown[] {
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

function entityRecord(
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function stringOrNumber(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function numberOr(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function dateOf(v: unknown): string | null {
  return stringOrNumber(v);
}

function stringList(v: unknown): string[] {
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

function highlightItems(v: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ id: string; title: string }> = [];
  v.forEach((x, i) => {
    if (x === null || typeof x !== 'object') return;
    const r = x as Record<string, unknown>;
    const id = stringOrNumber(r.id ?? r.project_id ?? r.uid ?? r.certificate_id);
    const title =
      stringOrNumber(r.title ?? r.name) ??
      (id !== null ? id : `Item ${i + 1}`);
    if (id !== null) out.push({ id, title });
  });
  return out;
}

function formatCharged(rec: Record<string, unknown>): string | null {
  const terms = (rec.terms ?? null) as Record<string, unknown> | null;
  const v = terms !== null ? terms.charged_amount ?? terms.bid ?? terms.amount : rec.charged_amount ?? rec.bid;
  return formatMoney(stringOrNumber(v));
}

function formatMoney(v: string | null): string | null {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `$${n.toLocaleString('en-US')}`;
}

function competingBidsOf(rec: Record<string, unknown>): string | null {
  const v = rec.competing_bids ?? rec.competing_bids_text ?? rec.bids;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (Array.isArray(v) && v.length > 0) {
    const parts = v
      .map((x) => (typeof x === 'number' && Number.isFinite(x) ? `$${x.toLocaleString('en-US')}` : null))
      .filter((p): p is string => p !== null);
    if (parts.length > 0) return parts.join(', ');
  }
  return null;
}

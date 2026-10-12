/**
 * Invitations & offers mapping + write-outcome parsing (plan 07b, D7.6).
 *
 * Upwork result field names are server-decided (plan 06 pattern): every
 * mapper probes documented names first, then aliases, degrades to `null`.
 *
 * Write contract (official plugin skills, plan 07 D7.1/D7.6):
 * - Invitation accept (`manage_proposals` action `accept_invitation`) is
 *   BINDING → `status: action_required` + `finalize_url` (finish on
 *   upwork.com; never completed by this server).
 * - Offer `decline` / `request_changes` (`respond_to_offer`) return a
 *   PREVIEW → second `confirm_preview` step; offer `accept` is binding.
 * `parseWriteOutcome` handles both shapes defensively, plus `needs_details`
 * (the documented recovery loop that names missing fields).
 */

import { needsDetailsOf } from './proposals.js';
import {
  dateOf,
  entityRecord,
  extractListItems,
  formatMoney,
  isRecord,
  numericStringOf,
  stringOrNumber,
} from './shape.js';

const LIST_ITEM_KEYS = ['items', 'results', 'data', 'list'];

/** One job that invited the freelancer (row = entity, D7.6). */
export interface InvitationRow {
  key: string;
  /** Invitation id when reported (else the job reference). */
  id: string | null;
  /** Numeric job id — `manage_proposals` wants it. */
  jobNumericId: string | null;
  /** Link key for `/jobs/:jobKey` (ciphertext > numeric id > URL). */
  jobKey: string | null;
  jobTitle: string | null;
  clientName: string | null;
  /** Formatted rate / budget, if reported. */
  terms: string | null;
  expires: string | null;
  /** Plain-English label — preferred for display. */
  statusLabel: string | null;
  /** Raw status code. */
  status: string | null;
  raw: unknown;
}

export function mapInvitations(data: unknown): InvitationRow[] {
  const items = extractListItems(
    data,
    ['invitations', ...LIST_ITEM_KEYS],
  );
  return items.map((item, i) => {
    const rec = isRecord(item) ? item : {};
    const jobRec = (rec.job ?? null) as Record<string, unknown> | null;
    const jobNum = numericStringOf(rec.job_id ?? jobRec?.id ?? jobRec?.job_id);
    const jobKey =
      stringOrNumber(rec.job_key ?? jobRec?.job_key) ??
      jobNum ??
      (typeof rec.url === 'string' ? rec.url : null) ??
      stringOrNumber(rec.id);
    return {
      key: stringOrNumber(rec.id ?? rec.invitation_id) ?? `inv-${i}`,
      id: stringOrNumber(rec.id ?? rec.invitation_id ?? rec.invitation) ?? jobNum,
      jobNumericId: jobNum,
      jobKey,
      jobTitle:
        stringOrNumber(rec.title ?? rec.job_title) ??
        (jobRec !== null ? stringOrNumber(jobRec.title) : null) ??
        'Invited job',
      clientName: stringOrNumber(rec.client_name ?? rec.client ?? jobRec?.client_name),
      terms: formatTerms(rec, jobRec),
      expires: dateOf(rec.expires_at ?? rec.expiration ?? rec.expires ?? jobRec?.expires_at),
      statusLabel: stringOrNumber(rec.status_label ?? rec.statusLabel),
      status: stringOrNumber(rec.status),
      raw: item,
    } satisfies InvitationRow;
  });
}

/** A client offer on an existing proposal. */
export interface OfferRow {
  key: string;
  id: string | null;
  jobNumericId: string | null;
  jobKey: string | null;
  jobTitle: string | null;
  clientName: string | null;
  hourlyRate: string | null;
  fixedPrice: string | null;
  expires: string | null;
  statusLabel: string | null;
  status: string | null;
  raw: unknown;
}

export function mapOffers(data: unknown): OfferRow[] {
  const items = extractListItems(data, ['offers', ...LIST_ITEM_KEYS]);
  return items.map((item, i) => {
    const rec = isRecord(item) ? item : {};
    const jobRec = (rec.job ?? null) as Record<string, unknown> | null;
    const jobNum = numericStringOf(rec.job_id ?? jobRec?.id ?? jobRec?.job_id);
    const jobKey =
      stringOrNumber(rec.job_key ?? jobRec?.job_key) ??
      jobNum ??
      (typeof rec.url === 'string' ? rec.url : null) ??
      stringOrNumber(rec.id);
    const terms = (rec.terms ?? null) as Record<string, unknown> | null;
    return {
      key: stringOrNumber(rec.id ?? rec.offer_id) ?? `offer-${i}`,
      id: stringOrNumber(rec.id ?? rec.offer_id) ?? jobNum,
      jobNumericId: jobNum,
      jobKey,
      jobTitle:
        stringOrNumber(rec.title ?? rec.job_title) ??
        (jobRec !== null ? stringOrNumber(jobRec.title) : null) ??
        'Offer',
      clientName: stringOrNumber(rec.client_name ?? rec.client ?? jobRec?.client_name),
      hourlyRate: formatMoney(
        stringOrNumber(rec.hourly_rate ?? rec.hourlyRate ?? terms?.hourly_rate ?? rec.rate),
      ),
      fixedPrice: formatMoney(
        stringOrNumber(
          rec.fixed_price ?? rec.fixedPrice ?? terms?.fixed_price ?? rec.budget ?? rec.amount,
        ),
      ),
      expires: dateOf(rec.expires_at ?? rec.expiration ?? rec.expires),
      statusLabel: stringOrNumber(rec.status_label ?? rec.statusLabel),
      status: stringOrNumber(rec.status),
      raw: item,
    } satisfies OfferRow;
  });
}

/**
 * One defensive parser for every 07b write result (D7.6):
 * - `finalize` — binding step finished on the server side, or still needs
 *   the user on upwork.com (`finalize_url` / `status: action_required`);
 * - `preview`  — the action was stored as a preview; the UI must run the
 *   second `confirm_preview` step with `previewId` + `previewType`;
 * - `needs_details` — the server names missing fields (recovery loop);
 * - `ok`       — plain success.
 */
export type WriteOutcomeKind = 'finalize' | 'preview' | 'needs_details' | 'ok';

export interface WriteOutcome {
  kind: WriteOutcomeKind;
  finalizeUrl: string | null;
  previewId: string | null;
  previewType: string | null;
  needsDetails: string | null;
  status: string | null;
  raw: unknown;
}

export function parseWriteOutcome(data: unknown): WriteOutcome {
  const top = isRecord(data) ? data : {};
  const rec: Record<string, unknown> = {
    ...top,
    ...(entityRecord(data, ['preview', 'result']) ?? {}),
  };
  const finalizeUrl = stringOrNumber(rec.finalize_url ?? rec.finalizeUrl);
  const status = stringOrNumber(rec.status);
  const previewId = stringOrNumber(rec.preview_id);
  const previewType = stringOrNumber(rec.type ?? rec.preview_type);
  const needsDetails = needsDetailsOf(data);

  let kind: WriteOutcomeKind = 'ok';
  if (finalizeUrl !== null || (status !== null && status.toLowerCase() === 'action_required')) {
    kind = 'finalize';
  } else if (previewId !== null && previewType !== null) {
    kind = 'preview';
  } else if (needsDetails !== null) {
    kind = 'needs_details';
  }

  return {
    kind,
    finalizeUrl,
    previewId,
    previewType,
    needsDetails,
    status,
    raw: data,
  };
}

/**
 * Job identity args for `manage_proposals` invitation actions (D7.6,
 * best-known names, D7.2 recovery loop): numeric `job_id` preferred,
 * else the `invitation_id`.
 */
export function invitationJobArgs(inv: {
  id: string | null;
  jobNumericId: string | null;
}): Record<string, unknown> {
  if (inv.jobNumericId !== null) return { job_id: inv.jobNumericId };
  if (inv.id !== null) return { invitation_id: inv.id };
  return {};
}

export function buildAcceptInvitationArgs(inv: {
  id: string | null;
  jobNumericId: string | null;
}): Record<string, unknown> {
  return invitationJobArgs(inv);
}

export function buildDeclineInvitationArgs(
  inv: { id: string | null; jobNumericId: string | null },
  reason?: string,
): Record<string, unknown> {
  const args = invitationJobArgs(inv);
  const r = reason?.trim();
  if (r !== undefined && r !== '') args.reason = r;
  return args;
}

export type OfferAction = 'accept' | 'decline' | 'request_changes';

/** Args for `respond_to_offer` actions (D7.6 best-known names). */
export function buildRespondOfferArgs(
  offer: { id: string | null; jobNumericId: string | null },
  action: OfferAction,
  message?: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (offer.id !== null) args.offer_id = offer.id;
  if (offer.jobNumericId !== null) args.job_id = offer.jobNumericId;
  if (action === 'request_changes') {
    const m = message?.trim();
    if (m !== undefined && m !== '') args.message = m;
  }
  return args;
}

function formatTerms(rec: Record<string, unknown>, jobRec: Record<string, unknown> | null): string | null {
  const v =
    stringOrNumber(rec.rate ?? rec.rate_text) ??
    formatMoney(stringOrNumber(rec.hourly_rate ?? rec.hourlyRate)) ??
    formatMoney(stringOrNumber(rec.budget ?? jobRec?.budget)) ??
    stringOrNumber(jobRec?.budget);
  return v;
}

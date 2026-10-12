import { apiFetch, ApiError } from './api.js';
import {
  extractText,
  toolCallErrorMessage,
  type ToolCallOutcome,
  type ToolInfo,
} from './tools.js';

/**
 * Feature registry (plan 06): binds UI features to Upwork MCP tools.
 *
 * Tool names are the documented best known so far (see plan 06, D6.1 —
 * official plugin + 2026-09-02 live inspection). They are confirmed against
 * the live `tools/list` at runtime: the first candidate name present in the
 * live list wins; if none is present the page shows a per-card
 * "unavailable" state instead of failing the whole page. When the owner's
 * first real connection fills the main-plan discovery log, any name drift
 * is corrected in this single file.
 */

export interface FeatureSpec {
  key: string;
  /** Candidate tool names, in preference order. */
  tools: string[];
  /** `action` argument most Upwork tools take (nested actions, see D6.1). */
  action?: string;
}

export const FEATURES = {
  jobsSearch: { key: 'jobs.search', tools: ['upwork__find_jobs'], action: 'search' },
  jobsSmart: { key: 'jobs.smart_search', tools: ['upwork__find_jobs'], action: 'smart_search' },
  jobGet: { key: 'jobs.get', tools: ['upwork__find_jobs'], action: 'get' },
  invitations: {
    key: 'proposals.invitations',
    tools: ['upwork__list_freelancer_proposals'],
    action: 'invitations',
  },
  proposalsList: {
    key: 'proposals.list',
    tools: ['upwork__list_freelancer_proposals'],
    action: 'list',
  },
  proposalsGet: {
    key: 'proposals.get',
    tools: ['upwork__list_freelancer_proposals'],
    action: 'get',
  },
  /** `manage_proposals` action `create` — returns the preview (plan 07a). */
  manageProposalsCreate: {
    key: 'proposals.create',
    tools: ['upwork__manage_proposals'],
    action: 'create',
  },
  /** `confirm_preview` action `confirm` — the submit step (plan 07a). */
  confirmPreview: { key: 'proposals.confirm', tools: ['upwork__confirm_preview'], action: 'confirm' },
  /** Invitation accept — BINDING, expect `finalize_url` (plan 07b, D7.6). */
  invitationsAccept: {
    key: 'invitations.accept',
    tools: ['upwork__manage_proposals'],
    action: 'accept_invitation',
  },
  /** Invitation decline — reversible (plan 07b, D7.6). */
  invitationsDecline: {
    key: 'invitations.decline',
    tools: ['upwork__manage_proposals'],
    action: 'decline_invitation',
  },
  /** Offer accept — BINDING, expect `finalize_url` (plan 07b, D7.6). */
  offerAccept: { key: 'offers.accept', tools: ['upwork__respond_to_offer'], action: 'accept' },
  /** Offer decline — returns a preview (second confirm step, D7.6). */
  offerDecline: { key: 'offers.decline', tools: ['upwork__respond_to_offer'], action: 'decline' },
  /** Offer request-changes — preview + `message` (second confirm step). */
  offerRequestChanges: {
    key: 'offers.request_changes',
    tools: ['upwork__respond_to_offer'],
    action: 'request_changes',
  },
  profileGet: { key: 'profile.get', tools: ['upwork__get_profile'], action: 'get' },
  /** Portfolio projects + certificates (TALENT) for proposal highlights. */
  profileHighlights: { key: 'profile.highlights', tools: ['upwork__get_profile'], action: 'list_highlights' },
  offers: { key: 'offers.list', tools: ['upwork__list_offers'], action: 'list_mine' },
  rooms: { key: 'messages.rooms', tools: ['upwork__get_messages'], action: 'list_rooms' },
  connects: { key: 'profile.connects', tools: ['upwork__get_profile'], action: 'connects_balance' },
} satisfies Record<string, FeatureSpec>;

/**
 * Resolve which concrete tool a feature should call, given the live
 * `tools/list` names. `null` ⇒ no candidate is live (feature degrades).
 */
export function resolveTool(spec: FeatureSpec, liveTools: Iterable<string>): string | null {
  const live = new Set(liveTools);
  for (const candidate of spec.tools) {
    if (live.has(candidate)) return candidate;
  }
  return null;
}

/**
 * `structuredContent` when present, else the JSON the text parts carry.
 * Non-JSON text is returned as `{ text }` so callers can still surface it.
 */
export function parseToolData(outcome: ToolCallOutcome): unknown {
  const sc = outcome.structuredContent;
  if (sc !== null && typeof sc === 'object') return sc;
  const text = extractText(outcome.content).trim();
  if (text === '') return null;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // fall through to raw text
    }
  }
  return { text };
}

/**
 * Call one feature through the generic tool API (`POST /api/tools/:name/call`),
 * adding `org_uid` (required on every tool call after `list_accounts`) and
 * the feature's `action`. Throws: ApiError for API-level failures, Error
 * with the tool's own text when the tool reports `isError: true`.
 */
export async function callFeature(
  spec: FeatureSpec,
  tool: string,
  orgUid: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const body: Record<string, unknown> = { ...args };
  if (spec.action !== undefined) body.action = spec.action;
  body.org_uid = orgUid;
  const outcome = await apiFetch<ToolCallOutcome>(
    `/api/tools/${encodeURIComponent(tool)}/call`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: body }),
    },
  );
  if (outcome.isError) {
    const text = extractText(outcome.content).trim();
    throw new Error(text === '' ? 'The Upwork tool reported an error.' : text);
  }
  return parseToolData(outcome);
}

/**
 * Human message for a failed feature call (keeps server-safe wording).
 * Returns null for non-Error values (caller decides the fallback).
 */
export function featureErrorMessage(err: unknown): string | null {
  if (err instanceof ApiError) return toolCallErrorMessage(err);
  if (err instanceof Error) return err.message;
  return null;
}

/** Tool names of a tools list, for O(1) availability checks. */
export function liveToolNames(tools: ToolInfo[]): Set<string> {
  return new Set(tools.map((t) => t.name));
}

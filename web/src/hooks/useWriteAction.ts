/**
 * Shared two-step write-action flow (plan 07b, D7.4/D7.6) — used by
 * invitations (accept/decline) and offers (accept/decline/request-changes).
 *
 * Step 1: the action call (through `ConfirmModal` — explicit confirm only).
 *   - `finalize_url` / `action_required` → done view with the upwork.com link
 *     (binding steps are never completed by this server).
 *   - `preview_id` + `type` → step 2.
 *   - `needs_details` → error shown verbatim (recovery loop, D7.2).
 *   - otherwise → success (toast + list refresh).
 * Step 2: `confirm_preview` action `confirm` with the RETURNED `type` +
 *   `preview_id` (D7.1) — only reachable with a confirmable preview
 *   (`canConfirmPreview`).
 *
 * No auto-confirm anywhere: every call runs behind a confirm button.
 */

import { useCallback, useState } from 'react';
import type { ConfirmOutcome } from '../components/ConfirmModal.js';
import { buildConfirmArgs, canConfirmPreview } from '../lib/proposals.js';
import { parseWriteOutcome } from '../lib/invitations.js';
import {
  callFeature,
  FEATURES,
  featureErrorMessage,
  resolveTool,
  type FeatureSpec,
} from '../lib/registry.js';
import { toastSuccess } from '../lib/toast.js';

export interface PendingPreview {
  previewId: string;
  type: string;
  /** What the second confirm will do, in plain words. */
  label: string;
}

export interface FirstStepOptions {
  /** Plain-words label for the (possible) second confirm step. */
  label: string;
  /** Message for the done view when the result is `action_required`. */
  finalizeMessage: string;
  /** Toast for a plain success. */
  successToast: string;
}

export interface WriteActionFlow {
  /** Id of the first-step action whose confirm dialog is open (null = none). */
  firstStep: string | null;
  /** The preview awaiting the second confirm step (null = none). */
  pendingPreview: PendingPreview | null;
  /** Open the confirm dialog for a first-step action id. */
  ask: (id: string) => void;
  /** Close the first-step dialog (cancels; also the auto-close after proceed). */
  closeFirst: () => void;
  /** Close the second-step dialog (after done/error). */
  closeSecond: () => void;
  /** Run the step-1 call; returns the ConfirmModal outcome. */
  runFirst: (
    feature: FeatureSpec,
    args: Record<string, unknown>,
    opts: FirstStepOptions,
  ) => Promise<ConfirmOutcome>;
  /** Run the step-2 `confirm_preview` call; returns the ConfirmModal outcome. */
  runSecond: () => Promise<ConfirmOutcome>;
}

const FINALIZE_FALLBACK =
  'This step is binding and needs a final action on upwork.com — open the link to finish.';

export function useWriteAction(
  orgUid: string | null,
  live: Set<string>,
  onDone: () => void,
): WriteActionFlow {
  const [firstStep, setFirstStep] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);

  const ask = useCallback((id: string) => {
    setPendingPreview(null);
    setFirstStep(id);
  }, []);

  // Deliberately does NOT clear pendingPreview: the modal auto-closes
  // through this after a successful `proceed`, and the preview must survive
  // so the second-step dialog can open.
  const closeFirst = useCallback(() => {
    setFirstStep(null);
  }, []);

  const closeSecond = useCallback(() => {
    setPendingPreview(null);
  }, []);

  const runFirst = useCallback(
    async (
      feature: FeatureSpec,
      args: Record<string, unknown>,
      opts: FirstStepOptions,
    ): Promise<ConfirmOutcome> => {
      const tool = resolveTool(feature, live);
      if (tool === null || orgUid === null) {
        throw new Error('This action is not available right now — check the tools console.');
      }
      const data = await callFeature(feature, tool, orgUid, args);
      const outcome = parseWriteOutcome(data);
      if (outcome.kind === 'finalize') {
        return {
          status: 'done',
          message: opts.finalizeMessage,
          finalizeUrl: outcome.finalizeUrl ?? undefined,
        };
      }
      if (outcome.kind === 'preview') {
        setPendingPreview({
          previewId: outcome.previewId as string,
          type: outcome.previewType as string,
          label: opts.label,
        });
        return { status: 'proceed' };
      }
      if (outcome.kind === 'needs_details') {
        throw new Error(
          outcome.needsDetails ?? 'Upwork needs more details before it can do this.',
        );
      }
      toastSuccess(opts.successToast);
      onDone();
      return { status: 'proceed' };
    },
    [live, orgUid, onDone],
  );

  const runSecond = useCallback(async (): Promise<ConfirmOutcome> => {
    if (pendingPreview === null || !canConfirmPreview(pendingPreview)) {
      throw new Error('No confirmable preview — start the action again.');
    }
    const tool = resolveTool(FEATURES.confirmPreview, live);
    if (tool === null || orgUid === null) {
      throw new Error('The confirm tool is not available right now.');
    }
    const data = await callFeature(FEATURES.confirmPreview, tool, orgUid, buildConfirmArgs(pendingPreview, null));
    const outcome = parseWriteOutcome(data);
    if (outcome.kind === 'finalize') {
      setPendingPreview(null);
      return {
        status: 'done',
        message: FINALIZE_FALLBACK,
        finalizeUrl: outcome.finalizeUrl ?? undefined,
      };
    }
    if (outcome.kind === 'needs_details') {
      setPendingPreview(null);
      throw new Error(outcome.needsDetails ?? 'Upwork needs more details.');
    }
    setPendingPreview(null);
    toastSuccess(`${pendingPreview.label} — done.`);
    onDone();
    return { status: 'proceed' };
  }, [pendingPreview, live, orgUid, onDone]);

  return {
    firstStep,
    pendingPreview,
    ask,
    closeFirst,
    closeSecond,
    runFirst,
    runSecond,
  };
}

/** Human message for a failed flow call (kept here so pages stay thin). */
export function flowErrorMessage(err: unknown): string {
  return featureErrorMessage(err) ?? 'Something went wrong.';
}

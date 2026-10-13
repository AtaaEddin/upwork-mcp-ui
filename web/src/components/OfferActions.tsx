/**
 * Accept / decline / request-changes actions for ONE client offer
 * (plan 07b, D7.4/D7.6).
 *
 * Accept is BINDING → the done view carries the `finalize_url` "Finish on
 * upwork.com" link. Decline and request-changes are previews per the
 * official upwork-workflows skill → the flow chains into the second
 * `confirm_preview` step. Everything runs behind an explicit confirm.
 */

import { useState } from 'react';
import { ConfirmModal } from './ConfirmModal.js';
import { useWriteAction, type FirstStepOptions } from '../hooks/useWriteAction.js';
import {
  buildRespondOfferArgs,
  type OfferAction,
  type OfferRow,
} from '../lib/invitations.js';
import { FEATURES } from '../lib/registry.js';

export interface OfferActionsProps {
  offer: Pick<OfferRow, 'id' | 'jobNumericId' | 'jobTitle'>;
  orgUid: string | null;
  live: Set<string>;
  /** Called after a successful action (the page refreshes its list). */
  onDone: () => void;
}

const FEATURE_BY_ACTION: Record<OfferAction, (typeof FEATURES)[keyof typeof FEATURES]> = {
  accept: FEATURES.offerAccept,
  decline: FEATURES.offerDecline,
  request_changes: FEATURES.offerRequestChanges,
};

export function OfferActions({ offer, orgUid, live, onDone }: OfferActionsProps) {
  const flow = useWriteAction(orgUid, live, onDone);
  const [message, setMessage] = useState('');
  const title = offer.jobTitle ?? 'this job';

  const optionsFor = (action: OfferAction): FirstStepOptions => {
    switch (action) {
      case 'accept':
        return {
          label: `accept the offer for ${title}`,
          finalizeMessage:
            'Your acceptance is binding — finish the acceptance on upwork.com to start the contract.',
          successToast: 'Offer accepted.',
        };
      case 'decline':
        return {
          label: `decline the offer for ${title}`,
          finalizeMessage: 'The decline is complete.',
          successToast: 'Offer declined.',
        };
      case 'request_changes':
        return {
          label: `send your change request for ${title}`,
          finalizeMessage: 'Your change request is complete.',
          successToast: 'Change request sent.',
        };
    }
  };

  const runFirst = (action: OfferAction) =>
    flow.runFirst(
      FEATURE_BY_ACTION[action],
      buildRespondOfferArgs(offer, action, action === 'request_changes' ? message : undefined),
      optionsFor(action),
    );

  const action = flow.firstStep as OfferAction | null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => flow.ask('accept')}
          className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
        >
          Accept offer
        </button>
        <button
          type="button"
          onClick={() => flow.ask('decline')}
          className="rounded-md border border-up-border bg-white px-4 py-2 text-sm font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-transparent dark:text-up-lime dark:hover:bg-white/10"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => flow.ask('request_changes')}
          className="rounded-md border border-up-border bg-white px-4 py-2 text-sm font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-transparent dark:text-up-lime dark:hover:bg-white/10"
        >
          Request changes
        </button>
      </div>

      <ConfirmModal
        open={flow.firstStep !== null}
        title={
          action === 'decline'
            ? 'Decline this offer?'
            : action === 'request_changes'
              ? 'Request changes to this offer?'
              : 'Accept this offer?'
        }
        confirmLabel={
          action === 'decline' ? 'Decline' : action === 'request_changes' ? 'Send request' : 'Accept'
        }
        onClose={() => {
          flow.closeFirst();
          setMessage('');
        }}
        onConfirm={() => (action !== null ? runFirst(action) : Promise.resolve({ status: 'proceed' }))}
        summary={
          <>
            {action === 'accept' && (
              <>
                <p>
                  This accepts the client's offer for <strong>{title}</strong> on the terms
                  they set.
                </p>
                <p className="mt-2 text-up-red">
                  Accepting is a binding action. The final step happens on upwork.com; this app
                  never completes it for you.
                </p>
              </>
            )}
            {action === 'decline' && (
              <>
                <p>
                  This declines the offer for <strong>{title}</strong>. You can still message
                  the client afterwards.
                </p>
                <p className="mt-2">
                  Upwork stores this as a preview; you'll confirm it in a second step.
                </p>
              </>
            )}
            {action === 'request_changes' && (
              <>
                <p>
                  This sends the client your proposed changes to the offer for{' '}
                  <strong>{title}</strong>. The original offer stays open.
                </p>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
                    What should change?
                  </span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    placeholder="e.g. I can take this on at $55/h…"
                    className="w-full rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-black dark:text-white"
                  />
                </label>
                <p className="mt-2 text-xs text-up-black/60 dark:text-white/60">
                  Upwork stores this as a preview; you'll confirm it in a second step.
                </p>
              </>
            )}
          </>
        }
      />

      <ConfirmModal
        open={flow.pendingPreview !== null}
        title="Confirm this action"
        confirmLabel="Confirm"
        onClose={flow.closeSecond}
        onConfirm={flow.runSecond}
        summary={
          <>
            <p>
              Upwork stored this as a preview. Confirming will{' '}
              <strong>{flow.pendingPreview?.label}</strong>.
            </p>
            <p className="mt-2">You can't undo a confirmed action from this app.</p>
          </>
        }
      />
    </>
  );
}

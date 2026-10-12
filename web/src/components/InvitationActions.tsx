/**
 * Accept / decline actions for ONE invitation (plan 07b, D7.4/D7.6).
 *
 * Accept is BINDING (creates the contract) → the done view carries the
 * `finalize_url` "Finish on upwork.com" link when the server reports
 * `action_required`. Decline is reversible. Both run only behind an
 * explicit confirm (ConfirmModal); a `preview` result chains into the
 * second `confirm_preview` step (D7.1). Reused by the Invitations page
 * and the draft page's invitation branch (D7.5).
 */

import { ConfirmModal } from './ConfirmModal.js';
import { useWriteAction, type FirstStepOptions } from '../hooks/useWriteAction.js';
import {
  buildAcceptInvitationArgs,
  buildDeclineInvitationArgs,
  type InvitationRow,
} from '../lib/invitations.js';
import { FEATURES } from '../lib/registry.js';

type Step = 'accept' | 'decline';

export interface InvitationActionsProps {
  invitation: Pick<InvitationRow, 'id' | 'jobNumericId' | 'jobTitle'>;
  orgUid: string | null;
  live: Set<string>;
  /** Called after a successful action (the page refreshes its list). */
  onDone: () => void;
}

export function InvitationActions({ invitation, orgUid, live, onDone }: InvitationActionsProps) {
  const flow = useWriteAction(orgUid, live, onDone);
  const title = invitation.jobTitle ?? 'this job';
  const step: Step = flow.firstStep === 'decline' ? 'decline' : 'accept';

  const optionsFor = (step: Step): FirstStepOptions =>
    step === 'accept'
      ? {
          label: `accept the invitation for ${title}`,
          finalizeMessage:
            'Your acceptance is binding — finish the acceptance on upwork.com to create the contract.',
          successToast: 'Invitation accepted.',
        }
      : {
          label: `decline the invitation for ${title}`,
          finalizeMessage: 'The decline is complete.',
          successToast: 'Invitation declined.',
        };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => flow.ask('accept')}
          className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
        >
          Accept invitation
        </button>
        <button
          type="button"
          onClick={() => flow.ask('decline')}
          className="rounded-md border border-up-border bg-white px-4 py-2 text-sm font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-transparent dark:text-up-lime dark:hover:bg-white/10"
        >
          Decline
        </button>
      </div>

      <ConfirmModal
        open={flow.firstStep !== null}
        title={step === 'decline' ? 'Decline invitation?' : 'Accept invitation?'}
        confirmLabel={step === 'decline' ? 'Decline' : 'Accept'}
        onClose={flow.closeFirst}
        onConfirm={() =>
          flow.runFirst(
            step === 'decline' ? FEATURES.invitationsDecline : FEATURES.invitationsAccept,
            step === 'decline' ? buildDeclineInvitationArgs(invitation) : buildAcceptInvitationArgs(invitation),
            optionsFor(step),
          )
        }
        summary={
          step === 'decline' ? (
            <>
              <p>
                This declines the invitation for <strong>{title}</strong>. The invitation
                disappears from your inbox.
              </p>
              <p className="mt-2">Declining is reversible only by re-inviting the client later.</p>
            </>
          ) : (
            <>
              <p>
                This accepts the invitation for <strong>{title}</strong> — it creates the
                contract with the client on the terms they set.
              </p>
              <p className="mt-2 text-up-red">
                Accepting is a binding action. The final step happens on upwork.com; this app
                never completes it for you.
              </p>
            </>
          )
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

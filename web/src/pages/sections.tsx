import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState } from '../components/EmptyState.js';
import { useAccount } from '../context/account.js';
import { useFeature } from '../hooks/useFeature.js';
import { useToolList } from '../hooks/useToolList.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import { buildGetArgs, mapJobDetail } from '../lib/jobs.js';
import { FEATURES, liveToolNames, resolveTool } from '../lib/registry.js';

/**
 * Placeholder sections (plan 05 layout). The tools console (plan 04) lives in
 * its own file (ToolsPage.tsx); the dashboard and jobs pages are real pages
 * since plan 06; the remaining data binding lands in plan 07.
 */

/**
 * Proposal draft landing (plan 06, D6.3): the apply CTA route. The two-step
 * draft → review → confirm-submit UI ships in plan 07; until then this page
 * names the job and points to the tools console so nothing is dead-ended.
 */
export function ProposalDraftPage() {
  const { status } = useUpworkStatus();
  const connected = status.state === 'connected';
  const { account } = useAccount();
  const orgUid = account?.orgUid ?? null;
  const params = useParams<{ jobKey: string }>();
  const jobKey = params.jobKey ?? '';

  const { tools, loading: toolsLoading } = useToolList(connected);
  const live = useMemo(() => liveToolNames(tools), [tools]);
  const args = useMemo(
    () => (orgUid !== null && jobKey !== '' ? buildGetArgs(jobKey, orgUid) : null),
    [orgUid, jobKey],
  );
  const { state } = useFeature(
    FEATURES.jobGet,
    resolveTool(FEATURES.jobGet, live),
    orgUid,
    args,
    { toolsLoading },
  );
  const detail = state.kind === 'ok' ? mapJobDetail(state.data, jobKey) : null;

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-up-border bg-white px-6 py-10 text-center dark:border-white/15 dark:bg-white/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-up-green-hc dark:text-up-lime">
        Proposal draft
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-up-black dark:text-white">
        {detail !== null ? detail.title : jobKey !== '' ? 'This job' : 'Proposal draft'}
      </h1>
      <p className="mt-3 text-sm text-up-black/60 dark:text-white/60">
        The two-step draft → review → confirm-submit flow lands in{' '}
        <span className="font-semibold text-up-black/80 dark:text-white/80">plan 07</span>. Until then you can
        draft manually in the tools console — this app never auto-confirms binding actions.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {jobKey !== '' && (
          <Link
            to={`/jobs/${encodeURIComponent(jobKey)}`}
            className="rounded-md border border-up-border bg-white px-4 py-2 text-sm font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-white/5 dark:text-up-lime dark:hover:bg-white/10"
          >
            Back to job
          </Link>
        )}
        <Link
          to="/tools"
          className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
        >
          Open tools console
        </Link>
      </div>
    </div>
  );
}

export function ProposalsPage() {
  return (
    <EmptyState
      title="Proposals"
      description="List, detail, and the draft → review → confirm-submit flow. Connects cost is shown before you commit; binding actions finish on upwork.com."
      plan="plan 07"
    />
  );
}

export function InvitationsPage() {
  return (
    <EmptyState
      title="Invitations & offers"
      description="Your inbox of client invitations and offers — accept, decline, or ask for changes, with notices for steps that finish on upwork.com."
      plan="plan 07"
    />
  );
}

export function MessagesPage() {
  return (
    <EmptyState
      title="Messages"
      description="Threaded inbox with unread badges, a composer, and attachment upload/download."
      plan="plan 07"
    />
  );
}

export function ContractsPage() {
  return (
    <EmptyState
      title="Contracts"
      description="Active and past contracts, milestone work, and your work diary."
      plan="plan 07"
    />
  );
}

export function ProfilePage() {
  return (
    <EmptyState
      title="Profile & earnings"
      description="Earnings and available balance, plus availability, employment, languages, education, portfolio, and profile visibility."
      plan="plan 07"
    />
  );
}

export function NotFoundPage() {
  return (
    <div className="py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-up-green-hc dark:text-up-lime">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-up-black dark:text-white">Page not found</h1>
      <p className="mt-2 text-sm text-up-black/60 dark:text-white/60">
        That page does not exist in this deployment.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
      >
        Back to dashboard
      </Link>
    </div>
  );
}

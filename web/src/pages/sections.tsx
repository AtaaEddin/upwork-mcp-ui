import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState.js';

/**
 * Placeholder sections (plan 05 layout). The tools console (plan 04) lives in
 * its own file (ToolsPage.tsx); the dashboard, jobs, proposals, proposal-draft,
 * and invitations/offers pages are real pages since plans 06/07a/07b; the
 * remaining data binding lands in plan 07 (07c-07d).
 */

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

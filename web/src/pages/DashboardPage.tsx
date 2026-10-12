import { useMemo } from 'react';
import { Link } from 'react-router';
import { FeatureCard } from '../components/FeatureCard.js';
import { NotConnectedCta } from '../components/NotConnectedCta.js';
import { useAccount } from '../context/account.js';
import { useFeature } from '../hooks/useFeature.js';
import { useToolList } from '../hooks/useToolList.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import { buildSmartArgs, mapJobResult } from '../lib/jobs.js';
import { FEATURES, liveToolNames, resolveTool } from '../lib/registry.js';
import { connectsBalanceOf, mapListResult } from '../lib/rows.js';

/**
 * Dashboard (plan 06, D6.3): independent per-feature cards over
 * invitations, offers, active rooms, matched jobs and the Connects wallet.
 * Each card degrades on its own (missing tool / error / retry).
 */
export function DashboardPage() {
  const { status } = useUpworkStatus();
  const connected = status.state === 'connected';
  const { account, accounts, loading: accountLoading, error: accountError, refresh, select } =
    useAccount();
  const orgUid = account?.orgUid ?? null;

  const { tools, loading: toolsLoading } = useToolList(connected);
  const live = useMemo(() => liveToolNames(tools), [tools]);

  const invitations = useFeature(
    FEATURES.invitations,
    resolveTool(FEATURES.invitations, live),
    orgUid,
    {},
    { toolsLoading },
  );
  const offers = useFeature(
    FEATURES.offers,
    resolveTool(FEATURES.offers, live),
    orgUid,
    {},
    { toolsLoading },
  );
  const rooms = useFeature(
    FEATURES.rooms,
    resolveTool(FEATURES.rooms, live),
    orgUid,
    {},
    { toolsLoading },
  );
  const matched = useFeature(
    FEATURES.jobsSmart,
    resolveTool(FEATURES.jobsSmart, live),
    orgUid,
    orgUid !== null ? buildSmartArgs(orgUid, 'best_match') : null,
    { toolsLoading },
  );
  const connects = useFeature(
    FEATURES.connects,
    resolveTool(FEATURES.connects, live),
    orgUid,
    {},
    { toolsLoading },
  );

  if (connected === false) {
    return <NotConnectedCta title="Dashboard" state={status.state} />;
  }

  if (account === null) {
    return (
      <div className="rounded-lg border border-up-border bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-white/5">
        <h1 className="text-lg font-semibold text-up-black dark:text-white">Dashboard</h1>
        <p className="mt-2 text-sm text-up-black/60 dark:text-white/60">
          {accountLoading
            ? 'Looking for your Upwork account…'
            : accountError !== null
              ? accountError
              : 'No account could be selected automatically. Refresh to try again.'}
        </p>
        {!accountLoading && (
          <button
            type="button"
            onClick={() => void refresh(true)}
            className="mt-4 rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
          >
            Refresh
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-up-black dark:text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-up-black/60 dark:text-white/60">
            Hi {account.name} — here is your Upwork at a glance.
          </p>
        </div>
        {accounts.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-up-black/50 dark:text-white/50">
            Account
            <select
              value={account.orgUid}
              onChange={(e) => void select(e.target.value)}
              className="rounded-md border border-up-border bg-white px-2 py-1.5 text-xs text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-surface-2 dark:text-white"
            >
              {accounts.map((a) => (
                <option key={a.orgUid} value={a.orgUid}>
                  {a.name}
                  {a.suspended ? ' (suspended)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <FeatureCard
          title="Invitations"
          state={invitations.state}
          tool={FEATURES.invitations.tools[0]}
          onRetry={invitations.reload}
          render={(data) => renderList(data, 'No invitations right now.', '/proposals')}
        />
        <FeatureCard
          title="Open offers"
          state={offers.state}
          tool={FEATURES.offers.tools[0]}
          onRetry={offers.reload}
          render={(data) => renderList(data, 'No open offers.', '/invitations?tab=offers')}
        />
        <FeatureCard
          title="Active messages"
          state={rooms.state}
          tool={FEATURES.rooms.tools[0]}
          onRetry={rooms.reload}
          render={(data) => renderList(data, 'No active conversations.', '/messages')}
        />
        <FeatureCard
          title="Matched jobs"
          state={matched.state}
          tool={FEATURES.jobsSmart.tools[0]}
          onRetry={matched.reload}
          render={renderMatched}
        />
        <FeatureCard
          title="Connects"
          state={connects.state}
          tool={FEATURES.connects.tools[0]}
          onRetry={connects.reload}
          render={renderConnects}
        />
      </div>

      <p className="text-xs text-up-black/50 dark:text-white/50">
        Sections load independently: a missing tool or a failed call only affects its own card.
        Anything you need is also available in the{' '}
        <Link to="/tools" className="font-semibold text-up-teal underline dark:text-up-lime">
          tools console
        </Link>
        .
      </p>
    </div>
  );
}

function renderList(data: unknown, empty: string, to: string) {
  const res = mapListResult(data);
  if (res.count === 0) {
    return <p className="text-sm text-up-black/60 dark:text-white/60">{empty}</p>;
  }
  return (
    <div>
      <p className="text-2xl font-semibold text-up-black dark:text-white">{res.count}</p>
      {res.items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {res.items.slice(0, 3).map((it) => (
            <li key={it.key} className="truncate text-xs text-up-black/70 dark:text-white/70">
              {it.title}
              {it.sub !== null ? ` — ${it.sub}` : ''}
            </li>
          ))}
        </ul>
      )}
      <Link to={to} className="mt-2 inline-block text-xs font-semibold text-up-teal underline dark:text-up-lime">
        View all →
      </Link>
    </div>
  );
}

function renderMatched(data: unknown) {
  const res = mapJobResult(data);
  if (res.rows.length === 0) {
    return <p className="text-sm text-up-black/60 dark:text-white/60">No matched jobs yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {res.rows.slice(0, 4).map((row) => (
        <li key={row.key} className="text-sm">
          <Link
            to={`/jobs/${encodeURIComponent(row.jobKey)}`}
            className="font-medium text-up-teal underline hover:text-up-green dark:text-up-lime dark:hover:text-up-sky"
          >
            {row.title}
          </Link>
          {row.budget !== null && (
            <span className="ml-1 text-xs text-up-black/50 dark:text-white/50">{row.budget}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function renderConnects(data: unknown) {
  const bal = connectsBalanceOf(data);
  if (bal === null) {
    return (
      <p className="text-sm text-up-black/60 dark:text-white/60">
        Balance not reported in the expected fields.
      </p>
    );
  }
  return (
    <p className="text-2xl font-semibold text-up-black dark:text-white">
      {`${bal} Connects`}
    </p>
  );
}

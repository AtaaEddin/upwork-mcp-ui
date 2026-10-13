/**
 * Invitations & offers (plan 07b): one page, two tabs (`?tab=offers`).
 *
 * The list row already carries the terms (D7.6), so the detail is an
 * inline expansion of the selected row (+ raw JSON) — no invented `get`
 * action. Actions: invitations accept (binding → `finalize_url`) /
 * decline; offers accept (binding) / decline / request-changes (the two
 * last are preview → second confirm step, D7.1). All write actions run
 * through ConfirmModal (D7.4); results toast; the list refreshes after a
 * successful action.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FeatureCard } from '../components/FeatureCard.js';
import { InvitationActions } from '../components/InvitationActions.js';
import { NotConnectedCta } from '../components/NotConnectedCta.js';
import { OfferActions } from '../components/OfferActions.js';
import { useAccount } from '../context/account.js';
import { useFeature } from '../hooks/useFeature.js';
import { useToolList } from '../hooks/useToolList.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import { mapInvitations, mapOffers, type InvitationRow, type OfferRow } from '../lib/invitations.js';
import { FEATURES, liveToolNames, resolveTool } from '../lib/registry.js';

type Tab = 'invitations' | 'offers';

export function InvitationsPage() {
  const { status } = useUpworkStatus();
  const connected = status.state === 'connected';
  const { account, loading: accountLoading, error: accountError, refresh } = useAccount();
  const orgUid = account?.orgUid ?? null;

  const { tools, loading: toolsLoading } = useToolList(connected);
  const live = useMemo(() => liveToolNames(tools), [tools]);

  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'offers' ? 'offers' : 'invitations';
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const switchTab = (next: Tab) => {
    setSelectedKey(null);
    if (next === 'offers') setSearchParams({ tab: 'offers' });
    else setSearchParams({});
  };

  const invArgs = useMemo(
    () => (orgUid !== null && tab === 'invitations' ? {} : null),
    [orgUid, tab],
  );
  const invList = useFeature(
    FEATURES.invitations,
    resolveTool(FEATURES.invitations, live),
    orgUid,
    invArgs,
    { toolsLoading },
  );
  const offerArgs = useMemo(
    () => (orgUid !== null && tab === 'offers' ? {} : null),
    [orgUid, tab],
  );
  const offerList = useFeature(
    FEATURES.offers,
    resolveTool(FEATURES.offers, live),
    orgUid,
    offerArgs,
    { toolsLoading },
  );

  if (connected === false) {
    return <NotConnectedCta title="Invitations & offers" state={status.state} />;
  }
  if (account === null) {
    return (
      <div className="rounded-lg border border-up-border bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-white/5">
        <h1 className="text-lg font-semibold text-up-black dark:text-white">
          Invitations & offers
        </h1>
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

  const invRows = invList.state.kind === 'ok' ? mapInvitations(invList.state.data) : [];
  const offerRows = offerList.state.kind === 'ok' ? mapOffers(offerList.state.data) : [];
  const selectedInvitation = invRows.find((r) => r.key === selectedKey) ?? null;
  const selectedOffer = offerRows.find((r) => r.key === selectedKey) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-up-black dark:text-white">
          Invitations & offers
        </h1>
        <p className="mt-1 text-sm text-up-black/60 dark:text-white/60">
          Jobs that invited you and offers on your proposals. Accepting is a binding action —
          the final step always finishes on upwork.com.
        </p>
      </header>

      <div role="tablist" aria-label="Invitations and offers" className="flex gap-2">
        <TabButton label="Invitations" active={tab === 'invitations'} onClick={() => switchTab('invitations')} />
        <TabButton label="Offers" active={tab === 'offers'} onClick={() => switchTab('offers')} />
      </div>

      {tab === 'invitations' ? (
        <FeatureCard
          title="Invitations"
          state={invList.state}
          tool={FEATURES.invitations.tools[0]}
          onRetry={invList.reload}
          render={(data) => {
            const rows = mapInvitations(data);
            if (rows.length === 0) {
              return (
                <p className="text-sm text-up-black/60 dark:text-white/60">
                  No open invitations right now.
                </p>
              );
            }
            return (
              <ul className="divide-y divide-up-border overflow-hidden rounded-lg border border-up-border bg-white dark:divide-white/10 dark:border-white/15 dark:bg-white/5">
                {rows.map((row) => (
                  <li key={row.key}>
                    <RowButton
                      title={row.jobTitle ?? 'Invited job'}
                      chip={row.statusLabel ?? row.status ?? 'Invited'}
                      meta={[row.clientName, row.terms, row.expires].filter(Boolean).join(' · ')}
                      jobKey={row.jobKey}
                      selected={row.key === selectedKey}
                      onSelect={() => setSelectedKey(row.key)}
                    />
                  </li>
                ))}
              </ul>
            );
          }}
        />
      ) : (
        <FeatureCard
          title="Open offers"
          state={offerList.state}
          tool={FEATURES.offers.tools[0]}
          onRetry={offerList.reload}
          render={(data) => {
            const rows = mapOffers(data);
            if (rows.length === 0) {
              return (
                <p className="text-sm text-up-black/60 dark:text-white/60">
                  No open offers right now.
                </p>
              );
            }
            return (
              <ul className="divide-y divide-up-border overflow-hidden rounded-lg border border-up-border bg-white dark:divide-white/10 dark:border-white/15 dark:bg-white/5">
                {rows.map((row) => (
                  <li key={row.key}>
                    <RowButton
                      title={row.jobTitle ?? 'Offer'}
                      chip={row.statusLabel ?? row.status ?? 'Open'}
                      meta={
                        [
                          row.clientName,
                          row.hourlyRate !== null
                            ? `${row.hourlyRate}/hr`
                            : row.fixedPrice,
                          row.expires,
                        ].filter(Boolean).join(' · ')
                      }
                      jobKey={row.jobKey}
                      selected={row.key === selectedKey}
                      onSelect={() => setSelectedKey(row.key)}
                    />
                  </li>
                ))}
              </ul>
            );
          }}
        />
      )}

      {tab === 'invitations' && selectedInvitation !== null && (
        <InvitationDetail
          row={selectedInvitation}
          orgUid={orgUid}
          live={live}
          onDone={invList.reload}
        />
      )}
      {tab === 'offers' && selectedOffer !== null && (
        <OfferDetail row={selectedOffer} orgUid={orgUid} live={live} onDone={offerList.reload} />
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'rounded-md px-4 py-2 text-sm font-semibold transition-colors ' +
        (active
          ? 'bg-up-green text-white'
          : 'border border-up-border bg-white text-up-teal hover:bg-up-surface-2 dark:border-white/15 dark:bg-transparent dark:text-up-lime dark:hover:bg-white/10')
      }
    >
      {label}
    </button>
  );
}

function RowButton({
  title,
  chip,
  meta,
  jobKey,
  selected,
  onSelect,
}: {
  title: string;
  chip: string;
  meta: string;
  jobKey: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        'block w-full px-4 py-3 text-left transition-colors hover:bg-up-surface dark:hover:bg-white/5 ' +
        (selected ? 'bg-up-surface-2 dark:bg-white/10' : '')
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-up-teal dark:text-up-lime">{title}</span>
        <span className="rounded-full bg-up-green/10 px-2 py-0.5 text-xs font-semibold text-up-green-hc dark:text-up-lime">
          {chip}
        </span>
      </div>
      {meta !== '' && (
        <div className="mt-1 text-xs text-up-black/50 dark:text-white/50">{meta}</div>
      )}
      {jobKey !== null && (
        <span className="mt-1 block truncate text-xs text-up-black/40 dark:text-white/40">
          Job: {jobKey}
        </span>
      )}
    </button>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-up-border bg-white px-6 py-5 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-base font-semibold text-up-black dark:text-white">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function DetailMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-up-border bg-white p-3 dark:border-white/15 dark:bg-white/5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-up-black dark:text-white">{value}</dd>
    </div>
  );
}

function JobLink({ jobKey }: { jobKey: string | null }) {
  if (jobKey === null) return null;
  return (
    <Link
      to={`/jobs/${encodeURIComponent(jobKey)}`}
      className="text-xs font-semibold text-up-teal underline dark:text-up-lime"
    >
      Open job
    </Link>
  );
}

function RawJson({ data }: { data: unknown }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-up-teal dark:text-up-lime">
        Raw result JSON
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-up-surface p-3 text-xs text-up-black dark:bg-up-black dark:text-white">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function InvitationDetail({
  row,
  orgUid,
  live,
  onDone,
}: {
  row: InvitationRow;
  orgUid: string | null;
  live: Set<string>;
  onDone: () => void;
}) {
  return (
    <DetailCard title="Invitation details">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-up-black dark:text-white">
          {row.jobTitle ?? 'Invited job'}
        </h3>
        <span className="rounded-full bg-up-green/10 px-2 py-0.5 text-xs font-semibold text-up-green-hc dark:text-up-lime">
          {row.statusLabel ?? row.status ?? 'Invited'}
        </span>
      </div>
      <div className="text-xs text-up-black/50 dark:text-white/50">
        {[row.clientName, row.terms, row.expires].filter(Boolean).join(' · ')}
      </div>
      <JobLink jobKey={row.jobKey} />
      <div className="pt-1">
        <InvitationActions
          invitation={{ id: row.id, jobNumericId: row.jobNumericId, jobTitle: row.jobTitle }}
          orgUid={orgUid}
          live={live}
          onDone={onDone}
        />
      </div>
      <RawJson data={row.raw} />
    </DetailCard>
  );
}

function OfferDetail({
  row,
  orgUid,
  live,
  onDone,
}: {
  row: OfferRow;
  orgUid: string | null;
  live: Set<string>;
  onDone: () => void;
}) {
  return (
    <DetailCard title="Offer details">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-up-black dark:text-white">
          {row.jobTitle ?? 'Offer'}
        </h3>
        <span className="rounded-full bg-up-green/10 px-2 py-0.5 text-xs font-semibold text-up-green-hc dark:text-up-lime">
          {row.statusLabel ?? row.status ?? 'Open'}
        </span>
      </div>
      <div className="text-xs text-up-black/50 dark:text-white/50">
        {[row.clientName, row.expires].filter(Boolean).join(' · ')}
      </div>
      <JobLink jobKey={row.jobKey} />
      <dl className="grid gap-3 sm:grid-cols-2">
        <DetailMeta
          label="Rate"
          value={
            row.hourlyRate !== null
              ? `${row.hourlyRate}/hr`
              : row.fixedPrice !== null
                ? `${row.fixedPrice} (fixed)`
                : '—'
          }
        />
        <DetailMeta label="Expires" value={row.expires ?? '—'} />
      </dl>
      <div className="pt-1">
        <OfferActions
          offer={{ id: row.id, jobNumericId: row.jobNumericId, jobTitle: row.jobTitle }}
          orgUid={orgUid}
          live={live}
          onDone={onDone}
        />
      </div>
      <RawJson data={row.raw} />
    </DetailCard>
  );
}

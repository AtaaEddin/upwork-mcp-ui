import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FeatureCard } from '../components/FeatureCard.js';
import { NotConnectedCta } from '../components/NotConnectedCta.js';
import { useAccount } from '../context/account.js';
import { useFeature } from '../hooks/useFeature.js';
import { useToolList } from '../hooks/useToolList.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import {
  mapProposalDetail,
  mapProposals,
  type ProposalDetailData,
  type ProposalRow,
} from '../lib/proposals.js';
import { FEATURES, liveToolNames, resolveTool } from '../lib/registry.js';

/**
 * Proposals (plan 07a): list with a status filter + detail.
 * `list_freelancer_proposals` list actions apply a default status filter,
 * so "All" omits `status` and specific states set it explicitly (D7.1).
 * Status display prefers `status_label` (plain English) over the raw code —
 * notably `Accepted` means "submitted & validated", not client-accepted.
 */

/** Status values the UI can request (documented best-known, D7.1). */
export const PROPOSAL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All (Upwork default filter)' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Accepted', label: 'Accepted (submitted & validated)' },
  { value: 'Offered', label: 'Offered' },
  { value: 'Hired', label: 'Hired' },
];

export function ProposalsPage() {
  const { status } = useUpworkStatus();
  const connected = status.state === 'connected';
  const { account, loading: accountLoading, error: accountError, refresh } = useAccount();
  const orgUid = account?.orgUid ?? null;

  const { tools, loading: toolsLoading } = useToolList(connected);
  const live = useMemo(() => liveToolNames(tools), [tools]);

  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listArgs = useMemo(
    () => (orgUid !== null ? (statusFilter === '' ? {} : { status: statusFilter }) : null),
    [orgUid, statusFilter],
  );
  const list = useFeature(
    FEATURES.proposalsList,
    resolveTool(FEATURES.proposalsList, live),
    orgUid,
    listArgs,
    { toolsLoading },
  );

  const detailArgs = useMemo(
    () => (selectedId !== null ? { id: selectedId } : null),
    [selectedId],
  );
  const detail = useFeature(
    FEATURES.proposalsGet,
    resolveTool(FEATURES.proposalsGet, live),
    orgUid,
    detailArgs,
    { toolsLoading },
  );

  if (connected === false) {
    return <NotConnectedCta title="Proposals" state={status.state} />;
  }
  if (account === null) {
    return (
      <div className="rounded-lg border border-up-border bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-white/5">
        <h1 className="text-lg font-semibold text-up-black dark:text-white">Proposals</h1>
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
      <header>
        <h1 className="text-2xl font-semibold text-up-black dark:text-white">Proposals</h1>
        <p className="mt-1 text-sm text-up-black/60 dark:text-white/60">
          Your applications. Selecting one loads its details; a missing tool degrades this page
          only.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label>
          <span className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
            Status
          </span>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setSelectedId(null);
            }}
            className="mt-1 block w-full min-w-56 rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-surface-2 dark:text-white"
          >
            {PROPOSAL_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {statusFilter !== '' && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter('');
              setSelectedId(null);
            }}
            className="self-end rounded-md border border-up-border bg-white px-3 py-2 text-xs font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-white/5 dark:text-up-lime dark:hover:bg-white/10"
          >
            Reset
          </button>
        )}
      </div>

      <FeatureCard
        title="Proposals"
        state={list.state}
        tool={FEATURES.proposalsList.tools[0]}
        onRetry={list.reload}
        render={(data) => {
          const rows = mapProposals(data);
          if (rows.length === 0) {
            return (
              <p className="text-sm text-up-black/60 dark:text-white/60">
                No proposals for this status yet.
              </p>
            );
          }
          return (
            <ul className="divide-y divide-up-border overflow-hidden rounded-lg border border-up-border bg-white dark:divide-white/10 dark:border-white/15 dark:bg-white/5">
              {rows.map((row) => (
                <li key={row.key}>
                  <ProposalRowItem
                    row={row}
                    selected={selectedId !== null && row.id !== null && row.id === selectedId}
                    onSelect={() => row.id !== null && setSelectedId(row.id)}
                  />
                </li>
              ))}
            </ul>
          );
        }}
      />

      {selectedId !== null && (
        <FeatureCard
          title="Proposal details"
          state={detail.state}
          tool={FEATURES.proposalsGet.tools[0]}
          onRetry={detail.reload}
          render={(data) => {
            const d = mapProposalDetail(data);
            if (d === null) {
              return <p className="text-sm text-up-black/60 dark:text-white/60">Proposal data not found in the result.</p>;
            }
            return <ProposalDetail d={d} />;
          }}
        />
      )}
    </div>
  );
}

function ProposalRowItem({
  row,
  selected,
  onSelect,
}: {
  row: ProposalRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const selectable = row.id !== null;
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-up-teal dark:text-up-lime">{row.title}</span>
        <span className="rounded-full bg-up-green/10 px-2 py-0.5 text-xs font-semibold text-up-green-hc dark:text-up-lime">
          {row.statusLabel ?? row.status ?? 'Unknown status'}
        </span>
        {row.bid !== null && (
          <span className="text-sm text-up-black/60 dark:text-white/60">{row.bid}</span>
        )}
      </div>
      <div className="mt-1 text-xs text-up-black/50 dark:text-white/50">
        {[row.clientName, row.posted].filter(Boolean).join(' · ')}
      </div>
    </>
  );
  return selectable ? (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        'block w-full px-4 py-3 text-left transition-colors hover:bg-up-surface dark:hover:bg-white/5 ' +
        (selected ? 'bg-up-surface-2 dark:bg-white/10' : '')
      }
    >
      {body}
      {row.jobKey !== null && (
        <span className="mt-1 block truncate text-xs text-up-black/40 dark:text-white/40">
          Job: {row.jobKey}
        </span>
      )}
    </button>
  ) : (
    <div className="px-4 py-3">{body}</div>
  );
}

function ProposalDetail({ d }: { d: ProposalDetailData }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-up-black dark:text-white">
            {d.jobTitle ?? 'Proposal'}
          </h3>
          <span className="rounded-full bg-up-green/10 px-2 py-0.5 text-xs font-semibold text-up-green-hc dark:text-up-lime">
            {d.statusLabel ?? d.status ?? 'Unknown status'}
          </span>
        </div>
        {d.clientName !== null && (
          <p className="mt-1 text-xs text-up-black/50 dark:text-white/50">{d.clientName}</p>
        )}
        {d.jobKey !== null && (
          <Link
            to={d.jobKey !== null ? `/jobs/${encodeURIComponent(d.jobKey)}` : '/jobs'}
            className="mt-1 inline-block text-xs font-semibold text-up-teal underline dark:text-up-lime"
          >
            Open job
          </Link>
        )}
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetaItem label="Bid (stored)" value={d.chargedAmount ?? '—'} />
        <MetaItem label="Connects bid" value={d.connectsBid !== null ? `${d.connectsBid} Connects` : '—'} />
        <MetaItem label="Status (raw)" value={d.status ?? '—'} />
      </dl>

      {d.coverLetter !== null && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
            Cover letter
          </h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-up-black/80 dark:text-white/80">
            {d.coverLetter}
          </p>
        </section>
      )}

      {d.screening.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
            Screening answers
          </h4>
          <div className="mt-2 space-y-2">
            {d.screening.map((s) => (
              <div key={s.question} className="text-sm">
                <p className="font-medium text-up-black/80 dark:text-white/80">{s.question}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-up-black/70 dark:text-white/70">{s.answer}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {d.attachments.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
            Attachments
          </h4>
          <ul className="mt-2 list-disc pl-5 text-sm text-up-black/80 dark:text-white/80">
            {d.attachments.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <details>
        <summary className="cursor-pointer text-xs font-semibold text-up-teal dark:text-up-lime">
          Raw result JSON
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-up-surface p-3 text-xs text-up-black dark:bg-up-surface-2 dark:text-white">
          {JSON.stringify(d.raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-up-border bg-white p-3 dark:border-white/15 dark:bg-white/5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-up-black dark:text-white">{value}</dd>
    </div>
  );
}

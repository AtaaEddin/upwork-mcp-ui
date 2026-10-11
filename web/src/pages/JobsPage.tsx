import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { FeatureCard } from '../components/FeatureCard.js';
import { NotConnectedCta } from '../components/NotConnectedCta.js';
import { useAccount } from '../context/account.js';
import { useFeature } from '../hooks/useFeature.js';
import { useToolList } from '../hooks/useToolList.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import {
  buildSearchArgs,
  buildSmartArgs,
  EMPTY_FILTERS,
  mapJobResult,
  type JobFilters,
  type JobMeta,
  type JobRow,
} from '../lib/jobs.js';
import { FEATURES, liveToolNames, resolveTool } from '../lib/registry.js';
import type { FeatureState } from '../hooks/useFeature.js';

type View = 'matched' | 'search';

/**
 * Jobs search (plan 06, D6.3). First visit shows `smart_search` matches;
 * the search form switches to `find_jobs action: 'search'` with
 * query/category/budget/type. Pagination is a pass-through echo of the
 * returned values; server feedback (`empty_reason`, `filters_ignored`,
 * `needs_details`) is surfaced verbatim.
 */
export function JobsPage() {
  const { status } = useUpworkStatus();
  const connected = status.state === 'connected';
  const { account, loading: accountLoading, error: accountError, refresh } = useAccount();
  const orgUid = account?.orgUid ?? null;

  const { tools, loading: toolsLoading } = useToolList(connected);
  const live = useMemo(() => liveToolNames(tools), [tools]);

  const [filters, setFilters] = useState<JobFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<View>('matched');
  /** Page stack: `pages[0] = null` is the first page; last entry is current. */
  const [pages, setPages] = useState<Array<Record<string, unknown> | null>>([null]);
  const page = pages[pages.length - 1] ?? null;

  const matchedArgs = useMemo(
    () => (view === 'matched' && orgUid !== null ? buildSmartArgs(orgUid, 'best_match', page) : null),
    [view, orgUid, page],
  );
  const searchArgs = useMemo(
    () => (view === 'search' && orgUid !== null ? buildSearchArgs(filters, orgUid, page) : null),
    [view, filters, orgUid, page],
  );

  const matched = useFeature(
    FEATURES.jobsSmart,
    resolveTool(FEATURES.jobsSmart, live),
    orgUid,
    matchedArgs,
    { toolsLoading },
  );
  const search = useFeature(
    FEATURES.jobsSearch,
    resolveTool(FEATURES.jobsSearch, live),
    orgUid,
    searchArgs,
    { toolsLoading },
  );

  const active: FeatureState = view === 'search' ? search.state : matched.state;
  const activeReload = view === 'search' ? search.reload : matched.reload;

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setView('search');
      setPages([null]);
    },
    [],
  );

  const resetForm = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setView('matched');
    setPages([null]);
  }, []);

  const gotoNext = useCallback(
    (meta: JobMeta) => {
      if (meta.nextPage !== null) setPages((p) => [...p, meta.nextPage as Record<string, unknown>]);
    },
    [],
  );

  const gotoPrev = useCallback(() => {
    setPages((p) => (p.length > 1 ? p.slice(0, -1) : p));
  }, []);

  if (connected === false) {
    return <NotConnectedCta title="Find jobs" state={status.state} />;
  }
  if (account === null) {
    return (
      <div className="rounded-lg border border-up-border bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-white/5">
        <h1 className="text-lg font-semibold text-up-black dark:text-white">Find jobs</h1>
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
        <h1 className="text-2xl font-semibold text-up-black dark:text-white">Find jobs</h1>
        <p className="mt-1 text-sm text-up-black/60 dark:text-white/60">
          Starts with jobs matched to your profile; run a search to filter by your own terms.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-up-border bg-white p-4 dark:border-white/15 dark:bg-white/5"
      >
        <label className="min-w-52 flex-1 basis-64">
          <FieldLabel>Keyword</FieldLabel>
          <input
            type="text"
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            placeholder="e.g. React, TypeScript…"
            className={inputCls}
          />
        </label>
        <label className="min-w-40 flex-1 basis-48">
          <FieldLabel>Category</FieldLabel>
          <input
            type="text"
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            placeholder="e.g. Engineering &amp; Product"
            className={inputCls}
          />
        </label>
        <label className="w-24">
          <FieldLabel>Budget min</FieldLabel>
          <input
            type="number"
            min={0}
            value={filters.budgetMin}
            onChange={(e) => setFilters({ ...filters, budgetMin: e.target.value })}
            placeholder="0"
            className={inputCls}
          />
        </label>
        <label className="w-24">
          <FieldLabel>Budget max</FieldLabel>
          <input
            type="number"
            min={0}
            value={filters.budgetMax}
            onChange={(e) => setFilters({ ...filters, budgetMax: e.target.value })}
            placeholder="0"
            className={inputCls}
          />
        </label>
        <label className="w-28">
          <FieldLabel>Type</FieldLabel>
          <select
            value={filters.jobType}
            onChange={(e) =>
              setFilters({
                ...filters,
                jobType: e.target.value as JobFilters['jobType'],
              })
            }
            className={inputCls}
          >
            <option value="any">Any</option>
            <option value="hourly">Hourly</option>
            <option value="fixed">Fixed</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
          >
            Search
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-md border border-up-border bg-white px-3 py-2 text-xs font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-white/5 dark:text-up-lime dark:hover:bg-white/10"
          >
            Reset
          </button>
        </div>
      </form>

      <FeatureCard
        title={view === 'search' ? 'Search results' : 'Matched jobs'}
        state={active}
        tool={FEATURES.jobsSearch.tools[0]}
        onRetry={activeReload}
        render={(data) => {
          const res = mapJobResult(data);
          return (
            <div className="space-y-3">
              <FeedbackNotes meta={res.meta} />
              {res.rows.length === 0 ? (
                <p className="text-sm text-up-black/60 dark:text-white/60">
                  {res.meta.emptyReason ?? 'No jobs found. Try wider filters.'}
                </p>
              ) : (
                <ul className="divide-y divide-up-border overflow-hidden rounded-lg border border-up-border bg-white dark:divide-white/10 dark:border-white/15 dark:bg-white/5">
                  {res.rows.map((row) => (
                    <JobRowItem key={row.key} row={row} />
                  ))}
                </ul>
              )}
              <PaginationBar
                meta={res.meta}
                canPrev={pages.length > 1}
                onPrev={gotoPrev}
                onNext={() => gotoNext(res.meta)}
                loading={active.kind === 'pending'}
              />
            </div>
          );
        }}
      />
    </div>
  );
}

const inputCls =
  'mt-1 w-full rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-surface-2 dark:text-white dark:focus:border-up-green';

function FieldLabel({ children }: { children: string }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
      {children}
    </span>
  );
}

function JobRowItem({ row }: { row: JobRow }) {
  return (
    <li>
      <Link
        to={`/jobs/${encodeURIComponent(row.jobKey)}`}
        className="block px-4 py-3 transition-colors hover:bg-up-surface dark:hover:bg-white/5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-up-teal dark:text-up-lime">{row.title}</span>
          {row.applied && (
            <span className="rounded-full bg-up-green/10 px-2 py-0.5 text-xs font-semibold text-up-green-hc dark:text-up-lime">
              Applied
            </span>
          )}
          {row.budget !== null && (
            <span className="text-sm text-up-black/60 dark:text-white/60">{row.budget}</span>
          )}
        </div>
        <div className="mt-1 text-xs text-up-black/50 dark:text-white/50">
          {[row.client, row.clientMeta, row.posted].filter(Boolean).join(' · ')}
        </div>
        {row.skills.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {row.skills.slice(0, 8).map((s) => (
              <li
                key={s}
                className="rounded-full border border-up-border bg-up-surface px-2 py-0.5 text-[11px] text-up-black/70 dark:border-white/15 dark:bg-white/10 dark:text-white/70"
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </Link>
    </li>
  );
}

function FeedbackNotes({ meta }: { meta: JobMeta }) {
  const hasNotes =
    meta.filtersIgnored !== null || meta.needsDetails !== null || meta.suggestedNextStep !== null;
  if (!hasNotes) return null;
  return (
    <div className="space-y-1 rounded-md border border-up-yellow/40 bg-up-yellow/10 px-3 py-2 text-xs text-up-black/80 dark:text-white/80">
      {meta.filtersIgnored !== null && meta.filtersIgnored.length > 0 && (
        <p>
          Upwork ignored some filters: {meta.filtersIgnored.join(', ')}.
        </p>
      )}
      {meta.needsDetails !== null && <p>More details needed: {meta.needsDetails}</p>}
      {meta.suggestedNextStep !== null && <p>Suggested next step: {meta.suggestedNextStep}</p>}
    </div>
  );
}

function PaginationBar({
  meta,
  canPrev,
  onPrev,
  onNext,
  loading,
}: {
  meta: JobMeta;
  canPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  loading: boolean;
}) {
  if (meta.nextPage === null && !canPrev) return null;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev || loading}
        className="rounded-md border border-up-border bg-white px-3 py-1.5 text-xs font-semibold text-up-teal transition-colors hover:bg-up-surface-2 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-up-lime dark:hover:bg-white/10"
      >
        ← Previous
      </button>
      {meta.nextPage !== null && (
        <button
          type="button"
          onClick={onNext}
          disabled={loading}
          className="rounded-md border border-up-border bg-white px-3 py-1.5 text-xs font-semibold text-up-teal transition-colors hover:bg-up-surface-2 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-up-lime dark:hover:bg-white/10"
        >
          Next page →
        </button>
      )}
      {meta.total !== null && (
        <span className="text-xs text-up-black/50 dark:text-white/50">{meta.total} total</span>
      )}
    </div>
  );
}

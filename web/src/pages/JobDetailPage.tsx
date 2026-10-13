import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { FeatureCard } from '../components/FeatureCard.js';
import { NotConnectedCta } from '../components/NotConnectedCta.js';
import { useAccount } from '../context/account.js';
import { useFeature } from '../hooks/useFeature.js';
import { useToolList } from '../hooks/useToolList.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import { buildGetArgs, isPlaceholderJobKey, mapJobDetail } from '../lib/jobs.js';
import { FEATURES, liveToolNames, resolveTool } from '../lib/registry.js';

/**
 * Job detail (plan 06, D6.3). `find_jobs action: 'get'` accepts the numeric
 * id, the `~02…` ciphertext, or the full job URL — the route carries any of
 * them (`:jobKey`). The apply panel shows the Connects cost and links to
 * the draft flow; the draft → confirm UI itself ships in plan 07.
 */
export function JobDetailPage() {
  const { status } = useUpworkStatus();
  const connected = status.state === 'connected';
  const { account, loading: accountLoading, error: accountError, refresh } = useAccount();
  const orgUid = account?.orgUid ?? null;
  const params = useParams<{ jobKey: string }>();
  const jobKey = (params.jobKey ?? '').trim();

  const { tools, loading: toolsLoading } = useToolList(connected);
  const live = useMemo(() => liveToolNames(tools), [tools]);
  // A search row with no recognizable reference arrives as a `row-<index>`
  // placeholder key: it is not a valid `find_jobs get` id, so no call is made
  // for it — the recovery card below takes over. `overrideKey` is a job
  // reference the owner pasted (URL / numeric id / `~02…` ciphertext) after
  // a failure; all three forms are valid `id` values.
  const [overrideKey, setOverrideKey] = useState<string | null>(null);
  const callKey = overrideKey ?? (isPlaceholderJobKey(jobKey) ? '' : jobKey);
  const args = useMemo(
    () => (orgUid !== null ? buildGetArgs(callKey, orgUid) : null),
    [orgUid, callKey],
  );
  const { state, reload } = useFeature(
    FEATURES.jobGet,
    resolveTool(FEATURES.jobGet, live),
    orgUid,
    args,
    { toolsLoading },
  );

  if (connected === false) {
    return <NotConnectedCta title="Job" state={status.state} />;
  }
  if (account === null) {
    return (
      <div className="rounded-lg border border-up-border bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-white/5">
        <h1 className="text-lg font-semibold text-up-black dark:text-white">Job</h1>
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
  if (jobKey === '') {
    return (
      <div className="rounded-lg border border-up-border bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-white/5">
        <p className="text-sm text-up-black/60 dark:text-white/60">
          No job selected. <Link to="/jobs" className="font-semibold text-up-teal underline dark:text-up-lime">Browse jobs</Link>.
        </p>
      </div>
    );
  }
  const placeholder = isPlaceholderJobKey(jobKey);

  const detail = state.kind === 'ok' ? mapJobDetail(state.data, callKey) : null;

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="text-sm font-semibold text-up-teal underline dark:text-up-lime">
        ← Back to jobs
      </Link>

      {placeholder && overrideKey === null ? (
        <JobKeyCard
          title="Open this job"
          body={
            'This job listing did not include a reference Upwork can open (no job id, '
            + 'ciphertext, or URL in the result). Paste the job URL from upwork.com — or the '
            + 'numeric job id / ~02… ciphertext — to load its details.'
          }
          onSubmit={setOverrideKey}
        />
      ) : (
        <>
      <FeatureCard
        title="Job details"
        state={state}
        tool={FEATURES.jobGet.tools[0]}
        onRetry={reload}
        render={(data) => {
          const d = mapJobDetail(data, callKey);
          if (d === null) {
            return <p className="text-sm text-up-black/60 dark:text-white/60">Job data not found in the result.</p>;
          }
          return (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold text-up-black dark:text-white">{d.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-up-black/60 dark:text-white/60">
                  {d.url !== null && (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-up-teal underline dark:text-up-lime"
                    >
                      Open on upwork.com
                    </a>
                  )}
                  {d.applied && (
                    <span className="rounded-full bg-up-green/10 px-2 py-0.5 text-xs font-semibold text-up-green-hc dark:text-up-lime">
                      Applied
                    </span>
                  )}
                </div>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetaItem label="Budget" value={d.budget ?? '—'} />
                <MetaItem label="Connects cost" value={d.connectsCost !== null ? `${d.connectsCost} Connects` : '—'} />
                <MetaItem label="Posted" value={d.posted ?? '—'} />
                <MetaItem
                  label="Client"
                  value={d.client !== null ? [d.client, d.clientMeta].filter(Boolean).join(' · ') : '—'}
                />
              </dl>

              {d.description !== null && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
                    Description
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-up-black/80 dark:text-white/80">
                    {d.description}
                  </p>
                </section>
              )}

              {d.requirements.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
                    Requirements
                  </h2>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-up-black/80 dark:text-white/80">
                    {d.requirements.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </section>
              )}

              {d.skills.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {d.skills.map((s) => (
                    <li
                      key={s}
                      className="rounded-full border border-up-border bg-up-surface px-2 py-0.5 text-[11px] text-up-black/70 dark:border-white/15 dark:bg-white/10 dark:text-white/70"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              )}

              <details>
                <summary className="cursor-pointer text-xs font-semibold text-up-teal dark:text-up-lime">
                  Raw result JSON
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-up-surface p-3 text-xs text-up-black dark:bg-up-black dark:text-white">
                  {JSON.stringify(d.raw, null, 2)}
                </pre>
              </details>
            </div>
          );
        }}
      />

      {state.kind === 'error' && (
        <JobKeyCard
          title="Try another job reference"
          body={
            'Upwork could not open this reference. If you have the job URL, the numeric job id, '
            + 'or the ~02… ciphertext, the job can be loaded with that.'
          }
          onSubmit={(key) => {
            setOverrideKey(key);
          }}
        />
      )}
      </>
      )}

      {detail !== null && (
        <ApplyPanel
          applied={detail.applied}
          jobKey={detail.jobKey ?? callKey}
          title={detail.title}
        />
      )}
    </div>
  );
}

/**
 * Paste-a-reference recovery (plan 10): `find_jobs` action `get` accepts a
 * full Upwork job URL, a numeric job id, or a `~02…` ciphertext — so a value
 * the owner pastes is always a valid `id` to retry with.
 */
function JobKeyCard({
  title,
  body,
  onSubmit,
}: {
  title: string;
  body: string;
  onSubmit: (key: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const key = value.trim();
    if (key !== '') onSubmit(key);
  };
  return (
    <section className="rounded-lg border border-up-border bg-white p-4 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
        {title}
      </h2>
      <p className="mt-2 text-sm text-up-black/70 dark:text-white/70">{body}</p>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Job URL, numeric job id, or ~02… ciphertext"
          aria-label="Job URL, numeric job id, or ciphertext"
          className="min-w-52 flex-1 rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-black dark:text-white"
        />
        <button
          type="submit"
          className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
        >
          Load job
        </button>
      </form>
    </section>
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

function ApplyPanel({ applied, jobKey, title }: { applied: boolean; jobKey: string; title: string }) {
  return (
    <section className="rounded-lg border border-up-border bg-white p-4 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
        Apply — {title}
      </h2>
      {applied ? (
        <p className="mt-2 text-sm text-up-black/60 dark:text-white/60">
          You have already applied to this job.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            to={`/jobs/${encodeURIComponent(jobKey)}/propose`}
            className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
          >
            Write proposal
          </Link>
          <p className="text-xs text-up-black/50 dark:text-white/50">
            Draft → review → confirm-submit; sending happens on Upwork, and this app never auto-confirms.
          </p>
        </div>
      )}
    </section>
  );
}

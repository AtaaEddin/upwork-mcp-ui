import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { FeatureCard } from '../components/FeatureCard.js';
import { NotConnectedCta } from '../components/NotConnectedCta.js';
import { useAccount } from '../context/account.js';
import { useFeature } from '../hooks/useFeature.js';
import { useToolList } from '../hooks/useToolList.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import { buildGetArgs, mapJobDetail } from '../lib/jobs.js';
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
  const jobKey = params.jobKey ?? '';

  const { tools, loading: toolsLoading } = useToolList(connected);
  const live = useMemo(() => liveToolNames(tools), [tools]);
  const args = useMemo(
    () => (orgUid !== null && jobKey !== '' ? buildGetArgs(jobKey, orgUid) : null),
    [orgUid, jobKey],
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

  const detail = state.kind === 'ok' ? mapJobDetail(state.data, jobKey) : null;

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="text-sm font-semibold text-up-teal underline dark:text-up-lime">
        ← Back to jobs
      </Link>

      <FeatureCard
        title="Job details"
        state={state}
        tool={FEATURES.jobGet.tools[0]}
        onRetry={reload}
        render={(data) => {
          const d = mapJobDetail(data, jobKey);
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
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-up-surface p-3 text-xs text-up-black dark:bg-up-surface-2 dark:text-white">
                  {JSON.stringify(d.raw, null, 2)}
                </pre>
              </details>
            </div>
          );
        }}
      />

      {detail !== null && (
        <ApplyPanel
          applied={detail.applied}
          jobKey={detail.jobKey ?? jobKey}
          title={detail.title}
        />
      )}
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

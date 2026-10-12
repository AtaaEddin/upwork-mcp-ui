import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ConfirmModal, type ConfirmOutcome } from '../components/ConfirmModal.js';
import { NotConnectedCta } from '../components/NotConnectedCta.js';
import { useAccount } from '../context/account.js';
import { useFeature, type FeatureState } from '../hooks/useFeature.js';
import { useToolList } from '../hooks/useToolList.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import { buildGetArgs, isPlaceholderJobKey, mapJobDetail } from '../lib/jobs.js';
import { InvitationActions } from '../components/InvitationActions.js';
import {
  buildConfirmArgs,
  buildCreateArgs,
  canConfirmPreview,
  clientFeedbackOf,
  highlightsOf,
  jobNumericIdOf,
  mapProposalDetail,
  mapProposals,
  matchesJob,
  needsDetailsOf,
  parseConfirmResult,
  parsePreview,
  screeningQuestionsOf,
  type ProposalPreview,
} from '../lib/proposals.js';
import { mapInvitations, type InvitationRow } from '../lib/invitations.js';
import { callFeature, FEATURES, liveToolNames, resolveTool } from '../lib/registry.js';
import { connectsBalanceOf } from '../lib/rows.js';
import { toastSuccess } from '../lib/toast.js';

/**
 * Proposal draft flow (plan 07a): the standard (non-invited) application.
 *
 * Two steps, MCP draft-confirm (D7.1/D7.4):
 *  1. `manage_proposals` action `create` — saves a PREVIEW (nothing is
 *     submitted, nothing is charged yet).
 *  2. `confirm_preview` action `confirm` — the submit (Connects charged).
 *
 * The submit control exists only after step 1 returned a confirmable
 * `preview_id` + `type` (`canConfirmPreview`, D7.3). Pre-draft checks:
 * an existing invitation → invitation notice WITH inline accept/decline
 * (plan 07b, D7.5: the shared `InvitationActions` panel),
 * an existing proposal / applied job → "already applied" notice (Upwork
 * rejects duplicate applications upstream).
 */

type Stage = 'form' | 'preview' | 'submitted';
type ConfirmStep = null | 'create' | 'submit';

interface SubmittedInfo {
  verified: boolean;
  statusLabel: string | null;
  connectsBid: string | null;
}

export function ProposalDraftPage() {
  const params = useParams<{ jobKey: string }>();
  const jobKey = params.jobKey ?? '';

  const { status } = useUpworkStatus();
  const connected = status.state === 'connected';
  const { account, loading: accountLoading, error: accountError, refresh } = useAccount();
  const orgUid = account?.orgUid ?? null;
  const isTalent = account?.role === 'TALENT';

  const { tools, loading: toolsLoading } = useToolList(connected);
  const live = useMemo(() => liveToolNames(tools), [tools]);

  // --- Preflight features (best effort, per-card degradation) -------------
  // `row-<index>` placeholder keys are not valid `find_jobs get` ids (plan 10).
  const jobArgs = useMemo(
    () =>
      orgUid !== null && jobKey !== '' && !isPlaceholderJobKey(jobKey)
        ? buildGetArgs(jobKey, orgUid)
        : null,
    [orgUid, jobKey],
  );
  const job = useFeature(FEATURES.jobGet, resolveTool(FEATURES.jobGet, live), orgUid, jobArgs, {
    toolsLoading,
  });

  const emptyArgs = useMemo(() => (orgUid !== null ? {} : null), [orgUid]);
  const invitations = useFeature(
    FEATURES.invitations,
    resolveTool(FEATURES.invitations, live),
    orgUid,
    emptyArgs,
    { toolsLoading },
  );
  const existing = useFeature(
    FEATURES.proposalsList,
    resolveTool(FEATURES.proposalsList, live),
    orgUid,
    emptyArgs,
    { toolsLoading },
  );
  const connects = useFeature(FEATURES.connects, resolveTool(FEATURES.connects, live), orgUid, emptyArgs, {
    toolsLoading,
  });
  const highlightsArgs = useMemo(
    () => (orgUid !== null && isTalent ? {} : null),
    [orgUid, isTalent],
  );
  const highlights = useFeature(
    FEATURES.profileHighlights,
    resolveTool(FEATURES.profileHighlights, live),
    orgUid,
    highlightsArgs,
    { toolsLoading },
  );

  // --- Job detail derivation ----------------------------------------------
  const detail = job.state.kind === 'ok' ? mapJobDetail(job.state.data, jobKey) : null;
  const jobData = job.state.kind === 'ok' ? job.state.data : null;
  const numericId = jobData !== null ? jobNumericIdOf(jobData) : null;
  const questions = useMemo(
    () => (jobData !== null ? screeningQuestionsOf(jobData) : []),
    [jobData],
  );
  const clientFeedback = jobData !== null ? clientFeedbackOf(jobData) : null;
  const connectsCost = detail?.connectsCost ?? null;
  const connectsBal =
    connects.state.kind === 'ok' ? connectsBalanceOf(connects.state.data) : null;
  const hl =
    highlights.state.kind === 'ok'
      ? highlightsOf(highlights.state.data)
      : { projects: [], certificates: [] };

  const identifiers = useMemo(() => {
    const ids = [numericId, detail?.jobKey ?? null, detail?.url ?? null, jobKey];
    return ids.filter((s): s is string => typeof s === 'string' && s.trim() !== '');
  }, [numericId, detail, jobKey]);

  // --- Branch: already applied / invited ----------------------------------
  // 'none' only once both checks have resolved (a pending invitations check
  // must not hide the invitation notice behind the form).
  const branch: null | { kind: 'applied' } | { kind: 'none' } | { kind: 'invited'; invitation: InvitationRow | null } =
    useMemo(() => {
      if (job.state.kind !== 'ok' || detail === null) return null;
      if (detail.applied) return { kind: 'applied' };
      const existingResolved = isResolved(existing.state);
      const invitationsResolved = isResolved(invitations.state);
      if (!existingResolved || !invitationsResolved) return null;
      if (
        existing.state.kind === 'ok' &&
        mapProposals(existing.state.data).some((r) => matchesJob(r.raw, identifiers))
      ) {
        return { kind: 'applied' };
      }
      if (invitations.state.kind === 'ok') {
        const rows = mapInvitations(invitations.state.data);
        const row = rows.find((r) => matchesJob(r.raw, identifiers)) ?? null;
        if (row !== null) return { kind: 'invited', invitation: row };
      }
      return { kind: 'none' };
    }, [job.state, detail, existing.state, invitations.state, identifiers]);

  // --- Draft values -------------------------------------------------------
  const [stage, setStage] = useState<Stage>('form');
  const [preview, setPreview] = useState<ProposalPreview | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedInfo | null>(null);
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>(null);
  const [cover, setCover] = useState('');
  const [bid, setBid] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [certIds, setCertIds] = useState<string[]>([]);
  const [boostInput, setBoostInput] = useState('');
  // Set when the inline accept/decline succeeds (D7.5/D7.6): the notice
  // then summarizes instead of re-offering a stale action.
  const [invitedHandled, setInvitedHandled] = useState(false);

  const bidNum = parseBid(bid);
  const screeningAnswers = questions
    .map((q) => ({ question: q, answer: (answers[q] ?? '').trim() }))
    .filter((a) => a.answer !== '');
  const canSubmit =
    cover.trim() !== '' &&
    bidNum !== null &&
    numericId !== null &&
    questions.every((q) => (answers[q] ?? '').trim() !== '');

  // --- Write actions (only through the confirm modals) -------------------
  const runCreate = async (): Promise<ConfirmOutcome> => {
    const tool = resolveTool(FEATURES.manageProposalsCreate, live);
    if (tool === null || orgUid === null) {
      throw new Error('The proposal tool is not available right now.');
    }
    if (numericId === null) {
      throw new Error('This job has no numeric id yet — reload the job and try again.');
    }
    const data = await callFeature(
      FEATURES.manageProposalsCreate,
      tool,
      orgUid,
      buildCreateArgs({
        jobNumericId: numericId,
        chargedAmount: bidNum ?? 0,
        coverLetter: cover,
        screeningAnswers,
        portfolioProjectIds: projectIds,
        certificateIds: certIds,
      }),
    );
    const p = parsePreview(data);
    if (!canConfirmPreview(p)) {
      throw new Error(
        needsDetailsOf(data) ??
          'Upwork did not return a confirmable preview. Check the values and try again.',
      );
    }
    setPreview(p);
    setStage('preview');
    return { status: 'proceed' };
  };

  const runSubmit = async (): Promise<ConfirmOutcome> => {
    const tool = resolveTool(FEATURES.confirmPreview, live);
    if (tool === null || orgUid === null || preview === null || !canConfirmPreview(preview)) {
      throw new Error('No confirmable preview — go back and create one.');
    }
    const boost = boostConnects();
    const data = await callFeature(
      FEATURES.confirmPreview,
      tool,
      orgUid,
      buildConfirmArgs(preview, boost),
    );
    const result = parseConfirmResult(data);
    if (
      result.finalizeUrl !== null ||
      (result.status !== null && result.status.toLowerCase() === 'action_required')
    ) {
      return {
        status: 'done',
        message: 'This step needs a final confirmation on upwork.com (binding action).',
        finalizeUrl: result.finalizeUrl ?? undefined,
      };
    }
    const info = await verifySubmission();
    setSubmitted(info);
    setStage('submitted');
    toastSuccess('Proposal submitted.');
    return { status: 'proceed' };
  };

  const verifySubmission = async (): Promise<SubmittedInfo> => {
    const listTool = resolveTool(FEATURES.proposalsList, live);
    const getTool = resolveTool(FEATURES.proposalsGet, live);
    if (listTool === null || getTool === null || orgUid === null) {
      return { verified: false, statusLabel: null, connectsBid: null };
    }
    try {
      const listData = await callFeature(FEATURES.proposalsList, listTool, orgUid, {
        status: 'Pending',
      });
      const rows = mapProposals(listData);
      const row = rows.find((r) => matchesJob(r.raw, identifiers)) ?? rows[0];
      let statusLabel: string | null =
        row !== undefined ? (row.statusLabel ?? row.status) : null;
      let connectsBid: string | null = null;
      if (row !== undefined && row.id !== null) {
        try {
          const detailData = await callFeature(FEATURES.proposalsGet, getTool, orgUid, {
            id: row.id,
          });
          const d = mapProposalDetail(detailData);
          if (d !== null) {
            statusLabel = d.statusLabel ?? statusLabel;
            connectsBid = d.connectsBid;
          }
        } catch {
          // Best effort: the list status alone is enough.
        }
      }
      return { verified: true, statusLabel, connectsBid };
    } catch {
      return { verified: false, statusLabel: null, connectsBid: null };
    }
  };

  const boostConnects = (): number | null => {
    const n = Number(boostInput);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  // --- Early returns ------------------------------------------------------
  if (connected === false) {
    return <NotConnectedCta title="Write proposal" state={status.state} />;
  }
  if (account === null) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-up-border bg-white px-6 py-10 text-center dark:border-white/15 dark:bg-white/5">
        <h1 className="text-lg font-semibold text-up-black dark:text-white">Write proposal</h1>
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

  const previewCost =
    (preview?.connectsRequired ?? null) ?? connectsCost ?? null;
  const previewBalance =
    (preview?.connectsBalance ?? null) ?? connectsBal ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link
          to={jobKey !== '' ? `/jobs/${encodeURIComponent(jobKey)}` : '/jobs'}
          className="text-xs font-semibold text-up-teal underline dark:text-up-lime"
        >
          ← Back to job
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-up-black dark:text-white">
          {detail !== null ? detail.title : 'Write proposal'}
        </h1>
        {detail !== null && (
          <p className="mt-1 text-sm text-up-black/60 dark:text-white/60">
            {[detail.client, detail.clientMeta].filter(Boolean).join(' · ')}
            {detail.budget !== null && ` · ${detail.budget}`}
          </p>
        )}
      </header>

      {detail === null ? (
        <PendingJobCard state={job.state} onRetry={job.reload} toolsLoading={toolsLoading} />
      ) : stage === 'submitted' && submitted !== null ? (
        <SubmittedView info={submitted} />
      ) : stage === 'preview' && preview !== null ? (
        <PreviewView
          preview={preview}
          detail={{ title: detail.title, budget: detail.budget }}
          bid={bid}
          boostInput={boostInput}
          onBoostChange={setBoostInput}
          onEdit={() => setStage('form')}
          onAskSubmit={() => setConfirmStep('submit')}
          submitDisabled={!canConfirmPreview(preview)}
        />
      ) : branch === null ? (
        <div className="rounded-lg border border-up-border bg-white px-6 py-6 text-sm text-up-black/60 dark:border-white/15 dark:bg-white/5 dark:text-white/60">
          Checking this job…
        </div>
      ) : branch.kind === 'applied' ? (
        <NoticeCard
          title="You already applied to this job"
          body="Upwork won't accept a duplicate application for the same job. Review your existing proposal instead."
          link={{ to: '/proposals', label: 'View proposals' }}
        />
      ) : branch.kind === 'invited' ? (
        <InvitedCard
          invitation={branch.invitation}
          orgUid={orgUid}
          live={live}
          handled={invitedHandled}
          onDone={() => {
            setInvitedHandled(true);
            void invitations.reload();
          }}
        />
      ) : (
        <form
          className="rounded-lg border border-up-border bg-white px-6 py-6 dark:border-white/15 dark:bg-white/5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) setConfirmStep('create');
          }}
        >
          {clientFeedback !== null && (
            <p className="mb-4 rounded-md bg-up-surface-2 px-3 py-2 text-sm text-up-black/70 dark:bg-white/10 dark:text-white/70">
              <span className="font-semibold text-up-black dark:text-white">Client feedback: </span>
              {clientFeedback}
            </p>
          )}
          {preview !== null && (
            <p className="mb-4 rounded-md border border-up-yellow/50 bg-up-yellow/10 px-3 py-2 text-sm text-up-black/80 dark:text-white/80">
              Creating a new preview supersedes the current one.
            </p>
          )}

          <Field label="Cover letter">
            <textarea
              value={cover}
              onChange={(e) => setCover(e.target.value)}
              rows={6}
              placeholder="Why you, specifically, are the right person for this job…"
              className="w-full rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-surface-2 dark:text-white"
            />
          </Field>

          {questions.length > 0 && (
            <fieldset className="mt-5">
              <legend className="mb-1 block text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
                Screening questions (required)
              </legend>
              <div className="space-y-3">
                {questions.map((q) => (
                  <div key={q}>
                    <p className="mb-1 text-sm font-medium text-up-black/80 dark:text-white/80">{q}</p>
                    <textarea
                      aria-label={q}
                      value={answers[q] ?? ''}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
                      rows={2}
                      className="w-full rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-surface-2 dark:text-white"
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <Field label="Your bid (fixed amount — this is exactly what will be charged)">
            <div className="flex items-center gap-2">
              <span className="text-sm text-up-black/50 dark:text-white/50">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={bid}
                onChange={(e) => setBid(e.target.value)}
                className="w-40 rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-surface-2 dark:text-white"
              />
            </div>
            {bidNum === null && bid.trim() !== '' && (
              <p className="mt-1 text-xs text-up-red">Enter a positive amount.</p>
            )}
          </Field>

          {hl.projects.length > 0 && (
            <Field label="Attach portfolio projects">
              <div className="space-y-1">
                {hl.projects.map((p) => (
                  <HighlightCheck
                    key={p.id}
                    id={p.id}
                    title={p.title}
                    checked={projectIds.includes(p.id)}
                    onToggle={(id) =>
                      setProjectIds((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }
                  />
                ))}
              </div>
            </Field>
          )}
          {hl.certificates.length > 0 && (
            <Field label="Attach certificates">
              <div className="space-y-1">
                {hl.certificates.map((c) => (
                  <HighlightCheck
                    key={c.id}
                    id={c.id}
                    title={c.title}
                    checked={certIds.includes(c.id)}
                    onToggle={(id) =>
                      setCertIds((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }
                  />
                ))}
              </div>
            </Field>
          )}

          {numericId === null && (
            <p className="text-sm text-up-red">
              This job has no numeric id yet — Upwork requires it to create an application. Reload
              and try again.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-up-black/60 dark:text-white/60">
              {connectsCost !== null
                ? `Applying costs ${connectsCost} Connects${connectsBal !== null ? ` · balance ${connectsBal}` : ''}.`
                : 'Connects cost: shown when the preview is ready.'}
            </p>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-up-green px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue — create preview
            </button>
          </div>
        </form>
      )}

      {/* Write-action modals (D7.4): no auto-confirm anywhere. */}
      <ConfirmModal
        open={confirmStep === 'create'}
        title="Create application preview"
        confirmLabel="Create preview"
        onClose={() => setConfirmStep(null)}
        onConfirm={runCreate}
        summary={
          <>
            <p>
              This saves your application for <strong>{detail?.title ?? 'this job'}</strong> as a
              preview on Upwork (cover letter, screening answers, bid{' '}
              <strong>{bidNum !== null ? `$${bidNum.toLocaleString('en-US')}` : ''}</strong>).
            </p>
            <p className="mt-2">
              Nothing is submitted and no Connects are charged yet — the Connects charge happens
              only when you confirm the submission in the next step.
            </p>
          </>
        }
      />
      <ConfirmModal
        open={confirmStep === 'submit'}
        title="Submit proposal"
        confirmLabel="Submit proposal"
        onClose={() => setConfirmStep(null)}
        onConfirm={runSubmit}
        summary={
          <>
            <p>
              This submits your proposal for <strong>{detail?.title ?? 'this job'}</strong> at{' '}
              <strong>{bidNum !== null ? `$${bidNum.toLocaleString('en-US')}` : ''}</strong>.
              Upwork will charge{' '}
              <strong>
                {previewCost !== null ? `${previewCost} Connects` : 'Connects (amount shown by Upwork)'}
              </strong>
              {previewBalance !== null && ` (balance ${previewBalance})`}.
            </p>
            <p className="mt-2 text-up-red">
              Once submitted, the bid cannot be edited or withdrawn through this app.
            </p>
          </>
        }
      />
    </div>
  );
}

function isResolved(state: FeatureState): boolean {
  return state.kind === 'ok' || state.kind === 'error' || state.kind === 'unavailable';
}

function parseBid(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-5 block first:mt-0">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
        {label}
      </span>
      {children}
    </label>
  );
}

function HighlightCheck({
  id,
  title,
  checked,
  onToggle,
}: {
  id: string;
  title: string;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-up-black/80 dark:text-white/80">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(id)}
        className="h-4 w-4 accent-[var(--color-up-green)]"
      />
      {title}
    </label>
  );
}

/**
 * Invitation branch (plan 07b, D7.5): the shared `InvitationActions`
 * panel inline — accept (binding, finalize on upwork.com) / decline without
 * leaving the job. After a successful action the card summarizes instead of
 * re-offering a stale action.
 */
function InvitedCard({
  invitation,
  orgUid,
  live,
  handled,
  onDone,
}: {
  invitation: InvitationRow | null;
  orgUid: string | null;
  live: Set<string>;
  handled: boolean;
  onDone: () => void;
}) {
  return (
    <div className="rounded-lg border border-up-teal/30 bg-up-surface-2 px-6 py-6 dark:border-up-lime/20 dark:bg-white/5">
      <h2 className="text-lg font-semibold text-up-black dark:text-white">
        This job reached you as an invitation
      </h2>
      <p className="mt-2 text-sm text-up-black/70 dark:text-white/70">
        Invited jobs are accepted or declined, not applied to.
        {invitation !== null && invitation.terms !== null && (
          <> Terms offered: <span className="font-semibold">{invitation.terms}</span>.</>
        )}
      </p>
      {handled ? (
        <p className="mt-4 text-sm font-medium text-up-green-hc dark:text-up-lime">
          Invitation handled — it will disappear from your list on the next refresh.
        </p>
      ) : (
        <div className="mt-4">
          <InvitationActions
            invitation={
              invitation !== null
                ? { id: invitation.id, jobNumericId: invitation.jobNumericId, jobTitle: invitation.jobTitle }
                : { id: null, jobNumericId: null, jobTitle: null }
            }
            orgUid={orgUid}
            live={live}
            onDone={onDone}
          />
        </div>
      )}
      <Link
        to="/invitations"
        className="mt-4 inline-block text-xs font-semibold text-up-teal underline dark:text-up-lime"
      >
        View all invitations
      </Link>
    </div>
  );
}

function NoticeCard({
  title,
  body,
  link,
}: {
  title: string;
  body: string;
  link: { to: string; label: string };
}) {
  return (
    <div className="rounded-lg border border-up-teal/30 bg-up-surface-2 px-6 py-6 dark:border-up-lime/20 dark:bg-white/5">
      <h2 className="text-lg font-semibold text-up-black dark:text-white">{title}</h2>
      <p className="mt-2 text-sm text-up-black/70 dark:text-white/70">{body}</p>
      <Link
        to={link.to}
        className="mt-4 inline-block rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
      >
        {link.label}
      </Link>
    </div>
  );
}

function PendingJobCard({
  state,
  onRetry,
  toolsLoading,
}: {
  state: FeatureState;
  onRetry: () => void;
  toolsLoading: boolean;
}) {
  if (state.kind === 'unavailable') {
    return (
      <div className="rounded-lg border border-up-border bg-white px-6 py-6 text-sm text-up-black/70 dark:border-white/15 dark:bg-white/5 dark:text-white/70">
        The job tool isn't available in the current server, so the draft can't be loaded. Retry,
        or check the <Link to="/tools" className="font-semibold text-up-teal underline dark:text-up-lime">tools console</Link>.
        <div className="mt-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-up-border bg-white px-3 py-1.5 text-xs font-semibold text-up-teal dark:border-white/15 dark:bg-white/5 dark:text-up-lime"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="rounded-lg border border-up-red/40 bg-white px-6 py-6 text-sm dark:border-up-red/40 dark:bg-white/5">
        <p role="alert" className="font-medium text-up-red">
          {state.message}
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-up-border bg-white px-3 py-1.5 text-xs font-semibold text-up-teal dark:border-white/15 dark:bg-white/5 dark:text-up-lime"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  return (
    <p role="status" className="rounded-lg border border-up-border bg-white px-6 py-6 text-sm text-up-black/60 dark:border-white/15 dark:bg-white/5 dark:text-white/60">
      {toolsLoading ? 'Loading tools…' : 'Loading this job…'}
    </p>
  );
}

function SubmittedView({ info }: { info: SubmittedInfo }) {
  return (
    <div className="rounded-lg border border-up-green/40 bg-white px-6 py-6 dark:border-up-green/40 dark:bg-white/5">
      <h2 className="text-lg font-semibold text-up-green-hc dark:text-up-lime">
        Proposal submitted
      </h2>
      <p className="mt-2 text-sm text-up-black/80 dark:text-white/80">
        Status: <span className="font-semibold">{info.statusLabel ?? 'Pending'}</span>
        {info.connectsBid !== null && (
          <span className="font-semibold">
            {' · Stored bid: '}{info.connectsBid} Connects
          </span>
        )}
      </p>
      {!info.verified && (
        <p className="mt-2 text-xs text-up-black/60 dark:text-white/60">
          Verification wasn't available — check the list to confirm.
        </p>
      )}
      <p className="mt-3 text-xs text-up-black/60 dark:text-white/60">
        The bid cannot be edited or withdrawn once submitted.
      </p>
      <Link
        to="/proposals"
        className="mt-4 inline-block rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
      >
        View proposals
      </Link>
    </div>
  );
}

function PreviewView({
  preview,
  detail,
  bid,
  boostInput,
  onBoostChange,
  onEdit,
  onAskSubmit,
  submitDisabled,
}: {
  preview: ProposalPreview;
  detail: { title: string; budget: string | null };
  bid: string;
  boostInput: string;
  onBoostChange: (v: string) => void;
  onEdit: () => void;
  onAskSubmit: () => void;
  submitDisabled: boolean;
}) {
  const boost = preview.boost;
  return (
    <div className="rounded-lg border border-up-border bg-white px-6 py-6 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-lg font-semibold text-up-black dark:text-white">Review before you submit</h2>
      <p className="mt-1 text-sm text-up-black/60 dark:text-white/60">
        {detail.title}
        {detail.budget !== null && ` · ${detail.budget}`}
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetaItem
          label="Cost"
          value={preview.connectsRequired !== null ? `${preview.connectsRequired} Connects` : 'Shown by Upwork'}
        />
        <MetaItem
          label="Connects balance"
          value={preview.connectsBalance !== null ? String(preview.connectsBalance) : '—'}
        />
        <MetaItem
          label="Bid"
          value={Number(bid) > 0 ? `$${Number(bid).toLocaleString('en-US')}` : '—'}
        />
      </dl>

      {preview.eligible === false && (
        <p role="alert" className="mt-4 rounded-md border border-up-red/40 bg-up-red/5 px-3 py-2 text-sm text-up-red">
          You are not eligible to apply: {preview.eligibilityNote ?? 'see the raw preview below'}
        </p>
      )}

      {preview.unmetQualifications.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
            Unmet qualifications (for reference)
          </h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-up-black/80 dark:text-white/80">
            {preview.unmetQualifications.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      {preview.requiredScreening.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
            Required screening (per preview)
          </h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-up-black/80 dark:text-white/80">
            {preview.requiredScreening.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      {preview.competingBids !== null && (
        <p className="mt-4 text-sm text-up-black/70 dark:text-white/70">
          Competing bids (provided by Upwork): {preview.competingBids}
        </p>
      )}

      {boost !== null && boost.available && (
        <section className="mt-4 rounded-md border border-up-border bg-up-surface-2 px-4 py-3 dark:border-white/15 dark:bg-white/10">
          {boost.recommendation === 'skip' ? (
            <p className="text-sm text-up-black/80 dark:text-white/80">
              Upwork suggests not boosting this proposal
              {boost.reason !== null && <span className="text-up-black/60 dark:text-white/60">: {boost.reason}</span>}.
            </p>
          ) : (
            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
                Boost (optional)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={boost.limit ?? undefined}
                  value={boostInput}
                  onChange={(e) => onBoostChange(e.target.value)}
                  placeholder="0"
                  className="w-28 rounded-md border border-up-border bg-white px-3 py-1.5 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-black dark:text-white"
                />
                <span className="text-xs text-up-black/60 dark:text-white/60">
                  additional Connects
                  {boost.limit !== null && ` (max ${boost.limit})`}
                </span>
              </div>
              {boost.suggestedBid !== null && (
                <p className="mt-2 text-xs text-up-black/60 dark:text-white/60">
                  Upwork suggests {boost.suggestedBid} additional Connects
                  {boost.recommendation !== null && ` — ${boost.recommendation}`}.
                </p>
              )}
              <p className="mt-2 text-xs text-up-black/60 dark:text-white/60">
                Boost is optional — only the amount you enter here is applied on confirm.
              </p>
            </label>
          )}
        </section>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-semibold text-up-teal dark:text-up-lime">
          Raw preview JSON
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-up-surface p-3 text-xs text-up-black dark:bg-up-surface-2 dark:text-white">
          {JSON.stringify(preview.raw, null, 2)}
        </pre>
      </details>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-up-border bg-white px-4 py-2 text-sm font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-transparent dark:text-up-lime dark:hover:bg-white/10"
        >
          Edit draft
        </button>
        <button
          type="button"
          onClick={onAskSubmit}
          disabled={submitDisabled}
          className="rounded-md bg-up-green px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          Submit proposal
        </button>
      </div>
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

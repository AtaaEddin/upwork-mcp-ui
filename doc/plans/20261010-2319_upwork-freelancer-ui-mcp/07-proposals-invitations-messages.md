# 07 — Proposals, invitations/offers, messages, contracts, earnings, profile

status: in-progress
parent: `main.md` (depends on 04 tool discovery log)

## Scope (one section per session slice if needed — split into 07a/07b if it grows)
- Proposals: list (status filter), detail, **draft → review → confirm-submit** two-step UI
  (MCP draft-confirm; Connects cost shown before confirm; binding notice where applicable)
- Invitations & offers: inbox list, detail, accept / decline / ask-changes actions
  (binding acceptance → notice + link to finish on upwork.com)
- Messages: inbox (threads, unread badges), thread view, composer (send), attachments
  upload/download (streaming proxy, size caps)
- Contracts: active/past list, detail, milestone work view, work diary
- Earnings: balance + earnings summary; Profile: availability, employment, languages,
  education, portfolio (read + updates the MCP supports)
- Every write action: confirm modal showing exactly what will happen + Connects/cost where
  known; results toast with error surface

## Session slices (added 2026-10-11)

The scope is 5+ sections with a new server surface (attachment proxy); per the plan's own
rule it is split into session-sized slices. Each slice lands independently green
(build 0 warnings, tests, lint, browser-verified).

| Slice | Content | Status |
|-------|---------|--------|
| 07a | Proposals: list (status filter) + detail; proposal draft → review → confirm-submit (standard, non-invited application); shared write-action infra (confirm modal + toasts) | done |
| 07b | Invitations & offers: inboxes, detail, accept / decline / ask-changes (invite + offer), `finalize_url` binding notices; invitation branch of the draft flow wired to the shared accept/decline | planned |
| 07c | Messages: rooms + unread, thread view, composer, attachment upload/download (server streaming proxy + size caps) | planned |
| 07d | Contracts (active/past, detail, milestones, work-diary best effort) + earnings + profile (read + MCP-supported updates) | planned |

## Decisions

### D7.1 — Tool names/actions from the official `upwork/upwork-agent-plugin` skills (v0.3.0)
The live `tools/list` is still pending the owner's first real connection (main plan
discovery log), so names follow the official plugin skill docs — the same source plan
06's registry uses, now extended with the proposal/confirm tools:

- `list_freelancer_proposals` — actions `list`, `invitations`, `get`, `get_room`
- `manage_proposals` — action `create` (returns a **preview**: `preview_id` + `type`;
  nothing submitted yet), `acknowledge_policy`, plus invitation actions
  `accept_invitation` / `decline_invitation` (07b)
- `confirm_preview` — action `confirm` with the **returned** `type` + `preview_id`
  (`confirm_draft`/`get_draft` are deprecated aliases of `confirm_preview`/`get_preview`)
- `get_profile` — actions `get`, `connects_balance`, `list_highlights`
  (portfolio projects + certificates → `portfolio_project_ids` / `certificate_ids`)
- `respond_to_offer` — decline & request-changes are previews; **accept is binding** and
  returns a `finalize_url` (07b)
- `find_jobs` action `get` → **numeric job id** (required by `manage_proposals` create),
  `connects_cost`, `client_feedback`; a job with `applied: true` is already applied
- Both list actions apply a **default status filter** — set `status` explicitly for a
  specific state; `Accepted` means "submitted & validated", not client-accepted →
  prefer `status_label`
- A freelancer cannot open a proposal room / send the first proposal message
- `needs_details` responses name missing fields → surface + retry is the recovery path
- Money/binding steps return `status: action_required` + `finalize_url` — never completed
  by this server

Sources:
- https://github.com/upwork/upwork-agent-plugin (skills `write-proposal`, `upwork-workflows`,
  `hire-on-upwork`, v0.3.0 — cloned 2026-10-11; `skills/*/SKILL.md`)
- https://www.skills.sh/upwork/upwork-agent-plugin/write-proposal
- https://www.claudepluginhub.com/skills/upwork-upwork-agent-plugin/upwork-workflows
- Plan 06 registry convention (documented best-known names, confirmed live at runtime,
  per-card degradation) is unchanged.

### D7.2 — Parameter names are documented best-known; `needs_details` is the recovery loop
`manage_proposals` create params: `job_id` (numeric), `charged_amount` (number),
`cover_letter`, `screening_answers` (array of `{question, answer}`),
`portfolio_project_ids`, `certificate_ids` — the skill doc names `charged_amount`,
`certificate_ids`, `portfolio_project_ids`; the rest follow the server's
`needs_details` feedback loop ("names the missing fields and inlines the field
reference"). The create result is parsed defensively (`parsePreview`); if no
confirmable `preview_id` comes back, the UI shows the server's `needs_details`
text verbatim instead of guessing.

### D7.3 — Draft-confirm guard is client-side (no server surface exists for it)
The generic tool API is tool-agnostic, so the "submit requires draft id" guard lives
where the draft lives: `canConfirmPreview()` (pure, `lib/proposals.ts`) requires the
`preview_id` + `type` returned by the latest `create`; the submit control is not
rendered until then, and a superseded/failed preview invalidates it until re-create.
Covered by unit tests (100% of the pure logic) + page-level tests asserting the
confirm call is never made without a preceding successful create.

### D7.4 — Shared write-action infra: `ConfirmModal` + toast host
Every write action (07a–07d) goes through `components/ConfirmModal.tsx`: it shows
exactly what will happen + Connects/cost where known, runs the action on explicit
confirm, and renders the outcome (success, `finalize_url` "finish on upwork.com"
link, or error). No auto-confirm anywhere. `ToastHost` (mounted in `Layout`)
renders result toasts (`lib/toast.ts` pub/sub). Reused unchanged by 07b–07d.

### D7.5 — 07a scope: standard (non-invited) application
The draft flow is the standard application path. Pre-draft checks per the skill:
existing invitation → invitation notice + link (accept/decline land in 07b, where the
shared panel moves); existing proposal / `applied` job → "already applied" notice
(Upwork rejects duplicate applications upstream). Attachments are 07c (the draft
form links the console until then); `FL_AGENCY` accounts skip `get_profile`
read-only evidence (agency profile tools are a 07d read concern) — the flow
itself works for any account that has the tools.

## Acceptance
- HTTP/service tests incl. draft-confirm guard (submit requires draft id), attachment caps,
  401 → re-auth banner trigger
- Browser-verified mobile+desktop, light+dark, per section
- DoD: build 0 warnings, tests green, lint clean

## Verification (per slice)

### 07a (done 2026-10-11)
- **Tests** (same change, through the HTTP surface):
  - `lib/proposals.test.ts` — mappers/args/preview-parse/`canConfirmPreview` (100% of the pure logic),
  - `components/ConfirmModal.test.tsx` — confirm→run→proceed/done(finalize link)/error(+retry), ESC only from confirm,
  - `components/Toast.test.tsx` — host render/stacking/TTL/manual close,
  - `pages/ProposalsPage.test.tsx` — list (default call has **no** `status` arg; `status_label` preferred),
    filter change re-calls with explicit `status: 'Pending'`, row → `get(id)` detail, empty state,
    missing-tool degradation,
  - `pages/ProposalDraftPage.test.tsx` — preflight call args (find_jobs get / invitations / list /
    connects_balance / list_highlights), form gating, create args (`job_id` numeric,
    `charged_amount`, `cover_letter`, `screening_answers[]`), **confirm never called without a
    successful create** (`canConfirmPreview`), confirm args (`type`+`preview_id` from the create
    result, `boost_connects` from the review input), verification calls (list `status: 'Pending'`
    + `get(id)`), error paths verbatim (`needs_details` text, tool 401 text), applied/invited
    preflight branches.
- **DoD**: typecheck clean; 93/93 server + 148/148 web tests; lint clean; build 0 warnings.
- **Browser-verified** (`web/scripts/browser-verify-proposals.mjs`, system Chromium, built SPA on
  a fake connected `/api` backend): 15 shots desktop+mobile × light+dark — proposals list +
  status-filter re-query + row detail; draft flow end-to-end (form → create-preview modal A →
  review + boost → confirm modal B → "Proposal submitted" + toast + stored bid); list shows the
  verified proposal afterwards; applied + invited preflight notices; dark-class + horizontal
  overflow checks; no uncaught page errors. Screenshots in `$SHOT_DIR` (owner visual review).
- Real-data check against a live Upwork account stays an owner action (same as plan 06, D6.4).

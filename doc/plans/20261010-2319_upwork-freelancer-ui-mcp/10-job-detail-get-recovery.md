# 10 — Job detail `get` failure: "id is required" (diagnosis + recovery fix)

status: done

## Problem

Owner report: opening a job shows the Upwork tool error

```
id is required (trace_id: 9db0f5ec6f565232368425a55c74b05b)
```

Job details (`find_jobs` action `get`) therefore never load.

## Diagnosis (2026-10-12)

Verified chain (all files re-read):

1. `JobDetailPage` / `ProposalDraftPage` → `buildGetArgs(jobKey, orgUid)` →
   `POST /api/tools/upwork__find_jobs/call` with `{ args: { id: jobKey, action: 'get', org_uid } }`.
2. Server (`server/src/tools/service.ts`) validates args against the **live** `inputSchema`
   (SDK-bundled ajv via `fromJsonSchema`) and forwards `arguments` unchanged
   (`client.callTool({ name, arguments })` — SDK v2.3.1 `CallToolRequestParamsSchema`).
   A local schema mismatch would be **HTTP 400** with "args do not match the tool's inputSchema".
3. The reported error carries an Upwork `trace_id` ⇒ it is a **tool-level `isError` result**
   (HTTP 200) produced by the Upwork MCP server — i.e. the call **passed** local validation and
   reached Upwork; Upwork's response is its `needs_details`-style feedback naming the missing
   field (`id`).

So Upwork received a `get` call whose `id` it did not accept. The app's key sources
(`mapJobRow`): ciphertext (`~02…` scan + `job_key`/`posting_key`/`key`/`ciphertext`) >
numeric `id` (`id`/`job_id`/`id_numeric`/`numeric_id`) > URL (`url`/`job_url`/`link`) >
**`row-N` placeholder** — the placeholder is emitted for any live search row that carries no
recognizable job reference, and is sent to Upwork as `id: "row-N"`, which Upwork cannot
resolve and treats as a missing id. That is the only path where this app systematically sends
an unresolvable `id` (placeholder convention: `mapJobRow`, `web/src/lib/jobs.ts`).

Forensics (dev DB `server/data/app.db`, read-only):

- `upwork__find_jobs` call log: 29 calls today, all HTTP 200 (tool-level errors are 200, so
  the reported failure is among them and is not distinguishable from hashes alone — args are
  stored as sha256 only, by design).
- Hash reconstruction proved the dashboard's `smart_search` arg shape
  (`{action:'smart_search', mode:'best_match', org_uid}` — 6 repeated hashes = 6 dashboard
  loads) and that a plain `search` was run twice; ~21 distinct-arg `find_jobs` calls
  (job detail opens / manual console calls) sit between them.
- No `row-N` candidate hash matched, so the exact sent value can't be proven from the log —
  live reproduction is impossible headless (owner session only; OAuth tokens are encrypted
  with the running dev process's ephemeral secret; re-auth would be forced by any restart
  with a different secret).

Contract (unchanged, re-confirmed): `find_jobs` action `get` `id` accepts **a numeric job id,
a `~02…` ciphertext, or a full Upwork job URL** — official `upwork/upwork-agent-plugin`
skills `write-proposal` ("a link the user pasted can be passed through unchanged") and
`upwork-workflows` ("Search results hand you the ciphertext").

Sources:

- https://github.com/upwork/upwork-agent-plugin (skills `write-proposal`, `upwork-workflows`,
  cloned 2026-10-11 → `/tmp/upwork-plugin`)
- This repo: `web/src/lib/jobs.ts`, `web/src/pages/JobDetailPage.tsx`,
  `web/src/pages/ProposalDraftPage.tsx`, `server/src/tools/{service,routes,store}.ts`,
  `web/src/hooks/useFeature.ts`, plan 06/07 (D6.1, D7.2)

## Fix (defensive + self-diagnosing, testable without live Upwork)

Per D7.2 (`needs_details` naming the missing field is the recovery loop) and the skill
contract (`id` ← URL/numeric/ciphertext), make the failure mode recoverable from the UI:

1. **`web/src/lib/jobs.ts`**
   - `buildGetArgs`: trim the key; return `null` for empty/whitespace keys (callers then make
     no upstream call instead of sending `id: ""`).
   - Export `isPlaceholderJobKey(key)` — the `row-N` convention `mapJobRow` already emits for
     rows that carry no recognizable job reference; document the convention.
2. **`web/src/pages/JobDetailPage.tsx`**
   - Placeholder route key (`row-N`): **no** `get` call at all; show a recovery card
     ("open this job") immediately.
   - `get` failure: keep the server text verbatim (D7.2) **and** offer an inline recovery
     input — paste the job URL / numeric id / `~02…` ciphertext → re-runs `get` with the
     pasted value as `id` (all three forms are valid per contract).
   - Apply panel links to `/jobs/:key/propose` with the **effective** key (reference from
     the payload, else the pasted key), never a placeholder.
3. **`web/src/pages/ProposalDraftPage.tsx`**
   - Preflight `get` skips placeholder keys (no wasted upstream call with an unresolvable id).
4. **Tests (same change, per project rules):**
   - `lib/jobs.test.ts`: `buildGetArgs` trim/empty→null; `isPlaceholderJobKey`;
     `mapJobResult` referenceless row → `row-N` placeholder key.
   - `JobDetailPage.test.tsx`: placeholder key → zero `get` calls + recovery card; paste
     value → one call with `id` = pasted value → detail renders. Tool error (`isError` with
     "id is required (trace_id: …)") → verbatim message + recovery input; paste → second
     call succeeds → detail renders.
   - `ProposalDraftPage.test.tsx`: placeholder key → preflight makes no `find_jobs` call.

Out of scope (recorded, not done here): live verification on the owner's real connection
(owner browser required); tool-console UX changes (the console already shows each tool's
`inputSchema` + an args editor).

## Verification (done)

- Unit: `web/src/lib/jobs.test.ts` — `buildGetArgs` trim/null contract, `isPlaceholderJobKey`
  table, `mapJobResult` referenceless row keeps a `row-N` placeholder key.
- Page: `web/src/pages/JobDetailPage.test.tsx` — `/jobs/row-3` renders the recovery card with
  **zero** `find_jobs` calls; a pasted URL then produces exactly one `{action:'get', org_uid,
  id:<url>}` call and the detail renders. A `get` answering `isError` +
  `"id is required (trace_id: …)"` surfaces the text verbatim (role=alert) plus the recovery
  card; a pasted numeric id re-calls `get` and the detail renders.
  `web/src/pages/ProposalDraftPage.test.tsx` — `/jobs/row-9/propose` fires the other preflight
  tools but **no** `find_jobs` call.
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` — clean.
- Browser (fake "connected" backend, real Chromium; new
  `web/scripts/browser-verify-job-detail.mjs`, same pattern as the plan 06 script):
  14 screenshots + 1 assertion, desktop light/dark + mobile light, all states verified
  (shots in `$SHOT_DIR`): happy-path detail, placeholder card + paste-to-load, verbatim tool
  error + paste-to-recover, jobs page linking the referenceless row under `row-2`.
  Note: recovery-card headings are CSS-uppercased, so the script's text checks are
  case-insensitive.
- Live confirmation against the real account remains an owner action (needs a browser
  session; not runnable headless).

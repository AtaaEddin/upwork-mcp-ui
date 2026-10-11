# 06 — Freelancer dashboard + job search/detail

status: in-progress
parent: `main.md` (depends on 04 tool discovery log)

## Scope
- Dashboard: one screen with cards — invitations count, offers, unread messages, matched
  jobs, Connects balance (bound to discovered tool names; graceful degradation when a tool
  is missing or errors)
- Jobs: search form (keywords, category, budget range, type), results list in Upwork list
  style (title, budget/hourly, skills chips, client meta, posted time), pagination;
  detail view (description, requirements, client history, apply panel)
- Apply panel: proposal CTA → hands off to proposal flow (plan 07); favorites toggle
  (if the MCP exposes it — else record gap in main.md)
- Skeleton loading, empty states, error retry; pull-to-refresh on mobile

## Decisions (recorded 2026-10-11, web-searched)

### D6.1 — Tool names: bind to documented names, verify against the discovery log
The official server lists tools only after sign-in ("needs sign-in before it
lists them" — https://martechdb.com/vendors/upwork), so exact names/schemas are
confirmed from the live `tools/list` in the main-plan discovery log. Public
evidence used to seed the registry (both pending live confirmation):
- **Glama live MCP inspection of `com.upwork.mcp/upwork-mcp-server` (2026-09-02):**
  33 tools, all `upwork__<snake_case>`, "actions nested inside tools":
  `upwork__find_jobs`, `upwork__list_accounts`, `upwork__get_messages`,
  `upwork__send_message`, `upwork__list_offers` (actions `list`/`list_mine`),
  `upwork__list_contracts`, `upwork__confirm_preview` (absent on 09-02; the
  deprecated aliases `upwork__confirm_draft`/`upwork__get_draft` were present),
  plus client-side tools (`upwork__post_job`, `upwork__get_job_posting`,
  `upwork__get_client_dashboard`, …).
  Source: https://glama.ai/mcp/connectors/com.upwork.mcp/upwork-mcp-server
- **Official plugin `upwork/upwork-agent-plugin` (master, skills v0.3.0)**
  documents current names/actions: `list_accounts` → retain `org_uid` on every
  later call (role `TALENT` = freelancer); `find_jobs` actions `search` /
  `smart_search` (mode `best_match`/`most_recent`) / `get` (id accepts numeric,
  `~02…` ciphertext, or full URL); `manage_proposals` `create` (needs numeric
  id) / `accept_invitation` / `decline_invitation`; `list_freelancer_proposals`
  (`invitations`, `get_room`); `get_profile` (`get`, `list_highlights`,
  `connects_balance`); `respond_to_offer` (decline/changes = previews, accept
  binding → `finalize_url`); writes → `confirm_preview` (`action: confirm`,
  `type`, `preview_id`); result feedback fields: `empty_reason`,
  `filters_ignored`, `needs_details`, `retry_after_seconds`, `suggested_next_step`.
  Source: https://github.com/upwork/upwork-agent-plugin (skills/upwork-workflows, write-proposal)
- **Freelancer scope cross-check:** https://www.upwork.com/ai/mcp and
  https://support.upwork.com/hc/en-us/articles/55446516654611 (search,
  proposals, invitations, offers, messages, contracts, earnings, profile).

Consequences for 06:
- **Registry pattern** (single file `web/src/lib/registry.ts`): feature →
  candidate tool name(s) + action + arg builder. After the first real
  connection fills the main-plan discovery log, mismatches are corrected in
  that one file (the console already lets the owner see the live list).
- **Exact `find_jobs` param names are pending** `get_tool_help`; the UI
  surfaces the server's own feedback (`filters_ignored`, `needs_details`,
  `empty_reason`) so any mismatch is visible and self-explaining to the owner.
- **Graceful degradation is the contract:** a page composes independent cards;
  missing tool (404/absent from `tools/list`) → per-card "unavailable" state
  with a link to the tools console; `isError`/upstream failure → per-card
  error state with retry; one card never blocks the page.

### D6.2 — Server-side scope: selected-account API (new)
`org_uid` must be passed on every tool call after `list_accounts` (plugin
skill: "pass `org_uid` on every subsequent tool call"). New:
- `GET /api/upwork/account` — the stored selection; if none is stored yet and
  the connection is live, bootstraps **once** via `upwork__list_accounts`
  (prefers first non-suspended `TALENT`, then `FL_AGENCY`, then any
  non-suspended). `?refresh=1` forces a fresh `list_accounts`.
- `PUT /api/upwork/account` `{orgUid}` — re-lists and validates membership
  (400 if unknown), stores the selection (multi-account owners can switch).
- Cleared on disconnect. Stored in migration `004_upwork_account` (id = 1 row,
  like the connection row).
- All upstream calls go through the existing serialized `withClient` queue
  (no parallel fan-out); list results are parsed defensively
  (`org_uid`/`name`/`role`/`role_label`/`suspended`).

### D6.3 — Client-side scope: feature registry over the generic tool API
- New client context `AccountProvider` (fetches `/api/upwork/account` once the
  connection is `connected`; exposes `{account, orgUid, accounts, select, refresh}`).
- Feature calls = `POST /api/tools/<tool>/call` with registry-built args +
  `org_uid`; result = `structuredContent` if present else JSON parse of the
  text part; defensive mappers for jobs/proposals/offers/rooms/connects.
- **Apply handoff (06 → 07):** the detail-page apply panel shows the Connects
  cost (from `find_jobs` `get`; search rows don't carry `connects_cost`) and a
  CTA that routes to `/jobs/:id/propose` — a placeholder page that renders in
  06 (job context + "draft → review → confirm-submit ships in plan 07" +
  tools-console link, so the owner can still apply manually today). The actual
  two-step draft-confirm UI is plan 07 scope.
- **Favorites:** no saved-jobs tool in any public list — gap recorded in
  main.md; the toggle is wired only once the discovery log confirms a tool.
- Pagination: pass-through — whatever pagination value the result returns is
  echoed into the next call (server-controlled names).

### D6.4 — Verification
- The owner's first **real** Upwork connection is not available in this
  environment → real-data browser verification is pending (recorded here;
  closes with the discovery log from the tools console). Headless-Chromium
  verification instead runs against the fake Upwork (extended with
  `list_accounts`, `find_jobs`, `get_profile`, …), mobile+desktop,
  light+dark, per plans 04/05 pattern.

## Acceptance
- Endpoint/service tests for any server-side mapping; UI component tests
- Browser-verified mobile+desktop, light+dark, with real (authenticated) data where
  available; empty state verified
- DoD: build 0 warnings, tests green, lint clean

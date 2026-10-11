# 04 — MCP tool proxy API (ALL tools) + tools console

status: done
parent: `main.md`

## Scope
- `GET /api/tools` → `tools/list` result (name, description, inputSchema) cached short-TTL
- `POST /api/tools/:name/call` → `tools/call`; validate args against the tool's
  `inputSchema` (400 on mismatch); map MCP errors: auth failure → 401 + `needs_reauth`,
  rate limit → 429 with retry-after, upstream error → 502 with safe message
- Call log in SQLite (`tool_calls`: id, tool, args-hash, status, ms, ts) — index on ts;
  `GET /api/tools/calls` recent list (paginated, capped)
- **Tools console** (web): searchable list of every exposed tool, JSON args editor,
  result viewer (text/content parts, isError flag), copy-as-curl — this is how the user
  gets "the benefit of any available additional tool" without waiting for curated pages
- After first authenticated `tools/list`: record the real tool names/schemas into
  `main.md` "Tool discovery log" and adjust 06/07 page mapping
- Guard rails: only allow tools whose names pass the server's own list (no raw JSON-RPC
  passthrough), per-tool timeout, single-flight per (tool, normalized args) for idempotent
  reads (no aggressive caching of writes)

## Acceptance
- HTTP tests with a fake MCP server: list, call ok, call validation 400, unknown tool 404,
  upstream 401 → needs_reauth surfaced, 429 passthrough, timeout → 504
- Log redaction: args containing PII are not logged verbatim
- Browser: console usable mobile+desktop, light+dark

## Decisions

### D4.1 — Arg validation via the SDK's bundled ajv (`fromJsonSchema`)
`@modelcontextprotocol/client@2.3.1` ships ajv 8.18 inside its own dist
(`dist/ajvProvider-*.mjs`) and exports `fromJsonSchema(schema)` → sync validator
(Standard Schema v1, JSON Schema 2020-12). Using it: zero new dependencies, same
validator engine the SDK itself uses for schema work. One validator compiled per
tool, cached with the tool list, rebuilt on list refresh. No `inputSchema` ⇒ any
JSON object passes.

### D4.2 — Tool list cache
In-process TTL cache, default 60 s (`MCP_TOOLS_CACHE_TTL_MS`, clamped 5 s–1 h),
`?refresh=1` forces a re-fetch. The `Client` is built with
`listChanged.tools.onChanged` → cache invalidated when the server advertises
`tools.listChanged` (harmless no-op otherwise). Cache is served only while the
connection state is `connected` — a dropped connection answers 409 first, never
stale data.

### D4.3 — Error mapping (HTTP)
| MCP failure | HTTP | code |
|---|---|---|
| not connected (`disconnected`/`connecting`/`needs_reauth`) | 409 | `conflict` |
| unknown tool name | 404 | `not_found` |
| body not an object / args not an object / schema mismatch | 400 | `bad_request` |
| `UnauthorizedError` / `SdkHttpError` 401/403 | 401 | `unauthorized` (provider already flips state → `needs_reauth`, banner surfaces it) |
| `SdkHttpError` 429 | 429 | `rate_limited` + `retry-after` (upstream `Retry-After` header observed by the transport fetch wrapper, else 30 s) |
| `SdkError` `RequestTimeout` | 504 | `gateway_timeout` (new code) |
| `ProtocolError` / other `SdkError` / `SdkHttpError` | 502 | `upstream_error`, generic safe message (upstream text can carry PII — never echoed) |
| tool ran, reported failure | 200 | result with `isError: true` (MCP spec: tool errors are results, not RPC errors) |

### D4.4 — Call log (`tool_calls`, migration 003)
Columns: id, tool, `args_hash` (sha256 of canonicalized args — **args are never
stored**: PII redaction by construction), status code, ms, error class, ts.
Index on `created_at DESC`. `GET /api/tools/calls?limit=&offset=` — limit default
50 / max 200, offset capped at 10 000.

### D4.5 — Single-flight
In-flight map keyed by `tool + sha256(canonical args)`: concurrent duplicates share
one upstream call. Nothing is cached across time (writes are never coalesced),
and all MCP traffic (list + calls) runs through one serialization queue in the
connection service — no parallel fan-out (politeness rule).

### D4.6 — Env
`MCP_TOOL_CALL_TIMEOUT_MS` (default 60 s, 5 s–300 s), `MCP_TOOLS_CACHE_TTL_MS`
(default 60 s, 5 s–1 h). Transport-level: `retry-after` capture wrapper around the
MCP fetch (OAuth-endpoint requests use the provider's own fetch — unaffected).

### D4.7 — Console UI (`/tools`)
Replaces the plan-05 placeholder (`pages/ToolsPage.tsx`, pure logic in
`lib/tools.ts`): header (count + fetched-at, **Refresh list** = `?refresh=1`),
search box (name + description), flat list with descriptions (selected
highlighted), detail pane (description, collapsible raw input-schema view,
JSON args editor pre-filled from the schema's `required` properties, **Call
button**, **copy-as-curl** button), result viewer (text parts, `isError` red /
success badge, ms, collapsible raw-result JSON), recent-calls table (tool,
status, ms, time) refreshed after every attempt (successes and errors —
the server logs both). Single-column stacked layout at all viewports
(verified: no horizontal overflow at 375 px and 1440 px). Not connected ⇒
inline connect CTA; 409 from a stale list fetch is surfaced as an error box.

### D4.8 — Fake Upwork gains `GET /authorize` (auto-approve) for real browser
verification
The fake OAuth server previously had no authorize endpoint — tests simulated
the browser with `issueCode()` + direct callback GETs. For plan 04's browser
DoD the fake now serves `GET /authorize`: validates `client_id` + `redirect_uri`
against the DCR registration (new `clientRedirectUris` map) and `state`, then
302s back with a fresh `code` + `state` + `iss` — like a consent-free test
tenant. This lets a real browser complete the full OAuth round-trip against
the real app (used for the browser verification below; no effect on the
API-surface tests, which keep using `issueCode()`).

### D4.9 — One-click reconnect now follows the authorize URL client-side
(discovered contract mismatch, fixed here)
Plan 03's `POST /api/upwork/connect` answers **JSON** `{ authorizeUrl }` (tests
assert the JSON), while plan 05's re-auth banner used a top-level form POST —
so the browser would land on a raw-JSON page instead of Upwork's authorize
URL (plan 05's "contract note" anticipated a 3xx that plan 03 did not
deliver). Fix (no server change): `lib/upwork.ts → connectToUpwork()` posts
the connect request and then does `window.location.assign(authorizeUrl)`
(`navigate` injectable for tests). Both the re-auth banner button and the
`/tools` connect CTA use it. Verified end-to-end in a real browser
(disconnect → click → authorize → callback → connected → console).

## Verification
- `npm run build` / `typecheck` / `lint` → 0 errors/warnings; `npm test` →
  server 81 + web 62 tests, all green (15 new endpoint tests in
  `server/src/tools/tools.test.ts`, 7 `ToolsPage` tests, 4
  `connectToUpwork` tests, 1 new `ReAuthBanner` test).
- Real browser (headless Chromium via puppeteer-core, built app + fake
  Upwork on loopback): owner login → `/tools` CTA → connect (full OAuth
  round-trip incl. fake `/authorize` 302 + callback) → 5-tool console →
  select tool → call (result text rendered) → search filter narrows to 1 →
  recent-calls table visible → no horizontal overflow. Desktop 1440×900
  light+dark, mobile 375×812 light+dark; screenshots in `/tmp/uwu-shots-tools/`
  (not committed, per plan 05 convention).

## Tool discovery (pending first authenticated connection)

## Tool discovery (pending first authenticated connection)

Reference lists (unauthenticated, for planning only — the authenticated
`tools/list` is the source of truth and will be recorded in `main.md` when the
owner first connects):

- Glama MCP inspection of `mcp.upwork.com` (2026-09-02, 33 tools, all
  `upwork__`-prefixed): confirm_attachment_upload, confirm_draft, end_contract,
  find_freelancers, find_jobs, get_account, get_client_dashboard,
  get_client_financials, get_draft, get_job_posting, get_messages,
  get_rate_insights, get_tool_help, get_upload_status, invite_freelancer,
  list_accounts, list_client_invitations, list_client_proposals,
  list_contracts, list_offers, manage_client_proposals, manage_milestones,
  manage_offers, manage_talent_lists, post_job, send_message, set_tool_mode,
  set_tool_permission, start_attachment_upload, store_uploaded_files,
  update_account, update_contract, update_draft.
- Sources: https://glama.ai/mcp/connectors/com.upwork.mcp/upwork-mcp-server ,
  https://opentools.ai/mcp/upwork-mcp-connector-for-clients-and-freelancers
- Conventions from Upwork's agent-plugin skills docs (claudepluginhub /
  skills.sh, `upwork/upwork-agent-plugin`): tools take a nested `action`
  parameter (e.g. `find_jobs` actions `search`/`smart_search`/`get`;
  `send_message` actions `send`/`message_proposal`; `list_offers` actions
  `list`/`list_mine`); accounts are addressed via `list_accounts` (`role`
  `TALENT`/`FL_AGENCY` → `org_uid` for later calls); writes are draft-and-
  confirm (`update_draft`/`confirm_draft`, `start_attachment_upload`/
  `confirm_attachment_upload`); self-describing helpers `get_tool_help` /
  `search_tools` (per skill docs; names to be confirmed by the real list).
- Status: recorded pending the owner's **first real** authenticated connection
  (the browser verification used the fake server; its 5 tools are
  representative, not the live catalog). Fill in `main.md` after that.

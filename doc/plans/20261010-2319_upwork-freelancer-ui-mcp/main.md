# Upwork MCP Freelancer UI — Main Plan

status: in-progress
created: 2026-10-10 23:19 (+03)

## Goal

A self-hosted website (freelancer side only) that exposes the **full functionality of the
official Upwork MCP server** (`https://mcp.upwork.com/mcp`) as an Upwork-like UI:

1. Core flows (explicit user requirements):
   - Search for jobs
   - Submit proposals (when the account has enough Connects)
   - Read and respond to messages
   - Check invitations and send proposals/accept offers
   - **Plus any additional tool the MCP server offers now or later** (generic tool API + console)
2. **Re-auth notification**: the site must visibly notify (sticky banner + button) whenever
   the Upwork connection is expired/disconnected, with a one-click OAuth reconnect.
3. **Design as close to the official upwork.com design as possible** (tokens sampled from the
   live site — see D6).
4. Self-hosted on low-power hardware: one Docker container, one port, SQLite, no extra
   services.

## Key decisions (all web-searched 2026-10-10)

### D1 — Talk to Upwork via the official MCP server, not a raw API
- Legacy REST API v0 is sunset; legacy docs decommissioned 2024-06-19:
  https://developer.upwork.com/ , https://www.upwork.com/developer/documentation/graphql/api/docs/api-changelog.html
- Direct GraphQL API access requires an approved API-key application with strict gates
  (verified ID, ≥ $25,000 lifetime earnings/spend, JSS ≥ 90%, good standing):
  https://www.upwork.com/developer/documentation/graphql/api/docs/index.html ,
  https://support.upwork.com/hc/en-us/articles/115015857647-How-to-request-an-API-key-from-Upwork
- The official MCP server is free for any Upwork account, hosted at
  `https://mcp.upwork.com/mcp`, OAuth 2.1 with dynamic client registration:
  https://www.upwork.com/ai/mcp
- Browser-automation alternatives (https://github.com/vanooo/upwork-mcp,
  https://github.com/zcrossoverz/upwork-mcp) are **rejected**: ToS risk, selector
  fragility, requires a Chrome CDP host next to the app.
- ⇒ MCP is the only practical official path, and it is what the user asked for.

### D2 — No LLM in the stack
MCP is a JSON-RPC tool protocol; the backend is a headless MCP client that calls tools
directly (same as `claude mcp add --transport http`, minus Claude). No core feature needs an
LLM. An optional "AI copilot" would be a separate, later plan.

### D3 — Stack (versions from npm registry, 2026-10-10)
- Node.js 26 (LTS), npm workspaces (`server/`, `web/`).
- TypeScript **5.9.3** (not 7.x): `typescript-eslint@8.71.1` supports TS `<6.1.0`; TS 7 is
  the new native (Go) compiler line — conservative choice for a stable toolchain.
- Backend: Hono 4.13 + @hono/node-server 2.1 (lightweight, tiny footprint, first-class TS).
- MCP client: `@modelcontextprotocol/client` **v2.3.1** — `StreamableHTTPClientTransport` +
  `OAuthClientProvider` handles RFC 9728/8414 discovery, DCR, PKCE, RFC 9207 `iss`,
  RFC 8707 resource indicators, and 401 retry:
  https://ts.sdk.modelcontextprotocol.io/v2/clients/oauth.html
- Storage: SQLite (better-sqlite3 13.x) — tokens (AES-256-GCM), web session, tool-call log.
  No Redis/queues (low-power target).
- Frontend: React 19.3 + Vite 8.3 + Tailwind CSS 4.3 (`@theme` tokens from the live site).
- Quality: ESLint 10.12 + typescript-eslint 8.71 (zero warnings), Vitest 5, TS strict.
- Docker: `node:26-slim` multi-stage, single port 8787, non-root, volume for `DATA_DIR`.
  (slim/glibc chosen over alpine/musl for better-sqlite3 prebuild reliability.)

### D4 — Architecture
```
Browser (React 19 SPA, Tailwind 4)
   │  one origin, port 8787
   ▼
Hono BFF (Node 26, TS strict)
   ├─ owner auth: password (scrypt) → httpOnly session cookie
   ├─ /api/upwork/*   connect (OAuth 2.1 code+PKCE+DCR via Upwork AS), status, disconnect
   ├─ /api/tools, /api/tools/:name/call → MCP JSON-RPC (Streamable HTTP)
   │     └─ @modelcontextprotocol/client v2; per-owner token store (SQLite, AES-GCM)
   └─ serves web/dist (static SPA)
```
- One human owner. The OAuth client registration is obtained once (SDK DCR) and persisted.
- **Re-auth mechanics**: `OAuthClientProvider.tokens()` refreshes before expiry; on a 401 the
  connection is marked `needs_reauth`; a periodic keepalive ping (default 5 min) + UI polling
  of `/api/upwork/status` (30 s) drives the sticky banner.
- **Tool discovery**: official tool names/schemas are only known after an authenticated
  `tools/list`. Plan 04 ships the generic tool-calling API + a "Tools console" page so the
  first authenticated session records the real tool list into this plan (see log below);
  feature pages (06/07) bind to that list through a small registry (tool name → page mapping).

### D5 — Freelancer feature scope (from https://www.upwork.com/ai/mcp, freelancer section)
- Dashboard & overview: invitations, offers, messages, matched jobs, Connects balance
- Find the right jobs: search by skill/category/budget/type, matches & recommendations, favorites
- Draft & submit proposals: draft grounded in profile → review → submit (Connects only
  applied on confirm)
- Invitations & offers: view, accept / decline / ask for changes (binding acceptance finishes
  on upwork.com — UI shows notice + link)
- Contracts & work delivery: active contracts, milestone work, logged time (work diary)
- Earnings & profile: earnings, available balance, availability, employment, languages,
  education, portfolio, profile visibility
- Messaging: read/send messages, upload/download attachments
- Account & access: list available accounts, account details
- **Everything else the MCP server exposes** → generic tool API + tools console (D4)

### D6 — Design (sampled from live upwork.com HTML/CSS, 2026-10-10)
- Brand tokens found in live CSS: `--up-green:#14a800`, `--up-green-dark:#3c8224`,
  `--up-green-hc:#0c5c00`, `--up-lime:#95df00`, `--up-black:#181818`, teal `#13544e`,
  red `#c70e05`, sky `#5cf5ff`, yellow `#d9c407`, green-tinted surfaces
  (`#f7faf7`, `#f2f7f2`, `#e4ebe4`, `#d5e0d5`).
- Font: brand uses a custom cut of **Neue Montreal** — not redistributable, so the UI uses a
  system fallback stack (recorded in AGENTS.md).
- Light theme default (upwork.com default), dark theme class-based; both must be verified.
- Source: https://www.upwork.com/ (live HTML, grepped CSS custom properties), brand pages:
  https://lbbonline.com/news/upwork-builds-for-the-future-of-work-with-new-global-design-system-and-visual-identity ,
  https://colorfyi.com/brands/upwork-global-inc/

## Plan index

| # | Plan | Status |
|---|------|--------|
| 01 | `01-repo-scaffold.md` — configs, README, .gitignore, workspaces, toolchain, Docker, minimal health endpoint | done |
| 02 | `02-backend-core.md` — owner auth (login/session), config hardening, static SPA serving, error envelope | done |
| 03 | `03-upwork-oauth-connection.md` — MCP OAuth 2.1 flow, encrypted token store, re-auth detection & status API | done |
| 04 | `04-mcp-tool-proxy-api.md` — /api/tools + tool-call API (ALL tools), error mapping, call log, tools console | done |
| 05 | `05-frontend-shell.md` — React+Tailwind shell, Upwork design tokens, layout, login page, re-auth banner | done |
| 06 | `06-dashboard-jobs.md` — freelancer dashboard + job search/detail (after tool discovery) | done |
| 07 | `07-proposals-invitations-messages.md` — proposals (draft-confirm), invitations/offers, messages, contracts, earnings, profile | proposed |
| 08 | `08-deploy-hardening.md` — image size, backups, smoke tests, final docs | proposed |
| 09 | `09-pi-deployment.md` — Raspberry Pi deploy: bootstrap scripts, dynamic-DNS timer, Caddy TLS | proposed |

## Tool discovery log (filled after first authenticated connection — plan 04)

- (pending the owner's first **real** authenticated connection — the fake-server
  browser verification is not a source; plan 04 ships the console so this gets
  filled from the live `tools/list` the first time the owner connects)
- **Favorites gap (plan 06):** no saved-jobs tool appears in any public tool list
  (checked Oct 2026) — the favorites toggle is out of the UI; wire it if the live
  list surfaces a saved-jobs tool.

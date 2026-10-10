# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.
Read this file in full before making changes.

## Project

**upwork-mcp-ui** — a self-hosted, **freelancer-side** Upwork web UI built on top of the
**official Upwork MCP server** (`https://mcp.upwork.com/mcp`). The backend is a headless MCP
*client* (JSON-RPC over Streamable HTTP, OAuth 2.1) that exposes the Upwork MCP tools through a
small REST API consumed by a React SPA.

- **Freelancer side only**: job search, proposals (draft-confirm), invitations & offers,
  contracts & work delivery, messages & attachments, earnings & profile, dashboard/overview.
  The client/hiring side is out of scope.
- **Every MCP tool must stay reachable** — the UI has curated pages for the main flows, but a
  generic tool API + tools console exposes all current and future tools of the MCP server.
- **No LLM in the stack.** MCP is a tool protocol, not an AI feature. Do not add an LLM
  dependency without a plan that justifies it.
- **Single-owner deployment**: one human user (the freelancer) logs into the web app; the app
  holds that user's Upwork OAuth session.
- **Re-auth is a first-class feature**: whenever the Upwork connection is expired or
  disconnected, the site must show a clear notification with a one-click reconnect.
- Upwork® is a trademark of Upwork Global LLC. This is an unofficial UI; the standard Upwork
  API & MCP Terms of Use apply (freelancer actions only on your own account).

## Stack (pinned — sources in the main plan)

| Part | Choice |
|---|---|
| Runtime | Node.js 26 (LTS), npm workspaces (`server/`, `web/`) |
| Backend | Hono 4 + `@hono/node-server`, TypeScript 5.9 (`strict`) |
| MCP client | `@modelcontextprotocol/client` v2 (`StreamableHTTPClientTransport` + `OAuthClientProvider`) |
| Storage | SQLite via better-sqlite3 (file in `DATA_DIR`); no Redis/queues/Postgres |
| Frontend | React 19 + Vite 8 + Tailwind CSS 4 |
| Tests | Vitest (endpoint tests through the HTTP surface) |
| Lint | ESLint 10 flat config + typescript-eslint, zero warnings |
| Deploy | single Docker image (`node:26-slim`), one port (default 8787) |

## Commands

- `npm install` — install all workspaces
- `npm run dev` — server (http://localhost:8787) + web (http://localhost:5173, proxies `/api`)
- `npm run build` — build server (`server/dist`) and web (`web/dist`)
- `npm test` — vitest across workspaces
- `npm run lint` — eslint (must exit clean)
- `npm run typecheck` — `tsc --noEmit` for both workspaces
- `docker compose up --build -d` — production mode (serves API + built UI on :8787)

## Plan system (mandatory)

- Plans live in `doc/plans/<YYYYMMDD-HHMM>_<title-slug>/` (creation datetime + main-plan title).
- Folder = one plan: `main.md` + small `NN-topic.md` sub-plans + `COMMITS.md`.
- **No giant plans** — split by single responsibility; each sub-plan finishable in one session.
- Every plan file has a `status:` header: `proposed | in-progress | done | cancelled`.
- **Search the web before any non-trivial decision** (versions, libraries, architecture,
  UX flows); record the decision + source links in the plan file.
- Any git commit related to a plan → append a row to that folder's `COMMITS.md`
  (date, short hash, subject, note), then commit the update.
- Work follows the active plan. Missing scope ⇒ write a new plan first; never expand silently.

## Code rules

- Tests: **every new or changed behavior ships with its tests in the same change** —
  endpoint tests through the HTTP surface (`app.request()`) + service-level tests for guards
  the HTTP layer can't reach. Cover the happy path **and** the error paths (validation 400,
  404, 401/403, conflicts, caps); pure logic → 100%. A feature is not done without its tests.
- Warnings are **errors**: TypeScript `strict` (+ `noUncheckedIndexedAccess`), ESLint zero
  warnings, no `any` without a plan entry. `npm run build` must finish with 0 errors/warnings.
- Self-hosted (low-power target): no Redis/queues/Elasticsearch; small images; DB indexes
  over in-memory filtering; small Docker images; single container.
- No new infrastructure service (process, container, daemon) without a justifying plan.
- Never commit secrets, env files (`.env`), or user data (`data/` is gitignored and holds the
  SQLite DB with encrypted OAuth tokens and sessions).
- Never log OAuth tokens, session cookies, or request bodies containing PII; log ids and
  timestamps only.
- Upwork OAuth rules: tokens encrypted at rest (AES-256-GCM keyed from `APP_SECRET`); always
  validate `state` (CSRF) and `iss` (mix-up) on the callback; refresh before expiry; on 401
  mark the connection `needs_reauth` and surface it in the UI; revoke = local delete +
  instruct the user to revoke on upwork.com (Connected Apps).
- Write actions: the Upwork MCP uses **draft-confirm** for writes — the UI must present
  drafts and require explicit confirmation; binding actions finish on upwork.com (the UI
  shows a link/notice, it never auto-confirms).
- Rate limits: be polite to the Upwork API — no polling tighter than needed, no parallel
  fan-out of tool calls, back off on 429.
- Do not: delete/rename plan folders, rewrite git history, add dependencies "because it's
  easy", or change behavior beyond the active plan.
- Always search online before taking any decision.

## Definition of done

1. `npm run build` → 0 warnings · `npm test` green · `npm run lint` clean
2. UI changes verified in a browser: mobile + desktop, light + dark
3. Plan file updated (status/decisions) · `COMMITS.md` appended · clean commit(s)

## Design system (match upwork.com)

Tokens sampled from the live upwork.com CSS (Oct 2026) — see the main plan for sources.
Keep these exact values in `web/src/index.css` (`@theme`):

| Token | Value | Usage |
|---|---|---|
| `--color-up-green` | `#14a800` | primary buttons/links |
| `--color-up-green-dark` | `#3c8224` | hover states |
| `--color-up-green-hc` | `#0c5c00` | accessible green text |
| `--color-up-lime` | `#95df00` | accent / highlights |
| `--color-up-black` | `#181818` | main text |
| `--color-up-teal` | `#13544e` | dark accent, secondary text |
| `--color-up-red` | `#c70e05` | errors / destructive |
| `--color-up-sky` | `#5cf5ff` | info accent |
| `--color-up-yellow` | `#d9c407` | warnings |
| `--color-up-surface` | `#f7faf7` | page background |
| `--color-up-surface-2` | `#f2f7f2` | cards/sections |
| `--color-up-border` | `#e4ebe4` | borders/dividers |
| font | `"Neue Montreal", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | (brand font not redistributable → system fallback stack) |

Upwork look: white/green-tinted surfaces, black text, rounded buttons (primary = green with
white text), subtle 1px borders, generous whitespace, compact rows/lists for jobs & messages.
Light theme is default (like upwork.com); dark theme is class-based (`.dark`) and must be
verified in the browser too.

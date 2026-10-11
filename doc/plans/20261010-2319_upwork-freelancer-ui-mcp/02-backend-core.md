# 02 — Backend core: owner auth, config, static serving

status: done
parent: `main.md`

## Scope
- `APP_SECRET` mandatory in production (validated at boot); scrypt password hashing
  (node:crypto, no native dep) for the single owner account
- First-run owner setup (env `OWNER_PASSWORD` bootstrap or setup page — decide after search)
- Session cookies (httpOnly, SameSite=Lax, signed+encrypted with APP_SECRET), `/api/login`,
  `/api/logout`, `/api/me`; route protection middleware for all other `/api/*`
- SQLite via better-sqlite3 (WAL), schema: `users`, `sessions`, migrations table
- Serve `web/dist` statically with SPA fallback (single-origin production)
- Standard error envelope `{ error: { code, message } }`; 400/401/403/404/405/429/500 mapping
- Rate-limit login attempts (in-memory, low-power friendly)

## Acceptance
- Endpoint tests through HTTP surface: login ok/bad-password/locked, me authed/unauthed,
  static fallback, 404 JSON, 405 JSON
- Session expiry + logout invalidation; no secrets in logs
- DoD: build 0 warnings, tests green, lint clean; browser: login page works mobile+desktop

## Decisions (searched 2026-10-11)

| Decision | Choice | Source / rationale |
|---|---|---|
| First-run owner bootstrap | No default credentials. Two paths: `OWNER_PASSWORD` env (headless/Docker) **or** one-time `POST /api/setup` (in-browser; endpoint 404s once an owner exists) | Industry pattern for single-admin self-hosted apps: Grist (admin-password flag / first-run prompt), omnigent, PicPeak — all avoid shipped defaults (searched 2026-10-11) |
| Session storage | 32-byte opaque random token in `HttpOnly; SameSite=Lax; Secure(prod); Path=/` cookie; SQLite stores **SHA-256 hash** of the token; sliding 7-day expiry; server-side store ⇒ instant logout revocation | OWASP Session Management Cheat Sheet: opaque high-entropy tokens, server-side session store, hash tokens if store disclosure is a risk |
| Password hashing | `node:crypto` scrypt, OWASP params N=2^17, r=8, p=1, 64-byte key, 16-byte random salt, `timingSafeEqual` verify; self-describing format `scrypt$N=..&r=..&p=..&keylen=..$salt$hash` | OWASP Password Storage Cheat Sheet (scrypt minimum N=2^17, r=8, p=1); Node `crypto.scrypt` docs — no native dep needed |
| Config hardening | `APP_SECRET` required (zod, 32+ chars) when `NODE_ENV=production`; dev/test get an ephemeral random secret (warned in dev); `OWNER_PASSWORD` min 8 chars; `SESSION_TTL_MS` validated | plan scope; APP_SECRET is used for OAuth token encryption from plan 03 onward |
| Static SPA serving | Hand-rolled middleware (`createSpaMiddleware`): traversal guard (resolve + prefix check + literal `..` segment check), MIME table, exact file → SPA fallback to `index.html`; no `index.html` (dev) → fall through to JSON 404 (Vite serves UI) | Avoids `@hono/node-server` serve-static adapter quirks; ~50 lines, fully tested; Note: URL parsing already normalizes `..` before request reach — guard is defense-in-depth |
| Error envelope | `{ error: { code, message } }` with codes `bad_request/unauthorized/forbidden/not_found/method_not_allowed/conflict/rate_limited/internal_error`; `Retry-After` on 429; 500 messages are generic (no internals leaked) | plan scope; `AppError` (code → status map) so handlers throw typed errors |
| Auth-first API semantics | Middleware allowlist of public paths; everything else under `/api/*` → 401 unauthed (incl. unknown paths), 404 when authed-unknown, 405 envelope for wrong methods on known paths | Standard for protected APIs; keeps later plans' routes safe by default |
| Login rate limit | In-memory fixed-window (no Redis): 10 attempts / 15 min per IP (prod), keyed by `X-Forwarded-For` (first hop) or connection; cleared on success | low-power constraint; brute-force mitigation for a single-owner password |
| better-sqlite3 13.0.3 + @types/better-sqlite3 9.6.0 | No Node 26 prebuilds published for v13.x (0 release assets) ⇒ Docker **build stage** installs `python3 make g++`, compiles, then `npm prune --omit=dev`; runtime stage stays `node:26-slim` (image smaller than plan 01's 550 MB baseline) | https://github.com/WiseLibs/better-sqlite3/releases (verified assets 2026-10-11); npm auto node-gyp build of `binding.gyp` packages |
| DB layout | `DATA_DIR/app.db`, WAL, FK on; `users`, `sessions`, `migrations` (ordered, idempotent migrations table) | plan scope; low-power friendly (single file, no infra) |

## Notes
- `scryptSync` (N=2^17) blocks the event loop ~100–300 ms per hash — acceptable for a
  single-owner app (login once per session, setup once ever).
- Cookie name: `session`. Login is password-only (no username) — single owner by design.
- Verified in container (prod mode): env bootstrap, 401/200 login, Secure cookie, me
  authed/unauthed, 401/404/405 envelopes, logout revocation, rate limit, SPA index,
  traversal attempts never leak files.

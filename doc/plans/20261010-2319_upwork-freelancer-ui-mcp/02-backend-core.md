# 02 — Backend core: owner auth, config, static serving

status: proposed
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

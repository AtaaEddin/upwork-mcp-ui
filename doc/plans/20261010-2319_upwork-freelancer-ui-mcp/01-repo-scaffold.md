# 01 — Repo scaffold & toolchain

status: done
parent: `main.md` (20261010-2319_upwork-freelancer-ui-mcp)
done: 2026-10-10 23:40 (+03) — build 0 warnings, 6/6 tests green, lint clean, smoke-tested healthz; docker build verified

## Scope (single session)
- Root: `package.json` (npm workspaces `server`+`web`, scripts, engines), `tsconfig.base.json`,
  `eslint.config.js`, `.gitignore`, `.editorconfig`, `.npmrc`, `.env.example`, `README.md`,
  `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- `server/`: Hono app exposing `GET /api/healthz` (JSON), zod-validated env config,
  `app.ts` (factory) / `index.ts` (entry) split for testability, Vitest config
- `web/`: Vite + React 19 + Tailwind 4 placeholder page with Upwork design tokens
  (green primary, Neue Montreal fallback stack), dev proxy `/api → :8787`
- Tests: health endpoint via HTTP surface (200 shape, 404 unknown route), config
  validation (bad port rejected, defaults applied)

## Acceptance (DoD)
- `npm run build` 0 warnings · `npm test` green · `npm run lint` clean · `npm run typecheck` clean
- `docker compose up --build` serves `/api/healthz` on :8787
- Placeholder page renders (Upwork header + scaffold note) — visual browser verification
  (mobile/desktop, light/dark) happens in plan 05 when the real UI shell lands; scaffold
  placeholder is static.

## Out of scope (later plans)
Owner auth, Upwork OAuth, tool proxy, real feature pages, static SPA serving by the server.

## Decisions
- TS 5.9.3 over 7.0.2: typescript-eslint 8.71.1 peer range `>=4.8.4 <6.1.0` (npm registry).
- npm 11.19 `allowScripts`: approved `esbuild` postinstall (required by Vite) — recorded here per
  "no dependency/script changes silently".
- ESLint 10.12.0 + @eslint/js 10.0.1 + typescript-eslint 8.71.1 (peer allows eslint ^10).
- better-sqlite3 NOT added yet — lands with plan 02/03 when storage is actually used.
- `concurrently` for parallel dev (server+web) — small, standard tooling.
- Docker `node:26-slim` (glibc) over alpine (musl) for better-sqlite3 prebuild reliability.

# 08 — Deploy hardening & final docs

status: proposed
parent: `main.md`

## Scope
- Docker image size audit (multi-stage, `node:26-slim`, non-root, no dev deps in runtime
  stage) — record final size in this file. **Baseline (scaffold, plan 01): 550MB** (runtime
  stage currently copies full `node_modules` incl. dev deps → prune with a second
  `npm ci --omit=dev` or `npm prune --omit=dev`)
- Backup/restore for `DATA_DIR` (SQLite online backup; documented command)
- Smoke test script: start container → healthz → login → upwork status (scripted)
- `.env.example` final pass, README final pass (setup, reconnect, ToS notes), AGENTS.md sync
- Security checklist pass: headers (CSP, HSTS optional behind reverse proxy), cookie flags,
  rate limits, token redaction audit

## Acceptance
- `docker compose up --build` on a clean host works from README alone
- Smoke test green; image size recorded; checklist ticked in this file
- DoD: build 0 warnings, tests green, lint clean

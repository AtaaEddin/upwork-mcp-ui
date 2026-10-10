# 03 — Upwork OAuth connection (MCP OAuth 2.1) + re-auth detection

status: proposed
parent: `main.md`

## Scope
- `UpworkConnectionService` using `@modelcontextprotocol/client` v2:
  `StreamableHTTPClientTransport` + custom `OAuthClientProvider` backed by SQLite
- OAuth 2.1 code + PKCE + DCR against the Upwork authorization server; persist DCR client
  credentials keyed by issuer; store `state` (CSRF) + `discoveryState` per flow
- Callback endpoint `/api/upwork/callback`: validate `state` + `iss`, `transport.finishAuth`,
  persist tokens **encrypted (AES-256-GCM, key from APP_SECRET)**, then a fresh `connect()`
- `GET /api/upwork/status` → `{ state: 'disconnected'|'connecting'|'connected'|'needs_reauth',
  expiresAt?, accountSummary? }`
- Re-auth detection: proactive refresh before `expires_at`; on 401 → mark `needs_reauth`,
  stop keepalive; periodic keepalive ping (default 5 min, configurable)
- `POST /api/upwork/connect` (start flow → redirect URL), `POST /api/upwork/disconnect`
  (local token delete + hint to revoke at upwork.com Connected Apps)
- Connection manager: single lazy client, re-create transport on token change (fresh
  transport per connect, per SDK docs)

## Acceptance
- Service-level tests with a fake MCP HTTP server (OAuth metadata + token + JSON-RPC
  endpoints) covering: full flow, state mismatch (400), issuer mismatch (reject), expired
  token → refresh, 401 → needs_reauth, disconnect clears tokens
- HTTP-surface tests: status transitions, connect redirects to authorize URL, callback
  errors
- No tokens/cookies in logs (log redaction test)
- Browser: after connect, status shows connected; simulated expiry shows the re-auth
  requirement (banner itself lands in plan 05)

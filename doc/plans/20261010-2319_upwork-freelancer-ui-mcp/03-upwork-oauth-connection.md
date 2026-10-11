# 03 — Upwork OAuth connection (MCP OAuth 2.1) + re-auth detection

status: done
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

## Decisions (searched 2026-10-11)

| Decision | Choice | Source / rationale |
|---|---|---|
| SDK API surface | `@modelcontextprotocol/client` 2.3.1: implement `OAuthClientProvider` (`get redirectUrl`, `get clientMetadata`, `state()`, `clientInformation/saveClientInformation(ctx.issuer)`, `tokens/saveTokens(ctx?)`, `saveCodeVerifier/codeVerifier()`, `saveDiscoveryState/discoveryState()`, `invalidateCredentials(scope)`, `redirectToAuthorization(url)`); catch `UnauthorizedError` / `IssuerMismatchError` / `AuthorizationServerMismatchError`; callback leg = fresh transport + `finishAuth(URLSearchParams)` then fresh `Client.connect(new StreamableHTTPClientTransport(...))` | https://ts.sdk.modelcontextprotocol.io/v2/clients/oauth.html + package dist types (`OAuthClientProvider`, `StoredOAuthTokens = OAuthTokens & {issuer}`, `OAuthClientInformationMixed`) |
| Token refresh ownership | Provider `tokens()` is the SDK's per-request bearer read ⇒ proactive refresh happens there (single-flight, 120 s before `expires_at`, SDK `refreshAuthorization` helper). 401 path is SDK-owned: transport `onUnauthorized` → `auth()` → refresh grant; on refresh failure the SDK re-enters the authorization flow and throws `UnauthorizedError` ⇒ service marks `needs_reauth` (pending authorize URL was already recorded by `redirectToAuthorization`) | SDK dist: `adaptOAuthProvider`/`handleOAuthUnauthorized`/`authInternal` (refresh branch → redirect branch); docs oauth.html |
| Upwork AS facts (probed 2026-10-11) | issuer `https://mcp.upwork.com`; DCR `POST https://www.upwork.com/register`; `token_endpoint https://www.upwork.com/api/v3/oauth2/token`; PKCE S256 only; public client (`token_endpoint_auth_method: none`); `client_id_metadata_document_supported: true` (we do **not** set `clientMetadataUrl` ⇒ SDK uses DCR and we persist the client info); RFC 9728 resource `https://mcp.upwork.com/mcp` (SDK sends RFC 8707 `resource` on authorize + token legs) | live `https://mcp.upwork.com/.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource` |
| Client metadata | `client_name: upwork-mcp-ui`, `application_type: web` (explicit — beats loopback→native heuristic), `grant_types: [authorization_code, refresh_token]`, `response_types: [code]`, `token_endpoint_auth_method: none`, single `redirect_uris: [PUBLIC_BASE_URL/api/upwork/callback]` | MCP OAuth spec (client registration) + SDK `resolveClientMetadata` defaults; SEP-837 loopback heuristic in dist |
| Token storage | SQLite single row (`upwork_connection`, id=1): `state`, `issuer`, `access_expires_at`, `tokens_enc`, `client_info_enc`, `verifier_enc`, `discovery_enc`, `flow_state`, `pending_authorize_url`, `connected_at`. AES-256-GCM keyed from `APP_SECRET` (key = SHA-256 `upwork-mcp-ui/oauth/v1|<APP_SECRET>`), blob `v1.b64(nonce‖tag‖ct)`; PKCE verifier + discovery state encrypted too (DB backups must not leak them) | AGENTS.md OAuth rules (AES-256-GCM from APP_SECRET; validate state + iss) |
| State machine (persisted) | `disconnected --connect--> connecting --callback ok--> connected --(401+refresh fail)--> needs_reauth --connect--> connecting…`; any callback failure ⇒ `disconnected`; `disconnect` ⇒ `disconnected` (tokens+flow cleared, **DCR client info kept** for instant re-register-free reconnect) | plan scope; single-owner app, no per-user scoping |
| `state` (CSRF) handling | 32-byte base64url random per flow, persisted (survives restarts); callback compares with `crypto.timingSafeEqual`; mismatch ⇒ 400 + flow cleared; `error_description` from callback is **never** rendered (attacker-controlled per SDK docs) | plan scope + SDK docs (mix-up guidance) |
| Keepalive | `setInterval` (default 300 000 ms, `UPWORK_KEEPALIVE_MS`, min 5000, max 1 h, `unref()`), tick only when state=`connected`, request = MCP `ping` (`client.ping()`); `UnauthorizedError` ⇒ `needs_reauth`; other errors logged (no state change); timer never re-arms while `needs_reauth`/`disconnected` ⇒ pings stop until reconnect | plan scope (default 5 min, configurable); MCP protocol has a `ping` request; SDK `Client.ping()` |
| Version negotiation | leave default `legacy` (plain 2025 `initialize` handshake — no probe, byte-compatible with deployed Upwork MCP) | SDK `ClientOptions.versionNegotiation` docs (default `'legacy'`) |
| `accountSummary` in status | reserved field, `undefined` for now — filling it needs tool calls (plan 04/06 tool registry); status carries `state`, `expiresAt`, `connectedAt`, `pendingAuthorizeUrl` | plan scope (field is optional) |
| New env | `PUBLIC_BASE_URL` (default `http://localhost:$PORT` — dev-friendly; must be set to the public origin in prod so the DCR redirect URI is real), `UPWORK_KEEPALIVE_MS` (default 300000) | plan scope; DCR registers the callback redirect URI — it must be reachable by the user's browser |
| Disconnect revocation hint | local delete only; UI text points to `https://www.upwork.com/ab/account-security` (the account-security section the OAuth endpoints live under; exact "Connected Apps" page URL could not be verified — upwork.com bot-blocks non-browser clients). AS exposes `revocation_endpoint` but we do **not** call it (single public client, local delete is sufficient + Upwork tokens are short-lived) | AGENTS.md (revoke = local delete + instruct user); live AS metadata |
| New error code | `upstream_error` → 502 (Upwork-side failures: discovery/DCR network errors, token exchange transport failures) — additive to plan-02 envelope | plan scope |
| No new deps | only `@modelcontextprotocol/client@2.3.1` (already pinned in main plan D3) | main plan D3 |
| Where the interactive login happens (re-auth UX, decided 2026-10-11) | The human login (Google SSO + verification email + captcha) stays in the **owner's own browser on the owner's own machine**: the SPA follows the authorize URL in the top-level window, the redirect lands on the public callback, and the server does only OAuth protocol endpoints (DCR / token exchange / refresh). **Rejected: (a) server-side browser (RDP/VNC or on-server desktop)** — same human login but from a datacenter IP with an unknown browser fingerprint: exactly the "unusual sign-in" pattern Google/Upwork challenge (more verification loops / temporary lockouts, not fewer), and the verification email still lands in the owner's inbox, so the owner is present either way — RDP adds a machine in the middle, removes no step; also needs desktop + browser in the VPS image (breaks small-image/low-power constraint) and an RDP endpoint (attack surface unless tunnel-only). **Rejected: (b) headless/CDP login** — the "only if there's no risk" condition fails: Upwork's bot policy defines any script that "automatically sends requests to Upwork, collects data, or performs actions faster than a human" as a bot with warning → restriction → permanent block outcomes (even non-malicious tools), and `vanooo/upwork-mcp`'s README states its CDP design exists to "Bypass Cloudflare's 'automated test software' detection" — i.e. active circumvention of a security control; `zcrossoverz/upwork-mcp` is CDP + session-cookie capture from a real Chrome tab: same bot-class exposure plus UI-drift brittleness (selectors break on redesign). The official MCP OAuth flow is the sanctioned path: identical to Claude/ChatGPT/Cursor connecting to `mcp.upwork.com`, token scoped to the MCP resource (RFC 8707), no website session cookie, no internal APIs, no login automation | https://support.upwork.com/hc/en-us/articles/43342677368467-Use-bots-and-other-automation-properly · https://www.upwork.com/ai/mcp · https://support.upwork.com/hc/en-us/articles/55446516654611-How-to-use-Upwork-with-AI-agents-through-MCP · https://github.com/vanooo/upwork-mcp · https://github.com/zcrossoverz/upwork-mcp (both READMEs read 2026-10-11) · main plan D1 |

## Result (2026-10-11)

- `server/src/upwork/`: `crypto.ts` (AES-256-GCM `v1` blobs, key = SHA-256 of
  `upwork-mcp-ui/oauth/v1|APP_SECRET`), `store.ts` (single-row `upwork_connection`,
  migration `002_upwork_connection`), `provider.ts` (`UpworkOAuthProvider` — SQLite-backed
  `OAuthClientProvider`, single-flight proactive refresh in `tokens()`), `service.ts`
  (`UpworkConnectionService` — connect/callback/status/disconnect/ping/keepalive,
  serialized op queue, lazy single `Client`), `routes.ts` (`/api/upwork/*` sub-app),
  `fake-upwork.ts` (loopback fake Upwork AS + MCP server for tests).
- Wired into `app.ts` (guard **before** the sub-app so `/api/upwork/*` is session-gated;
  `GET /api/upwork/callback` public), `index.ts` (service construction + keepalive start +
  dispose on SIGINT/SIGTERM), `config.ts` (`PUBLIC_BASE_URL`, `UPWORK_KEEPALIVE_MS`),
  `errors.ts` (`upstream_error` → 502), `db.ts` (migration 002). `.env.example` documents the
  two new vars.
- Tests: `server/src/upwork/upwork.test.ts` — 24 tests, all HTTP-surface via `app.request()`:
  full flow (DCR+PKCE+callback+MCP session), CSRF state mismatch (400), RFC 9207 issuer
  mismatch (code not redeemed), callback `error` param never leaked, 401 → SDK refresh →
  re-connected, proactive refresh window, refresh-dead → `needs_reauth` + keepalive off,
  reconnect reusing the DCR client, disconnect keeps DCR client info, restart survival
  (tokens from DB → new session), keepalive cadence + non-auth failure threshold,
  401/405/409 envelopes, public callback, log redaction (no tokens/verifiers/`code=` in any
  service- or SDK-console output).
- Server boot smoke-tested: healthz, unauthed status 401, login, authed status.
- **Observation (no action)**: on a hard token death two in-flight transport requests can 401
  concurrently (SSE GET stream + request) and the SDK's 401 handler is not single-flight, so
  the refresh grant may run twice (last write wins; harmless for non-rotating refresh tokens,
  degrades to `needs_reauth` if the AS rotates them — acceptable per plan scope). Proactive
  refresh keeps this path rare in normal operation.
- `npm run build` 0 warnings · `npm test` green (66/66 server) · `npm run lint` clean.

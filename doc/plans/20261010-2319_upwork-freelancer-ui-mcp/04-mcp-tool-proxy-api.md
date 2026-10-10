# 04 — MCP tool proxy API (ALL tools) + tools console

status: proposed
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

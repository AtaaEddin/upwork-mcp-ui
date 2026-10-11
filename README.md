# Upwork MCP UI

Self-hosted, **freelancer-side** Upwork web UI built on the **official Upwork MCP server**
(`https://mcp.upwork.com/mcp`).

The backend is a headless [MCP](https://modelcontextprotocol.io) client (JSON-RPC over
Streamable HTTP, OAuth 2.1) that exposes the Upwork MCP tools through a small REST API
consumed by a React single-page app. **No LLM is involved** — MCP is a tool protocol; the UI
calls the tools directly.

> **Unofficial.** Upwork® is a trademark of Upwork Global LLC. Use of the Upwork MCP is
> subject to Upwork's API & MCP Terms of Use. Freelancer actions only, on your own account.

## Features (roadmap)

- [x] Repo scaffold, toolchain, Docker (plan 01)
- [x] Owner login, single-user session (plan 02)
- [x] One-click Upwork sign-in (OAuth 2.1) + **re-auth banner** when the connection expires
      (plans 03, 05)
- [x] **Every MCP tool reachable** via a generic tool API + tools console (plan 04)
- [x] Freelancer dashboard: invitations, offers, messages, matched jobs, Connects balance
      (plan 06)
- [x] Job search & detail (plan 06)
- [ ] Proposals with draft-confirm, invitations/offers, messages, contracts, earnings,
      profile (plan 07, in progress)
- [x] Design matching upwork.com (green `#14a800` system, light + dark themes) (plan 05)

See [`doc/plans/`](doc/plans/) for the full plan system and
[`AGENTS.md`](AGENTS.md) for contributor/agent rules.

## Architecture

```
Browser (React 19 SPA, Tailwind 4)
   │  one origin, port 8787
   ▼
Hono BFF (Node 26, TypeScript strict)
   ├─ owner login (password → httpOnly session cookie)
   ├─ /api/upwork/*  → OAuth 2.1 (code + PKCE + DCR) to the Upwork MCP server
   ├─ /api/tools, /api/tools/:name/call → MCP Streamable HTTP (JSON-RPC)
   │     └─ @modelcontextprotocol/client v2; tokens in SQLite (AES-256-GCM)
   └─ serves the built SPA (web/dist)
```

- One Docker container, one port, one SQLite file in a volume — built for low-power
  self-hosting. No Redis/queues/Postgres.
- **Re-auth**: the UI polls `/api/upwork/status`; a sticky banner appears whenever the
  Upwork connection needs re-auth, with a one-click reconnect.
- **All tools**: curated pages cover the main flows; everything else the MCP server offers
  is reachable through the tools console.

## Quickstart (development)

Requires Node.js ≥ 24 and npm ≥ 11.

```bash
cp .env.example .env
npm install
npm run dev        # server :8787 + web :5173 (proxies /api → :8787)
```

- Web UI: http://localhost:5173
- Health: http://localhost:8787/api/healthz

## Docker

```bash
cp .env.example .env     # set APP_SECRET: openssl rand -hex 32
docker compose up --build -d
# → http://localhost:8787
```

## Raspberry Pi deployment (plan 09)

For a Raspberry Pi 4 (64-bit Raspberry Pi OS) behind a dynamic public IP, the app is
exposed through a **Cloudflare Tunnel** (named tunnel, TLS at the Cloudflare edge) — no
router port forwarding or DDNS needed.

1. Create a tunnel + public hostname in the Cloudflare dashboard (Networking → Tunnels)
   and copy the tunnel token.
2. On the Pi:

   ```bash
   bash scripts/pi/install.sh   # installs Docker if missing, generates .env + secrets, builds & starts
   bash scripts/pi/status.sh    # containers, reachability, disk, memory
   ```

`install.sh` is idempotent (never regenerates existing secrets) and prints the generated
`OWNER_PASSWORD` once. Details, acceptance steps, and a documented fallback (Caddy + DDNS):
[plan 09](doc/plans/20261010-2319_upwork-freelancer-ui-mcp/09-pi-deployment.md).

## Environment variables

| Var | Default | Description |
|-----|---------|-------------|
| `PORT` | `8787` | HTTP port (API + built SPA) |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `development` / `production`. Production requires `APP_SECRET`. |
| `APP_SECRET` | — | **Required in production.** Random 32+ chars; encrypts stored OAuth tokens |
| `OWNER_PASSWORD` | — | Optional first-run owner password (min 8 chars) |
| `SESSION_TTL_MS` | `604800000` | Owner session lifetime (7 days, sliding) |
| `DATA_DIR` | `./data` | SQLite database location (gitignored, never committed) |
| `UPWORK_MCP_URL` | `https://mcp.upwork.com/mcp` | Official Upwork MCP endpoint |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | Public origin (no trailing slash); OAuth redirect base |
| `UPWORK_KEEPALIVE_MS` | `300000` | Upwork keepalive ping interval in ms (clamped 5 s – 1 h) |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Cloudflare Tunnel token (plan 09). Empty = the tunnel container does not run |
| `COMPOSE_PROFILES` | — | Compose profiles; `tunnel` activates `cloudflared` (set by the Pi install script) |

### First run

The app is single-owner and ships with **no default credentials**. Pick one:

- `OWNER_PASSWORD=...` — the owner account is created at boot (headless/Docker);
- or leave it unset: the first browser visitor completes a one-time setup
  (`POST /api/setup`, disabled as soon as an owner exists).

Login is password-only (no username). Sessions are opaque tokens in an `HttpOnly`
cookie with sliding 7-day expiry; logout revokes server-side. Login attempts are
rate-limited per IP (10 per 15 min).

> **Never commit** the real `.env` file, the `data/` directory, or anything that looks
> like an OAuth token/session cookie. Logs contain ids and timestamps only.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Server + web in watch mode (parallel) |
| `npm run build` | Build server (`server/dist`) and web (`web/dist`) |
| `npm test` | Run Vitest suites |
| `npm run lint` | ESLint (zero warnings) |
| `npm run typecheck` | `tsc --noEmit` for both workspaces |

## License

[MIT](./LICENSE)

# 09 — Deployment: Windows 11 (primary) + Cloudflare tunnel (Raspberry Pi alternative)

status: in-progress
parent: `main.md`

> **Target change (owner, 2026-10-11):** the deploy target is now a **regular Windows 11
> machine** (the owner's PC) instead of a Raspberry Pi. The Pi path (v1 of this plan)
> remains a documented alternative — `scripts/pi/*` are untouched and still valid.

## Scope

- **Primary target: Windows 11 (x64)** with **Docker Desktop** (WSL2 backend,
  per-user install). Same single `node:26-slim` container, same compose file, same
  image as every other environment — zero app divergence.
- **Reachability + TLS (unchanged from v1):** Cloudflare Tunnel (named tunnel, owner's
  Cloudflare account), public hostname `upwork-mcp.ataadevs.net`. No router port
  forwarding, no DDNS — the tunnel is outbound-only, so it survives public-IP changes
  and PC reboots. Local access stays `http://127.0.0.1:8787` (never LAN-exposed).
- Deliverables:
  1. `scripts/windows/install.ps1` — idempotent bootstrap: host checks (Windows
     10 1903+/11 build, Docker Desktop daemon, compose plugin), `.env` generation
     (first run only, UTF-8 no BOM, best-effort user-only ACL): `APP_SECRET`
     (random 32-byte hex), `OWNER_PASSWORD` (generated, **printed once**),
     `PUBLIC_BASE_URL=https://upwork-mcp.ataadevs.net`, `CLOUDFLARE_TUNNEL_TOKEN`
     (prompted, required — same contract as the Pi script); then `docker compose
     build` + `up -d`, health check, next steps. Never regenerates existing secrets.
  2. `scripts/windows/status.ps1` — containers, reachability info (public IP + DNS
     resolution — informational only), WSL state, disk, memory.
  3. Compose: **no changes needed** — verified for Windows (see D9.2): named volume
     `upwork-data` for SQLite (must stay a named volume — never a Windows bind mount),
     app bound to `127.0.0.1` only, `cloudflared` service under the `tunnel` profile.
- Already implemented in v1 (unchanged, still applies): empty env vars = unset in
  `loadConfig` (+test), compose env pass-through (`OWNER_PASSWORD`,
  `PUBLIC_BASE_URL`, `UPWORK_*`), `.env.example` (tunnel vars).
- Owner auth (plan 02 — no new behavior): single owner, password only, scrypt hash,
  httpOnly session cookie (7-day sliding), login rate limit.
- **Windows caveats (documented in the script header):** the app runs while Docker
  Desktop runs (keep "Start Docker Desktop when you sign in" on — default); while the
  PC sleeps the tunnel is down and `cloudflared` reconnects on wake (outbound-only,
  zero action). Do **not** switch `upwork-data` to a Windows bind mount (CIFS locking
  breaks SQLite — D9.2).
- **Alternative (v1, kept as-is):** Raspberry Pi 4, 64-bit Raspberry Pi OS,
  `scripts/pi/install.sh` + `status.sh` — see "v1 decisions" below.
- Out of scope: Windows auto-start beyond Docker Desktop's own (no service manager /
  scheduled task), host desktop / remote-access setup (owner-managed), backups/restore
  (plan 08), image-size optimization (plan 08).

## Acceptance

- Owner one-time step (unchanged from v1): Cloudflare dashboard → Networking →
  Tunnels → create a tunnel (e.g. `upwork-mcp-ui`) + public hostname
  `upwork-mcp.ataadevs.net`; copy the token.
- Windows 11 PC: Docker Desktop installed (one-time; `install.ps1` prints the exact
  `winget` / `wsl --install` steps when missing), then
  `powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1` (paste token)
  → app healthy.
- `https://upwork-mcp.ataadevs.net` loads from an external device (off-LAN); the full
  OAuth flow works client-side from that device.
- Reboot the PC → Docker Desktop auto-starts (default setting) → both containers
  auto-start (`restart: unless-stopped`), tunnel reconnects.
- `install.ps1` re-run = safe no-op (no secret regeneration); no secrets in logs;
  DoD: build 0 warnings, tests green, lint clean.
- Testing note: no PowerShell runtime in the Linux dev environment — the scripts are
  plain PS 5.1-compatible ASCII and are verified on the owner's machine during
  acceptance (same pattern as the Pi path's scripts).

## Decisions

### D9.2 — v2: target Windows 11 + Docker Desktop (searched 2026-10-11)

Owner request 2026-10-11: deploy on a regular Windows 11 machine instead of the Pi.

| Decision | Choice | Source / rationale |
|---|---|---|
| Runtime | **Docker Desktop (WSL2 backend, per-user install)** | Free for personal use and small business (<250 employees, <$10M revenue); per-user mode is the default (no admin); WSL2 is the default backend (needs WSL ≥ 2.1.5, `wsl --install` on Win 10 1903+/11): https://docs.docker.com/subscription/desktop-license/ · https://docs.docker.com/desktop/setup/install/windows-install/ · https://docs.docker.com/desktop/features/wsl/ |
| Stack | **same image + compose as Pi path** | zero app divergence; one code path across dev / Docker / Pi / Windows |
| SQLite storage | **named volume** `upwork-data` (as in v1) — never a Windows bind mount | a Windows bind mount is CIFS-mounted inside the WSL2 VM; SQLite locking breaks → constant "database is locked": https://github.com/docker/for-win/issues/11 · https://forums.docker.com/t/sqlite-db-locked-when-on-a-windows-volume/13757 · https://danielcosenza.com/posts/wsl-sqlite-filesystem-semantics/ |
| Native Node on Windows (no Docker) | **rejected** | better-sqlite3 v13 ships Node 26 N-API prebuilds for win32-x64 (https://github.com/WiseLibs/better-sqlite3/releases) so it would *install*, but the ops cost wins: an NSSM/WinSW third-party binary to run the app as a service + `cloudflared.exe` as a second Windows service = two processes to keep alive, and it diverges from the Dockerfile/compose/backup story: https://nssm.cc/usage/ |
| Tunnel on Windows | same `cloudflared` compose service (`tunnel --no-autoupdate run --token`) — Cloudflare's documented Docker flow | https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/update-cloudflared/ |
| install.ps1 contract | mirrors `scripts/pi/install.sh`: `.env` created once, tunnel token prompted + required, secrets printed once, idempotent re-run; pure-ASCII script (PS 5.1 reads BOM-less `.ps1` as ANSI), `.env` written UTF-8-no-BOM, best-effort `icacls` user-only ACL | parity with v1 |
| Local-only mode (if remote access is ever unwanted) | not scripted: remove `CLOUDFLARE_TUNNEL_TOKEN` + `COMPOSE_PROFILES` from `.env` → compose runs the app only → `http://127.0.0.1:8787` | one script path |

### D9.1 — v1 decisions: Pi alternative (searched 2026-10-11, unchanged)

| Decision | Choice | Source / rationale |
|---|---|---|
| Pi hardware | **Pi 4** (2 GB min, 4 GB rec); Pi 3 impractical (1 GB RAM, no Node 26 32-bit builds, armhf Docker EOL) | https://nodejs.org/en/blog/migrations/v22-to-v24 · https://docs.docker.com/engine/install/raspberry-pi-os/ |
| Reachability | Cloudflare Tunnel (named tunnel + public hostname) instead of A-record + port forwarding + Caddy: zero router config, no DDNS, no inbound ports | https://developers.cloudflare.com/tunnel/get-started/ · https://developers.cloudflare.com/tunnel/routing/ |
| TLS | Cloudflare edge; app plain HTTP on the Docker network only | same |
| Tunnel auth | dashboard token (one-time paste in install script); no API token in the repo | https://developers.cloudflare.com/tunnel/get-started/ (Docker: `tunnel --no-autoupdate run --token <TOKEN>`) |
| App exposure | app on `127.0.0.1:8787` only; cloudflared reaches it via the compose network | single TLS entry point |
| Owner password | install script generates a random `OWNER_PASSWORD` in `.env`, printed once (empty→in-browser-setup alternative exists, plan 02) | plan 02 |
| Empty env values | treated as unset in `loadConfig` + test | compose env-file behavior |
| Tunnel activation | `profiles: ["tunnel"]` + `COMPOSE_PROFILES=tunnel` in `.env` | https://docs.docker.com/compose/how-tos/profiles/ · https://docs.docker.com/compose/how-tos/environment-variables/envvars/ |
| Fallback (documented only) | Caddy + HTTP-01 + router port forwarding + DDNS systemd timer | https://caddyserver.com/docs/automatic-https · https://developers.cloudflare.com/dns/manage-dns-records/how-to/managing-dynamic-ip-addresses/ |

## Result

- **v1 (2026-10-11, commit 33bed73):** compose cloudflared service (`tunnel` profile,
  token from `.env`, `--no-autoupdate`) + app bound to `127.0.0.1` only; compose env
  pass-through fix (`OWNER_PASSWORD`/`PUBLIC_BASE_URL`/`UPWORK_*` were missing — the
  OAuth callback URI would have defaulted to localhost in docker); `config.ts`
  empty→unset + `loadConfig` test; `scripts/pi/install.sh` + `status.sh`;
  `.env.example` (tunnel vars).
- **v2 (2026-10-11):** plan re-scoped to Windows 11 (D9.2); `scripts/windows/
  install.ps1` + `status.ps1` added; compose unchanged (verified for Windows — named
  volume, `127.0.0.1` bind and tunnel profile are all valid on Docker Desktop/WSL2).
  README intentionally stays deployment-free (owner decision 2026-10-11).
- Pending: acceptance on the owner's Windows 11 PC (Docker Desktop + install run +
  off-LAN check). Pi acceptance no longer required (alternative only).

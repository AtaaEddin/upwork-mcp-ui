# 09 — Raspberry Pi deployment (bootstrap scripts + Cloudflare tunnel)

status: in-progress
parent: `main.md`

## Scope
- Target host: Raspberry Pi 4 (owner hardware — Pi 3 impractical, see decisions),
  64-bit Raspberry Pi OS, 2 GB RAM minimum (4 GB recommended), home network with
  dynamic public IP.
- Reachability + TLS: **Cloudflare Tunnel** (named tunnel, owner's Cloudflare account),
  public hostname `upwork-mcp.ataadevs.net` (owner's domain on Cloudflare). TLS at the
  Cloudflare edge. No router port forwarding, no DDNS — the hostname resolves to
  Cloudflare's edge, the Pi's public IP is irrelevant for reachability.
- Deliverables:
  1. `scripts/pi/install.sh` — idempotent bootstrap: host checks (aarch64, openssl,
     RAM warning), Docker Engine if missing (official Raspberry Pi OS path), `.env`
     generation (0600, first run only): `APP_SECRET` (`openssl rand -hex 32`),
     `OWNER_PASSWORD` (generated, **printed once**), `PUBLIC_BASE_URL=
     https://upwork-mcp.ataadevs.net`, `CLOUDFLARE_TUNNEL_TOKEN` (prompted),
     `COMPOSE_PROFILES=tunnel`; then `docker compose build` + `up -d`, health check,
     next steps. Never regenerates existing secrets.
  2. `scripts/pi/status.sh` — containers, reachability info (public IP + DNS
     resolution — informational only), disk, memory.
  3. Compose: `cloudflared` service (profile `tunnel`, token from `.env`,
     `--no-autoupdate`); app container binds 8787 to `127.0.0.1` only (local health
     checks), no network-exposed port.
  4. Config hardening (found while implementing): empty env vars now mean *unset*
     (compose passes every listed var, including empty ones — before, an empty
     `OWNER_PASSWORD` crashed the app instead of falling back to in-browser setup);
     compose env pass-through fix: only `APP_SECRET`/`DATA_DIR` were passed to the
     container before — `OWNER_PASSWORD` and `PUBLIC_BASE_URL` never reached the app
     (OAuth callback redirect URI would have been the localhost default in docker).
- Owner auth (already implemented in plan 02 — no new behavior): single owner,
  password only (no username — single-owner app by design), scrypt hash; set at deploy
  time via `OWNER_PASSWORD` (what `install.sh` generates) or, when empty, one-time
  in-browser setup; httpOnly session cookie (7-day sliding); login rate limit.
- Fallback (documented, not built): Caddy container + automatic HTTPS (HTTP-01) +
  router port forwarding 80/443 + DDNS systemd timer (5 min, `api.ipify` →
  Cloudflare `PUT /zones/{zone}/dns_records/{id}`) — use if the tunnel is unavailable.
- Out of scope: host desktop / remote-access setup (owner-managed — nothing in repo
  scripts or docs), backups/restore (plan 08), image-size optimization (plan 08).

## Acceptance
- Owner one-time dashboard step: create a tunnel (e.g. `upwork-mcp-ui`) + public
  hostname `upwork-mcp.ataadevs.net`; copy the token.
- Fresh 64-bit Raspberry Pi OS (Pi 4) → one `install.sh` run (paste token) → app
  healthy; `https://upwork-mcp.ataadevs.net` loads from an external device (off-LAN).
- Login with the generated owner password works; full OAuth flow works client-side
  from an external device.
- Reboot the Pi → both containers auto-start (`restart: unless-stopped`), tunnel
  reconnects (outbound-only — survives public-IP changes with zero action).
- `install.sh` re-run = safe no-op (no secret regeneration); `shellcheck` clean;
  no secrets in logs/journal; DoD: build 0 warnings, tests green, lint clean.

## Decisions (searched 2026-10-11)

| Decision | Choice | Source / rationale |
|---|---|---|
| Hardware | **Pi 4** (2 GB min, 4 GB recommended). Pi 3 impractical: 1 GB RAM, and the 32-bit image can't run Node 26 (no 32-bit Linux builds since Node 24; Docker armhf packages EOL at v28). Pi 3B+ on a 64-bit OS is technically arm64 but slow — not recommended | https://nodejs.org/en/blog/migrations/v22-to-v24 · https://docs.docker.com/engine/install/raspberry-pi-os/ · https://www.raspberrypi.com/software/operating-systems/ |
| Reachability | Cloudflare Tunnel (named tunnel + public hostname) instead of A-record + port forwarding + Caddy: zero router config, no DDNS (the "public IP script" is no longer needed), no Let's Encrypt management, works behind any NAT, no inbound ports | https://developers.cloudflare.com/tunnel/get-started/ · https://developers.cloudflare.com/tunnel/routing/ |
| TLS | Cloudflare edge (tunnel); the app stays plain HTTP on the Docker network only | same as above |
| Tunnel auth | dashboard token (one-time paste via `install.sh` prompt); no API token in the repo | https://developers.cloudflare.com/tunnel/get-started/ (Docker: `tunnel --no-autoupdate run --token <TOKEN>`) |
| App exposure | app: `127.0.0.1:8787` only; cloudflared reaches the app via the compose network | single TLS entry point |
| Owner password | `install.sh` generates a random `OWNER_PASSWORD` in `.env` and prints it once (owner: "set when the app is built (docker)"). The empty→in-browser-setup alternative already exists (plan 02) | plan 02 · owner request 2026-10-11 |
| Empty env values | treated as unset in `loadConfig` + test (compose passes every listed var; `""` must mean "default", not an invalid value) | compose env-file behavior · new `loadConfig` test |
| Tunnel activation | `profiles: ["tunnel"]` + `COMPOSE_PROFILES=tunnel` in the Pi `.env` (supported for pre-defined vars via `.env`) — dev without a token simply doesn't run cloudflared | https://docs.docker.com/compose/how-tos/profiles/ · https://docs.docker.com/compose/how-tos/environment-variables/envvars/ |
| Fallback | Caddy + HTTP-01 + DDNS timer, documented only | https://caddyserver.com/docs/automatic-https · https://developers.cloudflare.com/dns/manage-dns-records/how-to/managing-dynamic-ip-addresses/ |

## Result (in progress)
- Implemented 2026-10-11: compose (cloudflared service, `127.0.0.1` bind, env
  pass-through), `config.ts` empty→unset + `loadConfig` test, `scripts/pi/install.sh`,
  `scripts/pi/status.sh`, `.env.example` (`CLOUDFLARE_TUNNEL_TOKEN`,
  `COMPOSE_PROFILES`).
- Pending: acceptance on the owner's Pi 4 (dashboard tunnel + install run).

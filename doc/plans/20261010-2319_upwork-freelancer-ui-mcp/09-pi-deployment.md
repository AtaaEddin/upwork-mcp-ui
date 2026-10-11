# 09 — Raspberry Pi deployment (bootstrap scripts + dynamic DNS + TLS)

status: proposed
parent: `main.md`

## Scope
- Target host: Raspberry Pi (Pi 5 or 4, 64-bit Raspberry Pi OS, ≥ 4 GB RAM) on a home
  network with **dynamic public IP**. Single app container (same image as plan 08) +
  one TLS reverse-proxy container. Owner-owned domain with a dedicated subdomain
  (name/TLD: open question below).
- Deliverables (all idempotent, re-runnable):
  1. `scripts/pi/install.sh` — host bootstrap: Docker Engine per the official Raspberry
     Pi OS docs; then create `DATA_DIR` (0700), generate `.env` from `.env.example`
     (random `APP_SECRET` via `openssl rand -hex 32`, `NODE_ENV=production`,
     `PUBLIC_BASE_URL=https://<subdomain>`), `docker compose build`,
     `docker compose up -d`, health check (`/api/healthz`), print first-run
     instructions (owner password one-time setup in browser).
  2. `scripts/pi/status.sh` — container state, current public IP, IP currently
     published in DNS (via provider API), TLS cert days-to-expiry, `DATA_DIR`
     disk usage.
  3. DDNS: systemd **timer** (`upwork-mcp-ui-ddns.service`/`.timer`, 5 min cadence) —
     fetch public IP (`https://api.ipify.org`, fallback `https://ifconfig.me/ip`),
     compare with last published, on change update the A record via the DNS provider
     API. Credentials in a 0600 file next to `DATA_DIR`, never logged; unit logs only
     "ip changed: yes/no" + timestamp.
  4. TLS: Caddy container (added to the same compose file) in front of the app —
     automatic HTTPS (HTTP-01) for `<subdomain>`, HTTP→HTTPS redirect; router forwards
     80/443 to the Pi (manual router step, documented in the README final pass,
     plan 08). App container binds 8787 to `127.0.0.1` only (Caddy proxies it on the
     Docker network).
- Out of scope: host desktop / remote-access setup (owner-managed host configuration —
  nothing in repo scripts or docs), backups/restore (plan 08), image-size optimization
  (plan 08), Pi power/UPS.

## Acceptance
- Fresh 64-bit Raspberry Pi OS install → one `install.sh` run → app reachable via
  `https://<subdomain>` from an external device (laptop/phone off-LAN); healthz,
  login, first-run setup all work.
- Full OAuth flow works client-side from an external device
  (connect → authorize in the device's own browser → callback → connected).
- DDNS: simulated IP change (test override of the IP source) → A record updates
  within one timer interval; `dig +short <subdomain> A` shows the new IP; no provider
  call when the IP is unchanged.
- Reboot the Pi → container auto-starts (`restart: unless-stopped` already in compose),
  DDNS timer re-enabled (`WantedBy=multi-user.target`).
- `install.sh` re-run is a safe no-op (no duplicate env vars, no secret regeneration).
- No secrets in any log/journal (redaction check on `journalctl` output).
- DoD: `npm run build` 0 warnings · tests green · lint clean; scripts pass `shellcheck`.

## Decisions (searched 2026-10-11)

| Decision | Choice | Source / rationale |
|---|---|---|
| Docker on Pi | official Raspberry Pi OS install path: 64-bit OS + Debian `arm64` packages (32-bit armhf is EOL at Docker v29) | https://docs.docker.com/engine/install/raspberry-pi-os/ |
| Build location | build the image **on the Pi** (arm64 — x86 images don't transfer, QEMU cross-build too slow); record build time, revisit with plan 08 if unacceptable | plan 02 note (build stage compiles better-sqlite3; no Node 26 prebuilds) |
| Public IP detection | `curl -s --max-time 10 https://api.ipify.org`, fallback `https://ifconfig.me/ip` (plain-text answers, no auth) | https://api.ipify.org |
| DDNS scheduler | systemd timer (5 min, `OnBootSec` + `OnUnitActiveSec`), not a cron file — first-class unit, testable, survives reboot | https://www.freedesktop.org/software/systemd/man/systemd.timer.html |
| DNS provider / API | **open** — owner's DNS host for the domain (see open questions). If Cloudflare: official dynamic-IP guide + `PUT /zones/{zone_id}/dns_records/{record_id}` with a Zone:DNS:Edit token | https://developers.cloudflare.com/dns/manage-dns-records/how-to/managing-dynamic-ip-addresses/ · https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/update/ |
| TLS in front | Caddy container, automatic HTTPS (HTTP-01 — works once the DDNS A record points at the Pi); **alternative**: cloudflared tunnel (no port forwarding; requires the domain on Cloudflare) — pick once the DNS provider is known | https://caddyserver.com/docs/automatic-https · https://hub.docker.com/_/caddy |
| App exposure | app container stops publishing 8787 publicly; binds `127.0.0.1:8787`, Caddy is the single public entry point (OAuth callback included) | security: one TLS entry point, no direct API exposure |
| Router step | manual (forward 80/443 to the Pi) — documented in README final pass (plan 08), not scriptable from the host | router-dependent |

## Open questions (owner, 2026-10-11)
1. Where is the domain's DNS hosted (Cloudflare / Namecheap / Porkbun / GoDaddy /
   other)? Can an API token with DNS-edit rights be created?
2. Subdomain + full TLD to use (e.g. `mcp.<domain>`)?
3. Pi model + RAM; powered on 24/7?
4. Accept the registrar's API for A-record updates, or move NS to Cloudflare
   (enables the cloudflared-tunnel alternative and removes port forwarding)?

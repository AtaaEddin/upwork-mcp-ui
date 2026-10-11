#!/usr/bin/env bash
#
# upwork-mcp-ui — Raspberry Pi bootstrap (plan 09).
#
# What it does (idempotent — safe to re-run):
#   1. host checks (64-bit OS, openssl, curl, RAM warning)
#   2. installs Docker Engine if missing (official Raspberry Pi OS path)
#   3. creates .env (first run only): APP_SECRET + OWNER_PASSWORD + tunnel token.
#      Secrets are printed once — save the owner password.
#   4. docker compose build + up (app + Cloudflare tunnel)
#   5. health check + next steps
#
# BEFORE the first run (one time, ~2 minutes, in a browser):
#   Cloudflare dashboard → Networking → Tunnels → Create a tunnel
#   (e.g. name it "upwork-mcp-ui"), add the public hostname
#   upwork-mcp.ataadevs.net, then copy the tunnel token — install.sh asks for it.
set -euo pipefail

SUBDOMAIN='upwork-mcp.ataadevs.net'
APP_URL="https://${SUBDOMAIN}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

warn() { printf '\033[33mWARN: %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

# Re-exec as root (Docker install + file perms; compose runs fine as root here).
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die 'run as root (or prefix with sudo)'
  exec sudo "$0" "$@"
fi

# --- 1. host checks ----------------------------------------------------------
[ "$(uname -m)" = 'aarch64' ] || die "64-bit Raspberry Pi OS required (arch: $(uname -m)). Flash the 64-bit image."
command -v curl >/dev/null 2>&1 || die 'curl not found (apt-get update && apt-get install -y curl)'
command -v openssl >/dev/null 2>&1 || die 'openssl not found (apt-get update && apt-get install -y openssl)'
mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
if [ "${mem_kb:-0}" -lt 2097152 ]; then
  warn 'less than 2 GB RAM — the first docker build will be slow (swap).'
fi

# --- 2. Docker ----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log 'installing Docker Engine (official get.docker.com path for Raspberry Pi OS)'
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die 'docker compose plugin missing — reinstall Docker'

# --- 3. .env -------------------------------------------------------------------
cf_token=''
if [ -f "$ENV_FILE" ]; then
  log '.env exists — validating (existing secrets are never regenerated)'
  grep -Eq '^APP_SECRET=..+' "$ENV_FILE" \
    || die '.env: APP_SECRET missing/empty'
  grep -Eq '^OWNER_PASSWORD=..+' "$ENV_FILE" \
    || die '.env: OWNER_PASSWORD missing/empty (owner password is in .env)'
  grep -Eq '^PUBLIC_BASE_URL=..+' "$ENV_FILE" \
    || die ".env: PUBLIC_BASE_URL missing/empty (expected ${APP_URL})"
  grep -Eq '^CLOUDFLARE_TUNNEL_TOKEN=..+' "$ENV_FILE" \
    || die '.env: CLOUDFLARE_TUNNEL_TOKEN missing/empty (Cloudflare dashboard → Tunnels → copy token)'
  grep -Eq '^COMPOSE_PROFILES=tunnel' "$ENV_FILE" \
    || die '.env: COMPOSE_PROFILES=tunnel missing (tunnel service would not start)'
else
  log 'creating .env (secrets printed once — save the owner password!)'
  app_secret="$(openssl rand -hex 32)"
  owner_password="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')"
  if [ -t 0 ]; then
    printf 'Cloudflare tunnel token (dashboard → Networking → Tunnels → copy token): '
    IFS= read -r cf_token
  fi
  cf_token="$(printf '%s' "${cf_token:-}" | tr -d '[:space:]')"
  [ -n "$cf_token" ] || die 'tunnel token required — create the tunnel in the Cloudflare dashboard first (see the header comments of this script).'
  {
    printf 'NODE_ENV=production\n'
    printf 'APP_SECRET=%s\n' "$app_secret"
    printf 'OWNER_PASSWORD=%s\n' "$owner_password"
    printf 'PUBLIC_BASE_URL=%s\n' "$APP_URL"
    printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$cf_token"
    printf 'COMPOSE_PROFILES=tunnel\n'
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
  printf 'Owner password: %s\n\nSave it now — it is stored in .env and will not be shown again.\n' "$owner_password"
fi

# --- 4. build + run --------------------------------------------------------------
cd "$REPO_ROOT"
log 'building image (first run compiles native modules — takes a while on the Pi)'
docker compose build
log 'starting app + tunnel'
docker compose up -d

# --- 5. health + next steps ------------------------------------------------------
ok=''
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 'http://127.0.0.1:8787/api/healthz' >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ -z "$ok" ]; then
  docker compose logs --tail=50 upwork-mcp-ui >&2 || true
  die 'app did not become healthy within ~60 s — see logs above'
fi

log 'done'
cat <<EOF

Next steps
  1. Owner password (from .env):
       grep '^OWNER_PASSWORD=' .env
  2. Open ${APP_URL} in your browser and log in.
  3. In the app: connect Upwork (one click) — done.

Re-run this script any time to repair/upgrade; re-running never regenerates
existing secrets.
EOF

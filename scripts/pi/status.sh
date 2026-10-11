#!/usr/bin/env bash
#
# upwork-mcp-ui — Pi status (plan 09): containers, reachability, disk, memory.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUBDOMAIN='upwork-mcp.ataadevs.net'

cd "$REPO_ROOT"
[ -f .env ] || { echo 'no .env — run scripts/pi/install.sh first' >&2; exit 1; }

echo '== containers =='
docker compose ps

echo
echo "== reachability (informational — the tunnel needs no public IP) =="
ip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 10 https://ifconfig.me/ip || true)"
echo "public IP (this Pi): ${ip:-unknown}"
hosts="$(getent hosts "$SUBDOMAIN" || true)"
echo "hostname ${SUBDOMAIN} → ${hosts:-does not resolve yet}"

echo
echo '== resources =='
df -h "$REPO_ROOT" | tail -1
free -h | awk 'NR<=2'

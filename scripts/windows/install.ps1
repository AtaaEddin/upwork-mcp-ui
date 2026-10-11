#Requires -Version 5.1
<#
upwork-mcp-ui - Windows 11 bootstrap (plan 09).

What it does (idempotent - safe to re-run):
  1. host checks (Windows 10 1903+/11, Docker Desktop daemon, compose plugin)
  2. creates .env (first run only): APP_SECRET + OWNER_PASSWORD + tunnel token.
     Secrets are printed once - save the owner password.
  3. docker compose build + up (app + Cloudflare tunnel)
  4. health check + next steps

BEFORE the first run (one time, ~2 minutes, in a browser):
  Cloudflare dashboard -> Networking -> Tunnels -> Create a tunnel
  (e.g. name it "upwork-mcp-ui"), add the public hostname
  upwork-mcp.ataadevs.net, then copy the tunnel token - install.ps1 asks for it.

Notes:
  - The app runs while Docker Desktop runs. Keep Docker Desktop's
    "Start Docker Desktop when you sign in" setting on (default).
  - The SQLite data lives in the Docker named volume "upwork-data"
    (managed by Docker - do NOT re-point it to a Windows folder;
    Windows bind mounts break SQLite file locking).

Usage:
  powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1
#>
$ErrorActionPreference = 'Stop'

$Subdomain = 'upwork-mcp.ataadevs.net'
$AppUrl    = "https://${Subdomain}"
$LocalUrl  = 'http://127.0.0.1:8787'
$RepoRoot  = Split-Path -Parent $PSScriptRoot
$EnvFile   = Join-Path $RepoRoot '.env'

function Log([string]$Msg)     { Write-Host ''; Write-Host "==> $Msg" }
function WarnMsg([string]$Msg) { Write-Host "WARN: $Msg" -ForegroundColor Yellow }
function Fail([string]$Msg)    { Write-Host "ERROR: $Msg" -ForegroundColor Red; exit 1 }

function New-RandomHex([int]$ByteCount) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $bytes = New-Object byte[] $ByteCount
    $rng.GetBytes($bytes)
    return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
  }
  finally { $rng.Dispose() }
}

function New-RandomPassword([int]$Length) {
  # unambiguous charset (no 0/o, 1/l/i)
  $charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $bytes = New-Object byte[] $Length
    $rng.GetBytes($bytes)
    $chars = New-Object char[] $Length
    for ($i = 0; $i -lt $Length; $i++) { $chars[$i] = $charset[$bytes[$i] % $charset.Length] }
    return -join $chars
  }
  finally { $rng.Dispose() }
}

function Write-EnvFile([string]$Path, [string]$Content) {
  # UTF-8 without BOM (docker compose reads it cleanly; BOM would break KEY=value)
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

# --- 1. host checks -------------------------------------------------------------
$os = Get-CimInstance Win32_OperatingSystem
if ([int]$os.BuildNumber -lt 18362) {
  Fail "Windows 10 1903+ or Windows 11 required (found build $($os.BuildNumber))."
}

$dockerOk = $true
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  $dockerOk = $false
}
else {
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { $dockerOk = $false }
}
if (-not $dockerOk) {
  Fail @"
Docker Desktop is not installed or is not running.
  1. Install it:  winget install -e --id Docker.DockerDesktop
     (or: https://www.docker.com/products/docker-desktop/)
  2. If WSL is not set up yet:  wsl --install   (admin prompt, then reboot)
  3. Start Docker Desktop (Settings -> General -> start with Windows).
  4. Re-run this script.
"@
}

& docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Fail 'docker compose plugin missing - reinstall Docker Desktop.' }

# --- 2. .env ----------------------------------------------------------------------
if (Test-Path $EnvFile) {
  Log '.env exists - validating (existing secrets are never regenerated)'
  $envText = [System.IO.File]::ReadAllText($EnvFile)
  foreach ($key in 'APP_SECRET', 'OWNER_PASSWORD', 'PUBLIC_BASE_URL', 'CLOUDFLARE_TUNNEL_TOKEN') {
    if ($envText -notmatch "(?m)^${key}=\S") { Fail ".env: $key missing or empty" }
  }
  if ($envText -notmatch '(?m)^COMPOSE_PROFILES=tunnel') {
    Fail '.env: COMPOSE_PROFILES=tunnel missing (the tunnel service would not start)'
  }
}
else {
  Log 'creating .env (secrets printed once - save the owner password!)'
  $appSecret     = New-RandomHex 32
  $ownerPassword = New-RandomPassword 20
  if ([Console]::IsInputRedirected) {
    Fail 'run this interactively - the Cloudflare tunnel token is asked on the console'
  }
  $cfToken = (Read-Host 'Cloudflare tunnel token (dashboard -> Networking -> Tunnels -> copy token)').Trim()
  if ($cfToken -eq '') {
    Fail 'tunnel token required - create the tunnel in the Cloudflare dashboard first (see the header comments of this script)'
  }
  $envContent = @"
NODE_ENV=production
APP_SECRET=$appSecret
OWNER_PASSWORD=$ownerPassword
PUBLIC_BASE_URL=$AppUrl
CLOUDFLARE_TUNNEL_TOKEN=$cfToken
COMPOSE_PROFILES=tunnel
"@
  Write-EnvFile $EnvFile $envContent
  # best effort: .env readable by the current user only
  try {
    icacls $EnvFile /inheritance:r /grant:r "${env:USERNAME}:(R)" *> $null
  }
  catch { WarnMsg 'could not restrict .env ACLs - lock the file down manually if this PC is shared' }
  Write-Host "Owner password: $ownerPassword" -ForegroundColor Green
  Write-Host 'Save it now - it is stored in .env and will not be shown again.'
}

# --- 3. build + run -----------------------------------------------------------------
Set-Location $RepoRoot
Log 'building image (first run compiles native modules - takes a while)'
& docker compose build
if ($LASTEXITCODE -ne 0) { Fail 'docker compose build failed' }
Log 'starting app + tunnel'
& docker compose up -d
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed' }

# --- 4. health + next steps ------------------------------------------------------------
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "$LocalUrl/api/healthz" -UseBasicParsing -TimeoutSec 3
    if ([int]$resp.StatusCode -eq 200) { $ok = $true; break }
  }
  catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) {
  & docker compose logs --tail 50 upwork-mcp-ui
  Fail 'app did not become healthy within ~60 s - see logs above'
}

Log 'done'
Write-Host @"

Next steps
  1. Open $AppUrl in your browser and log in
     (owner password: printed once above, or stored in .env).
  2. In the app: connect Upwork (one click) - done.
  Local access also works at any time: $LocalUrl

Re-run this script any time to repair/upgrade; re-running never regenerates
existing secrets.
"@

#Requires -Version 5.1
<#
upwork-mcp-ui - Windows status (plan 09): containers, reachability, WSL, disk, memory.
Usage:
  powershell -ExecutionPolicy Bypass -File scripts\windows\status.ps1
#>
$ErrorActionPreference = 'Stop'

$Subdomain = 'upwork-mcp.ataadevs.net'
$RepoRoot  = Split-Path -Parent $PSScriptRoot

Set-Location $RepoRoot
if (-not (Test-Path '.env')) {
  Write-Host 'no .env - run scripts\windows\install.ps1 first' -ForegroundColor Red
  exit 1
}

Write-Host '== containers =='
& docker compose ps

Write-Host ''
Write-Host '== reachability (informational - the tunnel needs no public IP) =='
$ip = $null
try { $ip = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 10) }
catch {
  try { $ip = (Invoke-RestMethod -Uri 'https://ifconfig.me/ip' -TimeoutSec 10) } catch { }
}
if ($ip) { Write-Host "public IP (this PC): $ip" } else { Write-Host 'public IP (this PC): unknown' }
try {
  $dns = Resolve-DnsName -Name $Subdomain -Type A -ErrorAction Stop | Select-Object -First 1
  Write-Host "hostname $Subdomain -> $($dns.IPAddress)"
}
catch {
  Write-Host "hostname $Subdomain -> does not resolve yet"
}

Write-Host ''
Write-Host '== WSL =='
if (Get-Command wsl -ErrorAction SilentlyContinue) {
  & wsl -l -v
}
else {
  Write-Host 'wsl not found'
}

Write-Host ''
Write-Host '== resources =='
$driveName = $RepoRoot -replace ':.*', ''
$drive = Get-PSDrive $driveName
$sizeGB = [math]::Round(($drive.Used + $drive.Free) / 1GB, 0)
$freeGB = [math]::Round($drive.Free / 1GB, 0)
Write-Host "disk ${driveName}: ${freeGB} GB free of ${sizeGB} GB"
$os = Get-CimInstance Win32_OperatingSystem
$memFreeGB  = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$memTotalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
Write-Host "memory: ${memFreeGB} GB free of ${memTotalGB} GB"

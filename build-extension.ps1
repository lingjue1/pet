# Builds the Coopanion extension tarball (npm pack).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ext = Join-Path $root 'extension'
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Push-Location $ext
try {
    & npm.cmd pack --pack-destination $dist
} finally {
    Pop-Location
}
Write-Host "packed into $dist"

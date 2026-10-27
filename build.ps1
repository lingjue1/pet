# Builds the TinyPastureBridge mod zip.
#
# Godot Mod Loader requires the archive to contain:
#   mods-unpacked/<namespace>-<name>/manifest.json
#   mods-unpacked/<namespace>-<name>/mod_main.gd
# and the entry names must use forward slashes (Compress-Archive writes
# backslashes on Windows, which the loader cannot parse as directories).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $root 'mod\mods-unpacked\Coopanion-TinyPastureBridge'
$dist = Join-Path $root 'dist'
$manifest = Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version_number
$modId = "$($manifest.namespace)-$($manifest.name)"
$zip = Join-Path $dist "$modId-$version.zip"

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$files = Get-ChildItem $src -File | Select-Object -ExpandProperty Name
$stream = [System.IO.File]::Open($zip, [System.IO.FileMode]::CreateNew)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
foreach ($file in $files) {
    $entry = $archive.CreateEntry("mods-unpacked/$modId/$file", [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $src $file))
    $entryStream.Write($bytes, 0, $bytes.Length)
    $entryStream.Close()
}
$archive.Dispose()
$stream.Close()

Write-Host "built $zip"

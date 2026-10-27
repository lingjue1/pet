# Builds both deliverables: the Godot mod zip and the Coopanion extension tarball.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $root 'build.ps1')
& (Join-Path $root 'build-extension.ps1')
Get-ChildItem (Join-Path $root 'dist') -File | Select-Object Name, Length

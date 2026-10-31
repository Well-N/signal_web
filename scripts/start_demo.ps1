$ErrorActionPreference = "Stop"
$env:SIGNALWEB_DEMO = "1"
Set-Location (Join-Path $PSScriptRoot "..\web")
npm run dev

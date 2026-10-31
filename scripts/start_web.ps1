$ErrorActionPreference = "Stop"
$env:SIGNALWEB_DEMO = "0"
Set-Location (Join-Path $PSScriptRoot "..\web")
npm run dev

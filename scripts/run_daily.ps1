$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$pipeline = Resolve-Path (Join-Path $PSScriptRoot "..\pipeline")
Set-Location $pipeline

if (-not (Test-Path ".env")) {
    throw "缺少 pipeline/.env。请复制 .env.signalweb.example 为 .env，并填写 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL。"
}

python -m uv run horizon --hours 24
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$exportPath = Join-Path $pipeline "data\export\latest.json"
if (-not (Test-Path $exportPath)) {
    throw "流水线结束但没有生成 latest.json，请检查日志。"
}

Write-Host ""
Write-Host "导出完成：$exportPath" -ForegroundColor Green

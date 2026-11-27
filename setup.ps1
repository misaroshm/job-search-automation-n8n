# One-time setup for Windows (PowerShell):
# creates credentials from .env, imports all workflows, starts everything.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "Created .env - fill it in (see docs/SETUP.uk.md) and run .\setup.ps1 again."
  exit 1
}
if (-not (Test-Path setup/google-service-account.json)) {
  Write-Host "Missing setup/google-service-account.json (Google service account key). See docs/SETUP.uk.md."
  exit 1
}

Write-Host "-> Downloading images"
docker compose pull

Write-Host "-> Importing credentials and workflows into n8n"
docker compose run --rm --no-deps --entrypoint sh n8n -c "set -e; node /setup/make-credentials.js /tmp/credentials.json; n8n import:credentials --input=/tmp/credentials.json; rm -f /tmp/credentials.json; n8n import:workflow --separate --input=/workflows; for id in jtErrorHandler01 jtVacancySearch1 jtDailyDigest001 jtRejections0001 jtTelegramBot001; do n8n publish:workflow --id=`$id; done"

Write-Host "-> Starting n8n"
docker compose up -d --remove-orphans

Write-Host ""
Write-Host "Done. Open http://localhost:5678 and create your n8n account."
Write-Host "Then write /start to your Telegram bot."

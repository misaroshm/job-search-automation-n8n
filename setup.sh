#!/usr/bin/env bash
# One-time setup (and re-run after updating workflows):
# creates credentials from .env, imports all workflows, starts everything.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — fill it in (see docs/SETUP.uk.md) and run ./setup.sh again."
  exit 1
fi
if [ ! -f setup/google-service-account.json ]; then
  echo "Missing setup/google-service-account.json (Google service account key). See docs/SETUP.uk.md."
  exit 1
fi

echo "→ Downloading images"
docker compose pull

echo "→ Importing credentials and workflows into n8n"
docker compose run --rm --no-deps --entrypoint sh n8n -c '
  set -e
  node /setup/make-credentials.js /tmp/credentials.json
  n8n import:credentials --input=/tmp/credentials.json
  rm -f /tmp/credentials.json
  n8n import:workflow --separate --input=/workflows
  # publish (activate); the bot last, because it calls the other workflows
  for id in jtErrorHandler01 jtVacancySearch1 jtDailyDigest001 jtRejections0001 jtTelegramBot001; do n8n publish:workflow --id=$id; done
'

echo "→ Starting n8n"
docker compose up -d --remove-orphans

echo
echo "Done. Open http://localhost:5678 and create your n8n account."
echo "Then write /start to your Telegram bot."

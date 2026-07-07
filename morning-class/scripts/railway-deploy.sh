#!/usr/bin/env bash
# Railway deploy — run from morning-class/: bash scripts/railway-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

RAILWAY="npx @railway/cli"
SA_FILE="../server/service-account.json"

echo "=== Railway login check ==="
if ! $RAILWAY whoami 2>/dev/null; then
  echo "Run: npx @railway/cli login"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing morning-class/.env — cp .env.example .env"
  exit 1
fi
if [[ ! -f "$SA_FILE" ]]; then
  echo "Missing $SA_FILE"
  exit 1
fi

# shellcheck disable=SC1091
source .env

echo "=== Link project (creates salt-morning-class if new) ==="
if [[ ! -f .railway/project.json ]]; then
  $RAILWAY init --name salt-morning-class
fi

echo "=== Deploy ==="
$RAILWAY up --detach

echo "=== Environment variables ==="
$RAILWAY variables set \
  "SPREADSHEET_ID=${SPREADSHEET_ID}" \
  "TIMEZONE=${TIMEZONE:-Asia/Seoul}" \
  "AUTH_SECRET=${AUTH_SECRET:-salt-morning-$(openssl rand -hex 16)}"

$RAILWAY variables set "GOOGLE_SERVICE_ACCOUNT_JSON=$(tr -d '\n' < "$SA_FILE")"

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  $RAILWAY variables set "GEMINI_API_KEY=${GEMINI_API_KEY}"
fi

echo "=== Redeploy with env ==="
$RAILWAY redeploy --yes 2>/dev/null || $RAILWAY up --detach

echo "=== Public domain ==="
$RAILWAY domain 2>/dev/null || echo "Dashboard → Settings → Networking → Generate Domain"

echo ""
echo "Health: https://<your-domain>.up.railway.app/api/health"

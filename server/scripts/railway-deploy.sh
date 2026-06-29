#!/usr/bin/env bash
# Railway 배포 스크립트 — server/ 에서 실행: bash scripts/railway-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

RAILWAY="npx @railway/cli"

echo "=== Railway login check ==="
if ! $RAILWAY whoami 2>/dev/null; then
  echo "Run: npx @railway/cli login"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env"
  exit 1
fi
if [[ ! -f service-account.json ]]; then
  echo "Missing service-account.json"
  exit 1
fi

# shellcheck disable=SC1091
source .env

echo "=== Init / link project (skip if already linked) ==="
if [[ ! -f .railway/project.json ]] && [[ ! -f ../.railway/project.json ]]; then
  $RAILWAY init --name mrpark-class-api
fi

echo "=== Deploy (creates service if needed) ==="
$RAILWAY up --detach

echo "=== Set environment variables ==="
$RAILWAY variables set \
  "SPREADSHEET_ID=${SPREADSHEET_ID:-1XNZYW16PWijfNZPe3knwLnTw5Be_x_BoCeL3G1WO7jg}" \
  "TIMEZONE=${TIMEZONE:-Asia/Seoul}" \
  "GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}" \
  "GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET}" \
  "GOOGLE_OAUTH_REFRESH_TOKEN=${GOOGLE_OAUTH_REFRESH_TOKEN}" \
  "CORS_ORIGINS=https://script.google.com"

# JSON은 별도 설정 (특수문자)
$RAILWAY variables set "GOOGLE_SERVICE_ACCOUNT_JSON=$(cat service-account.json | tr -d '\n')"

echo "=== Redeploy with env ==="
$RAILWAY redeploy --yes 2>/dev/null || $RAILWAY up --detach

echo "=== Public domain ==="
$RAILWAY domain 2>/dev/null || echo "Railway dashboard → Settings → Networking → Generate Domain"

echo ""
echo "Done. Copy the *.up.railway.app URL to Apps Script NODE_API_URL"

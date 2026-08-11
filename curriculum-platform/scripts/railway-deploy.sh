#!/usr/bin/env bash
# Railway deploy — run from curriculum-platform/: bash scripts/railway-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

RAILWAY="npx --yes @railway/cli"

echo "=== Railway login check ==="
if ! $RAILWAY whoami 2>/dev/null; then
  echo "Run: npx @railway/cli login"
  exit 1
fi

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-curricumap}"
# Prefer known production project (avoids creating a duplicate empty "curricumap")
PROJECT_ID="${RAILWAY_PROJECT_ID:-b110a25c-5edc-4f01-bd78-1f4f405b5ab9}"
SERVICE_NAME="${RAILWAY_SERVICE_NAME:-curricumap}"

echo "=== Link project: $PROJECT_NAME ($PROJECT_ID) ==="
$RAILWAY link -p "$PROJECT_ID" -s "$SERVICE_NAME" -e production 2>/dev/null || $RAILWAY link -p "$PROJECT_ID" || true

AUTH_SECRET_VAL="${AUTH_SECRET:-curricumap-$(openssl rand -hex 16)}"
PORTAL_KEY_VAL="${PORTAL_API_KEY:-dev-portal-key}"
CRON_SECRET_VAL="${CRON_SECRET:-cron-$(openssl rand -hex 12)}"

echo "=== Set environment variables ==="
$RAILWAY variables set --service "$SERVICE_NAME" \
  "NODE_ENV=production" \
  "CURRICULUM_STORE=seed" \
  "SCHEDULE_STORE=memory" \
  "AUTH_SECRET=${AUTH_SECRET_VAL}" \
  "PORTAL_API_KEY=${PORTAL_KEY_VAL}" \
  "CRON_SECRET=${CRON_SECRET_VAL}" \
  "GEMINI_MODEL_PRO=gemini-2.5-pro" \
  "GEMINI_MODEL_FLASH=gemini-2.5-flash" \
  "GEMINI_MODEL=gemini-2.5-flash"

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  $RAILWAY variables set --service "$SERVICE_NAME" "GEMINI_API_KEY=${GEMINI_API_KEY}"
fi

echo "=== Deploy ==="
$RAILWAY up --detach --service "$SERVICE_NAME"

echo "=== Public domain ==="
$RAILWAY domain --service "$SERVICE_NAME" 2>/dev/null || echo "Dashboard → Settings → Networking → Generate Domain"

echo ""
echo "Health: https://curricumap-production.up.railway.app/api/health"
echo "App:    https://curricumap-production.up.railway.app/"

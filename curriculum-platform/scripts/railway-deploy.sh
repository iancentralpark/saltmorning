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

echo "=== Link / create project: $PROJECT_NAME ==="
if [[ ! -f .railway/project.json ]]; then
  # Prefer linking an existing project named curricumap; else create
  if $RAILWAY project list 2>/dev/null | grep -qi "$PROJECT_NAME"; then
    $RAILWAY link --project "$PROJECT_NAME" || true
  fi
fi
if [[ ! -f .railway/project.json ]]; then
  $RAILWAY init --name "$PROJECT_NAME" || $RAILWAY link
fi

AUTH_SECRET_VAL="${AUTH_SECRET:-curricumap-$(openssl rand -hex 16)}"
PORTAL_KEY_VAL="${PORTAL_API_KEY:-dev-portal-key}"
CRON_SECRET_VAL="${CRON_SECRET:-cron-$(openssl rand -hex 12)}"

echo "=== Set environment variables ==="
$RAILWAY variables set \
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
  $RAILWAY variables set "GEMINI_API_KEY=${GEMINI_API_KEY}"
fi

echo "=== Deploy ==="
$RAILWAY up --detach

echo "=== Public domain ==="
$RAILWAY domain 2>/dev/null || echo "Dashboard → Settings → Networking → Generate Domain"

echo ""
echo "Health: https://<domain>/api/health"
echo "App:    https://<domain>/"

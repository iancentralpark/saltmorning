#!/usr/bin/env bash
# Safe Salt Morning production deploy — GitHub main only. Never railway up.
set -euo pipefail
cd "$(dirname "$0")/.."

RAILWAY="npx @railway/cli"
PROJECT_ID="37e18dd4-072b-49df-ab3b-315e9ea29dcf"
SERVICE="salt-morning-class"

# Prefer project token (RAILWAY_TOKEN) or account/workspace token (RAILWAY_API_TOKEN).
# Project tokens cannot run `whoami` / `link`; they already target one environment.
if [[ -n "${RAILWAY_TOKEN:-}" ]]; then
  echo "=== Auth: RAILWAY_TOKEN (project token) ==="
elif [[ -n "${RAILWAY_API_TOKEN:-}" ]]; then
  echo "=== Auth: RAILWAY_API_TOKEN ==="
  if ! $RAILWAY whoami >/dev/null 2>&1; then
    echo "RAILWAY_API_TOKEN is set but not authorized."
    exit 1
  fi
  echo "=== Link mrpark-class-api / salt-morning-class ==="
  $RAILWAY link -p "$PROJECT_ID" -e production -s "$SERVICE" >/dev/null 2>&1 || true
elif $RAILWAY whoami >/dev/null 2>&1; then
  echo "=== Auth: CLI login session ==="
  echo "=== Link mrpark-class-api / salt-morning-class ==="
  $RAILWAY link -p "$PROJECT_ID" -e production -s "$SERVICE" >/dev/null 2>&1 || true
else
  echo "No Railway auth. Set Cursor secret RAILWAY_TOKEN (project token for mrpark-class-api / production),"
  echo "or RAILWAY_API_TOKEN, or run: npx @railway/cli login"
  exit 1
fi

echo "=== Deploy from GitHub source (main) ==="
$RAILWAY redeploy --from-source -y --service "$SERVICE"

echo "=== Done. Verify: curl -s https://www.saltmorning.study/api/health | jq .reportCardPrintVersion ==="

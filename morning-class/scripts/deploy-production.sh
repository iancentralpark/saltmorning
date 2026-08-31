#!/usr/bin/env bash
# Safe Salt Morning production deploy — GitHub main only. Never railway up.
set -euo pipefail
cd "$(dirname "$0")/.."

RAILWAY="npx @railway/cli"
PROJECT_ID="37e18dd4-072b-49df-ab3b-315e9ea29dcf"
SERVICE="salt-morning-class"

echo "=== Railway login ==="
if ! $RAILWAY whoami >/dev/null 2>&1; then
  echo "Run: npx @railway/cli login"
  exit 1
fi

echo "=== Link mrpark-class-api / salt-morning-class ==="
$RAILWAY link -p "$PROJECT_ID" -e production -s "$SERVICE" >/dev/null 2>&1 || true

echo "=== Deploy from GitHub source (main) ==="
$RAILWAY redeploy --from-source -y --service "$SERVICE"

echo "=== Done. Verify: curl -s https://www.saltmorning.study/api/health | jq .reportCardPrintVersion ==="

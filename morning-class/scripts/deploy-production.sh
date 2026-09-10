#!/usr/bin/env bash
# Safe Salt Morning production deploy — GitHub main only. Never railway up.
set -euo pipefail
cd "$(dirname "$0")/.."

RAILWAY="npx @railway/cli"
PROJECT_ID="37e18dd4-072b-49df-ab3b-315e9ea29dcf"
ENVIRONMENT_ID="119640d2-7f85-4691-9216-75c0a24e45d0"
SERVICE_ID="a77855e7-6d45-4bcb-8191-e68c1dc16147"
SERVICE="salt-morning-class"

# Workspace / account API tokens can deploy via GraphQL but cannot run `whoami`.
# Prefer GraphQL when any token is present so Cursor agents don't need interactive login.
deploy_via_graphql() {
  local token="$1"
  local label="$2"
  echo "=== Auth: $label (GraphQL serviceInstanceDeploy) ==="
  local resp
  resp=$(curl -sS -X POST https://backboard.railway.com/graphql/v2 \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" \
    -d "{\"query\":\"mutation { serviceInstanceDeploy(serviceId: \\\"${SERVICE_ID}\\\", environmentId: \\\"${ENVIRONMENT_ID}\\\", latestCommit: true) }\"}")
  if echo "$resp" | grep -q '"serviceInstanceDeploy": *true'; then
    echo "  Triggered deploy of salt-morning-class from latest GitHub source (main)."
    return 0
  fi
  echo "GraphQL deploy failed:"
  echo "$resp"
  return 1
}

if [[ -n "${RAILWAY_API_TOKEN:-}" ]]; then
  deploy_via_graphql "$RAILWAY_API_TOKEN" "RAILWAY_API_TOKEN" || exit 1
elif [[ -n "${RAILWAY_TOKEN:-}" ]]; then
  # Project tokens often work as Bearer too; if not, fall through to CLI.
  if ! deploy_via_graphql "$RAILWAY_TOKEN" "RAILWAY_TOKEN"; then
    echo "=== Fallback: CLI redeploy with RAILWAY_TOKEN ==="
    $RAILWAY redeploy --from-source -y \
      -p "$PROJECT_ID" -e production -s "$SERVICE"
  fi
elif $RAILWAY whoami >/dev/null 2>&1; then
  echo "=== Auth: CLI login session ==="
  echo "=== Link mrpark-class-api / salt-morning-class ==="
  $RAILWAY link -p "$PROJECT_ID" -e production -s "$SERVICE" >/dev/null 2>&1 || true
  echo "=== Deploy from GitHub source (main) ==="
  $RAILWAY redeploy --from-source -y --service "$SERVICE"
else
  echo "No Railway auth. Set Cursor secret RAILWAY_API_TOKEN (workspace API token),"
  echo "or RAILWAY_TOKEN, or run: npx @railway/cli login"
  exit 1
fi

echo "=== Done. Verify: curl -s https://www.saltmorning.study/api/health | jq .gradesStorage ==="

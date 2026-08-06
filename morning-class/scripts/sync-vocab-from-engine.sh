#!/usr/bin/env bash
# Sync Vocab Booster student UI from Mr.Park engine repo (same UX on Salt).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENGINE_PUBLIC="${VOCAB_ENGINE_PUBLIC:-$ROOT/../my-script/server/public}"
if [[ ! -f "$ENGINE_PUBLIC/js/vocab-learn.js" ]]; then
  ENGINE_PUBLIC="${1:-}"
fi
if [[ -z "${ENGINE_PUBLIC}" || ! -f "$ENGINE_PUBLIC/js/vocab-learn.js" ]]; then
  echo "Usage: sync-vocab-from-engine.sh /path/to/mrpark/server/public"
  exit 1
fi
cp "$ENGINE_PUBLIC/js/vocab-learn.js" "$ROOT/morning-class/public/js/vocab-learn.js"
cp "$ENGINE_PUBLIC/css/vocab-learn.css" "$ROOT/morning-class/public/css/vocab-learn.css"
echo "Synced vocab-learn.js + css from $ENGINE_PUBLIC"
echo "Remember: Salt student API is thin-proxy to /api/vocab/v1 — no vendor logic."

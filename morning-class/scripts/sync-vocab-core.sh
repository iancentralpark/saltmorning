#!/usr/bin/env bash
# Copy Mr. Park Vocab Booster core into Morning Class vendor (same DB/system).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/morning-class/src/vendor/mrpark-vocab"
mkdir -p "$DEST"
for f in vocabLearningService.js vocabPlacementService.js vocabClozeUtils.js vocabJunkFilter.js supabaseClient.js; do
  cp "$ROOT/server/src/$f" "$DEST/$f"
done
echo "Synced vocab core -> $DEST"
echo "Stubs (geminiService, luckyDrawService, dollarService, homeworkService, supabaseStudentService) are not overwritten."

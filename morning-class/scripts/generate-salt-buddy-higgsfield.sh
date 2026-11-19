#!/usr/bin/env bash
# Generate Salt buddy talking/emotion loops via Higgsfield image-to-video.
# Requires: HF_API_KEY_ID + HF_API_KEY_SECRET (or HF_CREDENTIALS=ID:SECRET)
# Does NOT print credentials. Downloads into public/img/salt-buddy/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/img/salt-buddy"
mkdir -p "$OUT" /tmp/salt-buddy-hf

if [[ -n "${HF_CREDENTIALS:-}" ]]; then
  AUTH_KEY="$HF_CREDENTIALS"
elif [[ -n "${HF_API_KEY_ID:-}" && -n "${HF_API_KEY_SECRET:-}" ]]; then
  AUTH_KEY="${HF_API_KEY_ID}:${HF_API_KEY_SECRET}"
elif [[ -n "${HIGGSFIELD_API_KEY_ID:-}" && -n "${HIGGSFIELD_API_KEY_SECRET:-}" ]]; then
  AUTH_KEY="${HIGGSFIELD_API_KEY_ID}:${HIGGSFIELD_API_KEY_SECRET}"
else
  echo "Missing Higgsfield credentials. Set HF_API_KEY_ID and HF_API_KEY_SECRET." >&2
  exit 1
fi

IMG_URL="${SALT_BUDDY_IMAGE_URL:-https://www.saltmorning.study/img/salt-buddy/idle-512.png}"
# Cheap short loops; override with HF_I2V_URL if needed.
ENDPOINT="${HF_I2V_URL:-https://api.higgsfield.ai/minimax/hailuo-2.3/standard/image-to-video}"
DURATION="${HF_DURATION:-6}"

submit() {
  local name="$1" prompt="$2"
  local idem
  idem="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  local body
  body="$(python3 - <<PY
import json
print(json.dumps({
  "prompt": """$prompt""",
  "image_url": "$IMG_URL",
  "duration": int("$DURATION"),
  "prompt_optimizer": True,
}))
PY
)"
  echo "Submitting $name…"
  local resp
  resp="$(curl -sS --fail-with-body \
    -X POST "$ENDPOINT" \
    -H "Authorization: Key ${AUTH_KEY}" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: ${idem}" \
    -d "$body")"
  local status_url request_id
  status_url="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["status_url"])' <<<"$resp")"
  request_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["request_id"])' <<<"$resp")"
  echo "  queued $request_id"
  local i=0 st="" video_url=""
  while true; do
    i=$((i + 1))
    sleep 8
    local st_json
    st_json="$(curl -sS --fail-with-body \
      -H "Authorization: Key ${AUTH_KEY}" \
      "$status_url")"
    st="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' <<<"$st_json")"
    echo "  [$i] $st"
    case "$st" in
      completed)
        video_url="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("video") or {}).get("url") or "")' <<<"$st_json")"
        if [[ -z "$video_url" ]]; then
          echo "completed but no video.url: $st_json" >&2
          exit 1
        fi
        break
        ;;
      failed|nsfw|canceled)
        echo "generation $st: $st_json" >&2
        exit 1
        ;;
    esac
    if [[ $i -gt 90 ]]; then
      echo "timeout waiting for $name" >&2
      exit 1
    fi
  done
  local mp4="/tmp/salt-buddy-hf/${name}.mp4"
  curl -sS -L --fail -o "$mp4" "$video_url"
  # Square-ish buddy frame, muted loop-friendly encode
  ffmpeg -y -i "$mp4" -an -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:white" \
    -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/${name}-loop.mp4" </dev/null
  ffmpeg -y -i "$OUT/${name}-loop.mp4" -an -c:v libvpx-vp9 -b:v 0 -crf 36 \
    "$OUT/${name}-loop.webm" </dev/null
  # Poster still from mid frame
  ffmpeg -y -ss 1 -i "$OUT/${name}-loop.mp4" -frames:v 1 "$OUT/${name}.png" </dev/null
  echo "  wrote $OUT/${name}-loop.{mp4,webm} + ${name}.png"
}

# Keep character identity; no slogan text; rubber-hose cartoon motion.
NEG="text overlay, watermark, logo text, SALT ACADEMY, Spice Up Your English, realistic human, 3d render, morphing identity"

submit talking "Vintage 1930s rubber-hose cartoon mascot: white lumpy salt crystal character with pie-cut eyes, yellow boots, standing on an open blue-and-yellow book, holding a yellow SALT pennant. Locked camera, plain white background. The character talks to the viewer: mouth opens and closes in a clear speaking loop, slight head bob, subtle arm gesture. Keep the exact same character design and colors. No new text on screen. Loop-friendly motion."
submit listening "Same vintage rubber-hose salt crystal mascot on an open book, white background, locked camera. Listening pose: leans slightly forward, eyes widen attentively, soft blink, small nod, one glove hand cups near ear. Mouth stays mostly closed with tiny smile. No on-screen slogan text. Loop-friendly."
submit thinking "Same vintage rubber-hose salt crystal mascot on an open book, white background, locked camera. Thinking: eyes glance up, eyebrows knit lightly, small head tilt, one glove hand to chin, gentle idle sway. Mouth closed. No slogan text. Loop-friendly."
submit happy "Same vintage rubber-hose salt crystal mascot on an open book, white background, locked camera. Happy celebration: big open smile, cheerful bounce, wave with free glove hand, flag wiggles slightly. Keep character identity. No slogan text. Loop-friendly."

# Alias talking as the default speaking loop used by the page
cp -f "$OUT/talking-loop.mp4" "$OUT/talking-loop.mp4.bak" 2>/dev/null || true
echo "Done. Assets in $OUT"

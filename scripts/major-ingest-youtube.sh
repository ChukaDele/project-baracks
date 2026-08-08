#!/usr/bin/env bash
set -euo pipefail

URL="${1:-}"
OUT="${2:-}"
LANGS="${3:-${MAJOR_SUB_LANGS:-en.*,en}}"

if [ -z "$URL" ]; then
  echo "Usage: $0 <youtube-url> [output-dir] [subtitle-languages]" >&2
  exit 2
fi

command -v yt-dlp >/dev/null 2>&1 || {
  echo "ERROR: yt-dlp is required. Run scripts/setup-major-knowledge-tools.sh install" >&2
  exit 3
}
command -v mw >/dev/null 2>&1 || {
  echo "ERROR: MacWhisper CLI 'mw' is required. Install it in MacWhisper > Settings > Advanced." >&2
  exit 3
}

if [ -z "$OUT" ]; then
  ID="$(yt-dlp --no-playlist --print '%(id)s' "$URL" 2>/dev/null | head -n 1 || true)"
  [ -n "$ID" ] || ID="youtube-$(date +%Y%m%d-%H%M%S)"
  OUT="$(pwd)/.major-ingest/$ID"
fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

COOKIE_ARGS=()
if [ -n "${MAJOR_YTDLP_BROWSER:-}" ]; then
  COOKIE_ARGS=(--cookies-from-browser "$MAJOR_YTDLP_BROWSER")
fi

fetch_metadata() {
  yt-dlp --no-playlist --dump-single-json "$URL" > "$OUT/source-metadata.json" 2>"$OUT/metadata.stderr" && return 0
  if [ "${#COOKIE_ARGS[@]}" -gt 0 ]; then
    yt-dlp "${COOKIE_ARGS[@]}" --no-playlist --dump-single-json "$URL" > "$OUT/source-metadata.json" 2>"$OUT/metadata.stderr" && return 0
  fi
  return 1
}

fetch_captions() {
  rm -f "$OUT"/caption.* "$OUT"/caption.*.* 2>/dev/null || true
  yt-dlp \
    --no-playlist \
    --skip-download \
    --write-subs \
    --write-auto-subs \
    --sub-langs "$LANGS" \
    --sub-format 'json3/vtt/best' \
    -o "$OUT/caption.%(ext)s" \
    "$URL" >"$OUT/captions.stdout" 2>"$OUT/captions.stderr" || true

  if find "$OUT" -maxdepth 1 -type f \( -name 'caption*.json3' -o -name 'caption*.vtt' \) | grep -q .; then
    return 0
  fi

  if [ "${#COOKIE_ARGS[@]}" -gt 0 ]; then
    yt-dlp \
      "${COOKIE_ARGS[@]}" \
      --no-playlist \
      --skip-download \
      --write-subs \
      --write-auto-subs \
      --sub-langs "$LANGS" \
      --sub-format 'json3/vtt/best' \
      -o "$OUT/caption.%(ext)s" \
      "$URL" >>"$OUT/captions.stdout" 2>>"$OUT/captions.stderr" || true
  fi

  find "$OUT" -maxdepth 1 -type f \( -name 'caption*.json3' -o -name 'caption*.vtt' \) | grep -q .
}

normalize_caption() {
  CAPTION="$(find "$OUT" -maxdepth 1 -type f -name 'caption*.json3' -print -quit)"
  if [ -z "$CAPTION" ]; then
    CAPTION="$(find "$OUT" -maxdepth 1 -type f -name 'caption*.vtt' -print -quit)"
  fi
  [ -n "$CAPTION" ] || return 1

  python3 - "$CAPTION" "$OUT/transcript.txt" <<'PY'
from pathlib import Path
import html, json, re, sys

src = Path(sys.argv[1])
out = Path(sys.argv[2])
lines = []

if src.suffix == '.json3':
    data = json.loads(src.read_text(errors='replace'))
    for event in data.get('events', []):
        text = ''.join(seg.get('utf8', '') for seg in event.get('segs', []))
        text = html.unescape(text).replace('\n', ' ').strip()
        if text:
            lines.append(text)
else:
    timestamp = re.compile(r'^\d{2}:\d{2}(?::\d{2})?[\.,]\d{3}\s+-->')
    tag = re.compile(r'<[^>]+>')
    for raw in src.read_text(errors='replace').splitlines():
        s = raw.strip()
        if not s or s == 'WEBVTT' or s.startswith(('Kind:', 'Language:', 'NOTE')):
            continue
        if timestamp.search(s) or s.isdigit():
            continue
        s = html.unescape(tag.sub('', s)).strip()
        if s:
            lines.append(s)

# YouTube auto-captions can repeat adjacent rolling cues. Keep the later/new text
# only when the line is identical; do not aggressively rewrite the source.
clean = []
for line in lines:
    if not clean or line != clean[-1]:
        clean.append(line)

out.write_text('\n'.join(clean).strip() + '\n')
PY

  printf '%s' "$CAPTION" > "$OUT/caption-source-path.txt"
}

fetch_audio_and_transcribe() {
  rm -f "$OUT"/media.* 2>/dev/null || true

  if ! yt-dlp --no-playlist -f 'bestaudio/best' -o "$OUT/media.%(ext)s" "$URL" >"$OUT/audio.stdout" 2>"$OUT/audio.stderr"; then
    if [ "${#COOKIE_ARGS[@]}" -eq 0 ]; then
      return 1
    fi
    yt-dlp "${COOKIE_ARGS[@]}" --no-playlist -f 'bestaudio/best' -o "$OUT/media.%(ext)s" "$URL" >>"$OUT/audio.stdout" 2>>"$OUT/audio.stderr"
  fi

  MEDIA="$(find "$OUT" -maxdepth 1 -type f -name 'media.*' -print -quit)"
  [ -n "$MEDIA" ] || return 1

  if ! mw transcribe "$MEDIA" --format txt --language auto --no-speakers -o "$OUT/transcript.txt" --overwrite 2>"$OUT/macwhisper.stderr"; then
    cat "$OUT/macwhisper.stderr" >&2 || true
    echo "ERROR: MacWhisper transcription failed. If the error mentions a sandbox, run this command outside the coding-agent sandbox." >&2
    return 1
  fi
  printf '%s' "$MEDIA" > "$OUT/media-source-path.txt"
}

fetch_metadata || true
METHOD=""
if fetch_captions && normalize_caption && [ -s "$OUT/transcript.txt" ]; then
  METHOD="yt-dlp-captions"
else
  rm -f "$OUT/transcript.txt"
  if fetch_audio_and_transcribe && [ -s "$OUT/transcript.txt" ]; then
    METHOD="yt-dlp-audio+macwhisper-local"
  else
    echo "ERROR: Could not obtain captions or transcribe downloaded audio." >&2
    if [ -z "${MAJOR_YTDLP_BROWSER:-}" ]; then
      echo "If authentication is required, set MAJOR_YTDLP_BROWSER (for example: chrome) and retry." >&2
    fi
    exit 4
  fi
fi

python3 - "$URL" "$METHOD" "$OUT" <<'PY'
from pathlib import Path
from datetime import datetime, timezone
import json, sys

url, method, out_dir = sys.argv[1:]
out = Path(out_dir)
metadata = {}
meta = out / 'source-metadata.json'
if meta.exists():
    try:
        raw = json.loads(meta.read_text())
        metadata = {
            'id': raw.get('id'),
            'title': raw.get('title'),
            'channel': raw.get('channel') or raw.get('uploader'),
            'duration': raw.get('duration'),
            'webpage_url': raw.get('webpage_url') or url,
        }
    except Exception:
        pass

provenance = {
    'source_url': url,
    'source_type': 'youtube',
    'primary_source': True,
    'ingestion_method': method,
    'retrieved_at': datetime.now(timezone.utc).isoformat(),
    'metadata': metadata,
    'transcript_path': str(out / 'transcript.txt'),
}
(out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
PY

WORDS="$(wc -w < "$OUT/transcript.txt" | tr -d ' ')"
echo "YouTube ingestion complete"
echo "Method: $METHOD"
echo "Transcript: $OUT/transcript.txt"
echo "Provenance: $OUT/provenance.json"
echo "Words: $WORDS"

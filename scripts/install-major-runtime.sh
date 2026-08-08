#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
MAJOR_HOME="$HOME/.major"
LEGACY_PLIST="$HOME/Library/LaunchAgents/com.chuka.major-supervisor.plist"

mkdir -p "$BIN_DIR" "$MAJOR_HOME/logs"

cd "$ROOT"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm build

cat > "$BIN_DIR/major" <<EOF
#!/bin/sh
exec node "$ROOT/dist/entry.js" "\$@"
EOF
chmod +x "$BIN_DIR/major"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.zshrc" 2>/dev/null; then
    printf '\n# Major global CLI\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.zshrc"
  fi
  export PATH="$BIN_DIR:$PATH"
fi

bash "$ROOT/scripts/install-major-global-rules.sh"

mkdir -p "$HOME/.claude"
python3 - "$HOME/.claude/settings.json" "$BIN_DIR/major" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
major = sys.argv[2]
try:
    data = json.loads(path.read_text()) if path.exists() and path.read_text().strip() else {}
except Exception:
    data = {}
hooks = data.setdefault("hooks", {})
session = hooks.setdefault("SessionStart", [])
command = f'"{major}" session hook --host claude'
entry = {"matcher": "startup|resume|clear|compact", "hooks": [{"type": "command", "command": command}]}
filtered = []
for item in session:
    text = json.dumps(item)
    if ("major" in text and "session" in text and "attach" in text) or "session hook --host claude" in text:
        continue
    filtered.append(item)
filtered.append(entry)
hooks["SessionStart"] = filtered
path.write_text(json.dumps(data, indent=2) + "\n")
PY

# Pilot posture: no auto-start daemon and no global Ruflo attachment.
launchctl bootout "gui/$UID/com.chuka.major-supervisor" >/dev/null 2>&1 || true
rm -f "$LEGACY_PLIST"

if [ "${MAJOR_INSTALL_ANTIGRAVITY:-0}" = "1" ] && command -v python3 >/dev/null 2>&1; then
  if [ ! -x "$MAJOR_HOME/antigravity-venv/bin/python" ]; then
    python3 -m venv "$MAJOR_HOME/antigravity-venv"
  fi
  "$MAJOR_HOME/antigravity-venv/bin/python" -m pip install --quiet --upgrade pip google-antigravity || \
    echo "WARN: Antigravity SDK install failed; Major will route around this worker until fixed."
fi

cat <<EOF
Major v0.4 pilot control plane installed.

CLI:        $BIN_DIR/major
State:      $MAJOR_HOME/supervisor-state.json
Policies:   $MAJOR_HOME/project-policies.json
Kill switch:$MAJOR_HOME/STOP
Claude:     deterministic SessionStart attach installed
Codex:      global Major rules installed
Cursor:     global Major rules installed
Antigravity:global Major rules installed

PILOT GUARANTEES:
- Major is present by default, but no login daemon is started.
- Unknown projects default to observe-only.
- Ruflo is NOT attached globally.
- Observe mode cannot dispatch workers.
- Three consecutive independent shadow-plan passes are required before assist mode.
- Assist mode is foreground-only, max 3 workers, max 30 minutes per coordinator run, no paid spend or external writes by default.

Open a new shell or run:
  export PATH="$BIN_DIR:\$PATH"

First JSS shadow pilot:
  major project configure jss-tool --class workshop --trust observe
  major run jss-tool --goal "Ship the smallest credible end-to-end JSS MVP"

Surface Talent isolation:
  major project configure surface-talent --class client --trust observe

Emergency stop:
  major stop

Resume after inspection:
  major start
EOF

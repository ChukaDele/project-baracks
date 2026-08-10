#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
MAJOR_HOME="$HOME/.major"
LEGACY_PLIST="$HOME/Library/LaunchAgents/com.chuka.major-supervisor.plist"
RELEASE_RECORD="$MAJOR_HOME/installed-release.json"

mkdir -p "$BIN_DIR" "$MAJOR_HOME/logs"

cd "$ROOT"

if [ "${MAJOR_ALLOW_DIRTY_INSTALL:-0}" != "1" ] && [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "ERROR: refusing to install Major from a dirty checkout." >&2
  echo "Commit/stash/remove local changes first, or set MAJOR_ALLOW_DIRTY_INSTALL=1 only for an intentional local pilot." >&2
  exit 1
fi

INSTALL_SHA="$(git rev-parse HEAD)"
INSTALL_BRANCH="$(git branch --show-current 2>/dev/null || true)"
INSTALL_BRANCH="${INSTALL_BRANCH:-detached}"
INSTALL_VERSION="$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync('package.json','utf8')).version)")"

corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

echo "Running Major release gate before installation..."
bash scripts/validate-major.sh
if [ -f scripts/validate-major-stability.sh ]; then
  bash scripts/validate-major-stability.sh
fi
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Only replace the active runtime after every release check passes.
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

# Pilot posture: no auto-start daemon. Foreground build mode is the normal active-work posture;
# unattended/background execution remains a separate explicit trust level.
launchctl bootout "gui/$UID/com.chuka.major-supervisor" >/dev/null 2>&1 || true
rm -f "$LEGACY_PLIST"

# Ruflo is NOT attached globally. It remains optional and project-scoped.

if [ "${MAJOR_INSTALL_ANTIGRAVITY:-0}" = "1" ] && command -v python3 >/dev/null 2>&1; then
  if [ ! -x "$MAJOR_HOME/antigravity-venv/bin/python" ]; then
    python3 -m venv "$MAJOR_HOME/antigravity-venv"
  fi
  "$MAJOR_HOME/antigravity-venv/bin/python" -m pip install --quiet --upgrade pip google-antigravity || \
    echo "WARN: Antigravity SDK install failed; Major will route around this worker until fixed."
fi

python3 - "$RELEASE_RECORD" "$INSTALL_VERSION" "$INSTALL_SHA" "$INSTALL_BRANCH" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path(sys.argv[1])
record = {
    "version": sys.argv[2],
    "sha": sys.argv[3],
    "branch": sys.argv[4],
    "installedAt": datetime.now(timezone.utc).isoformat(),
    "releaseGate": "passed",
}
path.write_text(json.dumps(record, indent=2) + "\n")
PY

cat <<EOF
Major v${INSTALL_VERSION} control plane installed from validated source.

CLI:        $BIN_DIR/major
Release:    $INSTALL_SHA ($INSTALL_BRANCH)
Record:     $RELEASE_RECORD
State:      $MAJOR_HOME/supervisor-state.json
Policies:   $MAJOR_HOME/project-policies.json
Kill switch:$MAJOR_HOME/STOP
Claude:     deterministic SessionStart attach installed
Codex:      global Major rules installed
Cursor:     global Major rules installed
Antigravity:global Major rules installed

NORMAL WORK MODE:
- Major is present by default across supported agent tools.
- The owner can explicitly fast-track trusted projects to foreground build mode.
- build = up to 6 useful workers, 120-minute coordinator ceiling, no repeated shadow/assist ceremony.
- --allow-external-writes authorizes normal project writes such as branches, PRs, previews and already-authorized integrations.
- client projects remain isolated from cross-project/global memory even in build mode.
- no new paid spend, destructive production-data changes, credential/ownership/DNS changes, or production security-policy changes without explicit authority.
- unattended/background mode is still separate from foreground build mode.

Owner-approved JSS working mode:
  major project configure jss-tool --class workshop --trust build --owner-approved --allow-external-writes

Owner-approved Surface Talent working mode:
  major project configure surface-talent --class client --trust build --owner-approved --allow-external-writes

Optional evidence-first mode for any new/untrusted project:
  major project configure <project> --class unknown --trust observe

Then work normally in a fresh Claude/Codex/Cursor session opened inside each repo.
No "start Major" prompt is required.

Emergency stop:
  major stop

Resume after inspection:
  major start
EOF

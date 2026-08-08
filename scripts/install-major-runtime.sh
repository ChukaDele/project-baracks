#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
MAJOR_HOME="$HOME/.major"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
PLIST="$LAUNCH_DIR/com.chuka.major-supervisor.plist"
RUFLO_VERSION="${RUFLO_VERSION:-3.34.0}"

mkdir -p "$BIN_DIR" "$MAJOR_HOME/logs" "$LAUNCH_DIR"

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

# Google Antigravity SDK worker pool. Kept in an isolated Major venv.
if command -v python3 >/dev/null 2>&1; then
  if [ ! -x "$MAJOR_HOME/antigravity-venv/bin/python" ]; then
    python3 -m venv "$MAJOR_HOME/antigravity-venv"
  fi
  "$MAJOR_HOME/antigravity-venv/bin/python" -m pip install --quiet --upgrade pip google-antigravity || \
    echo "WARN: Antigravity SDK install failed; Major will route around this worker until fixed."
fi

# Existing global rules plus Major default-supervisor instructions.
bash "$ROOT/scripts/install-major-global-rules.sh"

# Claude has a real per-session lifecycle hook, so attach deterministically on startup/resume.
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
# Remove earlier Major hook variants and keep exactly one current attach hook.
filtered = []
for item in session:
    text = json.dumps(item)
    if "major" in text and "session" in text and "attach" in text or "session hook --host claude" in text:
        continue
    filtered.append(item)
filtered.append(entry)
hooks["SessionStart"] = filtered
path.write_text(json.dumps(data, indent=2) + "\n")
PY

# Ruflo remains the shared swarm/memory substrate available to all hosts.
if command -v claude >/dev/null 2>&1; then
  claude mcp get ruflo >/dev/null 2>&1 || \
    claude mcp add ruflo --scope user -- npx -y "ruflo@$RUFLO_VERSION" mcp start || true
fi
if command -v codex >/dev/null 2>&1; then
  codex mcp add ruflo -- npx -y "ruflo@$RUFLO_VERSION" mcp start >/dev/null 2>&1 || true
fi

# Cursor and Antigravity global MCP definitions. Merge without deleting unrelated servers.
python3 - "$HOME/.cursor/mcp.json" "$HOME/.gemini/config/mcp_config.json" "$RUFLO_VERSION" <<'PY'
import json
import sys
from pathlib import Path

for raw in sys.argv[1:3]:
    path = Path(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(path.read_text()) if path.exists() and path.read_text().strip() else {}
    except Exception:
        data = {}
    servers = data.setdefault("mcpServers", {})
    servers["ruflo"] = {"command": "npx", "args": ["-y", f"ruflo@{sys.argv[3]}", "mcp", "start"]}
    path.write_text(json.dumps(data, indent=2) + "\n")
PY

# Persistent supervisor daemon starts at login and is kept alive by launchd.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.chuka.major-supervisor</string>
  <key>ProgramArguments</key>
  <array><string>$BIN_DIR/major</string><string>supervisor</string><string>daemon</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>StandardOutPath</key><string>$MAJOR_HOME/logs/supervisor.out.log</string>
  <key>StandardErrorPath</key><string>$MAJOR_HOME/logs/supervisor.err.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$BIN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH</string></dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID/com.chuka.major-supervisor" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/com.chuka.major-supervisor" >/dev/null 2>&1 || true

cat <<EOF
Major default supervisor runtime installed.

CLI:        $BIN_DIR/major
State:      $MAJOR_HOME/supervisor-state.json
Daemon:     com.chuka.major-supervisor
Claude:     deterministic SessionStart attach installed
Codex:      global Major rules + Ruflo MCP
Cursor:     global Major rules + Ruflo MCP
Antigravity: global Major rules + Ruflo MCP + SDK worker pool (when SDK auth is available)

Open a new shell or run:
  export PATH="$BIN_DIR:\$PATH"

Acceptance test:
  major status
  major run jss-tool --goal "Ship the smallest credible end-to-end JSS MVP" --autonomous
  major status jss-tool
EOF

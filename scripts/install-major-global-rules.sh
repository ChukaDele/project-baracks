#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLOBAL_SRC="$MAJOR_ROOT/guidance/global-worker-rules.md"
GLOBAL_TEXT="$(cat "$GLOBAL_SRC")"

mkdir -p "$HOME/.major" "$HOME/.claude" "${CODEX_HOME:-$HOME/.codex}" "$HOME/.gemini"
cp "$GLOBAL_SRC" "$HOME/.major/global-worker-rules.md"

# Claude Code: global user memory imports one Major-managed file.
CLAUDE_RULE="$HOME/.claude/major-global.md"
CLAUDE_ROOT="$HOME/.claude/CLAUDE.md"
cp "$GLOBAL_SRC" "$CLAUDE_RULE"
touch "$CLAUDE_ROOT"

# Remove the older Major communication-only import if this machine used the v0 installer.
python3 - "$CLAUDE_ROOT" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text() if p.exists() else ''
text = text.replace('\n# Major global communication style\n@~/.claude/major-communication.md\n', '\n')
text = text.replace('@~/.claude/major-communication.md\n', '')
p.write_text(text.rstrip() + '\n' if text.strip() else '')
PY
if ! grep -Fq '@~/.claude/major-global.md' "$CLAUDE_ROOT"; then
  printf '\n# Major global worker rules\n@~/.claude/major-global.md\n' >> "$CLAUDE_ROOT"
fi
rm -f "$HOME/.claude/major-communication.md"

install_managed_block() {
  local target="$1"
  mkdir -p "$(dirname "$target")"
  touch "$target"
  python3 - "$target" "$GLOBAL_SRC" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
rules = Path(sys.argv[2]).read_text().strip()
text = path.read_text() if path.exists() else ''

# Clean the older communication-only managed block if present.
old_start = '<!-- MAJOR-COMMUNICATION-START -->'
old_end = '<!-- MAJOR-COMMUNICATION-END -->'
if old_start in text and old_end in text:
    text = text.split(old_start, 1)[0].rstrip() + '\n\n' + text.split(old_end, 1)[1].lstrip()

start = '<!-- MAJOR-GLOBAL-START -->'
end = '<!-- MAJOR-GLOBAL-END -->'
block = f'{start}\n{rules}\n{end}'
if start in text and end in text:
    before = text.split(start, 1)[0].rstrip()
    after = text.split(end, 1)[1].lstrip()
    text = '\n\n'.join(x for x in [before, block, after] if x)
else:
    text = (text.rstrip() + '\n\n' + block).lstrip()
path.write_text(text.rstrip() + '\n')
PY
}

# Codex: global user instructions.
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_RULE="$CODEX_DIR/AGENTS.md"
install_managed_block "$CODEX_RULE"

# Google Antigravity: global rules across workspaces.
GEMINI_RULE="$HOME/.gemini/GEMINI.md"
install_managed_block "$GEMINI_RULE"

cat <<EOF
Major global worker rules installed for:
- Claude Code: $CLAUDE_RULE imported by $CLAUDE_ROOT
- Codex: $CODEX_RULE
- Antigravity: $GEMINI_RULE

Cursor:
- Major-managed projects inherit the contract through AGENTS.md.
- Cursor global User Rules are configured in Cursor Settings.
- The canonical text is: $HOME/.major/global-worker-rules.md
EOF

# macOS convenience: copy canonical rules for Cursor User Rules.
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$GLOBAL_TEXT" | pbcopy
  echo "Copied Major global worker rules to the clipboard for Cursor User Rules."
fi

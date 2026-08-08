#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STYLE_SRC="$MAJOR_ROOT/guidance/communication-style.md"
STYLE_TEXT="$(cat "$STYLE_SRC")"

mkdir -p "$HOME/.major" "$HOME/.claude" "${CODEX_HOME:-$HOME/.codex}" "$HOME/.gemini"
cp "$STYLE_SRC" "$HOME/.major/communication-style.md"

# Claude Code: use the documented global user-memory file and import a managed style file.
CLAUDE_STYLE="$HOME/.claude/major-communication.md"
CLAUDE_ROOT="$HOME/.claude/CLAUDE.md"
cp "$STYLE_SRC" "$CLAUDE_STYLE"
touch "$CLAUDE_ROOT"
if ! grep -Fq '@~/.claude/major-communication.md' "$CLAUDE_ROOT"; then
  printf '\n# Major global communication style\n@~/.claude/major-communication.md\n' >> "$CLAUDE_ROOT"
fi

# Codex: $CODEX_HOME/AGENTS.md participates in global user instructions.
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_RULE="$CODEX_DIR/AGENTS.md"
mkdir -p "$CODEX_DIR"
touch "$CODEX_RULE"
python3 - "$CODEX_RULE" "$STYLE_SRC" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
style = Path(sys.argv[2]).read_text()
text = path.read_text() if path.exists() else ""
start = "<!-- MAJOR-COMMUNICATION-START -->"
end = "<!-- MAJOR-COMMUNICATION-END -->"
block = f"{start}\n{style}\n{end}"
if start in text and end in text:
    before = text.split(start, 1)[0].rstrip()
    after = text.split(end, 1)[1].lstrip()
    text = "\n\n".join(x for x in [before, block, after] if x)
else:
    text = (text.rstrip() + "\n\n" + block).lstrip()
path.write_text(text.rstrip() + "\n")
PY

# Google Antigravity: documented global rule file across workspaces.
GEMINI_RULE="$HOME/.gemini/GEMINI.md"
touch "$GEMINI_RULE"
python3 - "$GEMINI_RULE" "$STYLE_SRC" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
style = Path(sys.argv[2]).read_text()
text = path.read_text() if path.exists() else ""
start = "<!-- MAJOR-COMMUNICATION-START -->"
end = "<!-- MAJOR-COMMUNICATION-END -->"
block = f"{start}\n{style}\n{end}"
if start in text and end in text:
    before = text.split(start, 1)[0].rstrip()
    after = text.split(end, 1)[1].lstrip()
    text = "\n\n".join(x for x in [before, block, after] if x)
else:
    text = (text.rstrip() + "\n\n" + block).lstrip()
path.write_text(text.rstrip() + "\n")
PY

cat <<EOF
Major communication style installed for:
- Claude Code: $CLAUDE_STYLE imported by $CLAUDE_ROOT
- Codex: $CODEX_RULE
- Antigravity: $GEMINI_RULE

Cursor:
- Major-managed projects should receive the same style through project AGENTS.md/.cursor rules.
- Cursor's documented global User Rules are configured in Cursor Settings rather than a stable public file path.
- The canonical text to paste there is: $HOME/.major/communication-style.md
EOF

# macOS convenience: copy the canonical rule to clipboard for Cursor User Rules.
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$STYLE_TEXT" | pbcopy
  echo "Copied Major communication style to the clipboard for Cursor User Rules."
fi

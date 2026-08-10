#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLOBAL_SRC="$MAJOR_ROOT/guidance/global-worker-rules.md"
INTERNAL_SKILLS_SRC="$MAJOR_ROOT/skills/internal"
GLOBAL_SKILLS_DEST="$HOME/.major/skills/internal"

mkdir -p "$HOME/.major" "$HOME/.claude" "${CODEX_HOME:-$HOME/.codex}" "$HOME/.gemini" "$HOME/.cursor/rules/major-global"
cp "$GLOBAL_SRC" "$HOME/.major/global-worker-rules.md"

# Canonical cross-project Major skills. This path is Major-owned, so converge it
# to the current repository rather than leaving stale copies behind.
rm -rf "$GLOBAL_SKILLS_DEST"
mkdir -p "$GLOBAL_SKILLS_DEST"
for skill_dir in "$INTERNAL_SKILLS_SRC"/*; do
  [ -d "$skill_dir" ] || continue
  cp -R "$skill_dir" "$GLOBAL_SKILLS_DEST/$(basename "$skill_dir")"
done

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

# Cursor: local file-backed global rule. Cursor cloud User Rules are a separate
# settings surface and are not mutated by this installer.
CURSOR_RULE="$HOME/.cursor/rules/major-global/RULE.md"
cp "$GLOBAL_SRC" "$CURSOR_RULE"

SKILL_COUNT="$(find "$GLOBAL_SKILLS_DEST" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
cat <<EOF
Major global worker rules installed for:
- Claude Code: $CLAUDE_RULE imported by $CLAUDE_ROOT
- Codex: $CODEX_RULE
- Antigravity: $GEMINI_RULE
- Cursor local global rule: $CURSOR_RULE
- Canonical Major internal skills: $GLOBAL_SKILLS_DEST ($SKILL_COUNT skills)

Cursor note:
- This terminal-installed rule is local to this Mac.
- Cursor's cloud-synced User Rules are a separate Settings surface and are not changed.
- Major-managed projects also inherit the same contract through project AGENTS.md.
EOF

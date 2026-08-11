#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STABILITY_SRC="$MAJOR_ROOT/guidance/stability-invariants.md"
GLOBAL_SKILLS_DEST="$HOME/.major/skills/internal"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/major-global-rules.XXXXXX")"
LEARNING_MIGRATION_LOCK="$HOME/.major/learning/.migration.lock"
LEARNING_LOCK_HELD=0

cleanup() {
  rm -rf "$STAGE_DIR"
  if [ "$LEARNING_LOCK_HELD" = "1" ]; then
    rm -f "$LEARNING_MIGRATION_LOCK"
  fi
}
trap cleanup EXIT

mkdir -p "$HOME/.major/learning"
if ! (set -C; : > "$LEARNING_MIGRATION_LOCK") 2>/dev/null; then
  echo "ERROR: refusing to install Major rules while another learning migration is active." >&2
  exit 1
fi
LEARNING_LOCK_HELD=1

MANIFEST="$(python3 "$MAJOR_ROOT/scripts/stage-major-user-state.py" \
  --root "$MAJOR_ROOT" \
  --stage "$STAGE_DIR/user-state")"
python3 "$MAJOR_ROOT/scripts/activate-major-user-state.py" --manifest "$MANIFEST"
LEARNING_LOCK_HELD=0

SKILL_COUNT="$(find "$GLOBAL_SKILLS_DEST" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
cat <<EOF
Major global worker rules installed transactionally for:
- Claude Code: $HOME/.claude/major-global.md imported by $HOME/.claude/CLAUDE.md
- Codex: ${CODEX_HOME:-$HOME/.codex}/AGENTS.md
- Antigravity: $HOME/.gemini/GEMINI.md
- Cursor local global rule: $HOME/.cursor/rules/major-global/RULE.md
- Canonical Major internal skills: $GLOBAL_SKILLS_DEST ($SKILL_COUNT skills)
- Stability invariants: $STABILITY_SRC

Cursor note:
- This terminal-installed rule is local to this Mac.
- Cursor's cloud-synced User Rules are a separate Settings surface and are not changed.
- Major-managed projects also inherit the same contract through project AGENTS.md.
EOF

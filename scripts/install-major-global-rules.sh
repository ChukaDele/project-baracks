#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STABILITY_SRC="$MAJOR_ROOT/guidance/stability-invariants.md"
GLOBAL_SKILLS_DEST="$HOME/.major/skills/internal"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/major-global-rules.XXXXXX")"
LEARNING_MIGRATION_LOCK="$HOME/.major/learning/.migration.lock"
LEARNING_LOCK_HELD=0
RULES_RECORD="$STAGE_DIR/installed-global-rules.json"
cd "$MAJOR_ROOT"

if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "ERROR: refusing to install Major rules from a dirty checkout." >&2
  exit 1
fi

INSTALL_SHA="$(git rev-parse HEAD)"
INSTALL_BRANCH="$(git branch --show-current 2>/dev/null || true)"
INSTALL_BRANCH="${INSTALL_BRANCH:-detached}"
if [ "$INSTALL_BRANCH" != "main" ]; then
  echo "ERROR: refusing to install Major rules from branch '$INSTALL_BRANCH'." >&2
  exit 1
fi
git fetch --quiet origin main
if [ "$INSTALL_SHA" != "$(git rev-parse refs/remotes/origin/main)" ]; then
  echo "ERROR: refusing to install Major rules because local HEAD is not current origin/main." >&2
  exit 1
fi

python3 - "$RULES_RECORD" "$INSTALL_SHA" "$INSTALL_BRANCH" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path(sys.argv[1])
path.write_text(
    json.dumps(
        {
            "sha": sys.argv[2],
            "branch": sys.argv[3],
            "installedAt": datetime.now(timezone.utc).isoformat(),
            "preflightBypasses": [],
        },
        indent=2,
    )
    + "\n"
)
PY

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
  --stage "$STAGE_DIR/user-state" \
  --global-rules-record "$RULES_RECORD")"
python3 "$MAJOR_ROOT/scripts/activate-major-user-state.py" --manifest "$MANIFEST"
rm -f "$LEARNING_MIGRATION_LOCK"
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

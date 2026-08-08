#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$(pwd)}"
PROFILE="${2:-core}"
FEATURES="${3:-}"
TEMPLATES="$MAJOR_ROOT/templates/project"

mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

copy_if_missing() {
  local src="$1" dest="$2"
  if [ ! -e "$dest" ]; then cp "$src" "$dest"; echo "created: ${dest#$TARGET/}"; fi
}

# Canonical project docs: create only when missing. Existing project truth is preserved.
for name in PROJECT.md GOAL_STATE.md STATUS.md LEARNINGS.md QUALITY.md DISCOVERY.md ARCHITECTURE.md SKILLS.md; do
  copy_if_missing "$TEMPLATES/$name" "$TARGET/$name"
done
if [ "$PROFILE" = "web-ui" ] || [ "$PROFILE" = "exploratory" ] || [ "$PROFILE" = "full" ]; then
  copy_if_missing "$TEMPLATES/DESIGN.md" "$TARGET/DESIGN.md"
fi

# AGENTS.md is provider-neutral. Preserve custom content and maintain one idempotent Major block.
AGENTS="$TARGET/AGENTS.md"
CORE="$TEMPLATES/major-core.md"
python3 - "$AGENTS" "$CORE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1]); core = Path(sys.argv[2]).read_text().strip()
text = path.read_text() if path.exists() else ""
start = "<!-- MAJOR-CORE-START -->"; end = "<!-- MAJOR-CORE-END -->"
block = f"{start}\n{core}\n{end}"
if start in text and end in text:
    before = text.split(start,1)[0].rstrip(); after = text.split(end,1)[1].lstrip()
    text = "\n\n".join(x for x in [before, block, after] if x)
else:
    text = (text.rstrip() + "\n\n" + block).lstrip()
path.write_text(text.rstrip()+"\n")
PY

# Claude adapter imports the provider-neutral project contract; preserve other Claude instructions.
CLAUDE="$TARGET/CLAUDE.md"
touch "$CLAUDE"
if ! grep -Fq '@AGENTS.md' "$CLAUDE"; then
  printf '\n# Major project contract\n@AGENTS.md\n' >> "$CLAUDE"
fi

# Antigravity workspace rule. Global Antigravity rules are installed separately.
mkdir -p "$TARGET/.agents/rules"
cp "$CORE" "$TARGET/.agents/rules/major-project.md"

# Install the native skill profile and remove stale previously-Major-managed skill copies.
bash "$MAJOR_ROOT/scripts/install-major-skills.sh" "$TARGET" "$PROFILE" "$FEATURES"

echo "Major project bootstrap complete"
echo "Project: $TARGET"
echo "Profile: $PROFILE"
echo "Features: ${FEATURES:-none}"
echo "Next: replace template placeholders with current project truth, then start the P0 proof/vertical slice."

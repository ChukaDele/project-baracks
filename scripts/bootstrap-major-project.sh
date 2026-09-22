#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$(pwd)}"
PROFILE="${2:-core}"
FEATURES="${3:-}"
FOUNDRY_MANIFEST="${4:-}"
TEMPLATES="$MAJOR_ROOT/templates/project"

if [ -n "$FOUNDRY_MANIFEST" ]; then
  [ -f "$FOUNDRY_MANIFEST" ] || { echo "ERROR: Foundry manifest not found: $FOUNDRY_MANIFEST" >&2; exit 2; }
  FOUNDRY_MANIFEST="$(cd "$(dirname "$FOUNDRY_MANIFEST")" && pwd)/$(basename "$FOUNDRY_MANIFEST")"
  [ -f "$MAJOR_ROOT/dist/entry.js" ] || {
    echo "ERROR: built Major runtime missing; run the normal Major build/release before Foundry bootstrap" >&2
    exit 2
  }
  FOUNDRY_PLAN="$(node "$MAJOR_ROOT/dist/entry.js" foundry plan "$FOUNDRY_MANIFEST" --json)" || exit $?
  FOUNDRY_FIELDS="$(printf '%s' "$FOUNDRY_PLAN" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
plan = payload.get("data", {})
questions = [q for q in plan.get("questions", []) if q.get("priority") in {"critical", "high"}]
profile = plan.get("majorProfile") or ""
features = ",".join(plan.get("majorFeatures", []))
blocked = bool(questions or not profile)
blockers = " | ".join(
    "[" + str(q.get("priority")) + "] " + str(q.get("question")) for q in questions[:4]
)
if not profile and not blockers:
    blockers = "[critical] Foundry archetype/profile is unresolved"
sys.stdout.write("\x1f".join(["1" if blocked else "0", profile, features, blockers]))
')"
  IFS=$'\x1f' read -r FOUNDRY_BLOCKED FOUNDRY_PROFILE FOUNDRY_FEATURES FOUNDRY_BLOCKERS <<< "$FOUNDRY_FIELDS"
  if [ "${FOUNDRY_BLOCKED:-1}" = 1 ]; then
    echo "ERROR: Foundry intake is not resolved enough to bootstrap:" >&2
    printf '%s\n' "$FOUNDRY_BLOCKERS" >&2
    exit 2
  fi
  PROFILE="$FOUNDRY_PROFILE"
  FEATURES="$FOUNDRY_FEATURES"

  # Fail before any project mutation if Foundry authority is redirected or conflicts.
  if [ -d "$TARGET" ]; then
    if [ -L "$TARGET/.foundry" ] || [ -L "$TARGET/.foundry/project.json" ]; then
      echo "ERROR: Foundry project authority must not be symlinked" >&2
      exit 2
    fi
    if [ -e "$TARGET/.foundry" ] && [ ! -d "$TARGET/.foundry" ]; then
      echo "ERROR: .foundry project authority must be a directory" >&2
      exit 2
    fi
    if [ -e "$TARGET/.foundry/project.json" ] && [ ! -f "$TARGET/.foundry/project.json" ]; then
      echo "ERROR: .foundry/project.json must be a regular file" >&2
      exit 2
    fi
    if [ -e "$TARGET/.foundry/project.json" ] && ! cmp -s "$FOUNDRY_MANIFEST" "$TARGET/.foundry/project.json"; then
      echo "ERROR: existing .foundry/project.json differs; refusing to overwrite project truth" >&2
      exit 2
    fi
  fi
fi

# Reuse the canonical skill-installer preflight before bootstrap writes any project files.
# This validates target/ancestor symlinks, receipt authority, profile/features, and lock entries.
bash "$MAJOR_ROOT/scripts/install-major-skills.sh" "$TARGET" "$PROFILE" "$FEATURES" --preflight-only

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

# Optional Foundry manifest. Never overwrite an existing project manifest silently.
if [ -n "$FOUNDRY_MANIFEST" ]; then
  if [ -L "$TARGET/.foundry" ] || [ -L "$TARGET/.foundry/project.json" ]; then
    echo "ERROR: Foundry project authority must not be symlinked" >&2
    exit 2
  fi
  if [ -e "$TARGET/.foundry" ] && [ ! -d "$TARGET/.foundry" ]; then
    echo "ERROR: .foundry project authority must be a directory" >&2
    exit 2
  fi
  if [ -e "$TARGET/.foundry/project.json" ] && [ ! -f "$TARGET/.foundry/project.json" ]; then
    echo "ERROR: .foundry/project.json must be a regular file" >&2
    exit 2
  fi
  mkdir -p "$TARGET/.foundry"
  if [ -e "$TARGET/.foundry/project.json" ]; then
    if ! cmp -s "$FOUNDRY_MANIFEST" "$TARGET/.foundry/project.json"; then
      echo "ERROR: existing .foundry/project.json differs; refusing to overwrite project truth" >&2
      exit 2
    fi
  else
    cp "$FOUNDRY_MANIFEST" "$TARGET/.foundry/project.json"
    echo "created: .foundry/project.json"
  fi
fi

# Install the native skill profile and remove stale previously-Major-managed skill copies.
bash "$MAJOR_ROOT/scripts/install-major-skills.sh" "$TARGET" "$PROFILE" "$FEATURES"

echo "Major project bootstrap complete"
echo "Project: $TARGET"
echo "Profile: $PROFILE"
echo "Features: ${FEATURES:-none}"
if [ -f "$TARGET/.foundry/project.json" ]; then
  echo "Foundry: $TARGET/.foundry/project.json"
  echo "Next: run major foundry plan '$TARGET/.foundry/project.json', resolve material questions, then start the P0 proof/vertical slice."
else
  echo "Next: replace template placeholders with current project truth, then start the P0 proof/vertical slice."
fi

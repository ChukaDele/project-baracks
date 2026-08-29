#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$(pwd)}"
PROFILE="${2:-core}"
FEATURES="${3:-}"
INTERNAL="$MAJOR_ROOT/skills/internal"
AGENT_SKILLS="$TARGET/.agents/skills"
CLAUDE_SKILLS="$TARGET/.claude/skills"
CODEX_SKILLS="$TARGET/.codex/skills"
CATALOG="$MAJOR_ROOT/guidance/skills.catalog.json"
ADAPTERS="$MAJOR_ROOT/adapters/skills"
LOCK="$TARGET/MAJOR_SKILLS.lock"
TMP="${TMPDIR:-/tmp}/major-skills-$$"

case "$PROFILE" in
  core|knowledge|web-ui|exploratory|full) ;;
  *) echo "ERROR: profile must be core, knowledge, web-ui, exploratory, or full" >&2; exit 2 ;;
esac

mkdir -p "$AGENT_SKILLS" "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$TMP"
node "$MAJOR_ROOT/scripts/generate-skill-catalog.mjs"

# Remove only skills previously installed by Major. Preserve project-owned/custom skills.
if [ -f "$LOCK" ]; then
  awk 'found && NF {print} /^\[skills\]$/ {found=1}' "$LOCK" | while IFS= read -r name; do
    [ -n "$name" ] || continue
    rm -rf "$AGENT_SKILLS/$name" "$CLAUDE_SKILLS/$name" "$CODEX_SKILLS/$name"
  done
fi

copy_skill_dir() {
  local src="$1" name
  name="$(basename "$src")"
  rm -rf "$AGENT_SKILLS/$name" "$CLAUDE_SKILLS/$name" "$CODEX_SKILLS/$name"
  cp -R "$src" "$AGENT_SKILLS/$name"
  cp -R "$src" "$CLAUDE_SKILLS/$name"
  cp -R "$src" "$CODEX_SKILLS/$name"
}

# All Major internal skills are available in every managed project; bodies remain trigger-loaded.
for dir in "$INTERNAL"/*; do
  [ -d "$dir" ] && copy_skill_dir "$dir"
done

has_feature() {
  case ",${FEATURES}," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

NEED_EMIL=0
NEED_ANTHROPIC=0
NEED_OPENAI=0
NEED_GRAPH=0
EXPECTED_EXTERNAL=""

if [ "$PROFILE" = "web-ui" ] || [ "$PROFILE" = "exploratory" ] || [ "$PROFILE" = "full" ]; then
  NEED_EMIL=1
  NEED_ANTHROPIC=1
  NEED_OPENAI=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL animate animation-vocabulary apple-design emil-design-eng find-animation-opportunities improve-animations pick-ui-library prototype review-animations frontend-design webapp-testing playwright"
fi

if [ "$PROFILE" = "exploratory" ] || [ "$PROFILE" = "full" ]; then
  NEED_ANTHROPIC=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL algorithmic-art"
fi

if has_feature vercel || [ "$PROFILE" = "full" ]; then
  NEED_OPENAI=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL vercel-deploy"
fi
if has_feature figma || [ "$PROFILE" = "full" ]; then
  NEED_OPENAI=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL figma-use figma-implement-design figma-generate-design"
fi
if has_feature mcp || [ "$PROFILE" = "full" ]; then
  NEED_ANTHROPIC=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL mcp-builder"
fi
if has_feature skill-authoring || [ "$PROFILE" = "full" ]; then
  NEED_ANTHROPIC=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL skill-creator"
fi
if has_feature security || [ "$PROFILE" = "full" ]; then
  NEED_OPENAI=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL security-threat-model"
fi
if has_feature pdf || [ "$PROFILE" = "full" ]; then
  NEED_OPENAI=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL pdf"
fi
if has_feature deep-graph || [ "$PROFILE" = "full" ]; then
  NEED_GRAPH=1
  EXPECTED_EXTERNAL="$EXPECTED_EXTERNAL graph-engineering"
fi

clone_repo() { git clone --depth 1 "https://github.com/$1.git" "$2"; }
copy_named() {
  local root="$1" name="$2" found
  found="$(find "$root" -type f -name SKILL.md -path "*/$name/SKILL.md" -print -quit || true)"
  if [ -z "$found" ]; then
    echo "ERROR: required selected skill missing upstream: $name" >&2
    return 1
  fi
  copy_skill_dir "$(dirname "$found")"
}

EMIL="$TMP/emil"
ANTHROPIC="$TMP/anthropic"
OPENAI="$TMP/openai"
GRAPH="$TMP/graph"
SOURCES=""

if [ "$NEED_EMIL" -eq 1 ]; then
  clone_repo emilkowalski/skills "$EMIL"
  SOURCES="$SOURCES $EMIL"
  # Full current Emil bundle by explicit policy.
  while IFS= read -r skill; do copy_skill_dir "$(dirname "$skill")"; done < <(find "$EMIL" -type f -name SKILL.md)
fi

if [ "$NEED_ANTHROPIC" -eq 1 ]; then
  clone_repo anthropics/skills "$ANTHROPIC"
  SOURCES="$SOURCES $ANTHROPIC"
  if [ "$PROFILE" = "web-ui" ] || [ "$PROFILE" = "exploratory" ] || [ "$PROFILE" = "full" ]; then
    copy_named "$ANTHROPIC" frontend-design
    copy_named "$ANTHROPIC" webapp-testing
  fi
  if [ "$PROFILE" = "exploratory" ] || [ "$PROFILE" = "full" ]; then copy_named "$ANTHROPIC" algorithmic-art; fi
  if has_feature mcp || [ "$PROFILE" = "full" ]; then copy_named "$ANTHROPIC" mcp-builder; fi
  if has_feature skill-authoring || [ "$PROFILE" = "full" ]; then copy_named "$ANTHROPIC" skill-creator; fi
fi

if [ "$NEED_OPENAI" -eq 1 ]; then
  clone_repo openai/skills "$OPENAI"
  SOURCES="$SOURCES $OPENAI"
  if [ "$PROFILE" = "web-ui" ] || [ "$PROFILE" = "exploratory" ] || [ "$PROFILE" = "full" ]; then copy_named "$OPENAI" playwright; fi
  if has_feature vercel || [ "$PROFILE" = "full" ]; then copy_named "$OPENAI" vercel-deploy; fi
  if has_feature figma || [ "$PROFILE" = "full" ]; then
    copy_named "$OPENAI" figma-use
    copy_named "$OPENAI" figma-implement-design
    copy_named "$OPENAI" figma-generate-design
  fi
  if has_feature security || [ "$PROFILE" = "full" ]; then copy_named "$OPENAI" security-threat-model; fi
  if has_feature pdf || [ "$PROFILE" = "full" ]; then copy_named "$OPENAI" pdf; fi
fi

if [ "$NEED_GRAPH" -eq 1 ]; then
  clone_repo codejunkie99/graph-engineering "$GRAPH"
  SOURCES="$SOURCES $GRAPH"
  copy_named "$GRAPH" graph-engineering
fi

missing=0
for dir in "$INTERNAL"/*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ -f "$AGENT_SKILLS/$name/SKILL.md" ] || { echo "ERROR: missing internal skill: $name" >&2; missing=1; }
done
for name in $EXPECTED_EXTERNAL; do
  [ -f "$AGENT_SKILLS/$name/SKILL.md" ] || { echo "ERROR: missing selected external skill: $name" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "Major skill installation incomplete; refusing success." >&2; exit 1; }

# Generated, host-native discovery/invocation hints. Existing project instructions are preserved.
cp "$CATALOG" "$TARGET/.agents/skills.catalog.json"
cp "$ADAPTERS/AGENTS.md" "$TARGET/.agents/MAJOR_SKILLS.md"
cp "$ADAPTERS/CLAUDE.md" "$TARGET/.claude/MAJOR_SKILLS.md"
cp "$ADAPTERS/CODEX.md" "$TARGET/.codex/MAJOR_SKILLS.md"
mkdir -p "$TARGET/.cursor/rules/major-skills" "$TARGET/.gemini"
cp "$ADAPTERS/RULE.mdc" "$TARGET/.cursor/rules/major-skills/RULE.mdc"
cp "$ADAPTERS/GEMINI.md" "$TARGET/.gemini/MAJOR_SKILLS.md"

{
  echo "# Generated by Major skill installer"
  echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "major_repo=$MAJOR_ROOT"
  echo "profile=$PROFILE"
  echo "features=$FEATURES"
  for repo in $SOURCES; do
    echo "source=$(git -C "$repo" remote get-url origin) commit=$(git -C "$repo" rev-parse HEAD)"
  done
  echo "[skills]"
  find "$AGENT_SKILLS" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort
} > "$LOCK"

rm -rf "$TMP"
echo "Major skills installed and validated into $TARGET"
echo "Profile: $PROFILE"
echo "Features: ${FEATURES:-none}"
echo "Registry: $LOCK"

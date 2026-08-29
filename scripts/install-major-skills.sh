#!/usr/bin/env bash
set -euo pipefail

MAJOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_TARGET="${1:-$(pwd)}"
mkdir -p "$INSTALL_TARGET"
INSTALL_TARGET="$(cd "$INSTALL_TARGET" && pwd -P)"
MAJOR_HOME="${MAJOR_HOME:-${HOME:?HOME is required}/.major}"
mkdir -p "$MAJOR_HOME"
MAJOR_HOME="$(cd "$MAJOR_HOME" && pwd -P)"
case "$MAJOR_HOME/" in
  "$INSTALL_TARGET/"*) echo "ERROR: MAJOR_HOME must be outside the project tree for installer-owned receipts" >&2; exit 2 ;;
esac
PROFILE="${2:-core}"
FEATURES="${3:-}"

case "$PROFILE" in
  core|knowledge|web-ui|exploratory|full) ;;
  *) echo "ERROR: profile must be core, knowledge, web-ui, exploratory, or full" >&2; exit 2 ;;
esac

INTERNAL="$MAJOR_ROOT/skills/internal"
CATALOG="$MAJOR_ROOT/guidance/skills.catalog.json"
ADAPTERS="$MAJOR_ROOT/adapters/skills"
FEATURES="$(node "$MAJOR_ROOT/scripts/materialize-project-skill-registry.mjs" normalize-features "$MAJOR_ROOT" "$INSTALL_TARGET" "$PROFILE" "$FEATURES")"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/major-skills.XXXXXX")"
STAGED_TARGET="$TMP/project"
TARGET="$STAGED_TARGET"
AGENT_SKILLS="$TARGET/.agents/skills"
CLAUDE_SKILLS="$TARGET/.claude/skills"
CODEX_SKILLS="$TARGET/.codex/skills"
LOCK="$TARGET/MAJOR_SKILLS.lock"

node "$MAJOR_ROOT/scripts/generate-skill-catalog.mjs" --check
mkdir -p "$STAGED_TARGET" "$INSTALL_TARGET"
for managed in .agents .claude .codex .cursor .gemini MAJOR_SKILLS.lock; do
  [ ! -e "$INSTALL_TARGET/$managed" ] || cp -R "$INSTALL_TARGET/$managed" "$STAGED_TARGET/$managed"
done
mkdir -p "$AGENT_SKILLS" "$CLAUDE_SKILLS" "$CODEX_SKILLS"

# Rebuild only Major-owned projections and command namespaces. Preserve all
# project-owned commands, prompts, skills, and host instructions.
rm -f "$TARGET/.agents/skills.registry.json" "$TARGET/.agents/skills.catalog.json"
rm -rf "$TARGET/.claude/commands/major" "$TARGET/.codex/prompts/major" \
  "$TARGET/.cursor/commands/major" "$TARGET/.gemini/commands/major"
rm -f "$TARGET/.claude/commands/major.md" "$TARGET/.codex/prompts/major.md" \
  "$TARGET/.cursor/commands/major.md" "$TARGET/.gemini/commands/major.toml"

# Remove only skills previously installed by Major. Preserve project-owned/custom skills.
if [ -f "$LOCK" ]; then
  awk 'found && NF {print} /^\[skills\]$/ {found=1}' "$LOCK" | while IFS= read -r name; do
    [ -n "$name" ] || continue
    rm -rf "$AGENT_SKILLS/$name" "$CLAUDE_SKILLS/$name" "$CODEX_SKILLS/$name"
  done
fi

copy_skill_dir() {
  local src="$1" source_key="${2:-}" skill_path="${3:-}" name
  name="$(basename "$src")"
  rm -rf "$AGENT_SKILLS/$name" "$CLAUDE_SKILLS/$name" "$CODEX_SKILLS/$name"
  cp -R "$src" "$AGENT_SKILLS/$name"
  cp -R "$src" "$CLAUDE_SKILLS/$name"
  cp -R "$src" "$CODEX_SKILLS/$name"
  [ -z "$source_key" ] || printf '%s\t%s\t%s\n' "$name" "$source_key" "$skill_path" >> "$TARGET/.agents/managed-external.tsv"
}

# All Major internal skills are available in every managed project; bodies remain trigger-loaded.
for dir in "$INTERNAL"/*; do
  [ -d "$dir" ] && copy_skill_dir "$dir"
done

PLAN="$TMP/project-install.tsv"
node "$MAJOR_ROOT/scripts/materialize-project-skill-registry.mjs" plan "$MAJOR_ROOT" "$TARGET" "$PROFILE" "$FEATURES" > "$PLAN"
: > "$TARGET/.agents/managed-external.tsv"
clone_repo() {
  local source_key="$1" repository="$2" destination="$3" source="$repository"
  if [ -n "${MAJOR_SKILL_FIXTURE_ROOT:-}" ]; then source="$MAJOR_SKILL_FIXTURE_ROOT/$source_key"; fi
  git clone --depth 1 "$source" "$destination"
}
copy_named() {
  local root="$1" name="$2" source_key="$3" skill_path="$4" found
  found="$root/$skill_path"
  if [ ! -f "$found/SKILL.md" ]; then
    echo "ERROR: required selected skill missing upstream: $name" >&2
    return 1
  fi
  [ "$(basename "$found")" = "$name" ] || { echo "ERROR: source path/id mismatch: $name" >&2; return 1; }
  copy_skill_dir "$found" "$source_key" "$skill_path"
}
SOURCES=""
SOURCE_LOCKS=""
while IFS=$'\t' read -r source_key repository skill_id skill_path; do
  [ -n "$source_key" ] || continue
  source_dir="$TMP/source-$source_key"
  if [ ! -d "$source_dir/.git" ]; then
    clone_repo "$source_key" "$repository" "$source_dir"
    SOURCES="$SOURCES $source_dir"
    commit="$(git -C "$source_dir" rev-parse HEAD)"
    SOURCE_LOCKS="${SOURCE_LOCKS}${source_key}|${repository}|${commit};"
  fi
  copy_named "$source_dir" "$skill_id" "$source_key" "$skill_path"
done < "$PLAN"

missing=0
for dir in "$INTERNAL"/*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ -f "$AGENT_SKILLS/$name/SKILL.md" ] || { echo "ERROR: missing internal skill: $name" >&2; missing=1; }
done
while IFS=$'\t' read -r name source_key skill_path; do
  [ -f "$AGENT_SKILLS/$name/SKILL.md" ] || { echo "ERROR: missing selected external skill: $name" >&2; missing=1; }
done < "$TARGET/.agents/managed-external.tsv"
[ "$missing" -eq 0 ] || { echo "Major skill installation incomplete; refusing success." >&2; exit 1; }

node "$MAJOR_ROOT/scripts/materialize-project-skill-registry.mjs" materialize "$MAJOR_ROOT" "$TARGET" "$PROFILE" "$FEATURES" "$SOURCE_LOCKS"

# Generated, host-native discovery/invocation hints. Existing project instructions are preserved.
cp "$ADAPTERS/AGENTS.md" "$TARGET/.agents/MAJOR_SKILLS.md"
cp "$ADAPTERS/CLAUDE.md" "$TARGET/.claude/MAJOR_SKILLS.md"
cp "$ADAPTERS/CODEX.md" "$TARGET/.codex/MAJOR_SKILLS.md"
mkdir -p "$TARGET/.cursor/rules/major-skills" "$TARGET/.gemini"
cp "$ADAPTERS/RULE.mdc" "$TARGET/.cursor/rules/major-skills/RULE.mdc"
cp "$ADAPTERS/GEMINI.md" "$TARGET/.gemini/MAJOR_SKILLS.md"
python3 - "$TARGET/.agents/skills.catalog.json" "$TARGET" <<'PY'
import json
import re
import sys
from pathlib import Path

catalog = json.loads(Path(sys.argv[1]).read_text())
target = Path(sys.argv[2])
slug_pattern = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
owners = {}
for entry in catalog.get('entries', []):
    skill_id = entry.get('id') if isinstance(entry, dict) else None
    aliases = entry.get('aliases', []) if isinstance(entry, dict) else None
    if not isinstance(skill_id, str) or not slug_pattern.fullmatch(skill_id):
        raise SystemExit('ERROR: generated skill id must be a safe canonical slug')
    if not isinstance(aliases, list):
        raise SystemExit(f'ERROR: invalid generated skill aliases: {skill_id}')
    for slug in [skill_id, *aliases]:
        if not isinstance(slug, str) or not slug_pattern.fullmatch(slug):
            raise SystemExit(f'ERROR: generated skill alias must be a safe canonical slug: {skill_id}')
        if slug in owners and owners[slug] != skill_id:
            raise SystemExit(f'ERROR: duplicate generated skill id or alias: {slug}')
        owners[slug] = skill_id

def command_path(root, skill_id, suffix):
    path = (root / 'major' / f'{skill_id}{suffix}').resolve()
    command_root = (root / 'major').resolve()
    if command_root not in path.parents:
        raise SystemExit('ERROR: generated command path escapes its root')
    return path

discovery = 'Use the installed Major catalogue. Run `major skill search --query "$ARGUMENTS"` or `major skill resolve --task "$ARGUMENTS" --json`.\n'
for root in (target / '.claude/commands', target / '.codex/prompts', target / '.cursor/commands'):
    (root / 'major').mkdir(parents=True, exist_ok=True)
    (root / 'major.md').write_text(discovery)
    for entry in catalog['entries']:
        skill_id = entry['id']
        command_path(root, skill_id, '.md').write_text(
            f'Run `major skill resolve --task "$ARGUMENTS" --skill {skill_id} --json`; the named skill is mandatory.\n'
        )
gemini = target / '.gemini/commands'
(gemini / 'major').mkdir(parents=True, exist_ok=True)
(gemini / 'major.toml').write_text('description = "Discover Major skills"\nprompt = "Run `major skill search --query {{args}}`."\n')
for entry in catalog['entries']:
    skill_id = entry['id']
    command_path(gemini, skill_id, '.toml').write_text(
        f'description = "Invoke Major skill {skill_id}"\nprompt = "Run `major skill resolve --task {{{{args}}}} --skill {skill_id} --json`."\n'
    )
PY

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
  python3 - "$TARGET/.agents/skills.catalog.json" <<'PY'
import json
import sys
from pathlib import Path
for entry in json.loads(Path(sys.argv[1]).read_text())['entries']:
    print(entry['id'])
PY
} > "$LOCK"
rm -f "$TARGET/.agents/managed-external.tsv"

PROJECT_IDENTITY="$(printf '%s' "$INSTALL_TARGET" | shasum -a 256 | awk '{print $1}')"
RECEIPT_DIR="$MAJOR_HOME/project-skill-receipts"
RECEIPT="$RECEIPT_DIR/$PROJECT_IDENTITY.json"
STAGED_RECEIPT="$TMP/project-skill-receipt.json"
mkdir -p "$RECEIPT_DIR"
node "$MAJOR_ROOT/scripts/materialize-project-skill-registry.mjs" receipt \
  "$MAJOR_ROOT" "$TARGET" "$PROFILE" "$FEATURES" "$SOURCE_LOCKS" "$INSTALL_TARGET" > "$STAGED_RECEIPT"

# Activate only after every source, skill, catalogue, rule and command artifact
# has been staged and validated. Roll back all managed roots if activation fails.
BACKUP="$TMP/backup"
mkdir -p "$BACKUP"
activated=""
receipt_activated=0
rollback_install() {
  if [ "$receipt_activated" -eq 1 ]; then
    rm -f "$RECEIPT"
    [ ! -e "$BACKUP/receipt.json" ] || mv "$BACKUP/receipt.json" "$RECEIPT"
  fi
  for managed in $activated; do
    rm -rf "$INSTALL_TARGET/$managed"
    [ ! -e "$BACKUP/$managed" ] || mv "$BACKUP/$managed" "$INSTALL_TARGET/$managed"
  done
}
trap 'rollback_install' ERR INT TERM
for managed in .agents .claude .codex .cursor .gemini MAJOR_SKILLS.lock; do
  [ ! -e "$INSTALL_TARGET/$managed" ] || mv "$INSTALL_TARGET/$managed" "$BACKUP/$managed"
  activated="$managed $activated"
  [ ! -e "$STAGED_TARGET/$managed" ] || mv "$STAGED_TARGET/$managed" "$INSTALL_TARGET/$managed"
done
[ ! -e "$RECEIPT" ] || mv "$RECEIPT" "$BACKUP/receipt.json"
receipt_activated=1
mv "$STAGED_RECEIPT" "$RECEIPT"
trap - ERR INT TERM
rm -rf "$TMP"
echo "Major skills installed and validated into $INSTALL_TARGET"
echo "Profile: $PROFILE"
echo "Features: ${FEATURES:-none}"
echo "Registry: $LOCK"

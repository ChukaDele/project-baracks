#!/usr/bin/env bash
# One-time host canonicalization for docs/skills-canonicalization.md.
# Dry run by default. With --apply it MOVES (never deletes) every replaced copy
# into ~/.major/backups/skills-archive-<date>/ and puts a symlink in its place.
# Idempotent: entries that are already correct are skipped.
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
HOME_DIR="${HOME:?}"
MAJOR_REPO="${MAJOR_REPO:-$HOME_DIR/Projects/project-baracks}"
ARCHIVE="$HOME_DIR/.major/backups/skills-archive-$(date +%Y%m%d-%H%M%S)"
C="$HOME_DIR/.claude/skills"
X="$HOME_DIR/.codex/skills"
A="$HOME_DIR/.agents/skills"

run() {
  echo "+ $*"
  if [ "$APPLY" = 1 ]; then "$@"; fi
}

archive() { # archive <path> <bucket>
  [ -e "$1" ] || [ -L "$1" ] || return 0
  if [ -e "$ARCHIVE/$2/$(basename "$1")" ]; then
    echo "ERROR: archive target exists: $ARCHIVE/$2/$(basename "$1")" >&2
    exit 1
  fi
  if [ "$APPLY" = 1 ]; then mkdir -p "$ARCHIVE/$2"; fi
  run mv "$1" "$ARCHIVE/$2/"
}

link() { # link <target> <path>: replace <path> with a symlink to <target>
  if [ -L "$2" ] && [ "$(readlink "$2")" = "$1" ]; then return 0; fi
  if [ -e "$2" ] || [ -L "$2" ]; then archive "$2" "$3"; fi
  if [ "$APPLY" = 1 ] && { [ -e "$2" ] || [ -L "$2" ]; }; then
    echo "ERROR: $2 still exists after archive; not linking" >&2
    exit 1
  fi
  run ln -s "$1" "$2"
}

[ -d "$MAJOR_REPO/skills/internal" ] || { echo "ERROR: Major checkout not found at $MAJOR_REPO" >&2; exit 1; }

# 1. Owner-approved gstack uninstall from Claude. ~/.codex/skills/gstack only
#    holds symlinks into the Claude install, so it goes with it.
for path in "$C"/gstack "$C"/gstack-* "$C"/_gstack-command; do archive "$path" claude; done
archive "$X/gstack" codex
archive "$HOME_DIR/.major/bin/gstack-browse" major-bin

# 2. Byte-identical Claude copies of shared skills become symlinks.
for s in break-ui emil-design-eng expose-local grill-me grilling mobile-native; do
  if [ -d "$C/$s" ] && [ ! -L "$C/$s" ]; then
    diff -rq "$C/$s" "$A/$s" >/dev/null || { echo "ERROR: $C/$s differs from $A/$s; merge first" >&2; exit 1; }
  fi
  link "../../.agents/skills/$s" "$C/$s" claude
done

# 3. Major-owned skills: one source in the repo; ~/.agents links to it and the
#    hosts link to ~/.agents. Unique content of the old copies is merged in the repo.
for s in website-design-qa reference-engineering responsive-motion-systems seo-os; do
  for old in "$A/$s" "$C/$s"; do
    if [ -d "$old" ] && [ ! -L "$old" ] && ! diff -rq "$old" "$MAJOR_REPO/skills/internal/$s" >/dev/null; then
      echo "NOTE: $old differs from the repo copy; it is archived, and its unique content is merged in the repo per docs/skills-canonicalization.md"
    fi
  done
  link "$MAJOR_REPO/skills/internal/$s" "$A/$s" agents
  link "../../.agents/skills/$s" "$C/$s" claude
done

# 4. Codex-only vendor copies move to the shared home (Codex reads ~/.agents/skills).
for s in pdf playwright; do
  if [ -d "$X/$s" ] && [ ! -L "$X/$s" ] && [ ! -e "$A/$s" ]; then run mv "$X/$s" "$A/$s"; fi
  link "../../.agents/skills/$s" "$X/$s" codex
done

# 5. Retired per-skill /major:<id> commands (the next Major install also removes them).
archive "$HOME_DIR/.claude/commands/major" claude-commands
archive "${CODEX_HOME:-$HOME_DIR/.codex}/prompts/major" codex-prompts
archive "$HOME_DIR/.cursor/commands/major" cursor-commands
archive "$HOME_DIR/.gemini/commands/major" gemini-commands

# 6. Disabled chrome-devtools-mcp plugin: archive its cache, then uninstall it.
archive "$HOME_DIR/.claude/plugins/cache/claude-plugins-official/chrome-devtools-mcp" plugin-cache
if grep -q 'chrome-devtools-mcp@claude-plugins-official' "$HOME_DIR/.claude/plugins/installed_plugins.json" 2>/dev/null; then
  run claude plugin uninstall chrome-devtools-mcp@claude-plugins-official
fi

if [ "$APPLY" = 1 ]; then echo "Applied. Archive: $ARCHIVE"; else echo "Dry run only. Re-run with --apply."; fi

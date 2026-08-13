#!/usr/bin/env bash
set -euo pipefail

project="${1:?usage: notify-human-blocker.sh <project> <specific-action>}"
action="${2:?usage: notify-human-blocker.sh <project> <specific-action>}"

/usr/bin/osascript - "$project" "$action" <<'APPLESCRIPT'
on run argv
  display notification (item 2 of argv) with title "Major — Action required" subtitle (item 1 of argv)
end run
APPLESCRIPT

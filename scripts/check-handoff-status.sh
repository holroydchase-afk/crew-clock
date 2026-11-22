#!/usr/bin/env bash
# Status header check (from holroydchase-afk/studio-agents, PMT-M3.4): HANDOFF.md opens with the
# `<!-- status` block the Studio Console reads (pm-tools scripts/feed/core.ts parseHandoff):
# within the first 15 lines, closed by `-->`, with every key below and a known stage.
# Warns only (GitHub `::warning::` lines), always exits 0: a repo without the header still works.
# Silent when the header is fine.
# Usage: bash scripts/check-handoff-status.sh [HANDOFF.md]
#   GOALS=agent-team,portfolio  optional comma list of goal ids (pm-tools goals.json); warns on any other goal.
set -u
f="${1:-HANDOFF.md}"
keys="stage goal milestone now next waiting_on_chase blockers"
stages="idea building beta live parked"
warn() { echo "::warning file=$f::$1"; }

[ -f "$f" ] || { warn "No $f. Create it from the studio-agents HANDOFF.md template, status header first."; exit 0; }

# The block between the opening line (first 15 lines) and `-->`, as the parser reads it.
block=$(awk '
  !on && NR<=15 && $0 ~ /^[ \t]*<!-- status/ { on=1; next }
  on && $0 ~ /^[ \t]*-->/ { closed=1; exit }
  on { print }
  END { if (!closed) exit 1 }' "$f") || {
  warn "$f has no status header. Add the <!-- status ... --> block from the studio-agents HANDOFF.md template within its first 15 lines, closed by -->."
  exit 0
}

value() { # value <key>: the scalar after `key:` (top-level line), empty if none
  printf '%s\n' "$block" | sed -n "s/^[ \t]*$1:[ \t]*//p" | head -1 | sed 's/[ \t]*$//'
}

for k in $keys; do
  printf '%s\n' "$block" | grep -qE "^[[:space:]]*$k:" || warn "$f status header is missing the '$k:' key."
done

if printf '%s\n' "$block" | grep -qE '^[[:space:]]*stage:'; then
  stage=$(value stage)
  lc=$(printf '%s' "$stage" | tr '[:upper:]' '[:lower:]')
  # `build` is the parser's older spelling of `building`; accept it quietly.
  case " $stages build " in
    *" $lc "*) [ -n "$lc" ] || warn "$f status header has an empty stage. Use one of: $stages." ;;
    *) warn "$f status header stage '$stage' isn't one of: $stages." ;;
  esac
fi

if [ -n "${GOALS:-}" ] && printf '%s\n' "$block" | grep -qE '^[[:space:]]*goal:'; then
  goal=$(value goal)
  case ",${GOALS// /}," in
    *",$goal,"*) [ -n "$goal" ] || warn "$f status header has an empty goal. Use one of: $GOALS." ;;
    *) warn "$f status header goal '$goal' isn't one of: $GOALS." ;;
  esac
fi
exit 0

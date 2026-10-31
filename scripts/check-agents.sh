#!/usr/bin/env bash
# Roster check (from holroydchase-afk/studio-agents; proved in Hearth): every agent in .claude/agents/
# is named in a CLAUDE.md table row as `name`, and every agent a CLAUDE.md table names has a file.
# Works with the studio table (templates/CLAUDE-agents.md) and a roster with the name in the first column.
# Usage: bash scripts/check-agents.sh   (run from anywhere inside the repo)
set -u
shopt -s nullglob
cd "$(dirname "$0")/.."
[ -f CLAUDE.md ] || { echo "No CLAUDE.md at the repo root"; exit 1; }
agents=(.claude/agents/*.md)
fail=0
for f in "${agents[@]}"; do
  name=$(basename "$f" .md)
  grep -q "^|.*| \`$name\` |" CLAUDE.md || grep -q "^| \`$name\` |" CLAUDE.md \
    || { echo "Agent '$name' is missing from the CLAUDE.md agent table"; fail=1; }
done
for name in $(grep '^|' CLAUDE.md | grep -o '| `[a-z0-9-]*` |' | tr -d '|` ' | sort -u); do
  [ -f ".claude/agents/$name.md" ] || { echo "CLAUDE.md agent table lists '$name' but .claude/agents/$name.md doesn't exist"; fail=1; }
done
[ $fail -eq 0 ] && echo "Agent roster OK (${#agents[@]} agents)"
exit $fail

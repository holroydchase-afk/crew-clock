#!/usr/bin/env bash
# Agents: line vs. what really ran (from holroydchase-afk/studio-agents). Every studio agent the PR's
# Agents: line names must appear in .claude/agent-runs/<branch>.log, written by the log-agent-run.sh hook
# ("<time> <agent>") or by its --as mode ("<time> <agent> via-general-purpose").
# "<agent> skipped: why" needs no entry. If qa-tdd ran and studio-checks.json has
# { "agents": { "verify": "<test command>", "runs": 3 } }, CI reruns that command that many times.
# Usage: BODY="<PR body>" HEAD_REF=<branch> bash scripts/check-agent-runs.sh   (from the repo root)
set -u
shopt -s nullglob
line=$(printf '%s\n' "${BODY:-}" | tr -d '\r' | grep -iE '^[[:space:]>*_-]*agents:' | tail -n 1)
[ -n "$line" ] || { echo "No Agents: line in the PR body"; exit 1; }
log=".claude/agent-runs/$(printf '%s' "${HEAD_REF:-}" | tr '/' '-' | tr -cd 'A-Za-z0-9._-').log"
fail=0; claimed=()
for f in .claude/agents/*.md; do
  a=$(basename "$f" .md)
  printf '%s' "$line" | grep -qE "(^|[^a-z-])$a([^a-z-]|$)" || continue
  printf '%s' "$line" | grep -qiE "(^|[^a-z-])$a skipped" && continue
  claimed+=("$a")
  grep -qE " $a( via-general-purpose)?\$" "$log" 2>/dev/null || { echo "::error::The Agents: line names '$a', but $log has no run of it. Run it with the Agent tool (the hook logs it), or in a cloud thread as general-purpose with the prompt from 'bash scripts/agent-prompt.sh $a \"<task>\"' (it logs itself with log-agent-run.sh --as $a), and commit the log, or write '$a skipped: <reason>'."; fail=1; }
done
[ $fail -eq 0 ] || exit 1
if [[ " ${claimed[*]-} " == *" qa-tdd "* ]] && [ -f studio-checks.json ]; then
  verify=$(python3 -c 'import json; print(json.load(open("studio-checks.json")).get("agents",{}).get("verify",""))')
  runs=$(python3 -c 'import json; print(int(json.load(open("studio-checks.json")).get("agents",{}).get("runs",3)))')
  if [ -n "$verify" ]; then
    for i in $(seq 1 "$runs"); do
      echo "verify run $i/$runs: $verify"
      bash -c "$verify" || { echo "::error::qa-tdd's suites failed on CI run $i of $runs: $verify"; exit 1; }
    done
  fi
fi
echo "ok: ${#claimed[@]} agent(s) on the Agents: line match $log"

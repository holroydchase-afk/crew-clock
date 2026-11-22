#!/usr/bin/env bash
# Builds the prompt for running a studio agent as a general-purpose subagent. Cloud project threads can't
# load the .claude/agents types (subagent_type fails) or fire the PreToolUse hook that logs runs, so the
# main session passes this prompt instead, and the subagent logs itself with log-agent-run.sh --as <agent>.
# Usage (from the repo root): bash scripts/agent-prompt.sh <agent> "<task>"
set -u
agent=${1:-}; task=${2:-}
[[ "$agent" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "usage: agent-prompt.sh <agent> \"<task>\"" >&2; exit 1; }
f=".claude/agents/$agent.md"
[ -f "$f" ] || { echo "agent-prompt.sh: no $f (run from the repo root)" >&2; exit 1; }
tools=$(awk 'NR==1&&$0=="---"{fm=1;next} fm&&$0=="---"{exit} fm&&/^tools:/{sub(/^tools:[[:space:]]*/,"");print}' "$f")
echo "You are acting as the studio agent $agent for this repo."
echo
echo "Before anything else, from the repo root run: bash scripts/log-agent-run.sh --as $agent"
echo "That logs this run honestly. Never write .claude/agent-runs/ any other way."
echo
if [ -n "$tools" ]; then echo "Use only these tools: $tools"; else echo "Use only these tools: all tools"; fi
echo
awk 'NR==1&&$0=="---"{fm=1;next} fm&&$0=="---"{fm=0;next} !fm' "$f"
echo
echo "## Your task"
echo
printf '%s\n' "$task"

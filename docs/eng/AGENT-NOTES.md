# Agent notes (Crew Clock)

Project facts for studio agents. Rules live in CLAUDE.md (hard rules) and docs/PRIVACY.md; read those, this only points at them.

- Public repo: demo and test data are made up and labeled. No real names, places, punches or secrets.
- Demo vs crew app: the public demo builds with `--demo` and never gets a backend URL. The crew app is a separate build on its own address (docs/SETUP.md step 5). See CLAUDE.md hard rules.
- Location is read only inside the clock-in/out flow, and only with the worker's consent record. Details: CLAUDE.md and docs/PRIVACY.md.
- Never block a clock-in. A bad fix or no signal means a photo fallback or a flag.
- `js/geo.js`, `js/report.js`, `js/chain.js` and `js/risk.js` are shared with the Edge Functions. After editing, run `./scripts/sync-shared.sh` (CI fails on drift).
- Logs never carry location, PINs, punches, phones or photos. The `bannedWords` list in `studio-checks.json` is enforced by `scripts/check-logs.mjs`.
- Agents come from studio-agents. Never hand-edit `.claude/agents/`; re-sync with that repo's `scripts/sync.sh`.
- Commands (test, test:sql, test:edge, test:mls, test:e2e) are listed in CLAUDE.md.

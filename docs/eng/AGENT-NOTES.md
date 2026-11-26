# Agent notes (Crew Clock)

Project facts for studio agents. Rules live in CLAUDE.md (hard rules) and docs/PRIVACY.md; read those, this only points at them.

- Public repo: demo and test data are made up and labeled. No real names, places, punches or secrets.
- Demo vs crew app: the public demo builds with `--demo` and never gets a backend URL. The crew app is a separate build on its own address (docs/SETUP.md step 5). See CLAUDE.md hard rules.
- Location is read only inside the clock-in/out flow, and only with the worker's consent record. Details: CLAUDE.md and docs/PRIVACY.md.
- Never block a clock-in. A bad fix or no signal means a photo fallback or a flag.
- The app source is `js/*.ts` (strict TypeScript); `npm run build` (esbuild, types stripped) writes the committed `js/*.js`, and CI fails if they differ. Never hand-edit `js/*.js` (except `js/vendor/`).
- `js/geo.ts`, `js/report.ts`, `js/chain.ts` and `js/risk.ts` are shared with the Edge Functions (as the emitted `.js`). After editing, run `npm run build && ./scripts/sync-shared.sh` (CI fails on drift).
- Repo scripts are strict TypeScript run by Node's own type stripping, with nothing compiled first: `scripts/build-site.mts`, `scripts/build-ts.mts`, `tests/sql/runner.test.mts`, `evals/geofence/*.mts`. Node comes from `.node-version` (>= 22.18) in CI, Pages and Cloudflare. The 24 `scripts/*.mjs` are studio-agents' tools: leave them as they are (marked linguist-vendored). `scripts/new-company.ts` is Deno, checked by `deno check` in CI.
- Logs never carry location, PINs, punches, phones or photos. The `bannedWords` list in `studio-checks.json` is enforced by `scripts/check-logs.mjs`.
- Agents come from studio-agents. Never hand-edit `.claude/agents/`; re-sync with that repo's `scripts/sync.sh`.
- Database grants (intake #35, `20261123000000_revoke_defaults.sql`): every new table, sequence or function the migration role creates starts closed to `anon`, `authenticated` and PUBLIC, in every schema including `app`. A migration that adds one must grant exactly what phones use, and a helper called inside an RLS policy must `grant execute ... to authenticated` or the policy fails closed. Add the grant to `tests/sql/70_grants_test.sql` (GRANT-3) in the same PR.
- Commands (test, test:sql, test:edge, test:mls, test:e2e) are listed in CLAUDE.md.

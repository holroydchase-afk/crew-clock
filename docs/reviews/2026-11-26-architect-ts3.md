# Architect review: TS-3 (unit tests to strict TypeScript on Node type stripping)

Date: 2026-11-26. Branch `claude/project-thread-4p3a4i`, uncommitted working tree (main 72764fc).
Spec: [docs/product/SPEC-TS-3.md](../product/SPEC-TS-3.md). Reviewer: architect (logged via
`scripts/log-agent-run.sh --as architect`).

## Verdict

**OK with changes: one P1 (ARCH-R1) must be fixed before the PR is marked ready.**
- Rung: same rung as TS-2 (strict TypeScript, no bundler). No new dependency: Node's built-in type
  stripping replaces any need for tsx or ts-node. pm-tools STACK.md and studio-agents could not be
  opened from this session (GitHub access to those repos is off), so the rung is taken from the spec.
- Reuse: `createRequire` plus `typeof import()` reuses the TS-2 source types; nothing to extract.
- Undo cost: low. Revert the merge commit; tests are not in `dist`, so nothing deploys.
- Entries: no `STU-DEC` needed. Log "tests are ESM `.ts` on Node type stripping, `engines >=22.18`" in
  the repo's decision log (story-keeper's NOTES entry covers it).

## What I checked

| Area | Result | Evidence |
|---|---|---|
| Renames | 29 `RM` renames (git sees them as moves), plus new `tests/ts3.test.ts`. e2e (`tests/e2e*.js`, `browser.js`) and `tests/sql/runner.test.mjs` stay JS; only comments changed in them. | `git status` |
| npm test / engines | `node --test tests/*.test.ts && ...`; `engines.node ">=22.18"` (advisory: no `engine-strict`, fine). Local Node 22.23.5, `process.features.typescript` = `strip`. | `package.json` |
| Typed require | 12 files use `createRequire(import.meta.url)` and cast `as typeof import('../js/x.js')`; with `moduleResolution: bundler` the type resolves to `js/x.ts`, while runtime loads the emitted `js/x.js` (tests still test what ships). The cast is unchecked, but ts2-review ARCH-R2 already pins declared names to runtime keys. No `__dirname`, no `import =`, enums or namespaces. | `tests/unit.test.ts:7-10`, `tests/ts2-review.test.ts:75` |
| tsconfig | `include: ["js/*.ts", "tests/"]` with `strict`, `erasableSyntaxOnly`; `allowJs`/`checkJs` kept because `tsconfig.e2e.json` extends it. `tsc -p tsconfig.json` exits 0 here. Explicit `any`: 1 (limit 10). No `allowImportingTsExtensions` needed (no test imports a `.ts` helper). | `tsconfig.json`, `tsconfig.e2e.json` |
| CI Node | `ci.yml`, `agents-check.yml` and `pages.yml` use `actions/setup-node@v7` with `node-version: 22`. setup-node takes the runner's cached 22.x (or the newest 22.x from the manifest), which is well past 22.18 on current images; and TS3-3 fails on a run that finds 0 tests, so an old Node cannot pass silently. No change needed. | `.github/workflows/*.yml` |
| studio-checks.json | `agents.verify` stays `npm test`, `runs: 3`. See ARCH-R1. | `studio-checks.json` |
| Studio-synced files | Only `scripts/sync-shared.sh` changed (comment line 3), and it is repo-owned. The studio scripts (`check-agents.sh`, `check-agent-runs.sh`, `log-agent-run.sh`) and `agents-check.yml` are unchanged. `studio-standard` and `studio-wiring` tests carry no "synced from" header; I could not open studio-agents to confirm it ships no test file. | `scripts/` |

## Findings

**ARCH-R1 (P1): the agents-check workflow's verify reruns will fail.** `agents-check.yml` runs
`scripts/check-agent-runs.sh`, which runs `agents.verify` (`npm test`) 3 times after only
`checkout` and `setup-node`: no `npm ci`, so no `node_modules`. Until now that was fine because the
tests that need dev tools skip there (TS2-12 skips without `tsc`, ts2-review ARCH-R1 skips without
esbuild, `ts2-review.test.ts:21`, `ts2.test.ts:331`). TS-3 breaks that in two places:
- `tests/ts3.test.ts:192` TS3-5 asserts `typescript` is installed ("this check must not skip").
- TS3-3 (`tests/ts3.test.ts:113`) allows a skip only in `license`; `ts2` and `ts2-review` will each
  report 1 skipped there, so their pins fail.

qa-tdd's local 3x runs pass because `node_modules` exists here. Fix (recommended, repo-owned, one
line): set `studio-checks.json` `agents.verify` to `npm ci --ignore-scripts && npm test`, so CI's
reruns check the real thing, and change TS3-2 to expect that string (a criterion change, so staff-pm
signs off and qa-tdd writes it red first). Alternative if Chase wants `verify` to stay `npm test`:
TS3-5 skips like TS2-12 when `tsc` is missing, and TS3-3 allows the TS2-12 and ts2-review skips when
`node_modules` is absent (weaker: CI then never type-checks in that job). Either way, an INTAKE for
studio-agents: "agents-check.yml: run `npm ci --ignore-scripts` before verify when `package-lock.json`
exists", so other repos do not hit this.

**ARCH-R2 (P2): TS3-3 doubles the unit run.** It spawns all 29 files again from inside `npm test`, and
agents-check runs that 3x. It is the guard against a 0-test run, so keep it, but consider a cheaper
guard later (the total count from the main run's TAP summary). No action needed for this PR.

**ARCH-R3 (P2): one stale `.test.js` name left.** `css/app.css:2` still says `tests/theme.test.js`
(HANDOFF notes it is kept on purpose; TS3-10 does not scan `css/`). Fix it when the theme test's pins
allow, or log why it stays.

Not findings: e2e and the sql runner staying JS matches the spec's cuts; historical `.test.js` names in
HANDOFF's Done entries are history and stay.

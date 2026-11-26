# qa-tdd run: TS-4 red phase, M0.6.1 (2026-11-26)

Spec: docs/product/SPEC-TS-4.md. Test: tests/ts4.test.ts (25 tests). Start commit cb2fb62 (main).
Red on main: 16 fail for the right reason (no .mts files yet, package.json, pages.yml and docs still name
the .mjs files, no .node-version, no deno check in ci.yml, no linguist-vendored rule, HANDOFF/PLAN/SETUP
not updated; the suite-total guard is red only because TS3-1 pins exactly 30 .ts tests and this file is
the 31st). Green regression guards (7): studio and shell script hashes, new-company.ts hash, the current
build-site gives main's pinned demo and crew dist (VERSION v3-b95449e9fb), the current build-ts reproduces
js/*.js and the esbuild-hidden message, tsc 0 errors with no scripts/*.mjs, assert pins for the 9 edited
tests, path-only diff of every test that named the old scripts. Skipped with a reason: deno check (no deno
here), test:sql (Postgres not running here).
npm test 3x: 301 passed, 18 failed each run (16 ts4 plus TS3-1 and TS3-2 CI shape, both caused by ts4).

QA-R1 | P1 | SPEC-TS-4 TS4-3 vs TS4-6, sw.js line 2 | TS4-3 wants sw.js to stop naming build-site.mjs, but build-site hashes sw.js (comments too) into VERSION, so that edit moves VERSION off v3-b95449e9fb and every phone refetches for nothing; both cannot be green; spec must choose | tests/ts4.test.ts
QA-R2 | P2 | SPEC-TS-4 TS4-1 | says scripts/*.sh -> 9; main has 6; the test pins those 6 by name and hash | tests/ts4.test.ts
QA-R3 | P1 | SPEC-TS-4 TS4-9, tests/ts3.test.ts | a path-only edit of ts3 cannot work: TS3-1 pins exactly 30 .ts tests (red once ts4 exists, and TS3-2 CI shape with it) and TS3-9 runs main's archived tree with the script path, which has no .mts until merge; ts4 exempts ts3 from the path-only check, spec should say so | tests/ts4.test.ts
QA-R4 | P2 | SPEC-TS-4 TS4-3 and TS4-9 | 13 e2e files (12 usage comments, e2e-update.js spawn path) name build-site.mjs, beyond the 9 edited tests the spec lists; the path-only check covers all 21 test files that named an old script | tests/ts4.test.ts
QA-R5 | P2 | SPEC-TS-4 TS4-3 | "docs" is unscoped; test reads it as living docs (docs/*.md, architecture, eng, evals, design), not dated specs, reviews, runs or postmortems; docs/evals/geofence.md is generated, so run.mts must regenerate it | tests/ts4.test.ts
QA-R6 | P2 | SPEC-TS-4 TS4-8, TS4-9 | spec says skipped 0 but agents.verify has no deno or Postgres; deno check and test:sql skip only when the tool is missing and were not run here | tests/ts4.test.ts
QA-R7 | P2 | tests/ts4.test.ts TS4-6, TS4-7 pins | exact main pins apply while the merge base still has build-site.mjs; if main changes app files before TS-4 merges, the pinned guards go red and need a re-pin, not a loosening | tests/ts4.test.ts

Chief-of-staff decisions applied (spec and test): QA-R1 sw.js exempt from the TS4-3 scan, VERSION pin kept;
QA-R2 spec says 6 .sh; QA-R3 ts3 may change TS3-1 (admit ts4) and TS3-9 (whichever build-site the archive has),
written into TS4-9; QA-R5 living docs only, written into TS4-3. Re-run once: still 7 pass, 16 fail, 2 skipped.

Green-phase pass (after the engineer's build, before PS-R1's fix): ts4 25/0 x3 with deno and Postgres up, typecheck 3x
green, test:sql 2/0 x3. npm test was 320/1 x3 (TS3-2 CI shape, root cause QA-R9, now fixed). Engineer's grants and
ts2 regex-literal edits are path-only (QA-R8 widened the rename). ts3 diff vs main: TS3-1 admits ts<N> guards,
TS3-9 runs whichever build-site the tree has (the two allowed), plus TS3-10's tests/sql extension filter moved to
.mts (an extension rename that keeps the runner scanned). ARCH-R3: the deno test now passes --config like ci.yml.
PS-R1 test added red. All-suites 3x restarts after the PS-R1 fix.

QA-R8 | P2 | tests/ts4.test.ts TS4-3, TS4-9 | the old-name needle missed the escaped regex-literal form (runner\.test\.mjs); widened to the same rename with the escaping kept, no looser | tests/ts4.test.ts
QA-R9 | P2 | tests/ts4.test.ts TS4-9 test:sql | a test bug: in ts3's CI-shape copy (mkdtemp, mode 0700) run.sh's su postgres cannot read the SQL files, and it shares one database with the outer run; nested runs now skip with that reason | tests/ts4.test.ts
QA-R10 | P2 | scripts/build-site.mts notTs (PS-R1) | .mts, .cts and .d.mts in a COPY folder ship to the public site; red test plants them in a temp tree | tests/ts4.test.ts

```agentrun
date: 2026-11-26
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: failing tests for TS4-1 to TS4-11 (SPEC-TS-4, M0.6.1)
tool: agent-guard | ok | kill qa-tdd
tool: agent-memory | ok | TS-4 mts build-site vendored, no prior finding covers these
tool: Bash | ok | pinned sha256 of 24 studio scripts, 6 shell scripts, new-company.ts, demo and crew dist digests and build-ts output from cb2fb62
tool: Bash | ok | qa-run3 node --test tests/ts4.test.ts 3x (7/16 each) and npm test 3x (301/18 each)
tool: Bash | ok | tsc -p tsconfig.json 0 errors with the new file
tool: agent-guard | failed | only-tests flags docs/product/SPEC-TS-4.md, staff-pm's untracked spec, not a qa-tdd change
verdict: red
findings: 10
p0: 0
artifact: tests/ts4.test.ts
escalated: yes
escalation_reason: harness showed no token or cost count
```

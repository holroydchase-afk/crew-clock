# Spec: TS-3, unit tests to strict TypeScript on Node type stripping (CRW, issue #36 PR 3)

Source: issue #36, SPEC-TS-2 design answer 6 ("`tests/*.test.ts` (Node 22 type stripping) is TS-3"),
CLAUDE.md commands, staff-pm memory PM-R4 (TS top language needs tests moved). PLAN row `M0.5`.

**Bet.** Engineers and AI tools find the unit tests in the same strict TypeScript as `js/*.ts`, with
no build step for tests and no test lost or weakened. Proof: 282 tests in 29 files pass 3x, tsc 0.
**Found in the repo (2026-11-26, main 72764fc):**
- 29 `tests/*.test.js`, 3,985 lines, 221,150 bytes, 282 tests (counts in TS3-3). All 29 use
  `require`, 25 use `__dirname`, 0 use `import`. 133 JSDoc or `@ts-` lines lose meaning in `.ts`.
- Local and CI Node is 22 (local 22.23.5): type stripping is on by default since 22.18, no flag.
  No `"type"` in package.json, so a `.ts` file with `import` syntax runs as ESM by detection.
- In a `.ts` file `require()` returns `any` (checkJs typed it in `.js`): a plain rename silently
  drops types. `__dirname` does not exist in ESM.
- No sync script owns any test: studio-standard and studio-wiring tests were written here by qa-tdd,
  so they convert. ts2.test.js reads `tests/shared.test.js` and `tests/location.test.js` by name.
- e2e (17 files + browser.js, 397 KB) run on lighter tsconfig.e2e rules; sql runner is `.mjs`.
**Design answers.**
1. Rename the 29 unit tests to `tests/*.test.ts`. ESM `import` with types (`import assert from
   'node:assert'`), `import.meta.dirname` for `__dirname`, `createRequire(import.meta.url)` only to
   load the emitted `js/*.js` (tests still test what ships). Only erasable syntax (tsconfig already
   has `erasableSyntaxOnly`): no enums, namespaces, `import x = require()`.
2. `npm test` = `node --test tests/*.test.ts && ...` (rest unchanged). package.json gets
   `"engines": {"node": ">=22.18"}`. CI keeps `node-version: 22`. `agents.verify` becomes `npm ci --ignore-scripts && npm test`
   (per ARCH-R1: agents-check reruns it with no `npm ci`, so TS3-5 and the ts2 pins fail without dev tools).
3. tsconfig.json keeps `allowJs`/`checkJs` (tsconfig.e2e extends it for the JS e2e) and adds
   `allowImportingTsExtensions` only if a test imports a `.ts` helper.
4. An assertion edit is weakening unless it only changes a file path or the import form.
Rounding: counts and bytes are exact integers. Rollback: revert the merge commit; nothing deploys
(tests are not in dist), so Pages and phones are untouched.
lint-ok: SL-4 no screen, layout or copy a user sees changes
lint-ok: SL-6 sign-in, roles and the demo versus crew split are untouched; TS3-9 checks dist
**Done, in two states.** Merged: PR on main with CI green, HANDOFF Done "TS-3", PLAN M0.5 done.
Checked: the repo language bar lists TypeScript first, recorded in HANDOFF (TS3-12). No deploy state:
dist is unchanged. README may say "tests in TypeScript" once merged; "top language" only after TS3-12.
Stale on merge: CLAUDE.md commands block, README test section, comments "Run: node --test
tests/x.test.js" in 7 tests, sync-shared.sh line 3, tsconfig comment "tests stay JS until TS-3",
HANDOFF now/next, PLAN M0.4 "tests stay JS" note.

```spec
verdict: ready
bet: Engineers and AI tools find the unit tests in strict TypeScript with no test lost or weakened; it worked when 282 tests in 29 files pass 3x and tsc reports 0 errors
step: M0.5.1 | qa-tdd writes tests/ts3.test.js with TS3-1 to TS3-10 red on main | red for the right reason | 0.5 session
step: M0.5.2 | Rename 10 small tests, ESM imports, import.meta.dirname, createRequire for js; npm test glob, engines | those files green, counts equal | 1 session
step: M0.5.3 | Rename the other 19 including ts2, typecheck, studio tests; fix path strings; ts3 test renamed last | TS3-1 to TS3-10 green | 1.5 sessions
step: M0.5.4 | Docs, CLAUDE.md, README, HANDOFF, PLAN M0.5; architect review; qa-tdd all suites 3x | TS3-11 met, no P0 or P1 | 0.5 session
step: M0.5.5 | After merge, check the language bar | TS3-12 recorded in HANDOFF | 0.25 session
criterion: TS3-1 | auto | Given tests/, then files matching *.test.js -> 0 and *.test.ts -> 30 (the 29 renamed plus ts3); e2e*.js, browser.js and sql/runner.test.mjs stay as they are -> 19 JS files
criterion: TS3-2 | auto | Given package.json, then scripts.test starts with "node --test tests/*.test.ts", engines.node is ">=22.18", and studio-checks.json agents.verify is exactly "npm ci --ignore-scripts && npm test" (per ARCH-R1); in a copy of the repo with no node_modules, bash -c on that verify string exits 0
criterion: TS3-3 | auto | Given npm test, then per-file test counts equal the pins ai 4, aishelf 8, chain 5, check-logs 5, demo 8, demobar 7, enhance 26, eval-geofence 9, grants 6, harden 14, harden2 19, hints 2, license 13, livecheck 4, location 6, m19 13, readme 3, risk 6, shared 1, shelf-docs 2, showcase 3, site 4, studio-standard 15, studio-wiring 8, theme 23, ts2-review 15, ts2 23, typecheck 9, unit 21 -> 282 total, fail 0, skipped 0; an empty run (0 tests found, or a Node without type stripping) -> TS3-3 fails, never passes on 0
criterion: TS3-4 | auto | Given each tests/*.test.ts, then "require(" calls on any path not under js/ -> 0, "__dirname" -> 0, and "import x = require" or "enum " or "namespace " -> 0
criterion: TS3-5 | auto | Given tsc -p tsconfig.json, then errors -> 0, tsconfig include covers tests/*.test.ts, and "@ts-nocheck", "@ts-ignore" and "@ts-expect-error" in tests/*.test.ts -> 0
criterion: TS3-6 | auto | Given tests/*.test.ts, then explicit "any" annotations or "as any" -> at most 10 in total, the count written in the PR
criterion: TS3-7 | auto | Given the 29 files on main and after, then assert calls per file (assert. and t.assert.) after >= before, and "test.skip", "todo:" and ".only(" -> 0
criterion: TS3-8 | auto | Given ts2.test.ts, then it reads "tests/shared.test.ts" and "tests/location.test.ts"; given typecheck.test.ts, then tsconfig include still covers tests/ and js/*.ts
criterion: TS3-9 | auto | Given build-site dist --demo, then files under dist whose path contains "tests/" -> 0 and the VERSION hash equals the one built on main
criterion: TS3-10 | auto | Given README, CLAUDE.md, docs/SETUP.md, scripts, .github/workflows and tests comments, then ".test.js" -> 0 and CLAUDE.md contains "node --test tests/*.test.ts" or "npm test"
criterion: TS3-11 | manual | qa-tdd runs npm test, typecheck, test:sql, test:edge, test:mls and test:e2e 3 times -> 3 of 3 green, qa block in the PR
criterion: TS3-12 | manual | After merge, the repo language bar shows "TypeScript" first, rank 1 of the languages -> recorded in HANDOFF with the shown percentage
cut: e2e click-throughs to TypeScript | Playwright scripts on lighter rules, 397 KB; a later TS-3b PR if the language bar needs it
cut: sql runner.test.mjs to TypeScript | belongs with the repo scripts in TS-4
cut: A test build step or tsx or ts-node | Node 22.18 strips types natively; no new dependency
cut: Typing the vm sandbox beyond tests/sandbox.d.ts | already typed in TS-1
risk: A plain rename leaves require typed any and drops type checking silently | TS3-4
risk: A test lost or loosened during the rewrite | TS3-3
risk: An older Node 22 without default type stripping runs zero tests and still passes | TS3-2
risk: Language bar still shows JavaScript first because e2e and scripts stay JS | TS3-12
handoff: qa-tdd | failing tests for TS3-1 to TS3-10 in tests/ts3.test.js | red for the right reason, TS3-3 pins green on main
handoff: engineer | build M0.5.2 to M0.5.4 | TS3-1 to TS3-10 green 3x
handoff: architect | review ESM in .ts, engines pin and tsconfig changes | no P0 or P1
handoff: story-keeper | log the ESM over require call for tests | entry in NOTES
```

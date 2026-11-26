# Spec: TS-4, repo scripts to strict TypeScript (CRW, issue #36 PR 4, last phase)

Source: issue #36 done-when ("typecheck is green over all hand-written code ... language bar shows
TypeScript"), Chase's plan rule "studio-synced tools stay as they are", SPEC-TS-3 cuts (runner "belongs
with the repo scripts in TS-4"; e2e "a later TS-3b PR if the language bar needs it"). PLAN `M0.6`.

**Bet.** Every hand-written script in this repo is strict TypeScript that tsc checks, with the demo
build byte-identical and Pages still deploying with no npm install. Proof: TS4-1..TS4-11 green 3x,
Pages run green after merge, language bar shows TypeScript first, #36 closed.
**Found in the repo (2026-11-26, main cb2fb62, Node 22.23.5 local):**
- scripts/ has 26 `.mjs`, 6 `.sh`, 1 `.ts`. 23 `.mjs` match studio-agents `tools/` by name (copied by
  its `sync-tools.sh`); `check-logs.mjs` is installed by its `install-rules.sh`. Studio-owned: 24.
  Repo-owned: `build-site.mjs` (102 lines, exports 5 functions), `build-ts.mjs` (74 lines, top-level
  `await import('esbuild')`). Neither has a shebang. `new-company.ts` is Deno, already TS, unchecked.
- Also hand-written: `tests/sql/runner.test.mjs` (47), `evals/geofence/model.mjs` (150), `run.mjs` (274).
- A `.ts` with `import` under a typeless package.json prints MODULE_TYPELESS_PACKAGE_JSON and reparses
  (checked: `node a.ts`); `.mts` runs clean. Adding `"type": "module"` would break the CommonJS e2e.
- CI and Pages use `node-version: 22` (may take a cached 22.x; stripping needs >= 22.18); Cloudflare's build image (SETUP step 5) may default lower.
- 9 tests name the scripts by path (ts2, ts2-review, ts3, site, aishelf, license, showcase, grants,
  eval-geofence); TS3-1 pins "runner.test.mjs stays". Demo build: 39 files, VERSION `v3-b95449e9fb`.
  HANDOFF still says TS-3 "not committed"; #68 merged it.
- Bar (REST, pre-#68): JS 872,556, TS 308,330. After TS-4: TS ~595 KB vs JS ~610 KB (studio tools
  200,349, e2e 397,939); vendoring the studio copies (another repo owns them) puts TS first.
**Design answers.** 1. Rename the 5 repo-owned files to `.mts` (explicit ESM, no warning, no
reparse), inline types, only erasable syntax. 2. One `.node-version` (exact, >= 22.18.0) read by
setup-node `node-version-file` in ci, pages and agents-check, and by Cloudflare. An old Node fails
loudly (unknown extension), so Pages keeps the last good site. 3. tsconfig `include` names the 5
files; studio `.mjs` stay out. CI adds `deno check scripts/new-company.ts`. 4. Path-only edits to
existing tests are not weakening (TS-3 rule 4). 5. e2e and `browser.js` stay JS (cut below).
Rounding: bytes and counts exact integers; language shares as GitHub shows, one decimal. Rollback:
revert the merge; Pages redeploys the previous commit; phones see no change (same VERSION).
lint-ok: SL-4 no screen, layout or copy a user sees changes; TS4-6 proves dist is identical
lint-ok: SL-6 sign-in, roles and the demo versus crew split are untouched; TS4-6 checks both builds
**Done, in three states.** Merged: CI green, HANDOFF Done "TS-4", PLAN M0.6 done. Deployed: Pages
run green, live VERSION in HANDOFF (TS4-13). Checked: bar TypeScript first, #36 commented and closed
(TS4-14). README may say "scripts in TypeScript" once merged; "TypeScript first" only after TS4-14.
Stale on merge: CLAUDE.md commands and stack line, README 139 and 158, SETUP step 5,
tsconfig comments, script usage headers, AGENT-NOTES, HANDOFF now/next, PLAN M0.5 "runner stays JS".

```spec
verdict: ready
bet: Engineers and AI tools find every hand-written repo script in strict TypeScript that tsc checks, with no deploy change; it worked when TS4-1 to TS4-11 pass 3x, the Pages run is green and the language bar shows TypeScript first
step: M0.6.1 | qa-tdd writes tests/ts4.test.ts with TS4-1 to TS4-11 red on main | red for the right reason | 0.5 session
step: M0.6.2 | Rename build-site and build-ts to .mts with types; package.json, workflows, .node-version, path pins in 9 tests | TS4-3 to TS4-7 green | 1 session
step: M0.6.3 | runner.test.mts, evals/geofence model.mts and run.mts, tsconfig include, deno check, .gitattributes | TS4-1, TS4-2, TS4-8 to TS4-10 green | 0.75 session
step: M0.6.4 | Docs, CLAUDE.md, SETUP, HANDOFF, PLAN M0.6; architect review; qa-tdd all suites 3x | TS4-11 and TS4-12 met, no P0 or P1 | 0.5 session
step: M0.6.5 | After merge and deploy, check Pages, live VERSION and language bar; comment and close #36 | TS4-13 and TS4-14 recorded in HANDOFF | 0.25 session
criterion: TS4-1 | auto | Given the tree, then scripts/build-site.mts, scripts/build-ts.mts, tests/sql/runner.test.mts, evals/geofence/model.mts and run.mts exist and their 5 .mjs names -> 0; tests/e2e*.js -> 17 and tests/browser.js exists; scripts/*.sh -> 6 and new-company.ts are byte-identical to main
criterion: TS4-2 | auto | Given scripts/*.mjs, then the names equal a pinned list of 24 studio-owned tools -> 24 of 24, each byte-identical to main; an extra or missing .mjs -> fail
criterion: TS4-3 | auto | Given package.json, then build is "node scripts/build-ts.mts", test:sql ends "node --test tests/sql/runner.test.mts", eval:geofence is "node evals/geofence/run.mts"; pages.yml contains "node scripts/build-site.mts dist --demo" and no "npm"; README, CLAUDE.md, living docs (docs/*.md, docs/architecture, eng, evals, design; not dated specs, reviews, runs or postmortems), tsconfig files, .github, tests and the 5 script headers mentioning the 5 old .mjs names -> 0; sw.js is exempt (its line 2 comment stays: sw.js is hashed whole into VERSION, so editing it breaks TS4-6; fix it in the next PR that changes sw.js, as TS-3 ARCH-R3 did for css/app.css)
criterion: TS4-4 | auto | Given .node-version, then it is one exact version >= "22.18.0"; ci.yml, pages.yml and agents-check.yml setup-node use "node-version-file: .node-version" -> 3 of 3, and "node-version: 22" -> 0
criterion: TS4-5 | auto | Given node runs build-site.mts dist --demo, build-ts.mts --out a temp dir and run.mts --check, then each exits 0 and stderr "MODULE_TYPELESS_PACKAGE_JSON" or "ExperimentalWarning" -> 0
criterion: TS4-6 | auto | Given main's build-site.mjs (git show into a temp copy) and build-site.mts, then --demo outputs are byte-identical, 39 files, VERSION "v3-b95449e9fb"; the crew build with the same fake test env is byte-identical too
criterion: TS4-7 | auto | Given build-ts.mts, then it reproduces the 14 committed js files byte for byte (TS2-3), exits 1 writing nothing on any esbuild warning (ARCH-R1), and with esbuild hidden exits non-zero with the same message as main
criterion: TS4-8 | auto | Given tsc -p tsconfig.json --listFilesOnly, then the 5 .mts files are listed -> 5 of 5 and scripts/*.mjs -> 0; tsc errors -> 0; "@ts-nocheck", "@ts-ignore", "@ts-expect-error" in the 5 -> 0; "as any" or ": any" -> at most 3, count in the PR; deno check scripts/new-company.ts exits 0 and ci.yml runs it
criterion: TS4-9 | auto | Given npm test on main and after, then total tests after = main + new ts4 tests, fail 0, skipped 0; in the 9 edited tests, assert calls per file after >= before and the diff changes only path strings (also every e2e file that named an old script), except ts3: TS3-1 admits ts4 (the 29 named files plus ts3 and any ts<N>.test.ts guard) and TS3-9 builds main's archived tree with whichever build-site that tree has (.mjs or .mts), its other assertions unchanged; test:sql runs 2 tests (GRANT-1, GRANT-9) -> pass
criterion: TS4-10 | auto | Given git check-attr linguist-vendored, then each of the 24 studio scripts -> "set" and build-site.mts, build-ts.mts and tests/e2e.js -> "unspecified"
criterion: TS4-11 | auto | Given HANDOFF, PLAN and SETUP, then HANDOFF has a Done entry "TS-4" and no "TS-3 ... not committed"; PLAN has an "M0.6" row naming SPEC-TS-4; SETUP step 5 names ".node-version" or NODE_VERSION "22.18" or later
criterion: TS4-12 | manual | qa-tdd runs npm test, typecheck, test:sql, test:edge, test:mls and test:e2e 3 times -> 3 of 3 green, qa block in the PR
criterion: TS4-13 | manual | After merge, the Pages run for the merge commit -> "success", and the live demo sw.js VERSION -> "v3-b95449e9fb" unless app files changed, recorded in HANDOFF
criterion: TS4-14 | manual | After merge, the language bar lists "TypeScript" first -> share recorded in HANDOFF, PR links commented on #36, #36 closed
cut: e2e click-throughs and browser.js to TypeScript (TS-3b) | 17 files, 6,800 lines of CommonJS Playwright already checked by tsconfig.e2e; not needed for #36 once studio copies are vendored; reopen only if TS4-14 fails
cut: Studio-synced scripts/*.mjs to TypeScript | owned by studio-agents and overwritten by its sync; convert there, not here
cut: Shell scripts to TypeScript | 9 .sh, plain glue, not part of #36
cut: sw.js and messenger/ | sw.js is served as-is with no build; messenger has its own package and build
cut: "type": "module" in package.json | breaks the CommonJS e2e; .mts gives ESM per file
risk: Pages runner or Cloudflare image runs Node below 22.18 and cannot strip types | TS4-4
risk: A test that spawns a script by its old path breaks or is quietly loosened | TS4-9
risk: Top-level await in build-ts or the typeless warning changes behaviour or output | TS4-5
risk: The demo build changes and phones fetch a new VERSION for nothing | TS4-6
risk: Language bar still shows JavaScript first | TS4-14
decision: .mts rather than .ts for the 5 converted files | yes; no typeless warning, no reparse, reversible
decision: Mark the 24 studio-synced scripts linguist-vendored | yes; another repo owns them and it makes the bar honest
handoff: qa-tdd | failing tests for TS4-1 to TS4-11 in tests/ts4.test.ts | red for the right reason, TS4-6 and TS4-7 green on main against the .mjs
handoff: engineer | build M0.6.2 to M0.6.4 | TS4-1 to TS4-11 green 3x
handoff: architect | review .node-version, setup-node change and .gitattributes | no P0 or P1
handoff: privacy-security | confirm pages.yml stays demo-only and no backend URL enters dist | no P0 or P1
handoff: story-keeper | log the .mts and vendored-studio-tools calls | entry in NOTES
```

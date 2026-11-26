# Spec: TS-2, front end to strict TypeScript with an esbuild step (CRW, issue #36 PR 2)

Source: issue #36, HANDOFF Done "TS-1", CLAUDE.md, pm-tools STACK.md ("written in strict TypeScript
and bundled by esbuild to the same classic scripts"). PLAN row: `M0.4` (add it in this PR).

**Bet.** Engineers and AI tools find typed TypeScript in `js/`; nothing phones, the demo or Edge
Functions load changes. Proof: all suites green 3x, the live demo clocks in after the deploy.
**Found in the repo (2026-11-23):**
- 14 hand-written files, 4,170 lines, 215,063 bytes. JSDoc types stop counting in `.ts`, so each
  `@param`/`@type` becomes an inline annotation or `as` cast: the real work.
- CI runs `npm test` before `npm ci` (no esbuild). Tests `require` or `vm`-run `js/*.js`; some only
  regex source. `pages.yml` has no install step; build-site copies all of `js/` (ships globals.d.ts).
- PRIVACY.md cites `js/app.js:85-90` style lines as evidence; README, PLAN, DESIGN, CLAUDE.md say
  "plain JS, no build step". TS-1 test asserts tsconfig includes `js/*.js`.
- Bytes: tests 450 KB and scripts 205 KB stay JS; TS is 80 KB now, 295 KB after. TS is already on
  the bar (Edge Functions); it is the top language only with TS-3. PR #48 and the demo bar #65 (both rewrite `js/app.js`) are merged.
**Design answers.**
1. Emitted `js/*.js` are committed next to the `.ts`, marked `linguist-generated`, with a banner.
   CI runs `npm run build && git diff --exit-code -- js/` (the MLS bundle pattern). So index.html,
   sw.js, build-site, Pages, the future crew host, sync-shared, unit and e2e tests load the same
   paths with no toolchain at deploy. `pages.yml` is unchanged and still builds `--demo` only.
2. `npm run build` = `node scripts/build-ts.mjs`: esbuild `transform` per file, loader ts, target
   es2022, no bundle, no format change, no minify, no sourcemap. tsconfig adds
   `erasableSyntaxOnly`, so the build only strips types. esbuild pinned exact (devDependency).
3. `npm run serve` = `npm run build && npx http-server ...`. Unit tests keep loading the emitted
   `.js` (they test what ships); tests that only read source text switch to `js/*.ts`.
4. `sync-shared.sh` keeps copying the emitted `js/{geo,report,chain,risk}.js`; CI builds first.
5. SW hash: build-site hashes the committed emitted files: changes once at this release, stable
   after (TS2-4). `build-site` stops copying `*.ts` into dist.
6. Tests stay `.js` as the unchanged oracle; `tests/*.test.ts` (Node 22 type stripping) is TS-3.
7. Branch from `main` after #48 merges; no rebase of a rename over #48.
Rounding: bytes only, exact integers. Rollback: revert the merge commit; CI then Pages redeploy.
lint-ok: SL-4 no screen, layout or copy a user sees changes; TS2-8 is the phone byte budget
lint-ok: SL-6 sign-in and roles are untouched; the demo versus crew split is TS2-7
**Done, in three states.** Merged: PR on main, HANDOFF Done "TS-2". Deployed: Pages run after CI,
VERSION hash in HANDOFF. Checked: TS2-14 on a phone, in HANDOFF. README and status lines may say
"TypeScript" once merged; "TypeScript is the top language" only after TS-3 and TS2-15.
Stale on merge: CLAUDE.md stack line and shared-files line, README stack table and file list,
PLAN line 9, DESIGN lines 70 and 133, PRIVACY evidence citations, tsconfig comments, HANDOFF next.
**CLAUDE.md wording.** "Progressive web app in strict TypeScript. Edit `js/*.ts`, run `npm run
build` (esbuild strips types, no bundling) and commit the emitted `js/*.js`; CI fails if they
differ. No deploy-time build: `scripts/build-site.mjs` copies committed files. The MLS
bundle in `js/vendor/` is prebuilt from `messenger/`." Shared line: "after editing `js/geo.ts`,
`report.ts`, `chain.ts` or `risk.ts` run `npm run build && ./scripts/sync-shared.sh`".
**HANDOFF Decisions to review.** "TS-2 (date): `no build step` now means no deploy-time build.
Emitted `js/*.js` are committed and CI-checked, not built on Pages or the crew host, so neither
needs a toolchain and the demo build is unchanged. Revert the PR to undo."

```spec
verdict: needs-decision
bet: Engineers and AI tools find typed TypeScript in js while phones, the demo and Edge Functions load identical paths; it worked when all suites pass 3x and the live demo clocks in after deploy
step: M0.4.1 | After 48 merges, qa-tdd writes TS2-1 to TS2-12 red from main | red for the right reason | 0.5 session
step: M0.4.2 | build-ts script, esbuild pin, tsconfig, gitattributes, CI build-diff step, build-site skips .ts | TS2-3 to TS2-7 green on one renamed file | 1 session
step: M0.4.3 | Rename geo, report, chain, risk, store, device, icons, push, api, ai; JSDoc to inline types; sync-shared | npm test and typecheck green | 1 session
step: M0.4.4 | Rename app, demo-backend, messenger, api-supabase | TS2-1 to TS2-12 green, e2e green | 2 sessions
step: M0.4.5 | Docs, CLAUDE.md and HANDOFF wording; architect and privacy-security review; qa-tdd 3x | TS2-13 met, no P0 or P1 | 1 session
step: M0.4.6 | After merge and deploy, phone check and language bar | TS2-14 and TS2-15 in HANDOFF | 0.5 session
criterion: TS2-1 | auto | Given js/, then js/*.ts excluding .d.ts -> 14 files named ai, api-supabase, api, app, chain, demo-backend, device, geo, icons, messenger, push, report, risk, store, and .ts files under js/vendor and vendor -> 0
criterion: TS2-2 | auto | Given each emitted js/NAME.js, then line 1 is "// Generated from js/NAME.ts by npm run build. Do not edit." and .gitattributes has "js/*.js linguist-generated" with both vendored lines kept
criterion: TS2-3 | auto | Given esbuild installed, when build-ts writes to a temp dir, then 14 of 14 outputs equal the committed js/NAME.js byte for byte; skipped with a reason when esbuild is absent, and ci.yml runs "npm run build" then "git diff --exit-code" on js/
criterion: TS2-4 | auto | Given two builds in a row and two build-site --demo runs into two temp dirs, then outputs are identical and both VERSION lines carry the same hash; a temp .ts with a syntax error -> exit 1 and committed js unchanged; an empty input dir -> exit 1 with "no js/*.ts found"
criterion: TS2-5 | auto | Given package.json and tsconfig.json, then scripts.build is "node scripts/build-ts.mjs", scripts.serve starts with "npm run build", esbuild version has no "^" or "~", erasableSyntaxOnly and noEmit are true, include has "js/*.ts" and no "js/*.js"
criterion: TS2-6 | auto | Given emitted geo, report, chain and risk, then lines starting with "import " or "export " -> 0, require gives the same export keys as before, and run in a vm with self set they define Geo, Report, Chain, Risk -> 4 of 4
criterion: TS2-7 | auto | Given build-site dist --demo, then files ending ".ts" in dist -> 0 (globals.d.ts included), every SHELL_FILES entry exists, and pages.yml contains "npm" -> 0 and "esbuild" -> 0
criterion: TS2-8 | auto | Given the 14 emitted js/*.js, then total bytes <= 221763 (main 444c5f8, re-baselined from 215063 per QA-R1)
criterion: TS2-9 | auto | Given ci.yml, then the build-diff step comes before the sync-shared step, and shared.test compares the 4 emitted files to the Edge copies -> 4 of 4 equal
criterion: TS2-10 | auto | Given location.test.js, then it reads "js/app.ts" and "js/geo.ts"; given a fixture js/zz.ts with console.log(lat), then check-logs exits 1
criterion: TS2-11 | auto | Given README, CLAUDE.md, PLAN.md and docs outside the dated records docs/runs, docs/reviews and docs/product (SPEC-TS-2.md included, per QA-R2), then citations like "js/app.js:85" for the 14 names -> 0 and "no build step" without "deploy-time" -> 0; CLAUDE.md contains "npm run build"
criterion: TS2-12 | auto | Given tsc -p tsconfig.json, then errors -> 0, "@ts-nocheck", "@ts-ignore" and "@ts-expect-error" in js/*.ts -> 0, and "any" annotations in js/*.ts <= the JSDoc any count in js/*.js on main, both counts in the PR
criterion: TS2-13 | manual | qa-tdd runs npm test, typecheck, test:edge, test:mls and test:e2e 3 times -> 3 of 3 green, qa block in the PR
criterion: TS2-14 | manual | After deploy, open the live demo on a phone, clock in -> "Clocked in"; reload twice -> the service worker VERSION changes once and then stays the same
criterion: TS2-15 | manual | After merge, the repo language bar lists TypeScript and js/*.js count as generated -> recorded in HANDOFF; top language waits for TS-3
cut: Tests to .test.ts | tests are the oracle for this rename; TS-3 right after, it makes TypeScript the top language
cut: Building js at deploy or in build-site | adds a toolchain to Pages and the crew host and touches the demo split for no user gain
cut: Source maps, minify, bundling, ES modules | same classic scripts was the ask; revisit only for a phone size problem
cut: scripts/*.mjs to TypeScript | not front end; later with STACK's one-off script rule
cut: A pre-commit build hook | the CI diff check catches stale js
risk: Rename over PR 48's app.js rewrite loses work or conflicts badly | M0.4.1
risk: Emitted js drifts from the .ts and phones run stale code | TS2-3
risk: Type stripping changes runtime behavior | TS2-6
risk: Docs and PRIVACY evidence still cite js/*.js lines | TS2-11
decision: Keep tests in JS for TS-2 and move them in a TS-3 PR, so the intake becomes three PRs | yes, safer oracle and smaller review
decision: Merge PR 48 before TS-2 starts | yes, TS-2 branches from main after it
handoff: qa-tdd | failing tests for TS2-1 to TS2-12 after 48 merges | red for the right reason, TS2-8 and TS2-11 green on main where already true
handoff: engineer | build M0.4.2 to M0.4.5 | TS2-1 to TS2-12 green 3x
handoff: architect | review esbuild dependency and the committed-output choice | no P0 or P1
handoff: privacy-security | review build-site and CI for the demo and crew split | no P0 or P1
handoff: story-keeper | log the no build step reversal and the TS-3 split | entry in NOTES
```

# Architect review: TS-2 (front end to strict TypeScript, esbuild type strip)

Date: 2026-11-26. Branch `claude/project-thread-4p3a4i`, uncommitted working tree. Spec:
[docs/product/SPEC-TS-2.md](../product/SPEC-TS-2.md). Reviewer: architect (logged via
`scripts/log-agent-run.sh --as architect`).

## Verdict

**OK with changes (no P0, no P1).**
- Rung: the studio's "strict TypeScript, bundled by esbuild to the same classic scripts" step, as
  quoted in the spec from pm-tools STACK.md (STACK.md itself could not be reopened from this
  session: GitHub access to pm-tools is off). No new rung; no runtime dependency; nothing reaches phones.
- Reuse: the committed-output-plus-CI-diff guard copies this repo's own MLS bundle pattern
  (`js/vendor/` from `messenger/`); nothing new to extract to studio-agents yet.
- Undo cost: low. Revert the merge commit; the emitted `js/*.js` are the same paths and shapes as before.
- Entries: none needed in pm-tools `DECISIONS.md` (esbuild is already the stack's builder). The two repo
  decisions are already logged in `HANDOFF.md` "Decisions to review" (no-deploy-time-build, `globalThis`).

## What I checked

| Area | Result | Evidence |
|---|---|---|
| esbuild pin | Exact `0.28.2` devDependency, lockfile has integrity hash, `engines.node >=18` (CI runs 22). Installed copy is 0.28.2. Has a `postinstall` (`install.js`) that picks the platform binary; dev-only, CI-only, not in Pages. | `package.json`, `package-lock.json:486-498` |
| Build script | One `transform` per file, loader ts, target es2022, no bundle/format/minify/sourcemap; all files transformed before any write, so a syntax error writes nothing. | `scripts/build-ts.mjs` |
| CI guard | `npm ci` now runs before `npm test`; build-diff step runs `npm run build && git diff --exit-code -- js/` plus an untracked-file check, and sits before the sync-shared step. | `.github/workflows/ci.yml:42-55` |
| Pages / demo split | `pages.yml` untouched: no npm, no esbuild, still `--demo`. `build-site` copies committed files only and filters `*.ts` (incl. `globals.d.ts`) out of every COPY entry. | `scripts/build-site.mjs:80-82`, `.github/workflows/pages.yml` |
| tsconfig | `erasableSyntaxOnly` + `noEmit` + `strict`; include `js/*.ts`, not `js/*.js`. Keeps esbuild a pure strip (no enums, namespaces, parameter properties). | `tsconfig.json` |
| `export declare` + `globalThis` | Declared names match the runtime `api` keys exactly for all five shared files (geo 11, report 13, chain 11, risk 4, ai 11). esbuild returns 0 warnings across the 14 files now. No `(void 0)` IIFE argument in any emitted file; the remaining `void 0` are ordinary `undefined`. `globalThis` is behavior-neutral: browser, service worker and Deno all hit `self` first; Node `require` uses `module.exports`; chain, risk and ai already used `globalThis` on main. | `js/geo.ts:119-131`, `js/report.ts` tail, `js/*.js` |
| Edge copies | `supabase/functions/_shared/vendor/{geo,report,chain,risk}.js` are byte-identical to the emitted files. Loaded as ES modules (the way `vendor/mod.ts` imports them) in Node with and without `self`, each attaches `Geo`/`Report`/`Chain`/`Risk` to `globalThis` and `Geo.fenceStatus(10,5,50)` returns `onsite`. Deno itself is not installed here, so `npm run test:edge` was not run by me; qa-tdd's 3x run covers it. | `scripts/sync-shared.sh`, `supabase/functions/_shared/vendor/mod.ts` |
| Byte budget | 14 emitted files = 173,361 bytes (budget 221,763): smaller than main because esbuild drops comments. | TS2-8 |

## Findings

- **ARCH-R1 (P2) Build ignores esbuild warnings.** `scripts/build-ts.mjs:45-50` sets `logLevel: 'silent'`
  and never reads `r.warnings`. The exact class of problem this PR hit (top-level `this` rewritten to
  `undefined` in a file esbuild sees as a module) is reported as a warning, so a future file can
  regress silently and only a runtime test would notice. Fix: fail the build (exit 1, nothing written)
  when `r.warnings.length > 0`, printing each with its location; failing test first (a temp `.ts` with
  `export declare const x: number;` and a top-level `this` -> exit 1). Owner: engineer, after qa-tdd.
- **ARCH-R2 (P2) `export declare` surface is not checked against the runtime object.** The declared
  exports in `js/{geo,report,chain,risk,ai}.ts` are hand-kept twins of each file's `const api = {...}`;
  tsc does not compare them, so adding a function to `api` without a declare (or the reverse) passes
  typecheck and the tests type against a wrong shape. They match today. Fix: a unit test that parses
  the `export declare` names and compares them to `Object.keys(require('../js/NAME.js'))` for the five
  files (or a `satisfies` check inside each file if it stays erasable). Owner: qa-tdd.
- **ARCH-R3 (P2) Orphan or hand-written `js/*.js` are not caught.** The CI guard detects a stale or
  missing emitted file, but build-ts never deletes output, so deleting or renaming a `.ts` leaves its old
  `.js` in `js/` and build-site ships it; equally a new hand-written `js/foo.js` would ship untyped.
  TS2-1 pins the 14 `.ts` names but not the `.js` set. Fix: a test that every top-level `js/*.js` has a
  `js/*.ts` sibling (and starts with the banner), alongside TS2-1/TS2-2. Owner: qa-tdd.
- **ARCH-R4 (P2, note) Emitted files carry no comments.** esbuild drops ordinary comments, so the
  Edge copies and anyone reading `js/*.js` or devtools on a phone see uncommented code; the `.ts` is the
  only documented source. Acceptable (it is why bytes went down); make sure `docs/architecture/` and
  PRIVACY evidence cite `js/*.ts` lines, which TS2-11 already enforces for the 14 names. No code change.

Nothing at P0 or P1. Hard rules unaffected: no runtime dependency, no network or user-data change,
the demo build gets no backend and no toolchain, Edge Functions load the same four files.

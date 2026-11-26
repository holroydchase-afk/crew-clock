# Privacy and security review: TS-2 (front end to strict TypeScript, esbuild type strip)

Date: 2026-11-26. Reviewer: privacy-security. Branch `claude/project-thread-4p3a4i`, working tree
(built, not committed). Spec: `docs/product/SPEC-TS-2.md`. Read-only review; nothing fixed here.

**Verdict: no P0 or P1. Safe to open the PR and, after merge, to deploy the demo.** Two P2 doc
citations and one P2 CI hardening below; none blocks M0.4.

## Threats checked (priority order)
1. The public demo picks up a backend URL or the crew app's config (the demo/crew split).
2. Source or type files (`.ts`, `globals.d.ts`) ship to phones or the public site.
3. The rewrite changes runtime behavior: a new location read, a watch that outlives its screen,
   a location read in the service worker.
4. The new devDependency (esbuild) brings supply-chain risk into CI.
5. CI or Pages gains a secret, a permission or a deploy-time toolchain.
6. PRIVACY.md evidence points at the wrong code after the rename.
7. Personal data or secrets added to a public repo.

## Evidence
- **Demo split (ASVS V14.1 build and deploy).** `node scripts/build-site.mjs /tmp/... --demo` gives
  `backend: 'demo'` and every URL/key empty, also with `CREW_BACKEND=supabase SUPABASE_URL=...`
  set in the environment. The `--demo` guard (`build-site.mjs` lines 48-61) is unchanged.
  `pages.yml` is unchanged: no `npm`, no esbuild, still `--demo` only, same permissions.
- **No `.ts` ships.** `cpSync` now has a `!src.endsWith('.ts')` filter; `find dist -name '*.ts'`
  gives 0 (`globals.d.ts` included). `dist/js` holds exactly the 14 emitted files plus `vendor/`.
  The crew host build uses the same copy path, so it also needs no toolchain.
- **Runtime unchanged.** Each emitted `js/*.js` compared to `main`'s `js/*.js` after esbuild
  `minifyWhitespace`: 12 of 14 identical; `geo.js` and `report.js` differ only in the IIFE
  fallback `this` -> `globalThis`. `self` exists first in the browser, the service worker scope
  and Deno, and a classic script's top-level `this` is `globalThis`, so behavior is the same.
  `build-ts.mjs --out /tmp/...` reproduces all 14 committed files byte for byte.
- **Location (L1, L2).** `navigator.geolocation` appears 4 times in `js/app.ts` and 4 in `js/app.js`,
  as on `main`; every call is in `watchGps` from `sortJobsByDistance`, `locate`, `prime-location`
  and `job-here`; `geo.ts` reads only the `geolocation` passed to `bestFix`; none in `sw.js`.
  `tests/location.test.js` now scans `.ts` and `.js` (not `.d.ts`). `check-logs.mjs` passes.
- **Edge copies.** `supabase/functions/_shared/vendor/{geo,report,chain,risk}.js` equal the emitted
  files byte for byte.
- **Supply chain.** `esbuild` pinned exact `0.28.2`; lockfile `integrity` matches the registry
  (`npm view esbuild@0.28.2 dist.integrity`); all 27 new entries resolve to registry.npmjs.org with
  sha512 integrity, MIT. Only `esbuild` has an install script (`postinstall: node install.js`).
  `npm audit`: 0 vulnerabilities. One stale `axe-core` lock entry was dropped; it was never in
  `package.json` (CI installs it pinned with `--no-save`), so nothing changes.
- **CI.** `ci.yml` keeps `permissions: contents: read`; no new secrets or env. `npm ci` moves before
  `npm test`; the build-diff step (`npm run build && git diff --exit-code -- js/ && test -z
  "$(git status --porcelain -- js/)"`) runs before sync-shared and also catches a new untracked
  `.js`. gitleaks job unchanged.
- **Public repo.** The diff, the spec, the run notes and `tests/ts2.test.js` add no names,
  addresses, emails, keys, project refs or URLs beyond the existing public map tile hosts.
- Tests run here: `tests/ts2.test.js`, `location`, `demo`, `shared`: 38 of 38 pass.

## PRIVACY.md citations
- All `js/*.js` citations moved to `js/*.ts` by function name: checked, accurate.
- **Stored PIN** `js/app.ts:526-527`: accurate (`state.auth = res.auth || { crewId, pin }`, then
  `Store.local.set('auth', ...)`).
- **Map tiles** `js/app.ts:1076-1081`: accurate (OSM and USGS tile layers in `addBaseLayers`).
- **Outbox** `js/app.ts:179-199,220-233`: accurate for the stub keys, `PERMISSION` and the
  remove/stub loop; see PS-R2 for one line it leaves out.

## Findings
| ID | Sev | Finding | Standard | When |
| --- | --- | --- | --- | --- |
| PS-R1 | P2 | PRIVACY.md map-tiles row still cites `sw.js:28-30`, which is now the `activate` handler; the tile cache is `sw.js:36-37` (`isTile`) and `51-56` (fetch). The PR corrected the same line's `js/` half. | Project evidence contract (PRIVACY.md "[true]" claims) | This PR |
| PS-R2 | P2 | Outbox citation skips `js/app.ts:212-213` ("Refused stubs are never resent"), which is the code for the row's "the stub is never resent" claim. Suggest `179-199,212-233`. | Project evidence contract | This PR |
| PS-R3 | P2 | CI `npm ci` now runs esbuild's `postinstall` in the test job. Verified the build works with `npm ci --ignore-scripts` (esbuild loads its platform binary from the optional dependency). Use `npm ci --ignore-scripts` in `ci.yml` and the README/CLAUDE.md setup line. | OpenSSF Scorecard / SLSA build hardening, ASVS V14.2 | This PR or M0.5 (by 2026-12-10) |

## Remaining risk
- **Fixed:** none here (review only).
- **Accepted:** the L1 placement test walks `js/app.ts`, not the shipped `js/app.js`; the CI
  build-diff step makes them the same code, and the hit-list test covers both files.
  Local `npm run serve` serves `.ts` from the repo root: dev only, never deployed.
- **Needs Chase:** nothing new.

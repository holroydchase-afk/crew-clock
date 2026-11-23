# Post-mortem: phones kept showing an old build of the demo after a deploy

Fixed 2026-10-28. Blameless. Sources: commit `1122130`, `sw.js`, `scripts/build-site.mjs`,
`tests/e2e-update.js`, `HANDOFF.md` ("Stale live demo") and `git log`. Times are UTC from git.

## Summary

After a successful deploy of the public demo, browsers that had opened an earlier build kept
showing it. The service worker filled its new cache through the browser's HTTP cache, so a cache
with a new name could hold old files. Install now bypasses that cache, and a test deploys twice.

## Impact

- Who: browsers that had already opened an older deploy of the demo. A first-time visitor was not
  affected. How many: not recorded.
- What they saw: the previous build (old boss name, old pins, no sample day, per `HANDOFF.md`).
- How long: not recorded per phone. The deploy named in the record was merged at 2026-10-26 17:44
  and the fix at 2026-10-28 03:43, about 34 hours later. When it was first noticed, and whether
  earlier deploys behaved the same way, is not recorded.
- Data: sample data only, no crew data. The demo has no backend, and the crew app was not live.

## Timeline

| When (UTC) | Event | Source |
| --- | --- | --- |
| 2026-10-26 17:44 | Four pull requests merge to `main` (head `b410caa`). The demo deploys from it without error. Deploy time: not recorded. | `git log`, `HANDOFF.md` |
| Between then and 2026-10-28 03:31 (approximate) | Phones that had opened an older deploy are seen still showing it. Exact time and reporter: not recorded. | `HANDOFF.md` |
| 2026-10-28 03:31 | Fix committed with a browser test that failed before the change and passed after. Merged to `main` at 03:43. | commits `1122130`, `09ca252` |
| 2026-10-28, after the merge | CI on `main` fails once on an unrelated demo test (a race in "Reset sample data"), which blocks that deploy. Time: not recorded. The race fix is committed at 03:54 and merged at 14:24. | `HANDOFF.md`, commits `c2677bf`, `eadca53` |
| 2026-10-29 | The live demo, loaded in a fresh browser, serves a current build of `main`. This does not show that a stale phone recovered. When the fixed build first went live is not recorded. | `HANDOFF.md` |
| 2026-10-29 (logged 20:24) | The new update test fails once in CI on timing and passes on the next run. | commit `0410264`, `HANDOFF.md` |

## Root cause

The build stamps the service worker's `VERSION` with a hash of the app files, so every deploy gets
a new cache name, `shell-<version>` (`scripts/build-site.mjs:92-95`, `sw.js:4-5`). On install the
worker filled that cache with `cache.addAll(SHELL_FILES)` (the removed line in `1122130`). Those
requests use the browser's default cache mode, so they can be answered from the browser's own HTTP
cache. GitHub Pages serves files with `Cache-Control: max-age=600`. A browser that had fetched the
old files within the last 10 minutes therefore installed the new worker, created the new cache and
filled it with the old files. On activate the worker deleted the previous cache (`sw.js:30-34`) and
then served the old files from the new one, because app files are answered from the cache first
(`sw.js:64-75`).

The background refresh, `fetch(req)`, also went through the HTTP cache. By reading the old code, a
phone should have fetched new files on an open after those 10 minutes and shown them on the open
after that. That was not reproduced, so whether this path explains every affected phone is unknown.

## Why it was not caught

- No test deployed twice. Tests checked that the build stamps the worker (`tests/site.test.js:24`)
  and ran the app against one build served with caching off (`http-server -c-1`,
  `.github/workflows/ci.yml:75`), which hides the HTTP cache.
- The deploy itself was green, and a fresh browser showed the new build.
- Playwright turns the HTTP cache off when request routing is used (`tests/e2e-update.js:60`), so
  a test written the usual way would not have reproduced it.

## Fix (commit `1122130`)

- Install fetches each file with `cache: 'reload'`, which skips the HTTP cache (`sw.js:24-28`).
- The background refresh uses `cache: 'no-cache'`, which revalidates with the server, except for
  page navigations, which are unchanged (`sw.js:68`).
- The version hash includes `sw.js` itself, so a change to the worker alone gets a new cache name
  (`scripts/build-site.mjs:92`).

## How it is guarded now

`tests/e2e-update.js` runs in `npm run test:e2e` and in CI. It builds the demo twice, edits the
first copy so it is recognizably old (a different boss name and version), and serves it with
`Cache-Control: max-age=600` like GitHub Pages. It opens the old build, switches the server to the
new one, reloads twice and asserts the page shows the new build. The contract it tests: a phone is
on the new build by the second open after a deploy.

## What went well, and what did not

- Went well: the fix came with a test that reproduces the bug. Deploys wait for CI, so the
  unrelated failing test blocked a deploy instead of shipping past it.
- Did not go well: nothing automated compares what a returning visitor sees with what was deployed.
- Did not go well: the record does not say when the problem started, how or when it was noticed,
  or when the fix went live, so the real duration cannot be stated.

## Follow-ups still open

- The update test waits fixed times (2 s, then 1 s) for the new worker (`tests/e2e-update.js:70-73`)
  and has failed once on a slow CI runner. The planned change is to wait for the new worker to
  activate. Those waits have not changed since the fix commit.
- The test runs in Chromium only (`tests/browser.js`). Safari on an iPhone is untested, and
  recovery of a phone that was actually stale was never confirmed on a real device.
- The crew app will be on a different host. Its `_headers` file sets `no-cache` on `sw.js`,
  `config.js` and `index.html`, but that host does not exist yet, so those headers have never been
  served. The only test checks that the file is copied into the build (`tests/site.test.js:27`).

# Privacy and security review: TS-4 (repo scripts to strict TypeScript)

Date: 2026-11-26. Reviewer: privacy-security. Branch `claude/project-thread-4p3a4i`, uncommitted
tree on main `cb2fb62`. Spec: `docs/product/SPEC-TS-4.md`. Node 22.23.5 local.

## Threats checked (priority order)
1. The public demo (GitHub Pages) gets a crew backend URL or key (hard rule: demo never the crew app).
2. TypeScript source or other non-app files ship to either site.
3. Workflow changes widen permissions, add secrets or pull unpinned code into the Pages deploy.
4. Personal data or secrets added to a PUBLIC repo.
5. SETUP step 5 tells Chase to do something that weakens the crew/demo split.

## Evidence
- **Demo with crew env set.** Exported fake `CREW_BACKEND=supabase`, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `ORG_CODE`, `VAPID_PUBLIC_KEY`, `SHEETS_BACKEND_URL`, `SHEET_URL`, then ran
  `build-site.mts --demo` and main's `build-site.mjs --demo` (from `git archive HEAD`). `diff -r`:
  identical, 39 files, VERSION `v3-b95449e9fb`. Grep of the new dist for every fake value: 0 hits.
- **Crew build** with the same fake env: byte-identical to main's (`b313ece18a`).
- **assertDemo still refuses.** A tampered `config.js` with a `supabaseUrl` makes `--demo` exit 1
  ("--demo build has a live backend"); calling `assertDemo` directly with `backend: 'supabase'` throws.
  The logic is unchanged apart from type annotations and one `as Record<string, unknown>` cast.
- **No TS in dist.** No `.ts`, `.mts`, `.cts` or `.mjs` in the demo dist. None in `js/`, `vendor/`,
  `css/`, `icons/` today.
- **Workflows.** `pages.yml`: only `node-version` -> `node-version-file: .node-version` and the
  `.mts` path; permissions (`contents: read`, `pages: write`, `id-token: write`), triggers, the
  tested-sha checkout and `--demo` are unchanged; no `npm`, no secrets. `.node-version` is read from
  the CI-tested commit. `ci.yml`: same setup-node change, `.mts` paths, and one new step
  `deno check --config supabase/functions/deno.json scripts/new-company.ts`; new-company.ts imports
  only local `_shared/*.ts`, so the check fetches nothing remote. No new permissions or secrets.
  `agents-check.yml`: setup-node change only.
- **Public-repo scan.** Diff and the 5 untracked files: no real names, addresses, emails, phone
  numbers, project refs or keys. Test fixtures use `https://x.supabase.co` and `EXAMPLE1`.
- **SETUP step 5.** Build command `node scripts/build-site.mts` (no `--demo`, correct for the crew
  app), plus a note that Cloudflare reads `.node-version`, with `NODE_VERSION` as a fallback. That
  variable is not secret, and the step still says never to use the demo's address for the crew.
- `npm run typecheck` exits 0. `tests/ts4.test.ts`: 25 tests, 24 pass, 1 skipped (TS4-8 deno, not
  installed here).

## Findings
- **PS-R1 P2. build-site's `notTs` filter only drops `.ts`.** `.mts`, `.cts` and `.d.mts` would ship
  if one ever landed in a COPY folder (`js/`, `vendor/`, `css/`, `icons/`). Now that `.mts` is the
  repo's own extension for scripts, that is more likely. None exists today and the repo is public,
  so it would leak source only. OWASP ASVS 4.0.3 V14.3 (unintended disclosure) and V1.14. Fix with
  a failing test first: drop `/\.[cm]?ts$/`. The output stays byte-identical, so TS4-6 holds.
  Not required for this PR.
- **PS-R2 P2 (pre-existing, accepted).** A refused `--demo` build leaves a partly copied `dist/`.
  On Pages the step fails, so nothing is uploaded and the last good site stays. Locally the dist is
  config-free demo files only. ASVS V14.1.
- **PS-R3 P2 (accepted, unverified live).** SETUP's claim that Cloudflare Pages reads
  `.node-version` matches build images v2 and later. I could not re-check it live because
  developers.cloudflare.com is blocked in this session's network settings. The `NODE_VERSION`
  fallback covers an older image, and an old Node fails loudly rather than shipping. Supply chain.

No P0 or P1. Required-now items for this milestone are met: demo-only Pages, no backend URL in
dist, no secrets or personal data, no new vendors, permissions or runtime scripts.

## Outside my lane (for qa-tdd)
`npm test` here: 321 tests, 319 pass, 1 fail, 1 skip. The fail is **TS3-2 CI shape**, which is red
when run on its own as well. Inside its no-node_modules copy, `TS4-9 npm run test:sql` fails
(`not ok 286`). That test does not skip under `CRW_TS3_CI_SHAPE`/`CRW_TS4_NESTED`, so it runs
test:sql again against the shared Postgres. Not a privacy issue, but it blocks a green 3x.

## Gate
Safe to ship to the next people (merge, then the Pages deploy): **yes** from privacy and security,
once qa-tdd clears the TS3-2 failure. Scheduled: PS-R1 in the next PR that touches build-site.

# Architect review: TS-4 (repo scripts to strict TypeScript, `.node-version`)

Date: 2026-11-26. Branch `claude/project-thread-4p3a4i`, uncommitted working tree.
Spec: [docs/product/SPEC-TS-4.md](../product/SPEC-TS-4.md). Reviewer: architect (logged via
`scripts/log-agent-run.sh --as architect`).

## Verdict

**OK. No P0 or P1; four P2s, none blocks the PR.**
- Rung: same rung as TS-2 and TS-3 (strict TypeScript, no bundler, Node's built-in type stripping).
  No new dependency or service. pm-tools STACK.md was not opened from this session; the rung follows
  the spec and the TS-3 review.
- Reuse: nothing to extract. `.mts` per file reuses the TS-3 pattern (`createRequire` + `typeof import()`).
- Undo cost: low. Revert the merge; Pages rebuilds the previous commit with `node-version: 22` and
  `build-site.mjs`; the demo VERSION is unchanged either way (TS4-6), so phones see nothing.
- Entries: no `STU-DEC` here. One studio-agents INTAKE (below) for `agents-check.yml`.

## What I checked

| Area | Result | Evidence |
|---|---|---|
| Renames | 5 `RM` moves: `scripts/build-site`, `scripts/build-ts`, `tests/sql/runner.test`, `evals/geofence/model`, `run` to `.mts`. Only `node:*` imports plus `./model.mts` (type-only) and `createRequire` for `js/geo.js`. | `git status`, `evals/geofence/run.mts:15` |
| tsconfig | `include` names the 4 non-test `.mts` (runner is under `tests/`); `allowImportingTsExtensions` is legal with `noEmit`. `npm run typecheck` exits 0 here. | `tsconfig.json` |
| `.node-version` | `22.23.5\n`, one exact version, >= 22.18 and >= `engines.node`. 22.23.5 is in `actions/node-versions` `versions-manifest.json`, so setup-node can fetch it if the runner cache lacks it. | `.node-version`, `package.json` |
| GitHub Pages deploy | Safe. `pages.yml`: checkout of the CI-tested `head_sha` (so `.node-version` is present), `setup-node` with `node-version-file`, then `node scripts/build-site.mts dist --demo`. No `npm`, no `node_modules`, `build-site.mts` imports only `node:*`. `--demo` path unchanged and byte-identical (TS4-6). A wrong Node fails the build step loudly (unknown `.mts` extension or type syntax), so `upload-pages-artifact` never runs and the live demo stays on the last good build. | `.github/workflows/pages.yml` |
| Crew-app host (SETUP step 5) | Covered on paper, not exercised (the Cloudflare project does not exist yet). Build command is now `node scripts/build-site.mts`; SETUP says Cloudflare reads `.node-version` and gives the `NODE_VERSION` fallback. Cloudflare's build images read `.node-version`/`.nvmrc`; the v3 image's default without it is 22.16, below 22.18, so the file matters and a miss fails loudly, never a silent half-build. See ARCH-R2. | `docs/SETUP.md:84-90` |
| CI | `ci.yml` uses `node-version-file`; new step `deno check --config supabase/functions/deno.json scripts/new-company.ts` (imports only local `_shared/*.ts`, no network). | `.github/workflows/ci.yml:69-71` |
| agents-check.yml | Studio-synced, now edited (`node-version-file`). Logged in HANDOFF "Decisions to review". A re-sync puts `node-version: 22` back; TS4-4 then fails `npm test` loudly. See ARCH-R1 and the INTAKE. | `.github/workflows/agents-check.yml:50-52` |
| `.gitattributes` | 24 `scripts/*.mjs` marked `linguist-vendored`, one line each (no glob, so a new studio tool is not silently hidden and `build-site.mts`/`build-ts.mts` still count). | `.gitattributes` |
| Studio-owned scripts | Byte-identical to main (TS4-2 green). | `tests/ts4.test.ts` |
| ts4 tests | `node --test tests/ts4.test.ts`: 25 tests, 24 pass, 0 fail, 1 skipped (TS4-8 deno, no deno here). See ARCH-R3. | local run |

## Findings

**ARCH-R1 (P2): `agents-check.yml` drifts from studio-agents.** The edit is right for this repo but a
studio file now differs from upstream, and upstream cannot take it as-is: setup-node fails when
`node-version-file` names a missing file, and most studio repos have no `.node-version`. Fix: file the
INTAKE below with studio-agents (Chase merges there), then re-sync. Until then HANDOFF's entry and
TS4-4 cover it. Owner: Chase / studio-agents.

**ARCH-R2 (P2): Cloudflare installs dev tools on every crew build (pre-existing, not TS-4).** With a
root `package-lock.json`, Cloudflare Pages runs an npm clean install before the build command, with
install scripts on (esbuild's postinstall), although `build-site.mts` needs nothing from
`node_modules`. Harmless today, but slower and the one place install scripts run. Fix when step 5 is
done: add `SKIP_DEPENDENCY_INSTALL` = `1` to the step 5 variables table (check the name against
Cloudflare's current build-image docs at that time) and confirm in the first build log that Node is
22.23.5 and no install ran. Owner: engineer, with the step 5 setup.

**ARCH-R3 (P2): TS4-8's deno test skips wherever deno is missing, and checks without `--config`.**
Spec TS4-9 says `npm test` has "skipped 0"; that holds in `ci.yml` (setup-deno runs before
`npm test`) but not locally or in agents-check's verify reruns (no deno there). Also the test runs
`deno check scripts/new-company.ts` while ci.yml passes `--config supabase/functions/deno.json`, so
the two checks can disagree. Fix: make the test use the same `--config` as ci.yml, and either reword
TS4-9 to "skipped 0 in ci.yml" or let qa-tdd's PR qa block state the one deno skip. The ci.yml step
remains the real gate. Owner: qa-tdd (a criterion wording change goes past staff-pm).

**ARCH-R4 (P2): an exact Node pin needs a bump path.** `22.23.5` gets no patch releases on its own,
and Node 22 leaves maintenance on 2027-04-30. Fix: add a PLAN or HANDOFF "next" line to move
`.node-version` to the current 24.x before then (type stripping is stable there; `engines` and
TS4-4 accept it), and bump the patch when a Node security release lands. Owner: staff-pm.

Low note, no ID: `allowImportingTsExtensions` also applies to `js/*.ts`; esbuild's transform does not
rewrite `.ts` specifiers, so an app import of `./x.ts` would type-check but 404 in the browser. No
`js/*.ts` uses ESM imports today (they are classic scripts), so nothing to do now.

## Draft INTAKE for studio-agents (not filed)

```
INTAKE: studio-agents, templates/.github/workflows/agents-check.yml
Change:
  1. Read the Node version from .node-version when the repo has one, else keep 22:
       - uses: actions/setup-node@v7
         with:
           node-version-file: ${{ hashFiles('.node-version') != '' && '.node-version' || '' }}
           node-version: ${{ hashFiles('.node-version') == '' && '22' || '' }}
  2. Before the "Agents line matches the run log" step, install dev tools when there is a lockfile:
       - name: Install dev tools (from the lockfile, no install scripts)
         if: hashFiles('package-lock.json') != ''
         run: npm ci --ignore-scripts
Reason: CRW TS-4 pins Node in .node-version (scripts are .mts run by type stripping, needs >= 22.18)
  and edited its synced agents-check.yml to read it; the next sync would revert that. An
  unconditional node-version-file breaks every repo without the file, hence the hashFiles guard.
  Step 2: verify reruns ran `npm test` with no node_modules (CRW TS-3 ARCH-R1); CRW works around it
  with verify = "npm ci --ignore-scripts && npm test"; doing it in the workflow fixes all repos.
Files: templates/.github/workflows/agents-check.yml (and its sync target list, if separate).
Check: a repo with and one without .node-version both pass agents-check; CRW re-syncs with no diff.
```

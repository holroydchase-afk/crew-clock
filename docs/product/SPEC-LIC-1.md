# Spec: license audit (CRW, intake LIC-1)

Docs and packaging only; no app behavior change. IDs are `LIC1-n` (= LIC-1.n; the spec checker
allows no dot in an ID). Source: Chase's intake, CLAUDE.md (public repo, $0), CoS checks 2026-11-24.

**Bet.** Anyone opening the public repo or demo sees what ships, under which license, and that
Crew Clock is MIT with no AGPL code; proven by `tests/license.test.js` red, then green 3x.

**Found.** `messenger/src/mls.js` is original (plain JS; Hearth's messenger is TypeScript; only
ts-mls's public API names are shared): stays MIT. `js/vendor/crew-mls.js` (keeps only esbuild's short
"Bundled license information" block for the @noble packages; no notice for ts-mls or @hpke,
which is why the notices file ships beside it, PS-R2) bundles **seven** packages: ts-mls 1.6.4,
@noble/curves 2.0.1, @noble/hashes 2.4.0, **@noble/hashes 2.0.1** (nested under @noble/curves, PM-R1),
@noble/ciphers 2.1.1, @hpke/core 1.9.0, @hpke/common
1.10.1. `vendor/` ships Leaflet 1.9.4 (BSD-2-Clause, no LICENSE file) and Atkinson Hyperlegible
Next (OFL-1.1, `OFL.txt` present). esbuild is build-only; Edge Function imports are not vendored.

**Build.**
1. `mls.js` `//` comment in lines 1-5: "Original work for Crew Clock, MIT. Not copied from Hearth
   (@holroyd/messenger, AGPL-3.0-or-later); it only calls ts-mls's public API." (esbuild drops it.)
2. `THIRD_PARTY_NOTICES.md`: per component `## <name> <version>`, `License: <SPDX>`, each
   copyright line verbatim from its own LICENSE, and the shipped path. Footer: esbuild build-only;
   Edge imports not vendored; `docs/design/STUDIO-CORE.md` and `tokens.json` are first-party
   copies from Chase's Hearth repo, MIT here by their author (CoS logs it in Decisions to review).
3. `vendor/leaflet/LICENSE`: exact text from the leaflet@1.9.4 package.
4. README "## License": keep `[MIT](LICENSE)`, add a link to `THIRD_PARTY_NOTICES.md`.
5. `"license": "MIT"` in both package.json files; refresh both lockfiles' root entries with
   `npm install --package-lock-only` (no version changes, PM-R3).
6. `scripts/build-site.mjs` COPY gains `THIRD_PARTY_NOTICES.md` and `LICENSE` (PS-R1, so the notices' `[LICENSE](LICENSE)` link resolves; enforced by the two PS-R1 tests). `sw.js` unchanged.

**Criteria** (`tests/license.test.js`, run by `npm test`; LIC1-11 and LIC1-12 manual)
- LIC1-1: both package.json -> `license` is "MIT".
- LIC1-2: notices -> exactly 9 `## ` headings; "@noble/hashes 2.4.0" and "@noble/hashes 2.0.1" separate.
- LIC1-3: each bundled heading's version equals `messenger/package-lock.json` (nested path for
  2.0.1). Always runs, with or without `node_modules`.
- LIC1-4: drift guard: a non-dev lockfile package (not esbuild or `@esbuild/*`) with no heading,
  or a duplicate heading -> fail.
- LIC1-5: if `messenger/node_modules` exists, every `Copyright` line of each package LICENSE is in
  its section (@noble/ciphers has 2: Paul Miller 2022 and Thomas Pornin 2016); if absent -> skip
  with a reason, never a silent pass.
- LIC1-6: Leaflet section has "BSD-2-Clause" and "1.9.4"; Atkinson has "OFL-1.1" and the
  copyright line from `OFL.txt` verbatim.
- LIC1-7: `vendor/leaflet/LICENSE` has "Copyright (c) 2010-2023, Volodymyr Agafonkin",
  "Copyright (c) 2010-2011, CloudMade" and "Redistribution and use in source and binary forms".
- LIC1-8: README from "## License" to the next "## " -> has `](LICENSE)` and `](THIRD_PARTY_NOTICES.md)`.
- LIC1-9: `mls.js` lines 1-5 -> contain "Not copied from Hearth" and "MIT".
- LIC1-10: `--demo` build into a temp dir -> has `THIRD_PARTY_NOTICES.md` and `vendor/leaflet/LICENSE`; dir removed.
- LIC1-11 (manual): `npm run build:mls`, then `git diff --exit-code js/vendor/crew-mls.js` -> 0.
- LIC1-12 (manual): after the next Pages deploy (Chase's go) the demo serves the notices, 9 sections.

**Done.** Merged: green 3x, HANDOFF updated. Deployed: only on Chase's go; until LIC1-12 is
checked nothing claims the live demo carries the notices. Rollback: revert the PR (no data touched).

**Not doing.** Notices for esbuild or Deno imports (not shipped); SBOM or license-checker
dependency (one test does it, $0); notices screen in the app (no persona needs it).

**Findings.** PM-R1 P1 bundle: nested @noble/hashes 2.0.1 also bundled, missed by intake and CoS
-> list it (LIC1-2, LIC1-3). PM-R2 P2 vendor/leaflet: BSD-2 text not shipped with the binary ->
LIC1-7, LIC1-10. PM-R3 P2 lockfiles: root entries go stale when `license` is added -> step 5.

lint-ok: SL-6 no sign-in, data or owner-only behavior changes; the word privacy only names the reviewer
lint-ok: SL-7 the README change is a link, checked by LIC1-8 in the repo and LIC1-12 on the live demo

```spec
verdict: ready
bet: Anyone reading the public repo sees every shipped package, version and license and that Crew Clock is MIT with no AGPL code; proven when tests/license.test.js goes red then green 3x
step: M0.3.1 | qa-tdd writes tests/license.test.js | LIC1-1 to LIC1-10 red for the right reason | 0.5 session
step: M0.3.2 | engineer builds steps 1 to 6 | LIC1-1 to LIC1-10 green and LIC1-11 exits 0 | 1 session
step: M0.3.3 | qa-tdd all suites 3x, privacy-security review | green 3x, no P0 or P1 | 0.5 session
criterion: LIC1-1 | auto | Given both package.json files, then license is "MIT" in each
criterion: LIC1-2 | auto | Given the notices, then 9 headings incl. "@noble/hashes 2.4.0" and "@noble/hashes 2.0.1"
criterion: LIC1-3 | auto | Given the lockfile and no node_modules, then ts-mls reads "1.6.4" matching the lockfile
criterion: LIC1-4 | auto | Given a lockfile runtime package with no heading, then the test fails with 1 missing name
criterion: LIC1-5 | auto | Given node_modules, then the @noble/ciphers section holds 2 copyright lines; absent -> skipped
criterion: LIC1-6 | auto | Given the notices, then Leaflet reads "BSD-2-Clause" and Atkinson reads "OFL-1.1"
criterion: LIC1-7 | auto | Given vendor/leaflet/LICENSE, then it contains "Copyright (c) 2010-2011, CloudMade"
criterion: LIC1-8 | auto | Given the README License section, then it links "THIRD_PARTY_NOTICES.md"
criterion: LIC1-9 | auto | Given lines 1 to 5 of mls.js, then they contain "Not copied from Hearth"
criterion: LIC1-10 | auto | Given a demo build, then "THIRD_PARTY_NOTICES.md" exists in the output
criterion: LIC1-11 | manual | Rebuild the MLS bundle -> git diff on it exits 0
criterion: LIC1-12 | manual | After the next Pages deploy -> the notices page shows 9 sections
cut: Notices for esbuild and Deno imports | not shipped or vendored
cut: License-checker dependency or SBOM | one test does it at no cost
cut: Notices screen in the app | no persona needs it
risk: A dependency bump ships code with no notice | LIC1-4
risk: The comment edit changes the shipped bundle | LIC1-11
handoff: qa-tdd | write tests/license.test.js for LIC1-1 to LIC1-10 | red for the right reason
handoff: engineer | build steps 1 to 6 | LIC1-1 to LIC1-10 green 3x and LIC1-11 exits 0
handoff: privacy-security | review the notices and the first-party Hearth note | no P0 or P1
```

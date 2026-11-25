# qa-tdd run: failing tests for the M2.0.5 intakes (CRW-1 to CRW-16, auto)

Spec: `docs/product/SPEC-INTAKES-2026-11-25.md`. Start commit `4f2fa6cf4059d19653e2e8152c75689983ddba00`.
New files: `tests/intakes.test.js` (unit, `npm test`), `tests/e2e-intakes.js` (browser, against a
`--demo` build on :8123). Every clock is pinned to 2026-11-25 local time, never today's date.

```agentrun
date: 2026-11-25
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: spec SPEC-INTAKES-2026-11-25.md, write the failing tests for CRW-1..CRW-16 (auto); CRW-9/17/18 are manual
tool: Bash | ok | log-agent-run.sh --as qa-tdd
tool: agent-guard | ok | kill qa-tdd
tool: agent-memory | ok | sample town, demo key, chip wording, sheets backend, demo-bar: only 2026-11-25-qa-tdd-ps-r1 QA-R1 (licence notices), nothing covering these
tool: Bash | ok | node --test tests/intakes.test.js: 15 cases, 11 fail red for the right reason, 4 pass as other-direction or edge guards
tool: Bash | ok | node tests/e2e-intakes.js: 6 cases, all 6 fail red for the right reason
tool: Bash | ok | node --test on the other 23 unit files: 237 tests, 235 pass, 2 skipped, 0 fail (no regression)
tool: Bash | ok | npm run test:sql after starting Postgres 16: 2 pass, 0 fail (baseline, unchanged by this run)
tool: Bash | ok | tsc (6.0.2, the sandbox's) over tsconfig.json and tsconfig.e2e.json: 0 errors in either new file
tool: Bash | ok | baseline npm run test:e2e on the same demo build: e2e, chat, supabase, harden, demo, consent, location, update, demo-chat, works, polish, harden2, enhance, design all passed
tool: Bash | failed | tests/e2e-showcase.js and tests/e2e-hints.js cannot load here: axe-core is not installed and installing it is not allowed in this sandbox
tool: Bash | ok | 3 runs of both new suites: 239/11 three times, 0/6 three times, the same messages each time (stable red)
tool: agent-guard | ok | only-tests --base 4f2fa6c
verdict: red
findings: 7
p0: 0
artifact: tests/intakes.test.js
escalated: yes
escalation_reason: harness showed no token or cost count
```

QA-R1 | P2 | package.json `test:e2e` | the new browser file is not in the suite, so CI would never run CRW-6..8, CRW-14 or CRW-16; qa-tdd may not change package.json (agent-guard only-tests), so the engineer adds `node tests/e2e-intakes.js` to the chain in the same PR | tests/e2e-intakes.js
QA-R2 | P2 | spec CRW-16 height budget | at 390x844 the demo Home is already 923px tall before any header (demo banner 79px above a 100vh screen), so "at most 1 screen tall" cannot be met by adding a 52px header; Clock in itself is fully on screen (top 275, bottom 561). The test asserts the spec as written and is red on this line too: staff-pm either amends the budget to "Clock in needs no scroll" or the engineer shrinks the banner | tests/e2e-intakes.js (CRW-16 390x844)
QA-R3 | P2 | spec CRW-4 vs tests/sql | the old coordinate sweep covers `tests/sql/`, where 10_rls, 40_retention and 50_harden carry 19 pinned fixture coordinates; changing them needs `npm run test:sql` rerun in the same PR (some tests pin exact values) | tests/intakes.test.js (CRW-4)
QA-R4 | P2 | spec CRW-16 laptop | at 1280x800 the boss tab bar sits at the top of the body, under the portfolio header by design, and the first shift row starts at 634px; "boss Today shows its first whole shift row above the tab bar" only describes the phone layout, so the test applies the row check at 390 only and the overlap check at both | tests/e2e-intakes.js (CRW-16 1280x800)
QA-R5 | P2 | spec CRW-8 / `js/demo-backend.js` `load()` | the spec says "when `load()` runs twice", but `load()` returns the stored db untouched and only `seed()` writes; the top-up has to be a new step inside `load()` that is idempotent per worker (last punch is a clock-in on the sample day). The tests drive it through two `DemoBackend.handle('listCrew')` calls, which is what the app really does on reopen | tests/intakes.test.js (CRW-8)
QA-R6 | P2 | docs/product/SPEC-INTAKES-2026-11-25.md line 49 | the spec itself quotes all five old place names, so CRW-4's repo-wide sweep ("0 hits") cannot go green until the spec is redacted in place like the two review docs the spec lists; staff-pm or the engineer redacts it in the #56 PR | tests/intakes.test.js (CRW-4)
QA-R7 | P2 | sandbox, tests/e2e-showcase.js and tests/e2e-hints.js | both require axe-core/axe.min.js, which is not installed here and could not be installed, so those 2 of 16 browser files did not run in this session and need a CI or local run before the PR is marked ready | none

## What is not covered here

- CRW-9, CRW-17, CRW-18 are manual (ux-reviewer, privacy-security, and the live page after Chase's go).
- `npm run test:edge` could not run in this sandbox: no `deno` on PATH. Nothing in this run touches
  the Edge Functions, so the suite is unaffected, but its verdict is blocked, not green.
- `tests/e2e-showcase.js` and `tests/e2e-hints.js` could not run here either: both `require`
  `axe-core/axe.min.js`, which is not installed (their headers say `npm install --no-save
  axe-core@4.11.3`) and installing it was refused in this sandbox. The other 14 browser files ran.
- Boundaries covered for the pinned clock: 08:00 (before 9 AM, sample day is yesterday), 10:00 (open
  shifts), 14:00 (seeded mid-day), 21:30 (evening), and a store emptied to 0 punches. Not covered:
  midnight and the other side of a time zone (the demo's day boundaries come from
  `Report.startOfDay`, which has its own tests), and a store left from a past day (the spec cuts it).

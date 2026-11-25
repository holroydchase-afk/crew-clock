# Spec: intakes #56, #53 (EF-CK-1, EF-CK-11), #57 — M2.0.5

Staff PM, 2026-11-25. Four small fixes, one PR each, in this order. Before state: `main` at `9adcf3b`.
Out of scope: #53 items 2-10 (follow-up PR), #54, #38, #36.

**Answer.** Build all four now: EF-CK-1 first (P0, wrong data on the boss's screen), then the
Sheets route (P0 here, though the intake said P1: a crew build can still send punches with
coordinates to a non-Supabase backend, a hard-rule breach), then the demo town swap (P0, privacy),
then the portfolio header (P2, waits for Chase's go to deploy). All four are reversible.

## EF-CK-1 root cause (found in code, not guessed)
1. **The chip is a geofence result, not presence.** Boss Today (`js/app.js` `bossTodayHtml`, line ~1286)
   puts `chip(s.status)` on every shift row. `s.status` comes from `Report.pairShifts`
   (`js/report.js`): the worse of the in and out punches' geofence checks. `STATUS.onsite.word` is
   "On site" (`js/app.js:21`). So Ray T.'s closed shift "6:54 AM – 3:24 PM · 8.5 h" still carries a
   present-tense "On site" chip at 9:30 PM. The map already separates "Clocked out"; Today does not.
2. **A day-time seed goes stale by evening.** `load()` (`js/demo-backend.js`) seeds once and keeps
   `cc.demo.db.v7` forever. Seeded 9 AM–6 PM, `sampleDay().done` is false, so p6–p8 (clock-outs)
   are never added. Reopened after 6 PM, `bossTodayHtml` reads `DemoBackend.sampleDay(Date.now()).done`
   (true) and says "Not in", while the stored rows still say "on the clock". Header and rows disagree.

## Critical path (one PR per task)
- `M2.0.5.1` EF-CK-1 closed-shift chip and evening top-up — done when CRW-6..9 green 3x — 1 session
- `M2.0.5.2` EF-CK-11 no Sheets route in `js/api.js` or the crew build — done when CRW-10..14 green 3x — 1 session
- `M2.0.5.3` #56 made-up town and pins, demo key v8, repo-wide sweep — done when CRW-1..5 green 3x — 1 session
- `M2.0.5.4` #57 demo-bar tag in the `--demo` build only — done when CRW-15..16 green 3x — 0.5 session
- `M2.0.5.5` privacy-security and ux-reviewer pass, HANDOFF and PLAN — done when CRW-18 has no P0/P1 — 0.5 session

## Acceptance criteria
Pinned clock everywhere (never today's date). No new hours or totals are shown, so no rounding rule changes.

**EF-CK-1**
- **CRW-6 (auto)** Given a closed shift (in 06:54, out 15:24, both `onsite`) and a pinned clock of 2026-11-25 21:30, when boss Today renders, then its chip reads "Was on site", never "On site".
- **CRW-7 (auto)** Given closed shifts with status `near`, `offsite`, `weak`, `nogps`, then chips read "Was near", "Was off site", "Weak GPS", "No GPS"; an open shift at 10:00 still reads "On site" (colour classes unchanged).
- **CRW-8 (auto)** Given a store seeded at 2026-11-25 14:00 (c1–c3 open) and reloaded at 21:30, when `load()` runs twice, then c1, c2, c3 each have exactly 1 clock-out (15:24, 15:30, 15:12), no row says "on the clock", and the list header is "Not in". A seeded worker the visitor already clocked out gets 0 extra clock-outs (no "clocked out twice"). An emptied store (0 punches, after the visitor voids them all) gets 0 punches added.
- **CRW-9 (manual)** Given the demo at 390x844 at 21:30, ux-reviewer screenshots boss Today -> 0 rows read "On site" for a worker whose last punch is a clock-out.

**EF-CK-11** (decision, logged in HANDOFF "Decisions to review": the Sheets route is removed, not gated)
- **CRW-10 (auto)** Given `backend: 'supabase'`, no `supabaseUrl`, any `backendUrl`, when `Api.listCrew()` runs, then it rejects with `offline: true`, `fetch` is called 0 times, and `Api.isDemo` is false.
- **CRW-11 (auto)** Given `backend: 'sheets'` with a `backendUrl`, then the same as CRW-10: 0 fetches.
- **CRW-12 (auto)** Given `backend: 'demo'` and no keys, then `Api.listCrew()` returns 6 crew from DemoBackend; given `backend: 'supabase'` with a URL, then `Api === SupabaseApi` (no regression).
- **CRW-13 (auto)** Given a non-demo build with `SHEETS_BACKEND_URL` set, then `build-site.mjs` exits non-zero with "Sheets backend is demo-only"; `js/api.js` contains 0 `fetch(` calls.
- **CRW-14 (auto)** Given the CRW-10 config, when a worker taps Clock in, then the punch is saved to the outbox (pending 1) and the screen shows the done step: never blocked, never dropped.

**#56 demo towns**
- **CRW-1 (auto)** Given `seed()` at 2026-11-25 10:00, then all 4 job addresses end "Fernhollow (sample town)", 0 contain ", WV", and every pin has 3 decimals with lat in 38.700–38.950 and lng in -98.400 to -98.000 (rural Kansas, nowhere near the crew).
- **CRW-2 (auto)** Given those 4 pins, then every pair is at least 3 km apart and all fit in a 30 km box, and the map's default view (`js/app.js` lines ~1056 and ~1418) centres inside that box.
- **CRW-3 (auto)** Given the moved seed at 2026-11-25 21:30, then each punch p1–p8 keeps the geofence status it had at `9adcf3b` (p4 `nogps`, the rest as recorded there; offsets from each pin are preserved).
- **CRW-4 (auto)** Given the repo minus `.git` and `node_modules`, then "Teays", "Cross Lanes", "Scott Depot", "Hurricane" and "Charleston" have 0 hits, and `js/` plus `tests/` (incl. `sql/`, `edge/`, `e2e-*`) have 0 coordinates matching `38\.4\d+,\s*-8[12]\.\d+`. Demo store key is `cc.demo.db.v8`.
- **CRW-5 (auto)** Given demo geocode "Main St, Fernhollow", then the answer label ends "(sample)" and its pin is inside the CRW-1 box.

**#57 portfolio header (demo build only; independent of the #38 demo bar)**
- **CRW-15 (auto)** Given `build-site.mjs dist --demo`, then `dist/index.html` has exactly 1 `<script src="/assets/demo-bar.js" data-page="white" defer></script>` directly before `</body>`; a crew build has 0 "demo-bar"; `sw.js` SHELL_FILES has 0 "demo-bar".
- **CRW-16 (auto)** Given the demo build served with a stub `/assets/demo-bar.js` (52px fixed header, body padding 52px), at 390x844 and 1280x800, then `scrollWidth` is at most the viewport width, Clock in's bottom is at most 844, the boss tab bar is not under the header, and there are 0 page errors. Height budget: at 390x844 crew Home is at most 1 screen tall (no vertical scroll to reach Clock in) and boss Today shows its first whole shift row above the tab bar.
- **CRW-17 (manual)** After Chase's go and the Pages deploy, at 390 and 1280 on the live demo -> the header shows, its back link opens the portfolio, and Clock in fits without scrolling.

**All**
- **CRW-18 (manual)** privacy-security (location, demo/crew split) and ux-reviewer (chip words, 390px) -> 0 P0 and 0 P1.

## Edge cases named up front
Seeded before 9 AM (sample day is yesterday: CRW-8 must not add clock-outs to it twice); load twice;
a store from yesterday (left alone: `bossDay` already labels it "Yesterday (sample day)"); empty
demo after Reset; a failed localStorage write (`root.__demoDb` path); `fetch` absent.

## Done: three states
- **Merged**: each PR green 3x on CI; HANDOFF "Done" and PLAN `M2.0.5.x` updated; `#53` gets a comment per item.
- **Deployed**: Pages rebuild from `main` (Chase's go). Until then README and HANDOFF say "merged, not live".
- **Checked**: CRW-17 on the live page, recorded in HANDOFF with the date.
Stale artifacts to refresh: `docs/screenshots/demo-today.png` (chip words), HANDOFF line ~862
(town names), `docs/reviews/2026-10-23-privacy-security.md` and `2026-10-24-recruiter-ready.md`
(town names redacted in place with a one-line dated note), `tests/risk.test.js` test name.
Undo: each PR reverts on its own; CRW-8's top-up and the v8 key are the only stored-data change.

lint-ok: SL-6 no sign-in, session or owner-only rule changes here; CRW-10 to CRW-14 cover the only access path touched (which backend a build talks to)
lint-ok: SL-9 lines 26 and 57 say "no P0 or P1" as a review gate; they rank nothing as P1

## Biggest risk
CRW-8's top-up double-counts a worker the visitor already clocked out. Handled by CRW-8's second case.
Git history keeps the old town names; the hard rules forbid rewriting it, so privacy-security notes it.

```spec
verdict: ready
bet: The boss trusts Today at any hour; it worked when CRW-9 shows 0 "On site" rows for clocked-out workers at 21:30
step: M2.0.5.1 | EF-CK-1 closed-shift chip and evening top-up | CRW-6 to CRW-9 green 3x | 1 session
step: M2.0.5.2 | EF-CK-11 remove the Sheets route from api.js and the crew build | CRW-10 to CRW-14 green 3x | 1 session
step: M2.0.5.3 | Made-up town and pins, demo key v8, repo-wide sweep | CRW-1 to CRW-5 green 3x | 1 session
step: M2.0.5.4 | Demo-bar tag in the demo build only | CRW-15 and CRW-16 green 3x | 0.5 session
step: M2.0.5.5 | privacy-security and ux-reviewer pass, HANDOFF and PLAN | CRW-18 has no P0 or P1 | 0.5 session
criterion: CRW-1 | auto | Given seed at 2026-11-25 10:00, then 4 addresses end "Fernhollow (sample town)" and 0 contain ", WV"
criterion: CRW-2 | auto | Given the 4 pins, then every pair is at least 3 km apart inside a 30 km box
criterion: CRW-3 | auto | Given the moved seed at 21:30, then p4 is "nogps" and p1 to p8 keep their 9adcf3b statuses
criterion: CRW-4 | auto | Given a repo grep for the 5 old place names and the old coordinate pattern, then 0 hits and the key is "cc.demo.db.v8"
criterion: CRW-5 | auto | Given geocode "Main St, Fernhollow", then the label ends "(sample)" and the pin is in the CRW-1 box
criterion: CRW-6 | auto | Given a closed onsite shift at 21:30, then the chip reads "Was on site", never "On site"
criterion: CRW-7 | auto | Given closed near and offsite shifts, then chips read "Was near" and "Was off site"; an open shift at 10:00 reads "On site"
criterion: CRW-8 | auto | Given a store seeded at 14:00 and loaded twice at 21:30, then c1 to c3 each have 1 clock-out and the header says "Not in"; an empty store gets 0 punches added
criterion: CRW-9 | manual | Demo at 390x844 at 21:30 -> 0 rows read "On site" for a clocked-out worker
criterion: CRW-10 | auto | Given backend supabase with no supabaseUrl and a backendUrl, then listCrew rejects offline and fetch runs 0 times
criterion: CRW-11 | auto | Given backend sheets with a backendUrl, then fetch runs 0 times
criterion: CRW-12 | auto | Given backend demo, then listCrew returns 6 crew; given supabase with a URL, then Api is SupabaseApi
criterion: CRW-13 | auto | Given a crew build with SHEETS_BACKEND_URL set, then the build exits 1 with "Sheets backend is demo-only"
criterion: CRW-14 | auto | Given the CRW-10 config, when Clock in is tapped, then the outbox holds 1 punch and the done step shows
criterion: CRW-15 | auto | Given the demo build, then index.html has 1 demo-bar tag before body end; the crew build has 0
criterion: CRW-16 | auto | Given a 52px stub header at 390x844, then scrollWidth is at most 390 and Clock in's bottom is at most 844
criterion: CRW-17 | manual | Live demo after deploy at 390 and 1280 -> header shows and Clock in fits with 0 scrolling
criterion: CRW-18 | manual | privacy-security and ux-reviewer review -> 0 P0 and 0 P1
cut: #53 items 2 to 10 | follow-up PR, none is wrong data
cut: Reseeding a store from a past day | bossDay already labels it "Yesterday (sample day)"; reseeding would wipe visitor punches
cut: Rewriting git history for old town names | hard rule forbids it
risk: Evening top-up double-counts a worker the visitor already clocked out | CRW-8
risk: Removing the Sheets route blocks a clock-in on a misconfigured crew build | CRW-14
risk: Portfolio header hides the punch buttons on a small phone | CRW-16
decision: Deploy the demo-bar tag and new towns to the live demo once merged | yes, after CRW-16 is green; CRW-17 right after
handoff: qa-tdd | failing tests CRW-1 to CRW-16 at 9adcf3b, one PR at a time | red for the right reason
handoff: engineer | build M2.0.5.1 to M2.0.5.4 in order | each PR green 3x
handoff: ux-reviewer | chip words and 390px header fit | CRW-9 and CRW-18 no P0 or P1
handoff: privacy-security | demo towns, Sheets route, demo/crew split | CRW-18 no P0 or P1
```

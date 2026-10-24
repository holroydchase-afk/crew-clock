# M1.8 recruiter-ready review (2026-10-24)

**Verdict: go with conditions.** No P0 or P1 is open in code. But the fixes live in PR #18 and
PR #19, which are not merged, so the live site still shows the old demo. Nobody has opened the
live site tonight. Two manual privacy checks only Chase can do are still open.

## What was checked and how

All runs were on a local `--demo` build (`node scripts/build-site.mjs dist --demo`), night shift
2026-10-24. The sandbox can't reach chaseholroyd.com or the map tile hosts, so **the live site was
NOT checked** and map tiles never loaded.

- **ux-reviewer (showcase mode):** 22 screens x 390x844 and 1280x800 x light and dark. axe-core
  (WCAG 2.2 A/AA) on every screen. Same-origin console errors counted.
- **qa-tdd:** unit 68 pass. All 8 e2e suites green 3x in three time zones (UTC, Asia/Tokyo,
  Asia/Kolkata), then again after the last fix. CI green on PR #18 head `a9e1789`. SQL, Edge and
  MLS suites unchanged tonight, green on `main` CI.
- **privacy-security:** M1.6 changes against CLAUDE.md hard rules and docs/PRIVACY.md. Pass, no
  P0 or P1.
- **positioning:** every README claim checked against what the demo actually does.

## Findings, ranked

Severity is staff-pm's call where the source lane didn't give one.

| ID | Sev | Where | Problem | Status | PR |
| --- | --- | --- | --- | --- | --- |
| PS-N1 | P0 if true | Demo job pins (Blockers 7) | Unknown if any of the four town-level pins sits near a real past or current job | Needs Chase | none |
| SEP-6 | P0 if true | `js/demo-backend.js` seed | Chase hasn't confirmed the demo names are made up | Needs Chase | none |
| SC-1 | P1 | Punch flow, demo | Demo read the visitor's real location ("Off site, 444 mi") | Fixed, SHOW-2 | #18 |
| SC-2 | P1 | Today, boss map | Before about 12:30 PM the sample shifts ran at night | Fixed, SHOW-3 | #18 |
| SC-3 | P1 | First screen | Told no story; no clear first tap | Fixed, SHOW-4 | #18 |
| AXE | P1 | Every screen | 38 axe violations: contrast, unnamed and overlapping map markers, attribution link | Fixed, SHOW-1 | #18 |
| POS-1 | P1 | README.md | 8 claims the demo can't back up (push alerts, Sheets, on-phone AI, "server sees only ciphertext", Pages hosting, crew app not marked not live, `Code.gs` "still works", wrong e2e command) | Fixed, `tests/readme.test.js` | #19 |
| PS-P2-1 | P2 | Crew build falling back to demo | Fake GPS could show there | Fixed, only when backend is `demo` | #18 |
| PS-P2-2 | P2 | Tests | No L3 test with the fake GPS on | Fixed, SHOW-5 | #18 |
| PS-P2-3 | P2 | Demo seed, HANDOFF | Real road names next to ~100 m pins | Fixed, town names only, "rural West Virginia" | #18 |
| SC-4 | P2 | Demo banner | 13px text, 30px link | Fixed, 15px, 44px | #18 |
| SC-5 | P2 | Boss header | 37px buttons | Fixed, 44px, "Refresh · time" | #18 |
| SC-6 | P2 | Map | Leaflet zoom 30px | Fixed, 44px. Pins and dots 30 to 40px remain | #18 |
| SC-7 | P2 | Fence hints | 12px, cut placeholder | Fixed, 14px | #18 |
| SC-8 | P2 | Inputs | No focus outline | Fixed | #18 |
| SC-9 | P2 | Jobs | Address cut with an ellipsis | Fixed, wraps to 2 lines | #18 |
| SC-10 | P2 | Today summary | Hours count only finished shifts | Open, logged | none |
| SC-11 | P2 | Mock phone prompt | Looks tappable (only seen with the fake off) | Open, logged | none |
| SC-12 | P2 | 1280x800 | Empty sides unused | Open, logged | none |

No P0 or P1 is open in code. The two "P0 if true" rows are checks, not known problems.

## Conditions before Chase adds it to the portfolio

1. **Confirm the demo data is made up.** Read the four job pins (Teays Valley, Cross Lanes, Scott
   Depot, Hurricane) and the crew names in `js/demo-backend.js`. Reply "none are real" in the
   thread. If one is near a real job or names a real person, stop: it gets moved or renamed first.
2. **Merge PR #18, then PR #19** (stacked). Wait for CI and the Pages deploy on `main`.
3. **Open https://chaseholroyd.com/crew-clock/ on your phone** after the deploy. Check: the intro
   and "Start here" show, Travis K. clocks in "On site" with no location prompt, the map tiles
   load, and the banner link goes back to chaseholroyd.com. Then add the card.

## What a recruiter sees

**In 90 seconds (phone):** a first screen that says what this is, with Travis K. marked "Start
here". A banner on every screen: made-up crew, saved only in this browser, back to
chaseholroyd.com. Three taps to clock in, and it lands "On site" without asking for location.

**In 5 minutes (laptop):** Billy S. shows the one-line consent screen. Sam W. (the boss) shows the
map, the Today list with "Not in yet" and hours, and the Jobs and Crew tabs. On GitHub: the README
with three screenshots and a "Why I built it", a green CI badge, the test suites, docs/PRIVACY.md
and the review docs in `docs/reviews/`.

## Known limits a hiring manager might ask about

- **No real users yet.** The crew app isn't live. It waits on Chase's Supabase and hosting setup
  (HANDOFF Blockers 1 to 3). The two-week beta with five workers hasn't started.
- **Retention isn't built.** M1.4 (retention and delete rules) has not started.
- **Crew sign-in hardening is open.** M1.9 (crew list open to anyone with the code, PIN guessing
  and lockout abuse, `*` CORS fallback, photo overwrite, report token, secret scanning in CI) must
  land before M2.1. None of it affects the demo, which has no backend.
- **Live site never opened from a session.** Every check ran on a local build.
- **Demo limits:** the boss's Today hours skip open shifts (SC-10); laptop sides are empty
  (SC-12); map pins and dots are 30 to 40px, under the 44px target.
- **Phone limits:** iPhones don't sync web apps in the background. A GPS-spoofing app can fake a
  location; photos and spot checks cover it. On-phone AI is untested on a real phone.
- **Housekeeping:** Dependabot PRs #10 and #13 need `@dependabot rebase`; #17 (esbuild) needs
  `npm run build:mls`.

## Portfolio card draft

**Crew Clock** · Three taps to clock in, even with no signal: a $0 offline time clock with a fair
geofence, built for my dad's construction crew. · https://chaseholroyd.com/crew-clock/

## M1.8 done-when

- ux-reviewer (showcase), qa-tdd and privacy-security ran: **met.**
- staff-pm ranked findings in this doc: **met.**
- No P0/P1 open: **met in PRs #18 and #19, not yet on `main` or live.**
- Chase asked once to add it to the portfolio: **this is the ask,** after conditions 1 to 3.

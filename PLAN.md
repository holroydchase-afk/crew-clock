# Plan: Crew Clock (CRW)

_Milestones in order. One branch and one PR per task (`m1.2-slug`, PR `M1.2: …`). A milestone is done only when every task's done-when passes. Update status here in the PR that changes it. IDs never get reused; cut work is marked `dropped`. Statuses: todo, doing, blocked, done, dropped._

## Goal
Chase's dad and a beta crew of 5 clock in and out at rural WV job sites in three taps, with location used only at the tap and only with each worker's recorded consent; recruiters try the same app as a public demo at chaseholroyd.com/crew-clock/ with sample data and no backend.

## Stack
Plain-JS PWA, no build step except `scripts/build-site.mjs` (copies the app to `dist/`, fills `config.js` from env). Two builds from one repo: **public demo** on GitHub Pages, always forced to demo mode (decided in M0.1), data only in the visitor's browser; **crew app** built separately for Cloudflare Pages (not set up) against Supabase (Postgres + RLS, Edge Functions), Backblaze B2 photos, web push, MLS chat (ts-mls), Google Sheets reports. No new runtime dependencies planned.

## M0: Studio setup
- `M0.1` Studio setup: CLAUDE.md, PLAN.md, agents, handoff-check, dependabot, LICENSE, README CI badge, Pages waits for CI and builds forced demo, HANDOFF sections — **doing** — done when the PR is merged with CI green and a Pages build with repo variables set still ships `backend: 'demo'` — branch `claude/project-thread-rewwa2` (named by the session)

## M1: Recruiter-demoable v1
_Done when the recruiter-ready bar (pm-tools ONBOARDING section 5) passes and `docs/reviews/<date>-recruiter-ready.md` says go. Every M1 task is buildable with no accounts from Chase._

- `M1.1` Demo can't reach a backend, and says it's a demo — doing (SEP-1..SEP-5 and SEP-6's rounded pins pass; SEP-6 name check is Chase's) — done when SEP-1..SEP-6 pass — branch `m1.1-demo-separation`
- `M1.2` Record each worker's location consent in the app — done (CON-1..CON-6 pass in demo mode, against local Postgres and in the Edge tests; CON-7 passed ux-reviewer on 390 and 1280 wide, light and dark) — done when CON-1..CON-7 pass in demo mode and against local Postgres — branch `m1.2-location-consent`
- `M1.3` Location read only at the clock-in/out tap — done (`tests/location.test.js` and `tests/e2e-location.js` LOC-1/LOC-2; PRIVACY L1/L2 marked true; privacy-security P1 fixed) — done when a test proves no GPS read happens on any screen except the punch flow (and the opt-in "nearest job" sort inside it), and docs/PRIVACY.md matches — branch `m1.3-location-at-tap`
- `M1.4` Retention and delete rules in code — done (`tests/sql/retention_test.sql` RET-1..5, DEL-1..3; `tests/e2e-demo.js` RST-1; consent records kept for good per CLAUDE.md, crew row anonymized; B2 purge function, Auth user delete and phone chat trim left for M2) — done when the retention periods in docs/PRIVACY.md are a SQL function with local tests (old punches, GPS points, photos keys, chat purged on schedule; a removed worker's data deleted or anonymized), and the demo has "Reset sample data" — branch `m1.4-retention`
- `M1.5` Night-shift hardening (qa-tdd + ux-reviewer on existing features, fix P0-P2) — doing (PR #6: P0/P1 fixed with tests, P2s fixed or logged in HANDOFF, suites 3x; waits on merge) — done when every P0/P1 found is fixed with a test, P2s are fixed or logged, all suites pass 3x — branch `m1.5-harden`
- `M1.6` Showcase polish: 390x844 and 1280x800, light and dark, WCAG 2.2 AA, no console errors or dead links, no TODOs or "coming soon" — done (`tests/e2e-showcase.js` SHOW-1..5 and `tests/showcase.test.js`; ux-reviewer 3 P1 fixed, P2s fixed or logged; privacy-security no P0/P1; all suites 3x in three time zones) — done when an axe run is clean on every demo screen in both themes and both sizes, and the e2e console listener records zero errors — branch `m1.6-showcase-polish`
- `M1.7` README for recruiters: "Try the demo" link, screenshot, why Chase built it (positioning drafts; story matches demo and portfolio) — done (`tests/readme.test.js`; positioning rewrite, claims checked against the demo) — done when README shows the live link, a current screenshot, CI badge and MIT license, and no claim the demo can't back up — branch `m1.7-readme`
- `M1.8` Recruiter-ready review — doing (`docs/reviews/2026-10-24-recruiter-ready.md`: go with conditions; waits on Chase's three steps) — done when ux-reviewer (showcase), qa-tdd and privacy-security have run, staff-pm ranked findings in `docs/reviews/<date>-recruiter-ready.md`, no P0/P1 open, and Chase is asked once to add it to the portfolio — branch `m1.8-recruiter-review`
- `M1.9` Crew sign-in and server hardening from the privacy review (F-03 crew list open to anyone with the code, PIN guessing and lockout abuse; F-06 `*` CORS fallback; F-12 photo overwrite; F-13 report token; F-15 secret scanning in CI) — todo — done when each has a failing-then-passing test and docs/reviews/2026-10-23-privacy-security.md marks it closed; must land before `M2.1` — branch `m1.9-crew-auth-hardening`
- `M1.10` Works for real: Chase's release plan phase 2 (sample chat, evening sample day, iPhone Safari tab bar, empty states) — done when tests pass (`tests/e2e-demo-chat.js`, `tests/e2e-works.js`, `tests/demo.test.js` EVENING) — branch `claude/project-thread-1jlll2`
- `M1.11` UI to 8/10: release plan phase 3 (ux-reviewer UX-R1..R17) — done when `tests/e2e-polish.js` passes and ux-reviewer scores >= 8 — branch `claude/project-thread-1jlll2-m1.11`
- `M1.12` Harden: PS-4, HRD-7, HRD-8, HRD-11, HRD-13, HRD-14, PS-M111-1, CRW-R3..R5 — doing (built; tests green) — done when `tests/harden2.test.js`, `tests/edge/harden.test.ts`, `tests/sql/harden_test.sql` and `tests/e2e-harden2.js` pass 3x and privacy-security has no P0/P1 — branch `claude/project-thread-1jlll2-m1.12`

### M1.1 acceptance criteria (SEP)
- **SEP-1 (auto, done in M0.1: `tests/site.test.js` "--demo build ignores backend variables")** Given the Pages workflow with `CREW_BACKEND=supabase` and `SUPABASE_URL` set, when `build-site.mjs` runs in demo-forced mode, then `dist/config.js` has `backend: 'demo'` and empty `supabaseUrl`, `supabaseAnonKey`, `orgCode`, `vapidPublicKey`, `backendUrl`.
- **SEP-2 (auto)** Given the demo build, when it is opened with `?org=ANY` or with a stale crew-app session in localStorage, then it stays in demo mode and the e2e network log has zero requests to any host other than its own origin, except map tiles (OpenStreetMap, USGS), which carry no crew data. The demo never offers the on-phone AI (it would load a model script from another site).
- **SEP-3 (auto)** Given demo mode, when any screen renders (sign-in, home, punch, boss tabs, chat), then a visible "Sample data, not a real crew" label is present and data is described as saved only in this browser.
- **SEP-4 (auto)** Given demo mode, when the visitor looks for a way out, then every screen has a link to `https://chaseholroyd.com` that resolves (not a 404).
- **SEP-5 (auto)** Given a crew-app build (`backend: 'supabase'`), when it renders, then no demo banner, demo PIN hints, "pretend I'm at the job" toggle, sample-data label or portfolio link appear.
- **SEP-6 (manual)** Given the demo seed in `js/demo-backend.js` (Ray T., Jake R., Cody M., Billy S., Travis K., four jobs), when Chase reads the list, then he confirms none is a real crew member or client; any match is renamed in this PR. Evidence so far (Oct 23): Chase never gave any crew or client names in the project chat; the seed was invented by an earlier Claude session. Cross-check with docs/reviews/2026-10-23-privacy-security.md. Also move demo job pins off real houses (public lots, or round to 3 decimals) and stub or allow the demo's Nominatim address search (F-01, F-07).

### M1.2 acceptance criteria (CON)
_Wording and what the consent covers come from docs/PRIVACY.md (privacy-security owns the text)._
- **CON-1 (auto)** Given a worker with no consent on record, when they sign in, then they see the one-line location consent before Home, with "I agree" and "Not now".
- **CON-2 (auto)** Given no consent, when the worker taps Clock in (or a foreman clocks them in), then no location is read and the app says consent is needed first.
- **CON-3 (auto)** Given the worker taps "I agree" with no signal, when signal returns, then one consent record (worker, consent text version, timestamp, device) syncs through the same offline queue as punches; demo mode stores it in the browser.
- **CON-4 (auto, SQL)** Given the `location_consents` table under RLS, then a worker can insert and read only their own records, the boss can read all records in their org, and nobody can update or delete one (withdrawal is a new record).
- **CON-5 (auto)** Given consent on record, when the worker taps "Stop using my location", then a withdrawal record is added, the next clock-in shows the consent screen again, and the boss's Crew tab shows "No location consent" for them.
- **CON-6 (auto)** Given the consent text version changes, when a worker who agreed to the old version signs in, then they are asked again.
- **CON-7 (manual)** Given a 390x844 phone, when ux-reviewer reads the consent screen, then it is plain words, under 40 words, readable at arm's length, and matches docs/PRIVACY.md.

## M2: Crew beta (5 workers, 2 weeks)
_Done when the beta crew has used the real app for 2 weeks, every worker's consent is on record, retention jobs have run at least once, and a beta gate review (go/no-go for all 10) is written._

- `M2.1` Supabase project live (SETUP 1.1-1.4, migrations incl. consent and retention) — blocked: Chase creates the Supabase project and pastes URL + anon key (about 25 min) — done when CI's e2e-supabase passes against it — branch `m2.1-supabase-live`
- `M2.2` Crew app host on Cloudflare Pages, separate from the demo — blocked: Chase creates a Cloudflare account and Pages project, picks the crew-app hostname (Porkbun DNS) — done when the crew URL serves `backend: 'supabase'` and chaseholroyd.com/crew-clock/ still serves demo — branch `m2.2-crew-host`
- `M2.3` Photos, alerts, Sheets (SETUP 2, 3, 4, 6, 7) — blocked: Chase's Backblaze bucket + keys, VAPID key, Google Sheet — done when a test punch with photo shows in the boss Map and the nightly Sheet row appears — branch `m2.3-services-live`
- `M2.4` Retention jobs scheduled live (pg_cron for M1.4's function) — blocked on M2.1 — done when one scheduled run is logged and old test rows are gone — branch `m2.4-retention-live`
- `M2.5` Install day: 5 phones, each worker agrees to location consent (SETUP 8) — blocked: Chase and his dad pick the day — done when 5 workers are signed in, 5 consent records exist, each did one clock-in/out — branch `m2.5-install-day`
- `M2.6` Beta gate review after 2 weeks — todo — done when staff-pm writes the go/no-go with evidence (punch success rate, help requests, missed punches, consent coverage) — branch `m2.6-beta-gate`

## Decisions for Chase (from HANDOFF)
- MLS: keep ts-mls for the beta (recommended) or swap in Chase's own build.
- Weekly report: hours only (recommended for beta) or hours times pay rate.

## Not now
- All 10 crew: only after the M2.6 gate says go.
- Capacitor / App Store build: web app is enough for the beta; Apple account waits.
- Chase's own MLS implementation: not on the critical path; same interface allows a later swap.
- Pay-rate reports: payroll data raises the privacy bar; hours only for the beta.
- Real-phone AI model download testing: belongs to the beta phones (M2.5), not the demo.
- Continuous or background location tracking: against the consent promise; location only at the tap.
- Background sync on iPhone: platform limit; the app already tells crew to open it on signal.
- Multi-company / sign-up for other contractors: one crew first.

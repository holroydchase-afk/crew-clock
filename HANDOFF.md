# Handoff: Crew Clock (CRW)

_Read this before starting work. Update it in the same commit whenever you make progress. It is the single source of truth for where things stand._

Updated: 2026-10-28 (studio refresh: agents by default)

## What it is

A GPS clock-in and clock-out phone app for a small construction crew in rural West Virginia. Low-tech crew, cheap phones, weak signal. Beta is one team of 5 for two weeks,
then all 10 if the beta gate passes. Budget is $0, so everything runs on free tiers. It is also
a portfolio piece: a public demo on sample data at chaseholroyd.com/crew-clock/.

Plan and milestone IDs: [PLAN.md](PLAN.md). Hard rules: [CLAUDE.md](CLAUDE.md). Privacy
contract: [docs/PRIVACY.md](docs/PRIVACY.md).

## Done

- Studio refresh (2026-10-28, Chase's ask): re-synced `.claude/agents/` from studio-agents (adds
  `architect`, updates `engineer`) and ran its `install-rules.sh`. The CLAUDE.md "Studio agents"
  section is now the studio template: the main session is Chase's chief of staff and sends each
  piece of work to the agent the table names, in order (staff-pm, qa-tdd red, engineer, qa-tdd 3x,
  then ux-reviewer / privacy-security / positioning). New `agents-check` PR workflow fails a PR
  without an `Agents:` line (or one that changes code without naming qa-tdd), and
  `scripts/check-agents.sh` (in `npm test` and CI) fails if the table and `.claude/agents/` drift.
  Also installed `scripts/check-logs.mjs` + `studio-checks.json` (roots `js`, `supabase/functions`),
  not wired into CI yet (see Exact next step).

- Stale live demo (2026-10-28): Pages had deployed `b410caa` (PRs #18-#21) fine, but phones
  that had opened an older deploy kept showing it ("Dad", old pins, no sample day). The service
  worker filled its new cache through the browser's HTTP cache (GitHub Pages: max-age=600), so a
  new version could be saved with the old files inside it. Now install uses `cache: 'reload'`, the
  background refresh uses `cache: 'no-cache'`, and the app version hash includes `sw.js` itself.
  `tests/e2e-update.js` (red before, green after) builds two deploys and checks a phone on the old
  one is on the new one by the second reopen. Live page not checked from the sandbox.
- The whole MVP: three-tap clock-in, offline queue, fair geofence with the phone's GPS error
  counted in the worker's favor, photo fallback, boss Map / Today / Jobs / Crew tabs, "Not in
  yet", "Wrong job? Fix it", foreman "clock in a teammate".
- v2 (PR #1): Supabase Postgres with row-level security, Edge Functions, signed hash-chained
  punches, Backblaze B2 photos, web push alerts, MLS encrypted crew chat, on-phone AI tiers,
  Google Sheets reports.
- Sign-in (PR #2): Supabase Auth sessions signed with asymmetric (ES256) keys. Phones keep a
  refresh token, never the PIN. Don't go back to shared-secret tokens.
- Hosting (PR #3): `scripts/build-site.mjs` builds `dist/`; the repo is public and GitHub Pages
  is deployed by Actions (first manual deploy succeeded 2026-10-23).
- CI runs unit, SQL / row-level security, Edge Function, MLS and browser tests on every PR.

Demo mode runs with nothing configured: `npm run serve`. In the demo you sign in by tapping a
name (no PIN); `demoPin: true` in `config.js` brings the PIN screen back. The demo boss is "Sam W.",
never "Dad" (Chase's ask, 2026-10-23). The real app always asks for the PIN.

- `M1.3` location read only at the tap, done when tests pass (branch `m1.3-location-at-tap`, stacked on M1.2): every
  GPS watch now belongs to one screen (`watchGps` in `js/app.js`, `signal` in `Geo.bestFix`) and
  stops at once when the worker backs out of "Finding you", taps "Take a picture instead", or the
  app goes to the background; the boss's "Use where I'm standing" stops when they leave the job form.
  Tests: `tests/location.test.js` (no location read outside the allowed places, none in `sw.js`),
  `tests/e2e-location.js` LOC-1 (zero reads on Home, teammate list, every boss screen, both sizes)
  and LOC-2 (red before the fix, green after), 4 `bestFix` unit tests. privacy-security: 0 P0,
  1 P1 (the job list's rough reading and the primer's reading didn't stop on leaving; both now go
  through `watchGps`, tested), P2s fixed (a stopped reading is thrown away, not used; the static
  test also scans `js/vendor`, `messenger/src` and pages, and catches any `geolocation` mention).
  The job list's sort and the primer are now rough watches (not one-shot reads), so the hardening
  GPS fake answers rough watches on its own as it did the one-shot reads; assertions unchanged.
- `M1.2` location consent (branch `m1.2-location-consent`, stacked on M1.1): table
  `location_consents` (insert-only, RLS own + boss) and `crew_consent_status()` (foreman/boss see
  latest action only); the sync function takes `kind: 'consent'` items (only your own); the app asks
  before Home and before the phone permission screen, reads no GPS without consent (foreman for a
  teammate too: picture instead), Home has "Stop using my location" / "Use my location for
  clock-ins", the boss's Crew tab says "No location consent", a new `CONSENT_VERSION` asks again.
  Demo seed v4: everyone agreed except Billy S. Tests: `tests/e2e-consent.js` (12 cases),
  `tests/sql/consent_test.sql` (CON-4), Edge `core.test.ts`. Done when passes: CON-1..CON-7 green;
  privacy-security (0 P0, 2 P1 + 4 P2, all fixed: server strips coordinates without a current agree,
  a refused record is forgotten, column-level insert grant) and ux-reviewer (CON-7 pass after the
  PRIVACY wording fix; Back buttons 48px, "Location is off" line 17px). PR #8 ready for review. Found on the way: the local
  `npm run test:sql` never failed on an error (fixed) and CI didn't run newer SQL files (fixed).
  Edge tests now run locally with `npx deno` (deno.land reachable again).
- `M1.1` demo separation (branch `m1.1-demo-separation`, stacked on PR #6 with PR #5 merged in):
  SEP-2..SEP-6 tests in `tests/e2e-demo.js` and `tests/demo.test.js`, red first, now green. The demo
  address search uses four made-up sample places instead of Nominatim; `DemoBackend.forgetCrewApp()`
  drops crew-app session keys and any session whose worker isn't in the demo seed (demo only);
  one banner on every demo screen (its link's tap area stays inside the banner, tested; "Sample data, made-up crew, saved only in this browser · Back to
  chaseholroyd.com"); the demo hides the on-phone AI buttons; `forgetCrewApp()` runs only when
  `backend: 'demo'`; job pins rounded
  to 3 decimals (demo store key now `cc.demo.db.v3`). Hardening tests updated for the merge (boss
  Sam W., tap-to-sign-in, new store key and pins); assertions unchanged.
  CI-only e2e-demo failures (2026-10-23 morning) were two real app races, both fixed test-first:
  the sign-in list redrew after the crew list reloaded even when nothing changed (a tap during the
  redraw was lost), and a sync still running at "Not you?" refreshed with no session and signed the
  next person out with "Your PIN was changed" (`syncNow` now pins each sync to the session that
  started it). e2e-demo now blocks service workers (Playwright routes miss a worker's own fetches,
  so tiles were reaching the real tile servers), answers tiles with a 1x1 PNG, closes each case's
  pages, and prints the screen and frame state on failure. `PW_HEADLESS_SHELL=1` runs the e2e
  tests on Playwright's headless shell, the browser CI uses (that is how the races reproduced).
  privacy-security on the sync fix: no P0/P1; two P2 follow-ups under Known limits.
  `tests/e2e.js` now waits for the sync line to settle on "waiting" after the offline clock-out
  (CI read it while the earlier online sync still said "Sending…"; the check itself is unchanged).
- `M0.1` studio setup (branch `claude/project-thread-rewwa2`): CLAUDE.md, PLAN.md, studio agents
  in `.claude/agents/`, `handoff-check`, dependabot, MIT LICENSE, README CI badge and demo link,
  docs/PRIVACY.md and the privacy-security review (15 findings: two P0, four P1), this HANDOFF
  layout. SETUP no longer names the company code or sends the crew to the demo's address. `pages.yml` now deploys
  only after CI passes on `main` and always builds demo-only (`build-site.mjs --demo` ignores
  backend variables and fails if config.js points at a backend; tested in `tests/site.test.js`).
- `M1.5` hardening (PR #6, draft, stacked on M0.1; night shift 2026-10-23). All P0/P1 found are
  fixed with a test. HRD-1/2/3/4/5/6/9 fixed by engineer against qa-tdd's tests (`tests/harden.test.js`,
  `tests/e2e-harden.js`), then privacy-security follow-ups PS-2, PS-6, PS-7. Unit (50), SQL/RLS, MLS
  and full e2e passed 3x locally after one flaky test was root-caused (the sync line was redrawn
  after `syncing` cleared; fixed in `syncNow`). Edge Function tests run in CI only (no deno here).
  ux-reviewer findings fixed test-first the same night: UX-1 "Wrong job? Fix it" after sync
  (`Store.outbox.get` now resolves undefined for a missing id; a punch saved mid-sync is sent right
  after), UX-2 live "Sent to the boss" line on the done screen, UX-3 foreman clock-out uses the
  teammate's open job, UX-4 one 112x52 "Clock in"/"Clock out" button per teammate with an
  "On at … since …"/"Off" line, UX-5 boss tab bar fits under the demo banner, UX-6 map legend clear
  of the attribution, UX-7 demo seed slides back before ~12:30 PM so shifts have real hours,
  UX-8 Today summary names each person once with no "..", UX-9 Back on "Finding you" and the photo
  screen, UX-10 "GPS signal: weak (about …)"/"good", UX-16 contrast tokens (all text ≥ 4.5:1).
  HRD-9's browser case now clocks in Travis (Cody is on the clock in the seed, so his row only
  offers "Clock out"); its assertions are unchanged.
## In progress

- `M1.4` retention and delete rules, done when tests pass (branch `m1.4-retention`, stacked on M1.8;
  morning shift 2026-10-24). Migration `20261024000000_retention.sql`: `app.apply_retention(p_now)`
  does every server-side row of PRIVACY's retention table (hours deleted at 3 years, GPS nulled at
  90 days with status and distance kept, picture keys queued in `app.photo_purge` and nulled at 60
  days, chat ciphertext at 30 days, used key packages 30 days after `claimed_at`, phones 90 days
  after `revoked_at`, a worker who left anonymized to "Former crew member" once no hours are left).
  Only the owner can run it (pg_cron, M2.4): phones get 42501. Turning a worker off in the Crew
  tab now also revokes their phones, drops push, chat membership and unused key packages (trigger
  `crew_offboard`). `public.erase_crew_data(crew)` is the boss's "delete their data" action (GPS,
  pictures, phones, push, key packages, sent chat; hours and consent kept). FKs `punches.voids_id`
  and `punches.device_id` are now `on delete set null` so old rows can go. Tests:
  `tests/sql/retention_test.sql` (qa-tdd, 16 cases, red then green). privacy-security on M1.4:
  1 P1 and 3 P2, all fixed test-first: GPS removal now also removes the punch's hash, signature and
  the next punch's `prev_hash` (they cover the location, so it could be brute-forced back); a worker
  is anonymized 3 years after `deactivated_at`, not at the next run; rows revoked or claimed before
  this migration get `revoked_at`/`claimed_at` of today. Residual (logged, not fixed): the next
  punch's own hash still covers that pointer until it is trimmed too (days), and `devices.last_hash`
  holds the newest hash; a per-punch random salt in `js/chain.js` (chain v2) would close both. Demo: "Reset sample data" in
  the demo banner clears the visit and reloads the sample crew (`tests/e2e-demo.js` RST-1; SEP-4 now
  also checks the banner's two controls never cover each other; SEP-5 checks the crew app has no
  reset). Left for later: the B2 purge Edge Function that drains `app.photo_purge` (M2.3), deleting
  the Supabase Auth user at 3 years, the phone's 90-day chat trim, the delete-company script, the
  boss's "Erase their data" button in the Crew tab (the SQL is ready), and `hold_until` (R3).

- `M1.8` recruiter-ready review (branch `m1.8-recruiter-review`, stacked on M1.7):
  `docs/reviews/2026-10-24-recruiter-ready.md`, staff-pm's ranked findings from tonight's
  ux-reviewer, qa-tdd, privacy-security and positioning runs. Verdict: go with conditions. No P0/P1
  open in code; the two "P0 if true" rows are Chase's checks (demo pins, SEP-6 names). Done when
  Chase does the doc's three steps: confirm the demo data is made up, merge #18 then #19, open the
  live demo on his phone, then add the portfolio card (draft in the doc).
- `M1.7` README for recruiters (branch `m1.7-readme`, stacked on M1.6): positioning's rewrite.
  Leads with what it is, "Try the demo", three screenshots from the demo build
  (`docs/screenshots/`, 390x844 at 2x, 1:30 PM page clock), a "Why I built it", a 90-second
  walkthrough, the product decisions, and a table of what the demo shows versus what only the crew
  app does (push alerts, Sheets reports and on-phone AI are crew-app only; the crew app isn't live
  yet). Fixed claims the demo couldn't back up (alerts, Sheets, AI labels, "server sees only
  ciphertext" in the demo, Pages hosting for the crew app, `Code.gs` "still works").
  `tests/readme.test.js` fails if a README link or image is missing, the live link, badge or
  license goes, or the walkthrough names someone who isn't in the demo crew.
- `M1.6` showcase polish, done when tests pass, PR #18 ready (branch `m1.6-showcase-polish`, night shift 2026-10-24, Chase's steer:
  recruiter readiness first). `tests/e2e-showcase.js` runs axe-core (WCAG 2.2 A/AA) on every demo
  screen at 390x844 and 1280x800, light and dark, and fails on any same-origin console error;
  `tests/showcase.test.js` fails on TODO/"coming soon" in the shipped demo, broken same-site links,
  or an outside link that isn't chaseholroyd.com or this repo. Red first (38 violations), now green.
  Fixed: text on light-blue chips (`--blue-ink`), amber text (`--amber` #854d0e), the on-site map
  dot, dark fence hints, Leaflet's attribution link, map markers now named ("Jake R., On site")
  and laid out in a row above their job's pin so they never cover each other. Demo job "Scott
  Depot deck" moved so the four jobs don't overlap on a phone. CI installs `axe-core@4.11.3`
  (test only, `--no-save`, never shipped).
  ux-reviewer showcase sweep (22 screens x 4 setups): 0 P0, 3 P1, 9 P2. P1s fixed test-first
  (`tests/e2e-showcase.js` SHOW-2..4): the demo starts with "pretend I'm at the job" on, so it never
  reads a visitor's real location and the first clock-in lands "On site"; the sample day always
  runs in daytime hours (before 9 AM it's yesterday's, shown as "Yesterday (sample day)", store key
  v5); the first screen says what this is and marks Travis K. "Start here". P2s fixed: 15px banner
  with a 44px link, 44px boss-header buttons ("Refresh · time"), 44px map zoom buttons, 14px fence
  hints, focus outlines on inputs, job addresses wrap to two lines, stale map dots keep contrast.
  The harden suite runs on a 1:30 PM page clock because the seed now depends on the hour.
- Merged 2026-10-23: M0.1 (#4), M1.5 (#6), M1.1 (#7, with #5), M1.2 (#8), M1.3 (#9); their notes
  are under Done above.
- Left from `M1.5` (P2, logged, not fixed): PS-1 punches held for someone who never signs in again
  are invisible to the boss (send a content-free "N unsent on a phone" notice); PS-3 no retry
  backoff for transient failures; PS-4 "Unknown crew member" drops a turned-off worker's last
  clock-out silently; PS-5 server should check a late `replay_or_old` punch fills the recorded gap
  and clear the neighbor's `chain_gap`; HRD-7 Today hides a shift that started before midnight;
  HRD-8 GPS boundary unit tests; HRD-11 worker and foreman both closing one shift offline;
  HRD-12 empty states (no jobs, no crew); HRD-13 private mode keeps the outbox in memory only;
  UX-11 mark the current job in the fix picker; UX-12 chat "No groups yet" dead end; UX-13/14 Add
  job placeholder, inline error, 15px size labels; UX-15 boss header "Sign out" / "Refresh";
  UX-17 keypad Delete icon and key borders in dark; UX-18 "See photo" label on Today.

## Exact next step

Log check: `node scripts/check-logs.mjs` reports 2 findings, both P2 until privacy-security rates
them (a whole error object in Edge logs could carry punch or user data): CRW-R1
`supabase/functions/_shared/http.ts:28`, CRW-R2 `supabase/functions/sync/index.ts:16`. In their own
PR: qa-tdd failing case first, log `e.name` or a fixed word, privacy-security review, and add
`check-logs` to `npm test` and CI in that same PR.

Chase: the three steps in `docs/reviews/2026-10-24-recruiter-ready.md` (confirm the demo pins and
names are made up, merge #18 then #19 then #20, open the live demo on his phone), then review the
M1.4 PR and decide on consent-record retention (Decisions to review). Next build task: `M1.9` crew
sign-in and server hardening (F-03, F-06, F-12, F-13, F-15), failing tests first; or the boss's
"Erase their data" button and the B2 purge function if Chase wants M1.4's leftovers first.

## Decisions to review

- **Studio refresh: kept this repo's `handoff-check.yml`.** install-rules reported it as "kept
  existing"; ours is newer than the template (skips Dependabot, checkout@v7), so nothing to merge.
  `.claude/settings.json` was already identical. `agents-check.yml` bumped to checkout@v7 to match.
  Worth porting the Dependabot skip back to studio-agents' template.

- **M1.4: consent records are kept for good.** PRIVACY C6 said "on the crew + 3 years, then
  deleted", but CLAUDE.md's hard rule says consent records are never edited or deleted, and the
  hard rule wins. So a worker who left keeps their consent records, and their crew row is
  anonymized (name "Former crew member", no PIN) instead of deleted, because the records point at
  it. Chase's call: keep it, or change the hard rule so consents go at crew + 3 years (staff-pm
  recommends yes, wording by privacy-security).
- **M1.4: GPS removal also removes the punch's hash and signature**, because they cover the
  location and would let it be guessed back. Old punches can't be re-verified; `sig_ok` keeps the
  result from when the punch arrived. Proposed next: chain v2 with a per-punch random salt (M1.9
  or M2), so the residual guess through the next punch's hash goes away.
- **M1.4: "Reset sample data" sits in the demo banner** (every screen) and asks once before
  clearing. It clears only `cc.*` keys and the app's own IndexedDB stores, then reloads.

- **Demo (M1.6): "pretend I'm at the job" starts on**, so the demo never asks for or reads a
  visitor's location (a recruiter in another state would otherwise see "Off site, 444 mi"). The
  checkbox on Home turns it off. The consent and location tests opt out to cover the real path.
- **Demo (M1.6): before 9 AM the sample day is yesterday** (everyone clocked out by 3:30 PM) and the
  boss's list says "Yesterday (sample day)"; from 9 AM it's today from 6:54 AM. Replaces UX-7's
  slide-back, which showed 1 AM shifts; UX-7's unit test now checks the shown day and daytime hours.
- **Left from the showcase sweep (P2, logged):** SC-10 the Today summary's hours count only finished
  shifts; SC-11 caption the mock phone prompt (only seen with the fake off); SC-12 use the empty
  sides on a laptop for the pitch and a short tour; tab labels and legend chips stay 13px.
- **Demo (M1.6): on the boss map, everyone at a job sits in a row above that job's pin**, not at
  their exact GPS point, so dots never cover each other on a phone (WCAG target size). Off-site
  punches still sit where they were. The popup still shows distance and accuracy.
- **Location (M1.3): the GPS watch stops when the app goes to the background** during "Finding
  you", and the worker clocks in with a picture after. Stricter than "stops when they leave the
  screen"; if real phones background the app for the permission prompt, revisit.
- **Consent (M1.2): a foreman who clocks in a teammate in the first second after sign-in**, before
  the crew's consent status has loaded, gets the picture path even for a teammate who agreed (the
  safe side). Found as a CI-only race in the CON-2 guard; the test now waits for the status.
- **Consent (M1.2): "Not now" is not remembered across app reloads**, so a worker who never agreed
  is asked again each time the app opens (ux-reviewer P2: may feel like nagging). Simplest fix if Chase
  agrees: remember "Not now" on the phone and ask again only from CLOCK IN or the link. Check with a real user.
- **Consent (M1.2): the boss's Crew tab says "No location consent"** for both "never agreed" and
  "stopped". ux-reviewer suggests "Location off" (plainer). Kept for now because CON-5 names the words;
  changing them means updating PLAN CON-5 and the tests together.
- **Consent (M1.2): after "Stop using my location", the app asks again only at Clock in**, not every
  time it opens; a worker with no record, or one who agreed to older words, is asked at sign-in.
  "Not now" lasts until they sign out. Undo: ask on every open.
- **Consent: the phone keeps each worker's newest consent record** (`cc.consents`: action, text
  version, time) through sign-out, so someone who agreed with no signal isn't asked again before it
  sends. Undo: clear it on sign-out (they'd be asked again offline).
- **Consent: the server also drops coordinates** from a punch by a worker whose latest consent at
  that time isn't "agree" to `loc-v1` (privacy-security P1); the clock-in still counts. The punch's
  signature covers the original GPS, so a stored row with GPS dropped won't re-verify; nothing
  re-verifies stored rows today.
- **Consent: the witness field is not built** (always empty); the install-day helper isn't recorded.
- **Consent text says "on the home screen"** instead of "in the menu" (the app has no menu), still
  version `loc-v1` because no worker had seen it.
- **The app now sends a person's queued items right after they sign in** (before: on the next
  60-second tick, signal change or app focus).
- **The demo still loads map tiles** from OpenStreetMap and USGS (no crew data in those requests);
  every other off-site request is gone. Undo: a static map image, at the cost of a real map.
- **The demo hides on-phone AI** ("Write it up with AI", photo labels), because they download a
  model from another site. The plain-words summary stays.
- **Public demo and crew app are two builds.** GitHub Pages only ever serves the demo (sample
  data in the visitor's browser, no backend). The crew's real app will be a separate Cloudflare
  Pages build on its own address with the Supabase variables (SETUP step 5). Undo: drop `--demo`
  from `pages.yml`, but then recruiters and the crew share one site.
- **Pages waits for CI** via `workflow_run`, and deploys the exact commit CI tested.
  `workflow_dispatch` still deploys by hand.
- **handoff-check skips Dependabot PRs** (a version bump doesn't move the work, and Dependabot
  can't edit HANDOFF.md). Undo: drop the `dependabot[bot]` condition in `handoff-check.yml`.
- **Dependabot skips `@noble/curves`**: ts-mls 1.6.4 pins it to exactly 2.0.1 as a peer, so
  Dependabot's #14 (2.0.1 to 2.4.0) broke `npm ci`. #14 is closed; the curves version moves with ts-mls.
- **Dependabot** watches `messenger/` (the only npm dependencies) and Actions. A messenger bump
  also needs `npm run build:mls` committed, or CI's bundle check fails; that's intended.
- **Retention defaults** (docs/PRIVACY.md): hours 3 years, raw GPS 90 days, photos 60 days,
  chat ciphertext 30 days, based on federal FLSA minimums. Built in `M1.4`.
- **Company code is no longer written in the repo.** SETUP uses a `<CODE>` placeholder and tells
  Chase to pick random letters, because anyone with the code can see the crew name list (F-03).
- MLS: keep the open-source ts-mls library for the beta (recommended), or swap in Chase's own
  build behind the same interface in `messenger/`.
- Weekly report: hours only for the beta (recommended), or hours times pay rate.
- **HRD-1: a queued item sends only under the person who made it** (`byCrewId`). Someone else's
  punches stay queued until they sign in again; the sync line counts only yours. Job/crew edits now
  carry `byCrewId` too.
- **HRD-2: only permission refusals are dropped** (Only a foreman / Unknown crew member / Boss only /
  Not yours). Any other refusal stays queued and shows its reason on the sync line.
- **PS-2: a permanent refusal is cut to a stub and never resent** (supersedes "is retried" above).
  Every refusal the server returns is a 4xx (`Punch too old`, `Bad punch type`, `Bad id`, `unknown
  kind`), so the phone keeps only kind, id, crewId, byCrewId, type, at, jobId and the reason; GPS,
  photo, signature and edit data are deleted. Network, 5xx and photo-upload failures keep the full
  item and retry. Open: stubs stay until the app gets a "clear" action or a retention trim.
- **UX-7: before about 12:30 PM the demo seed slides the seeded day back** so the last punch is an hour old and shifts show real hours;
  a 1 AM visitor sees shifts that started around 1 AM. Undo in `js/demo-backend.js` seed anchor.
- **HRD-6: a punch whose photo won't upload stays queued with its photo; the rest send.** A later
  resend can then arrive out of chain order (server marks it `replay_or_old`, no new flag).
- **HRD-9: a foreman can finish a teammate punch with no picture; it is flagged high**
  (`teammate_no_photo`).
- **PS-6: "no picture" now means no `photoKey`, `photo` or `hasPhoto`**, fields present or not,
  because the server only ever gets `photoKey`. Before, a server-side foreman punch with no photo
  was never flagged. `hasPhoto` stays in the check so the boss's team view doesn't false-flag.

## Blockers

Waiting on Chase, in order (each unblocks an M2 task; nothing in M1 needs these):

1. Supabase project and SETUP steps 1.1 to 1.4 (about 25 minutes). Unblocks `M2.1`.
2. Cloudflare Pages for the crew app, SETUP step 5 "Crew app" (about 10 minutes). Unblocks `M2.2`.
3. Backblaze, secrets, alerts and Sheets, SETUP steps 2, 3, 4, 6 and 7 (about 40 minutes).
4. Install day on the crew's phones, SETUP step 8, after `M1.2` consent ships.
5. Check West Virginia's record-keeping and employee-monitoring rules (docs/PRIVACY.md "Needs
   Chase") with whoever does the company's payroll. Only the hours row could change.
6. Turn on secret scanning and push protection (2 minutes): repo **Settings > Advanced Security**
   (or **Code security**) > Secret Protection > Enable, then Push protection > Enable.
7. Confirm none of the demo's four made-up job pins (town level: Teays Valley, Cross Lanes, Scott
   Depot, Hurricane; rounded to about 100 m) sits near a real past or current job (privacy-security
   P2 on M1.6, 2026-10-24). Needed before the portfolio link (M1.8).

## Portfolio / public presence

- 2026-10-24 (M1.6, M1.7 night shift): the demo opens with what it is and a "Start here" name,
  never reads a visitor's location, keeps the sample crew in daytime hours, and passes axe on every
  screen; the README now matches what the demo shows, with screenshots.
- Portfolio page: not yet; Product Studio adds the card once the demo passes the recruiter-ready
  bar (`M1.8`).
- Live demo: https://chaseholroyd.com/crew-clock/ (GitHub Pages, deployed by
  `.github/workflows/pages.yml` after CI passes on `main`, demo-only build).
- Demo data: made-up crew (Sam W., Ray T., Jake R., Cody M. and others), jobs and sample
  address-search places, seeded in `js/demo-backend.js`, kept only in the visitor's browser. Job
  pins rounded to 3 decimals. No real people, accounts or keys.
- Studio status: https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- 2026-10-23 (M1.1, merged): every demo screen gets "Sample data, made-up crew, saved only in
  this browser · Back to chaseholroyd.com"; no AI model downloads in the demo; the demo's address search is local; a stale crew-app session can't carry into
  the demo.
- 2026-10-23: first Pages deploy from `main` (manual run). M0.1 makes every later deploy wait for
  CI and forces demo mode.

## Known limits

- P2 (privacy-security, 2026-10-23): in the crew app, `refreshSession` in an old sync can finish
  after the next person signs in and overwrite their saved session (needs a token close to expiry).
  Needs its own test. Also worth a static test that `sw.js` reads no location and names no hosts.
- iPhones don't sync web apps in the background; the app tells crew to open it when they get
  signal.
- A GPS-spoofing app can still fake a location. Photos, addresses and spot checks cover it.
- AI model downloads have never been tested from a real phone (the build sandbox blocks
  Hugging Face), so those tiers are tested with the model step stubbed.
- The build sandbox can't reach chaseholroyd.com or github.io, so the live demo has not been
  opened from a session; it's tested from a local `--demo` build.

## Links

- Setup guide: [docs/SETUP.md](docs/SETUP.md)
- Privacy review: [docs/reviews/2026-10-23-privacy-security.md](docs/reviews/2026-10-23-privacy-security.md)

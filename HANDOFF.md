# Handoff: Crew Clock (CRW)

_Read this before starting work. Update it in the same commit whenever you make progress. It is the single source of truth for where things stand._

Updated: 2026-10-23 (night shift, M1.5)

## What it is

A GPS clock-in and clock-out phone app for a small construction crew in Putnam and Kanawha
counties, WV. Low-tech crew, cheap phones, weak signal. Beta is one team of 5 for two weeks,
then all 10 if the beta gate passes. Budget is $0, so everything runs on free tiers. It is also
a portfolio piece: a public demo on sample data at chaseholroyd.com/crew-clock/.

Plan and milestone IDs: [PLAN.md](PLAN.md). Hard rules: [CLAUDE.md](CLAUDE.md). Privacy
contract: [docs/PRIVACY.md](docs/PRIVACY.md).

## Done

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

## In progress

- `M1.2` location consent (branch `m1.2-location-consent`, stacked on M1.1): table
  `location_consents` (insert-only, RLS own + boss) and `crew_consent_status()` (foreman/boss see
  latest action only); the sync function takes `kind: 'consent'` items (only your own); the app asks
  before Home and before the phone permission screen, reads no GPS without consent (foreman for a
  teammate too: picture instead), Home has "Stop using my location" / "Use my location for
  clock-ins", the boss's Crew tab says "No location consent", a new `CONSENT_VERSION` asks again.
  Demo seed v4: everyone agreed except Billy S. Tests: `tests/e2e-consent.js` (11 cases),
  `tests/sql/consent_test.sql` (CON-4), Edge `core.test.ts` (3 cases). Found on the way: the local
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

Chase merges M0.1 (PR #4), then PR #6 (M1.5 hardening), the M1.1 PR #7 (branch
`m1.1-demo-separation`, which already contains #5 and #6), then the M1.2 PR (branch
`m1.2-location-consent`, stacked on #7). CON-7 (ux-reviewer reads the consent screen at 390x844)
is the one manual check left in M1.2. Next build task: `M1.3` location read only at the tap
(branch `m1.3-location-at-tap`, stacked on `m1.2-location-consent`): qa-tdd writes the failing
test that no screen except the punch flow reads GPS, and that backing out of "Finding you" stops
the watch at once (PRIVACY L1, L2).

## Decisions to review

- **Consent (M1.2): after "Stop using my location", the app asks again only at Clock in**, not every
  time it opens; a worker with no record, or one who agreed to older words, is asked at sign-in.
  "Not now" lasts until they sign out. Undo: ask on every open.
- **Consent: the phone keeps each worker's newest consent record** (`cc.consents`: action, text
  version, time) through sign-out, so someone who agreed with no signal isn't asked again before it
  sends. Undo: clear it on sign-out (they'd be asked again offline).
- **Consent: the server doesn't strip coordinates** from a punch by a worker with no consent on
  record; the phone never reads them (L3). A server-side check is a cheap follow-up if wanted.
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

## Portfolio / public presence

- Portfolio page: not yet; Product Studio adds the card once the demo passes the recruiter-ready
  bar (`M1.8`).
- Live demo: https://chaseholroyd.com/crew-clock/ (GitHub Pages, deployed by
  `.github/workflows/pages.yml` after CI passes on `main`, demo-only build).
- Demo data: made-up crew (Sam W., Ray T., Jake R., Cody M. and others), jobs and sample
  address-search places, seeded in `js/demo-backend.js`, kept only in the visitor's browser. Job
  pins rounded to 3 decimals. No real people, accounts or keys.
- Studio status: https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- 2026-10-23 (M1.1, unmerged): every demo screen gets "Sample data, made-up crew, saved only in
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

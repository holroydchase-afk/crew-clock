# Product notes: Crew Clock (CRW)

Decisions, lessons, outside accounts and the claims register in one file (the small-repo option in
studio-agents `docs/studio-standard.md` section 3). IDs and rules are the same as the split files;
split a section into its own file once it passes a screen. Public repo: no names but Chase and the
boss, no ids, addresses, emails or links to private accounts.

## Decisions

Every call Chase makes, newest first. Add the entry in the same PR as the call. Team calls still
waiting on Chase live in HANDOFF "Decisions to review" until he answers; the ones below are settled
or were his own words.

- **CRW-DEC-1** (2026-11-23) Chase never updates settings, environments or repos by hand. His
  words: "I never want to update your settings or environments or repos." Why: he has about an hour
  a night. Beat: asking him to paste fixes. Lives in CLAUDE.md (self-check paragraph, issue #46).
- **CRW-DEC-2** (2026-11-21) Text links on crew screens are ink and underlined, not accent (DS-10,
  UX-R61, "Chase's call"). Why: rust/red on a crew screen should only mean Clock out. Beat:
  accent-colored links from the design system's principle 6.
- **CRW-DEC-3** (2026-11-18) Run a three-seat portfolio review (recruiter, staff PM, engineering
  manager) and work its ranked backlog in order ("Chase's ask"). Why: the demo is a portfolio
  piece first until the beta. Beat: more features. First item shipped as `M1.16` (geofence eval).
- **CRW-DEC-4** (2026-11-01) Adopt the studio standard. His words: "I want all projects to be
  standardized ... I don't want to deal with it." Why: one rule set across his projects. Beat:
  per-repo rules (issue #39).
- **CRW-DEC-5** (2026-10-31) "Test and merge all": open PRs get tested and merged oldest first.
  Why: a short PR queue he can review on a phone. Beat: PRs waiting on him one by one. The
  live-demo gate stays: a merge to `main` redeploys the public demo, so CLAUDE.md keeps "never
  merge to `main` without Chase's go".
- **CRW-DEC-6** (2026-10-29) Live demo check: "fix it all". Why: the demo was loaded live for the
  first time and had four bugs (LIVE-1..4). Beat: logging them for later.
- **CRW-DEC-7** (2026-10-29) Put Crew Clock on the portfolio site as a public demo on made-up data
  (Product Studio intake). Why: recruiters should see it working. Beat: screenshots only.
- **CRW-DEC-8** (2026-10-24) Retention defaults: hours 3 years, raw GPS 90 days, pictures 60
  days, chat 30 days (docs/PRIVACY.md, from federal FLSA minimums). Why: keep only what payroll
  needs. Beat: keeping everything. Open part: consent records are kept for good (HANDOFF).
- **CRW-DEC-9** (2026-10-23) The public demo and the crew app are two builds; Pages builds only
  with `--demo` and never gets a backend address. Why: a visitor can never reach crew data. Beat:
  one site for both. Hard rule in CLAUDE.md.
- **CRW-DEC-10** (2026-10-22) Sign-in on Supabase Auth with asymmetric (ES256) keys; phones keep
  a refresh token, never the PIN (PR #2). Why: no shared secret to leak. Beat: shared-secret token
  minting. Hard rule in CLAUDE.md.
- **CRW-DEC-11** (2026-10-22) $0 stack on free tiers, no analytics or tracking scripts. Why: a
  family crew's tool and a portfolio piece; nothing to bill. Beat: paid hosting and push services.
- **CRW-DEC-12** (2026-10-22) Never block a clock-in: a bad fix or no signal means a picture or a
  flag. Why: the crew is low-tech on weak signal, and a refused punch loses pay. Beat: a strict
  geofence. Measured by the `M1.16` eval.

Still open for Chase (recommendation in PLAN and HANDOFF): ts-mls for the beta (yes); hours-only
reports (yes); consent kept for good vs crew + 3 years; tighten the geofence (no).

## Lessons

Post-mortems, newest first. Write one after any lost evening, broken demo or wrong call; read this
before picking a version or calling a build ready.

- **2026-10-31 CI image moved under us.** GitHub's ubuntu-latest became Ubuntu 26.04 and
  Playwright 1.56.1 would not install Chromium, so the test job failed before any test ran. Rule:
  the browser test job pins `ubuntu-24.04` until Playwright supports the new image; read the
  runner image notes before bumping either.
- **2026-10-31 A test that only failed on a Saturday.** UX-R29 went red on main: on Saturday the
  sample week has six days and totals like "49.1+", and the Week table was 321px in a 320px box.
  Rule: layout tests pin the clock to the widest day of the period, never today's date.
- **2026-10-28 Stale live demo from the service worker.** Pages deployed fine, but phones that had
  opened an older deploy kept showing it. The service worker filled its new cache through the
  browser's HTTP cache (Pages: max-age=600), so a new version could hold old files. Rule: install
  uses `cache: 'reload'`, refresh uses `cache: 'no-cache'`, the version hash includes `sw.js`;
  `tests/e2e-update.js` checks a phone on the old deploy reaches the new one by the second reopen.
- **2026-10-28 Reset could bring a punch back.** "Reset sample data" deleted IndexedDB without
  waiting and reloaded, so an unsent punch could survive and sync back; CI caught it, local runs
  did not. Rule: reset waits for the deletes and the store closes on `versionchange`. A race fixed
  by reading needs a test that waits for the real event, not a sleep.
- **2026-10-28 Logs could carry punch data.** Edge Functions logged whole errors, whose messages
  could hold punch data, URLs or keys (CRW-R1, CRW-R2). Rule: log only the error's name;
  `scripts/check-logs.mjs` runs in `npm test`.
- **2026-10-23 A dependency bump broke install.** Dependabot moved `@noble/curves` past the exact
  version ts-mls pins as a peer, and `npm ci` failed. Rule: Dependabot leaves `@noble/curves` to
  ts-mls; it moves only with a ts-mls bump.

## Accounts

Outside accounts by type only: no ids, project names, addresses or emails here. Real config lives
only in the crew app host's variables (CLAUDE.md). Status comes from HANDOFF "Blockers".

| Account | What it holds | Where the name is baked in | Rename cost |
|---|---|---|---|
| Supabase | Database, sign-in, Edge Functions, scheduled alerts (not created yet, Blocker 1) | Crew app build variables, the schedules migration's placeholders, the Sheet's script properties | Rename cost: low before install day; after it, every crew phone's refresh token points at the old project and needs a fresh sign-in |
| Backblaze B2 | Clock-in pictures, private bucket | Bucket name and CORS rule (crew app address only), function secrets | Rename cost: low; a new bucket means moving or dropping pictures under 60 days old |
| Resend | Email, named in the CLAUDE.md hard rules; not wired into SETUP yet | Nothing in the repo | Rename cost: none today |
| GitHub and GitHub Pages | The public repo and the public demo | Repo name in the demo path, README badge, portfolio links, Pages workflow | Rename cost: medium; the demo path and portfolio card links move together |
| Cloudflare Pages | The crew app build (not set up, Blocker 2) | The crew app address sent to each phone on install day, `APP_ORIGIN`, the B2 CORS rule | Rename cost: high after install day; every phone's home-screen app points at the old address |
| Google (Sheets, Apps Script) | The boss's daily and weekly hours reports | The Sheet's script properties | Rename cost: low; make a new Sheet and paste the script |
| Domain registrar | The portfolio domain (demo path) and the planned crew app subdomain | DNS for Pages and the crew app | Rename cost: high; warn Chase before anything locks it |

Before anything that locks a name (a domain, the crew app address on install day, telling the
crew), stop and warn Chase.

## Marketing claims register

Owned by `positioning`. Public copy (README, portfolio card, demo text) uses only claims listed
here, each with a proof in the repo that passes today. Add the proof first, then the claim.

| ID | Claim | Proof |
|---|---|---|
| CRW-CLAIM-1 | The geofence counts GPS error in the worker's favor, and a simulated eval measures how loose that is | `docs/evals/geofence.md` |
| CRW-CLAIM-2 | Location is read only while clocking in or out (and the boss's job pin); never in the background | `tests/location.test.js` |
| CRW-CLAIM-3 | The public demo has no server address in it, so a visitor can't reach crew data | `tests/site.test.js` |
| CRW-CLAIM-4 | Each punch is signed on the phone and chained; the boss's check names a changed punch | `tests/enhance.test.js` |
| CRW-CLAIM-5 | The weekly CSV carries name, date, in, out and hours only, no GPS | `tests/enhance.test.js` |
| CRW-CLAIM-6 | Works with no signal: punches queue on the phone and send later | `tests/e2e-enhance.js` |
| CRW-CLAIM-7 | Crew chat is end-to-end encrypted with MLS; the server never sees message text (it does see chat metadata: group names, members, who sent when) | `messenger/mls.test.mjs` |
| CRW-CLAIM-8 | Server logs never carry punch data, URLs or keys | `tests/check-logs.test.js` |

Not claimable yet: anything about real crew use or results (the beta has not run), "three taps"
as a measured number, uptime, and the crew app being live.

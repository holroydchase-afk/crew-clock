# Handoff: Crew Clock (CRW)

_Read this before starting work. Update it in the same commit whenever you make progress. It is the single source of truth for where things stand._

Updated: 2026-10-23 (studio onboarding thread, M0.1)

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

Demo mode runs with nothing configured: `npm run serve`, PINs in the README.

## In progress

- `M0.1` studio setup (branch `claude/project-thread-rewwa2`): CLAUDE.md, PLAN.md, studio agents
  in `.claude/agents/`, `handoff-check`, dependabot, MIT LICENSE, README CI badge and demo link,
  docs/PRIVACY.md and the privacy-security review (15 findings: two P0, four P1), this HANDOFF
  layout. SETUP no longer names the company code or sends the crew to the demo's address. `pages.yml` now deploys
  only after CI passes on `main` and always builds demo-only (`build-site.mjs --demo` ignores
  backend variables and fails if config.js points at a backend; tested in `tests/site.test.js`).
- `M1.5` hardening: the 2:15am night shift (2026-10-23) stacks on the M0.1 branch.

## Exact next step

`M1.1` demo separation in the app (branch `m1.1-demo-separation`): qa-tdd first writes failing
tests for SEP-2 (demo opened with `?org=` or a stale crew session still makes zero off-origin
requests) and SEP-3/SEP-4 (a "Sample data" label and a link back to chaseholroyd.com on every
demo screen). Criteria are in PLAN.md. Then `M1.2` location consent.

## Decisions to review

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
- Demo data: made-up crew (Dad, Ray T., Jake R., Cody M. and others) and jobs, seeded in
  `js/demo-backend.js`, kept only in the visitor's browser. No real people, accounts or keys.
- Studio status: https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- 2026-10-23: first Pages deploy from `main` (manual run). M0.1 makes every later deploy wait for
  CI and forces demo mode.

## Known limits

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

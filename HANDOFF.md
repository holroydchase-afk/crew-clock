# Handoff

Where Crew Clock stands, for whoever picks it up next. Last updated 2026-10-22.

## What it is

A GPS clock-in and clock-out phone app for a small construction crew in Putnam and Kanawha
counties, WV. Low-tech crew, cheap phones, weak signal. Beta is one team of 5 for two weeks,
then all 10 if the beta gates pass. Budget is $0, so everything runs on free tiers.

## Built and on `main`

- The whole MVP from the plan: three-tap clock-in, offline queue, fair geofence with the
  phone's GPS error counted in the worker's favor, photo fallback, boss Map / Today / Jobs /
  Crew tabs, "Not in yet", "Wrong job? Fix it", foreman "clock in a teammate".
- v2 (PR #1): Supabase Postgres with row-level security, Edge Functions, signed hash-chained
  punches, Backblaze B2 photos, web push alerts, MLS encrypted crew chat, on-phone AI tiers,
  Google Sheets reports.
- Sign-in (PR #2): Supabase Auth sessions signed with asymmetric (ES256) keys. Phones keep a
  refresh token, never the PIN. Don't go back to shared-secret tokens.
- Hosting: `scripts/build-site.mjs` builds `dist/`, and `.github/workflows/pages.yml` deploys it
  to GitHub Pages on every push to `main` (the repo is public for this).
- CI runs unit, SQL / row-level security, Edge Function, MLS and browser tests on every PR.

Demo mode runs with nothing configured: `npm run serve`. In the demo you sign in by tapping a
name (no PIN); `demoPin: true` in `config.js` brings the PIN screen back. The demo boss is "Sam W.",
never "Dad" (Chase's ask, 2026-10-23). The real app always asks for the PIN.

## Not live yet (needs Chase's accounts)

Chase already has Supabase, Backblaze, Porkbun (domain), GitHub, Resend, Expo and an Apple
Developer account. Expo isn't used (this is a web app); Apple Developer is for a Capacitor
App Store build after the beta.

None of this has run against real services. In order:

1. Supabase project and SETUP steps 1.1 to 1.4 (about 25 minutes).
2. GitHub Pages, SETUP step 5 (about 5 minutes).
3. Backblaze, secrets, alerts and Sheets, SETUP steps 2, 3, 4, 6 and 7 (about 40 minutes).
4. Install day on the crew's phones, SETUP step 8.

## Open decisions

- MLS: keep the open-source ts-mls library for the beta, or swap in Chase's own MLS build
  behind the same interface in `messenger/`. Recommendation: library for the beta.
- Weekly report: hours only, or hours times pay rate.
- Worker consent: the plan says each worker signs a one-line location consent; nothing in the
  app records it yet.

## Known limits

- iPhones don't sync web apps in the background; the app tells crew to open it when they get
  signal.
- A GPS-spoofing app can still fake a location. Photos, addresses and spot checks cover it.
- AI model downloads have never been tested from a real phone (the build sandbox blocks
  Hugging Face), so those tiers are tested with the model step stubbed.

## Links

- Plan doc: https://claude.ai/artifact/JpgRjqLpfjCehMu4jpDRRF
- Demo for Dad: https://claude.ai/artifact/8XNyXnDun1671nBbbMCESJ (sign in as Jake, PIN 1111)
- Setup guide: [docs/SETUP.md](docs/SETUP.md)

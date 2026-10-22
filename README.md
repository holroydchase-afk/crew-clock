# Crew Clock

GPS clock-in and clock-out for construction crews on rural job sites, built for
crews who aren't phone people and for places with one bar or none.

- **Three taps to clock in.** Nearest job on top, one big button, no usernames.
- **Works with no signal.** The phone records GPS and time at the tap and sends later.
- **Fair geofence.** Counts the phone's own GPS error in the worker's favor; photo when GPS fails.
- **Tamper-evident punches.** Each phone signs every punch with a key that can't leave it, chained by hash.
- **Team map and Today list** for the boss, with alerts pushed to his phone.
- **Encrypted crew chat** with MLS (RFC 9420). The server only ever sees ciphertext.
- **AI on the phone**, sized to the phone: photo checks everywhere, photo labels and a written
  day summary on phones that can handle a model. Nothing leaves the phone.
- **Google Sheets** daily and weekly reports.

## Try it

    npm run serve        # then open http://localhost:8123

With nothing configured it runs in **demo mode**, data kept in the browser.
Demo PINs: Dad (boss) 1234, Ray T. (foreman) 3333, Jake R. 1111, Cody M. 2222.

To run it for real, follow [docs/SETUP.md](docs/SETUP.md) (about an hour).
Where things stand and what's next: [HANDOFF.md](HANDOFF.md).

## Stack

| Part | Choice |
| --- | --- |
| App | Progressive web app, plain JS, no build step (the MLS bundle is prebuilt) |
| Hosting | Cloudflare Pages (free); `scripts/build-site.mjs` publishes only the app to `dist/` |
| Database, API | Supabase Postgres with row-level security; geofence and shift logic in SQL |
| Server code | Supabase Edge Functions (Deno) |
| Photos | Backblaze B2, private bucket, presigned upload and view links |
| Alerts | Web push (VAPID) |
| Chat crypto | [ts-mls](https://github.com/LukaJCB/ts-mls), suite X25519 / AES-128-GCM / Ed25519 |
| On-phone AI | Plain-JS image checks; Transformers.js models on capable phones |
| Reports | Apps Script in a Google Sheet pulls a read-only export nightly |

## Tests

    npm test                  # geofence, shifts, signatures, risk rules, AI helpers (node)
    npm run test:sql          # schema + row-level security on a local Postgres
    npm run test:edge         # Edge Function logic (deno)
    npm run test:mls          # MLS group chat (three people, late joiner)
    npm run test:e2e          # browser click-throughs (needs `npm run serve` running)

## Layout

| Path | What |
| --- | --- |
| `index.html`, `css/`, `js/` | The phone app |
| `js/geo.js`, `js/report.js`, `js/chain.js`, `js/risk.js` | Shared with the Edge Functions (copied by `scripts/sync-shared.sh`) |
| `js/api-supabase.js` | Supabase backend adapter (plain fetch, no SDK) |
| `js/messenger.js`, `messenger/` | Chat screens and the MLS wrapper that builds `js/vendor/crew-mls.js` |
| `js/ai.js` | On-phone AI tiers |
| `supabase/migrations/` | Schema, security rules, schedules |
| `supabase/functions/` | Edge Functions: `pin-login`, `crew-list`, `sync`, `photo-upload`, `photo-url`, `geocode`, `digest`, `report-export` |
| `backend/sheets-export.gs` | Google Sheets reports |
| `scripts/build-site.mjs`, `_headers` | Static site build and Cloudflare Pages headers |
| `backend/Code.gs` | The original all-in-Google-Sheets backend (still works, `backend: 'sheets'`) |

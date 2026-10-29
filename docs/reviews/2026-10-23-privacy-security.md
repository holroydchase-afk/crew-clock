# Privacy and security review, 2026-10-23

Reviewer: privacy-security. Scope: location paths, consent, retention and deletion, demo vs crew
app separation, personal data and secrets in the public repo and its history. Read: README,
HANDOFF, PLAN (draft), docs/SETUP.md, all three migrations, every Edge Function, `js/app.js`,
`js/geo.js`, `js/store.js`, `js/messenger.js`, `js/api*.js`, `js/demo-backend.js`, `sw.js`,
`scripts/build-site.mjs`, `.github/workflows/pages.yml`. No code changed in this review; the
contract it checks against is the new [docs/PRIVACY.md](../PRIVACY.md).

Note: `pages.yml`, `build-site.mjs`, `tests/site.test.js`, README and SETUP have uncommitted
edits in the working tree from the M0.1 setup work. Findings cite the working tree and say where
the committed `main` differs.

## Threats, in priority order

1. A recruiter or stranger on the public demo reaches the real crew's data or backend.
2. Someone outside the crew learns crew names, signs in as a worker, or locks workers out.
3. Location is used beyond the tap (tracking between punches, after work), or without consent.
4. Worker location history and pictures pile up forever and can't be deleted when someone leaves.
5. Real personal data (names, addresses, keys) sits in the public repo or its history.
6. Inside the company: a worker sees a teammate's location; a foreman's view is wider than needed.

## Verdict

**Safe for the public demo once M0.1 merges** (F-01). **Not safe for the crew beta yet:** F-02
(consent), F-03 (public company code and PIN guessing), F-04/F-05 (retention and deletion) and
F-06 (setup points the crew at the demo host) must be closed before M2.1 to M2.5.

## Findings

| ID | Sev | Finding | Standard | Required now / scheduled |
| --- | --- | --- | --- | --- |
| F-01 | P0 | Public Pages site becomes the live crew app as soon as repo variables are set | ASVS 2 V14.1 (build and deploy), LINDDUN Disclosure | Required now, M0.1 / M1.1 |
| F-02 | P0 | Nothing records a worker's location consent | LINDDUN Unawareness, Non-compliance | Required now, M1.2 (blocks M2.5) |
| F-03 | P1 | Real company code is in the public repo; crew list is open to anyone with it; 4-digit PIN guessing and lockout abuse | ASVS 2 V2.2.1, V11.1.4; STRIDE Spoofing, DoS | **Closed, M1.9 (2026-10-29)** |
| F-04 | P1 | No retention: GPS, pictures, chat ciphertext and devices kept forever | ASVS 2 V8.3.8; LINDDUN Non-compliance | Required now, M1.4 (live in M2.4) |
| F-05 | P1 | No deletion path; foreign keys block deleting a worker; leaving keeps devices, push, chat membership | ASVS 2 V8.3.2; LINDDUN Non-compliance | Required now, M1.4 |
| F-06 | P1 | SETUP still sends the crew, CORS and `APP_ORIGIN` to the demo's github.io host; functions fall back to `*` CORS | ASVS 2 V14.5.3 | **Closed, M1.9 (2026-10-29)** (B2 rule and CSP stay M2.2) |
| F-07 | P2 | Demo names are made up; demo pins sit on real roads at ~10 m precision | LINDDUN Identifiability | Required now (Chase confirms), M1.1 SEP-6 |
| F-08 | P2 | GPS watch keeps running up to 20 s after backing out of "Finding you" | LINDDUN Detectability; data minimization | M1.3 |
| F-09 | P2 | No test proves location is read only in the punch flow | ASVS 2 V1.1 (verified controls) | M1.3 |
| F-10 | P2 | README says the server "only ever sees ciphertext"; it also sees group names, members, sender and time. Phone chat history never trimmed | Surface must match code; LINDDUN Linkability | M1.7 (wording), M1.4 (trim) |
| F-11 | P2 | Old Sheets backend keeps the PIN in phone storage | ASVS 2 V2.10, V8.2.2 | M1.1 |
| F-12 | P2 | Any signed-in worker can get an upload link that overwrites a same-day picture of another punch | ASVS 2 V4.2.1 (IDOR) | **Closed, M1.9 (2026-10-29)** |
| F-13 | P2 | `REPORT_TOKEN` compared with `!==` and is global, though commented as per-company | ASVS 2 V2.9, V6.2 | **Closed, M1.9 (2026-10-29)** |
| F-14 | P2 | Foremen read every punch with GPS, all time, whole company | Data minimization, LINDDUN Disclosure | Accepted for beta (crew of 5, foreman needs the map); revisit at M2.6 |
| F-15 | P2 | No secret scanning in CI or GitHub push protection | Supply chain (gitleaks) | **Closed, M1.9 (2026-10-29)** (GitHub push protection: Chase checks one box) |

### F-01 (P0) Public demo vs live backend
- **Evidence:** committed `main` `.github/workflows/pages.yml` passed `vars.SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `ORG_CODE` etc. into `node scripts/build-site.mjs`, and
  `build-site.mjs` `fillConfig` wrote them into `config.js`; committed SETUP step 5 told Chase to
  set exactly those variables. The public Pages URL would have become the crew app.
- **State:** fixed in the working tree, not merged. `pages.yml:38` now runs
  `build-site.mjs dist --demo` with no `env:` block; `build-site.mjs` `assertDemo` fails the build
  if `config.js` names any backend; `tests/site.test.js` covers both. SETUP step 5 splits the
  demo (Pages) from the crew app (Cloudflare Pages).
- **Remaining:** (`vapidPublicKey` added to the `assertDemo` list in M0.1.) SEP-2 (demo ignores `?org=` and a stale crew session, zero off-origin requests) has no test yet;
  the demo still calls Nominatim from the browser for address search (`js/demo-backend.js:148`),
  which SEP-2's "zero requests to other hosts" will catch. Decide: allow it, or stub geocode in
  the demo.
- **Done when:** M0.1 merged with CI green; SEP-1 and SEP-2 pass; a Pages run with repo variables
  set still serves `backend: 'demo'`.

### F-02 (P0) No consent record
- **Evidence:** HANDOFF "Open decisions"; no consent table in `supabase/migrations/*`; the
  primer `js/app.js:388-399` only prepares the OS permission prompt and is skipped for the boss
  (`js/app.js:326-330`). Nothing stops a foreman reading GPS for a teammate (`js/app.js:224`).
- **Done when:** PLAN M1.2 CON-1..CON-7 pass, using the text, fields and rules C1-C6 in
  docs/PRIVACY.md (insert-only table, worker-only insert, boss read, withdrawal as a new record,
  version bump re-asks, works offline, no GPS read without consent including teammate punches).

### F-03 (P1) Company code, open crew list, PIN guessing
- **Evidence:** `docs/SETUP.md:58,60,87,115` give `<old code>` as the real company code (and the code
  names the area). `supabase/functions/crew-list/index.ts:6-13` returns every active name and
  role for a code, no sign-in. The crew app's `config.js` will carry the Supabase URL publicly
  (by design). `pin-login/index.ts:36-43` and `_shared/core.ts:55`: 4-digit PINs, 5 tries then
  15 minutes, per person, no per-IP limit. That is 480 guesses a day per worker; across 10 workers
  someone's PIN falls in about two days of scripted guessing, and the same script can keep every
  worker locked out at 7 AM.
- **Done when:** the real company code is random (8+ characters), lives only in the Cloudflare
  variables and the install link, and no real code appears in the repo (SETUP uses a placeholder);
  `pin-login` adds a per-IP limit and a longer lockout after repeated rounds (for example, 3
  lockouts in a day locks until the boss sets a new PIN) and pushes the boss an alert on lockout;
  a test covers both. `crew-list` is rate-limited per IP.

### F-04 (P1) No retention
- **Evidence:** `punches.lat/lng/accuracy_m/address/photo_key`
  (`20261022000000_init.sql:93-100`), `mls_messages` (`:148-159`), `mls_key_packages`
  (`:123-132`), `devices.user_agent` (`:62`) have no expiry and no job deletes them; B2 objects
  have no lifecycle; phone chat history in IndexedDB is never trimmed (`js/messenger.js:12-29`).
- **Done when:** PLAN M1.4: `app.apply_retention()` implements the docs/PRIVACY.md table (hours 3
  years, raw GPS 90 days, pictures 60 days, chat ciphertext and claimed key packages 30 days,
  devices 90 days after revoke, phone chat 90 days) with local SQL tests on both sides of each
  cutoff; pictures are deleted from B2 by an Edge Function; M2.4 schedules it and one run is logged.

### F-05 (P1) No deletion
- **Evidence:** `punches.crew_id`, `punches.by_crew_id` (`init.sql:85-86`),
  `chat_groups.created_by` (`:138`), `mls_messages.sender_crew_id` (`:152`) reference `crew` with
  no `on delete` rule, so deleting a crew row with history fails; no delete grant or function
  exists for any personal table; turning someone off (`active=false`) only ends sessions
  (`20261023000000_auth_hook.sql:32-41`) and leaves devices, push subscriptions, key packages and
  chat membership; Auth users (`<id>@crew.invalid`, `pin-login/index.ts:9`) are never deleted.
- **Done when:** M1.4 adds (a) an on-deactivate step that revokes devices, deletes push
  subscriptions and unclaimed key packages, and removes chat membership; (b) a boss-only
  "delete this worker's location and pictures" function that leaves hours until the 3-year cutoff;
  (c) a delete-company script covering rows, B2 prefix and Auth users; each with an SQL or Edge
  test, and the FK rules changed so the 3-year purge can delete the crew row.

### F-06 (P1) Setup points the crew at the demo host
- **Evidence (working tree):** `docs/SETUP.md:40` B2 CORS `allowedOrigins` github.io;
  `docs/SETUP.md:52` `APP_ORIGIN=https://holroydchase-afk.github.io`; `docs/SETUP.md:115` install
  link on github.io with `?org=<old code>`. Step 5 now says "never use the demo's address for the
  crew", so the file contradicts itself. `supabase/functions/_shared/http.ts:4` falls back to
  `Access-Control-Allow-Origin: *` when `APP_ORIGIN` is unset.
- **Update (M0.1):** SETUP steps 2, 3, 4, 5 and 8 now use `clock.example.com` and a `<CODE>`
  placeholder; `<old code>` is gone from SETUP. `http.ts` and the CSP are still open.
- **Done when:** SETUP steps 2, 3 and 8 use the crew app's own address (placeholder) everywhere;
  `http.ts` throws at start without `APP_ORIGIN` (Edge test); `_headers` gets a
  `Content-Security-Policy` for the crew host (scheduled, M2.2).

### F-07 (P2) Demo names and places
- **Evidence:** `js/demo-backend.js:11-23`: crew "Dad", "Ray T.", "Jake R.", "Cody M.",
  "Billy S.", "Travis K."; jobs "Smith kitchen", "Miller roof", "Scott Depot deck", "Hurricane
  addition". Chase never gave crew names in the project chat (caller-verified); these follow the
  pattern of a model-invented roster (common first names, one initial, the two most common US
  surnames for clients). Addresses are town or road names only, no house numbers. Coordinates
  (`demo-backend.js:11-14,26-30`, also tests) are at 4-5 decimals (about 1-10 m), so a pin on
  "Teays Valley Rd" or "Main St, Hurricane" can sit on a real property.
- **Done when:** Chase confirms SEP-6 (no name matches a real crew member or client); demo job
  pins are moved to public places (a park, a church lot, a store lot) or rounded to 3 decimals.

### F-08 (P2) GPS watch outlives the screen
- **Evidence:** `js/geo.js:57-91` clears the watch only on a good fix, permission denied or
  timeout; `js/app.js:215` drops the result if the worker backed out, but the watch keeps the GPS
  on for up to 20 s.
- **Done when:** `bestFix` returns a cancel handle and leaving the locating screen calls it;
  unit test with a fake geolocation asserts `clearWatch` on cancel (M1.3).

### F-09 (P2) Location-at-tap is true but unproven
- **Evidence:** the only geolocation calls are `js/app.js:173-180` (rough sort, not saved),
  `:195-218` (punch), `:888-893` (permission prompt, discarded), `:968-976` (boss job pin). No
  geolocation in `sw.js`, no background or periodic sync, `setInterval(syncNow, 60000)`
  (`js/app.js:1092`) only sends the outbox. Claim "It only checks when you clock in or out"
  (`js/app.js:397`) holds.
- **Done when:** M1.3 e2e wraps `navigator.geolocation` with a counter, walks every screen
  (home, boss tabs, chat, idle 2 minutes) and asserts reads only during the punch flow and "Use
  where I'm standing"; a grep test fails CI on any new `geolocation` call outside those files.

### F-10 (P2) Chat claims and phone history
- **Evidence:** `README.md:13` "The server only ever sees ciphertext". Server also stores
  `chat_groups.name` in plain text (`init.sql:134-140`), membership (`:142-146`), sender, kind,
  epoch and time (`:148-158`). Decrypted messages stay in the phone's IndexedDB forever, keyed by
  person but not removed on sign-out (`js/messenger.js:12-29`).
- **Done when:** README and the in-app chat text say "messages are end-to-end encrypted; the
  server sees who is in a group and when messages are sent" (hand to positioning, M1.7); phone
  history trimmed at 90 days (M1.4).

### F-11 (P2) Sheets backend stores the PIN on the phone
- **Evidence:** `js/app.js:295` `state.auth = res.auth || { crewId, pin }` then saved to
  localStorage; `api.js` sends `{crewId, pin}` on every request for `sheets` and `demo`.
  `backend/Code.gs:41` seeds a boss PIN 1234 in plain text in the Sheet.
- **Done when:** the non-demo build refuses `backend: 'sheets'` (build test), or the Sheets
  backend is removed; demo mode keeps the demo PINs (they're public anyway).

### F-12 (P2) Picture overwrite
- **Evidence:** `supabase/functions/photo-upload/index.ts:9-13` signs a PUT for
  `<org>/<today>/<punchId>.jpg` for any caller and any punch id; it doesn't check the punch is the
  caller's (or a foreman's teammate punch) or not yet uploaded. Punch ids are UUIDs that workers
  can't list, so exploit needs a leaked id. `photo_sha256` on the punch would expose a swap.
- **Done when:** the function refuses ids that already exist for someone else, or sync verifies
  the uploaded object's SHA-256 against `photo_sha256`; Edge test.

### F-13 (P2) Report token
- **Evidence:** `supabase/functions/report-export/index.ts:2,9`.
- **Done when:** constant-time compare; comment fixed, or the token stored per org row. Payload
  has no GPS (shifts and names only), which is good and should stay that way (test).

### F-14 (P2, accepted) Foreman sees all GPS
- **Evidence:** `init.sql:298-299` `punches_read` allows leads every punch in the org.
- **Accepted for the beta:** 5 people, the foreman runs the map. Revisit at M2.6: limit foremen to
  the last 8 days (what the app loads, `js/api-supabase.js:163`).

### F-15 (P2) Secret scanning
- **Evidence:** `.github/workflows/ci.yml` has no gitleaks step; dependabot is being added
  (untracked `.github/dependabot.yml`).
- **Done when:** gitleaks runs in CI on every PR, and GitHub secret scanning with push protection
  is on for the public repo (Chase, one checkbox).

## Personal data and secrets scan

- **Tree:** no API keys, tokens, JWTs, private keys, `sb_secret_`, service-role keys, Backblaze
  keys, real emails or phone numbers. Only placeholders (`you@example.com`, `<key id>`,
  `PROJECT_REF`, `CRON_SECRET`) and the CI-only Postgres password `postgres` for a throwaway
  service container (`ci.yml:14,34`). Test JWKs are generated at run time.
- **History** (`git log --all -p`, added lines): same result; no secret was ever committed and
  removed.
- **Identity in the repo (not secret, worth knowing):** `HANDOFF.md:9` names Putnam and Kanawha
  counties, WV; SETUP's `<old code>` names the area; "Dad" is the boss; `LICENSE` and the demo URL
  name Chase. Together they point to Chase's father's business. Fine for a portfolio piece once
  F-03 removes the real company code. Three merge commits carry Chase's own email as author (GitHub web
  merges), already shown on GitHub. Removing it would need a history rewrite; not recommended.
  Optional: GitHub Settings > Emails > "Keep my email addresses private" for future merges.
- **Links:** the two claude.ai artifact links (plan doc, demo for Dad) were removed from
  `HANDOFF.md` in M0.1. They stay in git history; they are private unless shared.

## Already good (keep it)

- PINs: PBKDF2 150k, constant-time compare, never stored on the phone in Supabase mode, never
  readable by phones (`init.sql:283-287`); tokens are asymmetric (ES256) and the functions refuse
  HS256 and `none` (`_shared/auth.ts:8`).
- RLS is on for every table and keyed on server-issued claims; punches are written only by the
  sync function, which checks signatures; the server scores the geofence.
- Pictures go phone-to-B2 by 10-minute presigned links; the bucket is private; view links are
  lead-only and org-checked; re-drawing on a canvas strips EXIF and GPS tags.
- Push text carries names and status, never coordinates. The Sheets export carries no GPS.
- No analytics, ads or AI vendors; AI runs on the phone.

## Remaining risks

- **Fixed in working tree (merge pending):** F-01 core.
- **Accepted:** F-14 for the beta (reason above). GPS spoofing apps (HANDOFF known limit).
- **Needs Chase:** confirm SEP-6 names (F-07); WV record-keeping and monitoring-notice check
  (docs/PRIVACY.md "Needs Chase"); pick a random company code at setup (F-03); turn on secret
  scanning and push protection (F-15); check the two claude.ai links' sharing (removed from HANDOFF).

## Closed in M1.9 (2026-10-29)

Each item had a failing test first, then the fix (`supabase/functions/_shared/guard.ts`, migration
`20261029000000_crew_auth.sql`).

- **F-03:** `scripts/new-company.ts ... random ...` makes an 8-character code and refuses one under 8;
  the old code is gone from the repo, this review included (`tests/m19.test.js`, by hash). `pin-login`
  counts every try first, 20 an hour per IP and 40 per company (HMAC keys with their own secret, kept a
  day, advisory-locked), then the person's lock; wrong PINs go through the row-locked `pin_fail`; the
  third 15-minute lockout in 24 hours blocks the PIN until the boss sets a new one, and the boss gets a
  push on every lockout. `crew-list` allows 30 lists an hour per IP. Round 2 fixed PS-M19-1..6. Tests: `tests/edge/m19.test.ts`
  F-03a..k, `tests/sql/m19_test.sql`.
- **F-06:** `corsFor` throws at start on a missing, `*` or plain-http `APP_ORIGIN` (F-06 test). SETUP
  already used the crew app's placeholder address. The B2 rule and the crew host's CSP are M2.2.
- **F-12:** `photoCheck`: a link only for a punch not synced yet, or the caller's own (or one they made
  for a teammate) that has no picture yet; never another company's (F-12a..e). Keys name the uploader
  and sync keeps only the caller's own key for that punch (F-12f..g).
- **F-13:** `tokenOk` compares in constant time and treats a token under 32 characters as not set up;
  `reportPayload` sends only shift and name fields, so GPS can never leak into the Sheet (F-13a..b).
  The comment no longer says the token is per company.
- **F-15:** CI's `secrets` job runs gitleaks v8.28.0 over the whole history on every PR and push to
  main. GitHub push protection is a repo setting for Chase.

# Crew Clock privacy

This is the promise Crew Clock makes to every worker who uses it, and the rules the code must
follow to keep it. If the app, the README or the demo ever says something different from this
page, that is a bug.

Status marks: **[true]** the code does this today. **[to build]** it does not yet; the task that
builds it is named (task IDs follow the PLAN.md draft; staff-pm owns the numbering).

## The promise, in plain words

> Crew Clock checks where your phone is only when you tap **Clock in** or **Clock out**. It does
> not follow you during the day, after work, or when the app is closed. The boss and foremen see
> where you clocked in and out, and your hours. Your hours are kept 3 years because payroll law
> says so. Where your phone was is kept 90 days, and clock-in pictures 60 days. You can stop
> letting it use your location any time; then you clock in with a picture instead.

The consent screen (below) is the short version of this.

## What location is collected, and when

| When | What is read | Where it goes | Status |
| --- | --- | --- | --- |
| Worker taps **Clock in** or **Clock out**, after picking the job | GPS watched for up to 20 s (stops early at 20 m accuracy), best fix kept: latitude, longitude, accuracy, time | Saved with the punch, sent to the server when there is signal | [true] `js/app.js` `locate`, `js/geo.js` `bestFix`; stops when they leave the screen (L2) |
| Worker taps **Clock in** (job list) | One rough, low-accuracy reading to put the nearest job on top | Stays in the app's memory for that screen; never saved or sent | [true] `js/app.js` `sortJobsByDistance`; stops when they pick a job or leave the list (L2) |
| First sign-in, **OK, ask me** | One reading only to make the phone show its permission prompt | Thrown away | [true] `js/app.js` `prime-location`; stops if the app goes to the background (L2) |
| Foreman clocks in a teammate | The **foreman's** phone GPS; a picture is asked for, and a punch without one is flagged high for the boss (`teammate_no_photo`) | Saved on the teammate's punch, marked as made by the foreman | [true] `js/app.js` `startPunch`, `js/risk.js` `teammate_no_photo`, `core.ts` `ingestPunch` |
| Boss taps **Use where I'm standing** when adding a job | The boss's own GPS | Saved as the job site's pin, not as anyone's punch | [true] `js/app.js` `job-here`; stops when the boss leaves the job form or picks another way (L2) |
| Any other time (home screen, chat, boss tabs, app closed, phone locked) | Nothing | — | [true] no other geolocation call in `js/`, none in `sw.js`, no background or periodic sync (`tests/location.test.js`, `tests/e2e-location.js` LOC-1) |

Rules:
- **L1** Location is read only inside the punch flow and the boss's "Use where I'm standing".
  No `watchPosition` that outlives the punch screen, no background location, no periodic or
  background sync that reads location. [true] `tests/location.test.js` fails if a location read
  appears anywhere else in `js/` or in `sw.js`; `tests/e2e-location.js` LOC-1 walks Home, the
  teammate list and every boss screen at 390 and 1280 wide and counts zero reads.
- **L2** When the worker backs out of the "Finding you" screen, taps "Take a picture instead",
  or the app goes to the background, the GPS watch stops at once, and any reading so far is thrown
  away (after going to the background they clock in with a picture). The same holds for the job
  list's rough reading and the permission primer's one reading: every read in the app goes through
  one gate (`watchGps`) tied to its screen. The boss's "Use where I'm standing" stops the same way when they
  leave the job form. [true] `js/app.js` `watchGps`/`stopGps`, `js/geo.js` `bestFix` `signal`;
  `tests/e2e-location.js` LOC-2, `tests/unit.test.js`
- **L3** No location is read for a worker with no consent on record (they clock in with a
  picture instead). This also applies when a foreman clocks them in. The sync function checks it
  too: a punch from someone whose latest record at that time isn't "agree" to the current words is
  stored without its location (`core.ts` `ingestPunch`), and a consent record the server refuses is
  forgotten on the phone, so they're asked again. [true] `js/app.js` `startPunch`,
  tested in `tests/e2e-consent.js` CON-2
- **L3a** When sync drops a punch's location (no consent, or an impossible reading), it drops that
  punch's hash and signature too, and the next punch keeps no pointer to that hash, since they cover
  the location and could let it be guessed back. [true] `core.ts` `ingestPunch`, tested in
  `tests/edge/harden.test.ts` PS-M112-2
- **L4** Pictures are re-drawn on the phone at 1024 px before upload, which strips the camera's
  EXIF data, including any GPS tag. The stamp says name, job and time, not coordinates.
  [true] `js/app.js` `stampPhoto`
- **L5** The server works out distance and on-site status itself; the phone's own verdict is not
  trusted. [true] `supabase/migrations/20261022000000_init.sql:184-212`

## Consent

Each worker agrees in the app, on their own phone, before the app ever reads their location.
The paper "one-line consent" in the original plan is replaced by this record. [true, M1.2]

**Consent screen text (version `loc-v1`):**

> **Crew Clock uses your location only when you tap Clock in or Clock out.** The boss sees where
> and when. It never tracks you in between. You can stop this any time on the home screen.
> [I agree] [Not now]

(36 words. "On the home screen" replaced "in the menu" before any worker saw `loc-v1`: the app has no menu,
and Home has the "Stop using my location" link.)

"Not now" lets the worker clock in with a picture instead; nothing is held against them in the app.

**What one consent record stores** (table `location_consents`, insert-only):

| Field | Why |
| --- | --- |
| `id` (made on the phone) | So a resend over a weak signal is not a duplicate |
| `org_id`, `crew_id` | Whose consent |
| `action`: `agree` or `withdraw` | Withdrawal is a new record, never an edit |
| `text_version`, e.g. `loc-v1` | Proves which words they agreed to; a new version asks again |
| `phone_at`, `received_at` | When they tapped, when the server got it |
| `device_id` | Which phone it was tapped on |
| `witness_crew_id` (optional) | The boss or foreman who walked them through it on install day, if any |

Rules:
- **C1** Only the worker can make their own record, from their own signed-in session; a foreman
  or boss cannot agree on someone's behalf. The witness field is filled from the witness's own
  sign-in, not typed. [true for the worker's own record: `core.ts` `ingestConsent`, RLS
  `consents_insert_own`; the witness field is not filled yet (always empty), see HANDOFF]
- **C2** Row-level security: a worker can insert and read only their own records; the boss can
  read every record in the company; nobody can update or delete one. A foreman sees only each
  teammate's latest action and text version (`crew_consent_status()`), never the records. [true]
  `supabase/migrations/20261023100000_location_consents.sql`, tested in `tests/sql/consent_test.sql`
- **C3** Withdraw: Home > **Stop using my location** adds a `withdraw` record, the app stops
  reading location for that worker, and the boss's Crew tab shows "No location consent".
  They can agree again later. After a withdrawal the app asks again only when they tap Clock in,
  not every time it opens. [true] (Home has the link; there is no menu)
- **C4** When `text_version` changes, everyone is asked again at next sign-in. [true] `CONSENT_VERSION`
  in `js/app.js`
- **C5** The consent record goes through the same offline outbox as punches, so it works with no
  signal. Demo mode keeps it in the browser. The phone remembers each worker's newest record
  (action, version, time; key `cc.consents`), so someone who agreed offline isn't asked again
  before it sends. [true]
- **C6** Consent records are kept for good: nothing edits or deletes them (CLAUDE.md hard rule),
  so the company can show consent for any GPS it ever had. The plan was "on the crew plus 3 years,
  the same as their hours"; that waits on Chase changing the hard rule. [true since M1.4: tested in
  `tests/sql/retention_test.sql` RET-2g and DEL-3]

The phone's own location permission ("Allow While Using App") is separate and still needed. The
app asks for consent first, then shows the existing permission primer.

## Retention (how long things are kept)

Defaults, chosen to be simple and defensible for a small US employer. The legal minimums are
federal; West Virginia's own rules are a "needs Chase" check (see the end).

| Data | Where | Kept | Then | Status |
| --- | --- | --- | --- | --- |
| Hours: punch time, type, job, worker, status, distance in feet, who made it | Supabase `punches` | **3 years** after the punch | Row deleted | [built, M1.4: `app.apply_retention`, `20261024000000_retention.sql`; runs daily from M2.4] |
| Raw GPS on a punch: `lat`, `lng`, `accuracy_m`, `address` | Supabase `punches` | **90 days** | Set to null; status and distance stay, so hours still make sense. The punch's hash and signature cover its location, so they are removed too, with the next punch's pointer to that hash (`sig_ok` keeps the check from arrival). The next punch's own hash still covers that pointer, so until it is trimmed too (at most days later) the old location could in theory be guessed back from it; a per-punch random salt in the chain would close this (logged in HANDOFF) | [built, M1.4] |
| Clock-in pictures | Backblaze B2 (private bucket), key on the punch | **60 days** | Object deleted, `photo_key` set to null, `photo_sha256` kept | [partly built, M1.4: key queued in `app.photo_purge` and nulled; the Edge Function that deletes the B2 object is M2.3; B2 lifecycle rule can back it up] |
| Picture-delete queue: company and B2 key, when queued and done | Supabase `app.photo_purge` (no phone can read it) | 30 days after the object is deleted | Deleted | [built, M1.4] |
| Chat ciphertext | Supabase `mls_messages` | **30 days** | Deleted. Phones keep their own decrypted copy. | [built, M1.4] |
| Used MLS key packages | Supabase `mls_key_packages` | **30 days** after claimed (`claimed_at`) | Deleted | [built, M1.4] |
| Chat on the phone (decrypted) | Phone IndexedDB `crewclock-chat` | **90 days** | Trimmed by the app | [to build, M1.4; today kept forever] |
| Consent records | Supabase `location_consents` | For good | Never edited or deleted (CLAUDE.md hard rule). Was "on the crew + 3 years"; that needs Chase to change the hard rule (HANDOFF, Decisions to review) | [true: nothing deletes them; tested in `tests/sql/retention_test.sql` RET-2g, DEL-3] |
| Phone keys and user agent | Supabase `devices` | While in use; 90 days after revoked (`revoked_at`) or the worker leaves | Deleted | [built, M1.4] |
| Sign-in limit counts: a keyed hash (HMAC with `RATE_HMAC_KEY`) of the caller's IP, or of the company for the company cap, and the time, per scope; never the IP itself | Supabase `app.rate_hits` (no phone can read it) | **1 day** | Deleted by `app.apply_retention` | [built, M1.9: `20261029000000_crew_auth.sql`, `tests/sql/m19_test.sql`] |
| Wrong-PIN count, lock time, lock rounds and "PIN blocked" | Supabase `crew` (server-only columns) | Until the next good PIN (count), the end of the lock, or the boss sets a new PIN (rounds, block) | Reset to 0/null/false | [built, M1.9: `guard.ts` `pinFailure`, `PIN_RESET`; `tests/edge/m19.test.ts`] |
| Push subscriptions | Supabase `push_subscriptions` | While in use | Deleted when the worker leaves or the browser retires it | [partly true: retired ones are deleted, `_shared/push.ts:28`] |
| Boss and foreman's team cache | Their phone, localStorage `cc.team` | Up to 13 days of punch times (from the Monday a week before this week, for the week view); GPS only for the last 8 days | Lat, lng, accuracy, address and distance are dropped from any punch older than 8 days before it is held or cached; replaced on each refresh; cleared on sign-out | [true, PS-M113-1] `Report.dropOldGps` in `js/api-supabase.js` `team()` and `js/app.js` `loadTeam()`; `tests/enhance.test.js` |
| Weekly CSV (timesheet) | Made on the boss's phone, saved to their Downloads | Until the boss deletes it | The boss owns the file; the app keeps no copy and sends it nowhere. Name, Date, In, Out, Hours only: no GPS, ids, photos or risk flags; cells a spreadsheet would run as a formula are escaped | [true, M1.13] `Report.timesheetCsv`; `tests/enhance.test.js` ENH-3, PS-M113-3 |
| Each worker's newest consent record, as this phone knows it | The phone, localStorage `cc.consents` | Until replaced by a newer record | Kept on sign-out so an offline re-sign-in isn't asked again; holds action, text version and time only | [true] `js/app.js` `rememberConsent` |
| Unsent punches and pictures | Phone IndexedDB outbox | Until sent | Removed when the server accepts them or refuses them for permission. Any other refusal (for example "Punch too old") is final: the phone deletes its GPS, picture, signature and edit data at once and keeps only a stub (who, job, in/out, time, reason) so the sync line can explain it; the stub is never resent. Network, server or picture-upload failures keep the whole punch and retry. | [true] `js/app.js:85-90,112-125`; [stub kept until cleared, no trim yet] |
| Daily and weekly reports | The boss's Google Sheet | 3 years (hours only, no GPS) | The boss deletes old rows | [manual; no GPS goes to the Sheet today, `report-export` sends shifts only] |
| Sign-in sessions | Supabase Auth | 1 hour token, refresh until sign-out | Ended on new PIN or deactivation | [true] `20261023000000_auth_hook.sql:32-41` |

Rules:
- **R1** One SQL function (`app.apply_retention()`) does every server-side row above, runs daily
  from `pg_cron`, and has local tests with rows on both sides of each cutoff. Phones can't run it.
  [built, M1.4: `tests/sql/retention_test.sql`; scheduled live in M2.4]
- **R2** Photo deletion lists B2 keys from the punches being trimmed and deletes those objects
  through an Edge Function holding the B2 key; a bucket lifecycle rule (hide and delete after 60
  days) is the backstop. [half built, M1.4: keys are queued in `app.photo_purge`; the Edge Function
  that deletes them is M2.3]
- **R3** A punch that is part of an open dispute can be put on hold by the boss (`hold_until`), and
  retention skips it until then. [scheduled; not needed for the beta]

## Deletion

**A worker leaves (boss turns them off in the Crew tab):**
- At once: sessions ended on every phone [true], devices revoked, push subscriptions deleted,
  removed from chat groups, unclaimed key packages deleted. [built, M1.4: trigger `crew_offboard`]
- After that, normal retention runs: GPS gone at 90 days, pictures at 60, hours kept 3 years
  under their name because payroll law needs it.
- 3 years after their last punch, the punches are deleted; once that's done and they left over 3
  years ago (`deactivated_at`), the crew row is anonymized ("Former crew member", no PIN). The row stays because consent records, kept for good, point at it. [built,
  M1.4] The Supabase Auth user (`<id>@crew.invalid`) is deleted then too. [to build, M2: needs the
  Auth admin API]

**A worker asks for their data to be deleted:**
- The boss can delete right away, with one action: GPS on all their punches, all their
  pictures, their devices, push subscriptions, key packages and chat messages they sent.
- Hours (time in, time out, job) are kept until the 3-year payroll minimum, then deleted. The app
  tells the boss this in plain words. [SQL built, M1.4: `public.erase_crew_data`, boss of the same
  company only; consent records stay. The Crew tab button and its wording are to build.]
- A worker can see their own punches and consent records in the app today (RLS allows it); an
  export button is scheduled after the beta.

**The boss deletes the company:**
- The boss exports the Sheet first (it is theirs; the app does not touch it).
- One owner-run script deletes the org (every table cascades on `org_id`), every B2 object under
  the `<org_id>/` prefix, and every Auth user for that crew. [to build, M2. Today
  `punches.crew_id`, `punches.by_crew_id`, `mls_messages.sender_crew_id` and
  `chat_groups.created_by` have no `on delete` rule, so a crew row with punches cannot be deleted
  at all (`20261022000000_init.sql:85-86,138,152`), and `location_consents.org_id` has none either,
  so the script has to decide what happens to consent records first]

## Who sees what

| | The worker | Foreman | Boss | Server operator (Chase, Supabase) | Public demo visitor |
| --- | --- | --- | --- | --- | --- |
| Own punches, hours, GPS | Yes | Yes | Yes | Yes | No |
| Other workers' punches and GPS | No | Yes, whole company | Yes, whole company | Yes | No |
| Clock-in pictures | No (own not shown) | Yes, 10-minute links | Yes, 10-minute links | Yes (B2 bucket) | No |
| Names on the sign-in screen | Yes | Yes | Yes | Yes | Anyone with the company code (see review F-03) |
| PIN | Types it; never stored on the phone | No | No (can set a new one) | Only a PBKDF2 hash | No |
| Chat text | Groups they are in | Groups they are in | Groups they are in | **No**: ciphertext only | No |
| Chat metadata: group names, who is in a group, who sent when | Their groups | Their groups | Their groups | Yes | No |
| Consent records | Own | No | Yes | Yes | No |
| Reports (Sheet) | No | No | Yes | Google | No |

[true] for punches, pictures, PIN and chat: `init.sql:280-338`, `photo-url/index.ts:10`.
Consent row is [true, M1.2]; a foreman sees status only (agreed or not), not the records.

Data that leaves to other services:
- **OpenStreetMap / USGS map tiles**: the boss's map loads tiles, so those servers see which area
  is being looked at (not who is on it). [true] `js/app.js:645`, `sw.js:28-30`
- **US Census geocoder, then OpenStreetMap Nominatim**: job addresses the boss types. Never a
  worker's location. [true] `supabase/functions/geocode/index.ts`
- **Hugging Face**: AI models are downloaded to capable phones; no data is sent to them.
- **Web push services** (Apple, Google, Mozilla): alert text such as "Jake R.: check this punch".
  No coordinates are put in push text. [true] `supabase/functions/sync/index.ts:31`
- No analytics, ads, trackers or AI vendors get any crew data. [true]

## Public demo and the crew app are separate

| | Public demo | Crew app |
| --- | --- | --- |
| Address | `chaseholroyd.com/crew-clock/` (GitHub Pages) | Its own address on Cloudflare Pages, e.g. `clock.<domain>` |
| Build | `node scripts/build-site.mjs dist --demo` | `node scripts/build-site.mjs` with backend variables |
| Backend | None. Sample data in the visitor's own browser | Supabase, B2, push |
| Names and jobs | Made up (see review F-07) | The real crew |

Rules:
- **S1** The GitHub Pages workflow always builds with `--demo`, takes no repo variables, and the
  build fails if `config.js` names any backend. [in the working tree, not yet merged: M0.1;
  `pages.yml:38`, `build-site.mjs` `assertDemo`]
- **S2** The crew's Supabase URL, key and company code exist only in the Cloudflare project's
  variables, never in the repo, never in GitHub variables. The real company code is random, 8 or
  more characters (`scripts/new-company.ts ... random ...`), and not any word written in this repo.
  The old code is in public git history (and its hash in `tests/m19.test.js`, which only detects it),
  so it is retired for good: never use it as a live code.
  [built, M1.9: `tests/m19.test.js` fails on the old code anywhere in the repo; the variables are
  M2.1/M2.2]
- **S3** CORS (`APP_ORIGIN`, the B2 bucket rule) lists only the crew app's address, never the
  demo's, and the functions refuse to start without `APP_ORIGIN`. [functions true since M1.9:
  `guard.ts` `corsFor` throws on a missing, `*` or plain-http origin (`tests/edge/m19.test.ts` F-06);
  SETUP uses the crew app's placeholder address; the B2 rule and CSP are M2.2]
- **S4** The demo always says it is sample data and never asks for a real name, PIN, picture of a
  person, or location it keeps. "Pretend I'm at the job" exists only in the demo. [true since M1.1:
  every demo screen shows "Sample data, made-up crew, saved only in this browser" with a link back
  to chaseholroyd.com; the demo makes no off-site requests except map tiles and never loads the AI
  models; tested in `tests/e2e-demo.js`]
- **S5** The crew app never runs the old Google Sheets backend (`backend: 'sheets'`): it keeps the
  PIN in the phone's storage (`js/app.js:295`). [to build: refuse `sheets` in a non-demo build,
  M1.1]

## Needs Chase (legal, not code)

- **Federal minimums used above:** FLSA payroll records 3 years (29 CFR 516.5); time cards and
  other records wages are figured from 2 years (29 CFR 516.6). Payroll tax records 4 years (IRS
  Publication 15) apply to payroll, which stays in the boss's payroll system, not in Crew Clock.
- **West Virginia:** check the WV Minimum Wage and Maximum Hours law (W. Va. Code 21-5C) and
  the Wage Payment and Collection Act (21-5) for any longer record period, and whether WV has
  any notice rule for electronic monitoring of employees. If WV needs longer than 3 years, raise
  the hours row only; GPS and pictures stay short.
- Workers use their own phones. Consent plus "location only at the tap" is the defensible line;
  confirm with whoever does the company's HR or payroll.

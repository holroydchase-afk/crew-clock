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
| Worker taps **Clock in** or **Clock out**, after picking the job | GPS watched for up to 20 s (stops early at 20 m accuracy), best fix kept: latitude, longitude, accuracy, time | Saved with the punch, sent to the server when there is signal | [true] `js/app.js:195-218`, `js/geo.js:57-91` |
| Worker taps **Clock in** (job list) | One rough, low-accuracy reading to put the nearest job on top | Stays in the app's memory for that screen; never saved or sent | [true] `js/app.js:173-180` |
| First sign-in, **OK, ask me** | One reading only to make the phone show its permission prompt | Thrown away | [true] `js/app.js:888-893` |
| Foreman clocks in a teammate | The **foreman's** phone GPS; a picture is asked for, and a punch without one is flagged high for the boss (`teammate_no_photo`) | Saved on the teammate's punch, marked as made by the foreman | [true] `js/app.js:224`, `js/risk.js:58`, `supabase/functions/_shared/core.ts:157-159` |
| Boss taps **Use where I'm standing** when adding a job | The boss's own GPS | Saved as the job site's pin, not as anyone's punch | [true] `js/app.js:968-976` |
| Any other time (home screen, chat, boss tabs, app closed, phone locked) | Nothing | — | [true] no other geolocation call in `js/`, none in `sw.js`, no background or periodic sync |

Rules:
- **L1** Location is read only inside the punch flow and the boss's "Use where I'm standing".
  No `watchPosition` that outlives the punch screen, no background location, no periodic or
  background sync that reads location. [true today; a test that proves it is **to build**, M1.3]
- **L2** When the worker backs out of the "Finding you" screen, the GPS watch stops at once.
  [to build, M1.3: today the result is discarded but the watch can run up to 20 s more]
- **L3** No location is read for a worker with no consent on record (they clock in with a
  picture instead). This also applies when a foreman clocks them in. [to build, M1.2]
- **L4** Pictures are re-drawn on the phone at 1024 px before upload, which strips the camera's
  EXIF data, including any GPS tag. The stamp says name, job and time, not coordinates.
  [true] `js/app.js` `stampPhoto`
- **L5** The server works out distance and on-site status itself; the phone's own verdict is not
  trusted. [true] `supabase/migrations/20261022000000_init.sql:184-212`

## Consent

Each worker agrees in the app, on their own phone, before the app ever reads their location.
The paper "one-line consent" in the original plan is replaced by this record. [to build, M1.2]

**Consent screen text (version `loc-v1`):**

> **Crew Clock uses your location only when you tap Clock in or Clock out.** The boss sees where
> and when. It never tracks you in between. You can stop this any time in the menu.
> [I agree] [Not now]

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
  sign-in, not typed. [to build, M1.2]
- **C2** Row-level security: a worker can insert and read only their own records; the boss can
  read every record in the company; nobody can update or delete one. [to build, M1.2]
- **C3** Withdraw: menu > **Stop using my location** adds a `withdraw` record, the app stops
  reading location for that worker, and the boss's Crew tab shows "No location consent".
  They can agree again later. [to build, M1.2]
- **C4** When `text_version` changes, everyone is asked again at next sign-in. [to build, M1.2]
- **C5** The consent record goes through the same offline outbox as punches, so it works with no
  signal. Demo mode keeps it in the browser. [to build, M1.2]
- **C6** Consent records are kept as long as the worker is on the crew plus 3 years, the same as
  their hours, so the company can show consent for any GPS it ever had. [to build, M1.4]

The phone's own location permission ("Allow While Using App") is separate and still needed. The
app asks for consent first, then shows the existing permission primer.

## Retention (how long things are kept)

Defaults, chosen to be simple and defensible for a small US employer. The legal minimums are
federal; West Virginia's own rules are a "needs Chase" check (see the end).

| Data | Where | Kept | Then | Status |
| --- | --- | --- | --- | --- |
| Hours: punch time, type, job, worker, status, distance in feet, who made it | Supabase `punches` | **3 years** after the punch | Row deleted | [to build, M1.4] |
| Raw GPS on a punch: `lat`, `lng`, `accuracy_m`, `address` | Supabase `punches` | **90 days** | Set to null; status and distance stay, so hours still make sense | [to build, M1.4] |
| Clock-in pictures | Backblaze B2 (private bucket), key on the punch | **60 days** | Object deleted, `photo_key` set to null, `photo_sha256` kept | [to build, M1.4; B2 lifecycle rule can back it up] |
| Chat ciphertext | Supabase `mls_messages` | **30 days** | Deleted. Phones keep their own decrypted copy. | [to build, M1.4] |
| Used MLS key packages | Supabase `mls_key_packages` | **30 days** after claimed | Deleted | [to build, M1.4] |
| Chat on the phone (decrypted) | Phone IndexedDB `crewclock-chat` | **90 days** | Trimmed by the app | [to build, M1.4; today kept forever] |
| Consent records | Supabase `location_consents` | On the crew + 3 years | Deleted | [to build, M1.4] |
| Phone keys and user agent | Supabase `devices` | While in use; 90 days after revoked or the worker leaves | Deleted | [to build, M1.4] |
| Push subscriptions | Supabase `push_subscriptions` | While in use | Deleted when the worker leaves or the browser retires it | [partly true: retired ones are deleted, `_shared/push.ts:28`] |
| Boss and foreman's team cache | Their phone, localStorage `cc.team` | Last 8 days of punches | Replaced on each refresh; cleared on sign-out | [true] `js/app.js:125-131`, `js/api-supabase.js:163` |
| Unsent punches and pictures | Phone IndexedDB outbox | Until sent | Removed when the server accepts them or refuses them for permission. Any other refusal (for example "Punch too old") is final: the phone deletes its GPS, picture, signature and edit data at once and keeps only a stub (who, job, in/out, time, reason) so the sync line can explain it; the stub is never resent. Network, server or picture-upload failures keep the whole punch and retry. | [true] `js/app.js:85-90,112-125`; [stub kept until cleared, no trim yet] |
| Daily and weekly reports | The boss's Google Sheet | 3 years (hours only, no GPS) | The boss deletes old rows | [manual; no GPS goes to the Sheet today, `report-export` sends shifts only] |
| Sign-in sessions | Supabase Auth | 1 hour token, refresh until sign-out | Ended on new PIN or deactivation | [true] `20261023000000_auth_hook.sql:32-41` |

Rules:
- **R1** One SQL function (`app.apply_retention()`) does every server-side row above, runs daily
  from `pg_cron`, and has local tests with rows on both sides of each cutoff. [to build, M1.4;
  scheduled live in M2.4]
- **R2** Photo deletion lists B2 keys from the punches being trimmed and deletes those objects
  through an Edge Function holding the B2 key; a bucket lifecycle rule (hide and delete after 60
  days) is the backstop. [to build, M1.4 / M2.3]
- **R3** A punch that is part of an open dispute can be put on hold by the boss (`hold_until`), and
  retention skips it until then. [scheduled; not needed for the beta]

## Deletion

**A worker leaves (boss turns them off in the Crew tab):**
- At once: sessions ended on every phone [true], devices revoked, push subscriptions deleted,
  removed from chat groups, unclaimed key packages deleted. [to build, M1.4]
- After that, normal retention runs: GPS gone at 90 days, pictures at 60, hours kept 3 years
  under their name because payroll law needs it.
- 3 years after their last punch: punches and consent records deleted, crew row and Supabase Auth
  user (`<id>@crew.invalid`) deleted. [to build, M1.4]

**A worker asks for their data to be deleted:**
- The boss can delete right away, with one action: GPS on all their punches, all their
  pictures, their devices, push subscriptions, key packages and chat messages they sent.
- Hours (time in, time out, job) are kept until the 3-year payroll minimum, then deleted. The app
  tells the boss this in plain words. [to build, M1.4]
- A worker can see their own punches and consent records in the app today (RLS allows it); an
  export button is scheduled after the beta.

**The boss deletes the company:**
- The boss exports the Sheet first (it is theirs; the app does not touch it).
- One owner-run script deletes the org (every table cascades on `org_id`), every B2 object under
  the `<org_id>/` prefix, and every Auth user for that crew. [to build, M1.4; today
  `punches.crew_id`, `punches.by_crew_id`, `mls_messages.sender_crew_id` and
  `chat_groups.created_by` have no `on delete` rule, so a crew row with punches cannot be deleted
  at all: `20261022000000_init.sql:85-86,138,152`]

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
Consent row is [to build, M1.2].

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
  variables, never in the repo, never in GitHub variables. The real company code is not
  `TEAYS` or any word written in this repo. [to build, M2.1/M2.2]
- **S3** CORS (`APP_ORIGIN`, the B2 bucket rule) lists only the crew app's address, never the
  demo's, and the functions refuse to start without `APP_ORIGIN`. [to build, M1.1 / M2.2; today
  `http.ts:4` falls back to `*` and SETUP still names github.io]
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

# Architecture: where personal data lives (Crew Clock)

A map, not the contract. The contract is [docs/PRIVACY.md](../PRIVACY.md): what is collected, who
sees it and how long it is kept. If this map and PRIVACY disagree, PRIVACY wins and this map is
fixed in the same PR. Any PR that changes how data is stored, moved, logged or shared updates the
matching section here (studio standard, section 3). Tables come from `supabase/migrations/`.
Who may touch them at all is set by grants (`20261123000000_revoke_defaults.sql`, PRIVACY S6):
signed-out callers nothing, phones only what the app uses, then row-level security picks the rows.
The alert schedules (`supabase/manual/schedules.sql`) are run by hand, not by `db push`.

## The two builds

| Build | Where | Personal data |
|---|---|---|
| Public demo | GitHub Pages, built with `--demo` | None. Made-up crew, kept in the visitor's own browser; no backend address in the build |
| Crew app | Its own Cloudflare Pages address (not set up yet) | The real crew, through Supabase and Backblaze below |

## How a punch moves

1. **Tap.** The worker taps Clock in or out. Only now is location read (up to 20 s, best fix kept),
   and only if their newest consent record says agree. No consent: no GPS, a picture instead.
2. **Phone.** The punch (time, type, job, GPS, picture, signature, link to the previous punch) is
   signed with the phone's private key from IndexedDB `crewclock-keys` and queued in the IndexedDB
   `outbox`. With no signal it waits there.
3. **Sync.** The `sync` Edge Function checks the signature and chain, drops GPS if consent was not
   agree at that time, flags risks, and writes `punches`. Pictures go straight to the private B2
   bucket through a 10-minute presigned link from `photo-upload`; only the key is stored.
4. **Boss.** The boss and foremen read the team through row-level security and cache up to 13
   days of times in `cc.team` (GPS for the last 8 days only). Pictures open through `photo-url`.
5. **Out of the system.** Web push (`digest`, `sync`, `pin-login` lockout alerts) carries names and counts, never coordinates.
   `report-export` sends shifts, hours only, to the boss's Google Sheet. The weekly CSV is made on
   the boss's phone: name, date, in, out, hours.

## What is stored where, and for how long

| Data | Store | Kept (from PRIVACY) |
|---|---|---|
| Company, jobs (job pin and address the boss enters) | `orgs`, `jobs` | While in use |
| Crew: name, role, PIN hash, server-only lock fields | `crew` | While on the crew; anonymized (not deleted, consents point at it) 3 years after `deactivated_at`. Wrong-PIN count, lock and block fields reset on their own rules (next good PIN, end of lock, new PIN) |
| Hours: punch time, type, job, worker, status, distance | `punches` | 3 years |
| Raw GPS on a punch: lat, lng, accuracy, address | `punches` | 90 days, then null (hash and signature removed too) |
| Clock-in pictures | Backblaze B2 private bucket; key on the punch | 60 days: key queued in `app.photo_purge` and nulled on the punch; deleting the B2 object itself is M2.3 (partly built) |
| Picture-delete queue | `app.photo_purge` | 30 days after the object is deleted |
| Consent records (action, text version, time, device) | `location_consents` | For good: never edited or deleted (CLAUDE.md hard rule) |
| Phone public keys and user agent | `devices` | 90 days after revoked or the worker leaves |
| Sign-in limit counts (keyed hash, never the IP) | `app.rate_hits` | 1 day |
| Push subscriptions | `push_subscriptions` | While in use |
| Chat groups and members | `chat_groups`, `chat_members` | While the group exists |
| Chat ciphertext (server never sees text) | `mls_messages` | 30 days |
| Used chat key packages | `mls_key_packages` | 30 days after claimed |
| Decrypted chat on the phone | IndexedDB `crewclock-chat` | 90 days (trim still to build) |
| Newest consent record, as the phone knows it | localStorage `cc.consents` | Until a newer record |
| Sign-in session (refresh token, never the PIN) | localStorage `cc.sbSession`; Supabase Auth | Until sign-out, a new PIN or deactivation |
| Unsent punches and pictures | IndexedDB `outbox` | Until sent; a final refusal keeps only a stub with no GPS or picture |
| Daily and weekly reports | The boss's Google Sheet | 3 years, hours only |

Retention runs in SQL (`app.apply_retention`, `20261024000000_retention.sql`), daily once the
crew app is live (`M2.4`).

## Outside services

Supabase (database, sign-in, functions), Backblaze B2 (pictures), web push services (alert
delivery), Google Sheets (nightly export, shelved; the Week view CSV covers it), and the US Census and OpenStreetMap geocoders for addresses
the boss types, never a worker's location. Metadata only: the OpenStreetMap / USGS tile servers see which area the boss's map is showing. Hugging Face: none while on-phone AI is shelved (`onPhoneAi` off in every build). Accounts by type: [NOTES.md](../product/NOTES.md#accounts).

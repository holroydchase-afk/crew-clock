# Crew Clock v2 setup

About an hour, once. Everything below has a free tier that covers a beta.
You need: a Supabase account, a Backblaze account, a GitHub account, a Google account for the Sheet,
and a computer with [Deno](https://deno.com) and the [Supabase CLI](https://supabase.com/docs/guides/cli).

## 1. Supabase project (database, logins, functions)

1. Create a project at supabase.com. Pick the US East region (closest to WV).
2. In this repo: `supabase link --project-ref YOUR_REF`, then `supabase db push`.
   That runs `20261022000000_init.sql` (tables, security rules, geofence) and
   `20261023000000_auth_hook.sql` (session claims). Leave `20261022000100_schedules.sql` for step 6.
3. Note from **Project Settings > API Keys**: the project URL and the publishable (`anon`) key.
4. Sign-in security, in the dashboard:
   - **Project Settings > JWT Keys**: if it still says "Legacy JWT secret", click
     **Migrate JWT secret**, then **Rotate keys** so the new ECC (P-256) key signs tokens.
     Later, once the app and functions use the new `sb_publishable_` / `sb_secret_` API keys
     instead of the legacy `anon` / `service_role` ones, revoke the legacy secret too. Until then
     the database would still accept a token made with it (the functions already refuse them).
   - **Authentication > Hooks**: add a **Customize Access Token (JWT) Claims** hook,
     type Postgres, function `public.crew_access_token_hook`.
   - **Authentication > Sign In / Providers**: turn **Allow new users to sign up** off.
     Leave the Email provider on (PIN login uses it behind the scenes; no email is ever sent).
   - **Authentication > Sessions** (optional): access tokens last 1 hour by default; leave that.

   How sign-in works: a crew member taps their name and types their PIN. `pin-login` checks the PIN
   (PBKDF2, 5 tries then a 15 minute lockout) and asks Supabase Auth for a normal session for that
   person. Supabase signs the token with its private key; the database and the functions check it
   with the public key. Nothing in this app can sign a token, and the phone never stores the PIN,
   only Supabase's refresh token. A new PIN or turning someone off in the Crew tab ends their
   sessions on every phone.

## 2. Backblaze B2 (photos)

1. Create a **private** bucket, e.g. `crewclock-photos`. Note its region from the endpoint,
   e.g. endpoint `s3.us-east-005.backblazeb2.com` means region `us-east-005`.
2. Create an application key limited to that bucket with read and write. Note the key ID and key.
3. Allow the app to upload from the browser (B2 CLI):

       b2 bucket update --cors-rules '[{"corsRuleName":"app","allowedOrigins":["https://clock.example.com"],
         "allowedOperations":["s3_put","s3_get"],"allowedHeaders":["content-type"],"maxAgeSeconds":3600}]' crewclock-photos allPrivate

## 3. Secrets and functions

Make push keys once: `npx web-push generate-vapid-keys`. Make three random secrets
(`openssl rand -hex 32`, one each) for `CRON_SECRET`, `REPORT_TOKEN` and `RATE_HMAC_KEY` (the sign-in
limits count tries under a hash of the IP made with it, so no address is stored). Then:

    supabase secrets set \
      B2_KEY_ID=<key id> B2_APPLICATION_KEY=<key> B2_BUCKET=crewclock-photos B2_REGION=us-east-005 \
      VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:you@example.com \
      CRON_SECRET=<random> REPORT_TOKEN=<random> RATE_HMAC_KEY=<random> \
      APP_ORIGIN=https://clock.example.com

    supabase functions deploy

## 4. The company and the boss

    deno run scripts/new-company.ts "Example Construction" random "Dad" <boss PIN>

Paste the printed SQL into the Supabase SQL editor and run it. `random` makes the company code: 8
random letters and numbers, printed once on the screen. Write it down; it goes in `ORG_CODE` (step 5)
and the install link (step 8), and never in this repo, since anyone with it sees the crew name list.
A code you type yourself must be 8 or more letters and numbers. The name list and PIN screen are
limited per phone network (30 lists and 20 PIN tries an hour) and per company (40 PIN tries an hour), and the third PIN lockout in a day
blocks that PIN until Dad sets a new one in the Crew tab; Dad gets an alert on every lockout.
Dad adds the crew himself from the app's **Crew** tab after that.

## 5. The app (two builds: the public demo and the crew's app)

The same code is published twice, so recruiters and visitors never reach the crew's real data:

| Build | Where | Data |
| --- | --- | --- |
| Public demo | GitHub Pages, `chaseholroyd.com/crew-clock/` | Made-up sample data in the visitor's browser. `pages.yml` builds it with `--demo`, which ignores every backend setting and fails the build if one slips in. |
| Crew app | Cloudflare Pages, its own address (e.g. `clock.example.com`) | The real Supabase project. Only this build gets the variables below. |

**Public demo** (once): **Settings > Pages**, set **Source** to **GitHub Actions**. After that it
deploys by itself after CI passes on `main`. Don't add the variables below to GitHub; the demo
build ignores them anyway.

**Crew app** (Cloudflare Pages, free):

1. [dash.cloudflare.com](https://dash.cloudflare.com) > **Workers & Pages > Create > Pages > Connect to
   Git** > `crew-clock`. Build command `node scripts/build-site.mjs`, output directory `dist`.
2. Under **Settings > Variables and secrets**, add:

   | Variable | Value |
   | --- | --- |
   | `CREW_BACKEND` | `supabase` |
   | `SUPABASE_URL` | the project URL from step 1.3 |
   | `SUPABASE_ANON_KEY` | the publishable key from step 1.3 |
   | `ORG_CODE` | your company code from step 4 |
   | `VAPID_PUBLIC_KEY` | the public push key from step 3 |

   None of them is a secret (phones see them anyway). The build writes them into `config.js`, so
   the repo's copy stays in demo mode.
3. Your own address: in the Pages project, **Custom domains > Set up a domain**, e.g.
   `clock.example.com`, and at Porkbun add the `CNAME` it shows. Use that address in the CORS
   rule, in `APP_ORIGIN` and in the install link. Never use the demo's address for the crew.

`scripts/build-site.mjs` publishes only the phone app (no backend code, tests or docs) and stamps
the service worker with a hash of the app files, so phones pick up every release without bumping
`VERSION` by hand. `_headers` sets the crew app's security headers on Cloudflare.

## 6. Morning and evening alerts

Enable the `pg_cron` and `pg_net` extensions (**Database > Extensions**). Open
`supabase/migrations/20261022000100_schedules.sql`, replace `PROJECT_REF` and `CRON_SECRET`,
and run it in the SQL editor. Times are UTC; the file explains the Eastern time offsets.

## 7. Google Sheets reports

1. Make an empty Google Sheet. **Extensions > Apps Script**, paste `backend/sheets-export.gs`.
2. **Project Settings > Script Properties**: `SUPABASE_URL`, `REPORT_TOKEN`, `ORG_CODE`.
3. Run `setupReports` once and approve. The Daily tab fills at 7:15 PM, Weekly on Sunday night,
   and the Sheet gets a **Crew Clock** menu to refresh any time.

## 8. Install day (10 minutes a person)

Send each person `https://clock.example.com/?org=<CODE>` (the crew app's address from step 5, never the demo's). On their phone:

1. Open the link. iPhone: Share, **Add to Home Screen**. Android: **Install app** or Add to Home screen.
2. Open it from the home screen, tap their name, type their PIN.
3. Tap **OK, ask me**, then **Allow** location.
4. Tap **Get alerts on this phone** (boss and foremen at least).
5. Open **Messages** once so the boss can add them to a group.
6. Do one practice clock-in and clock-out at the shop.

## What it costs

| Service | Free tier | When you'd pay |
| --- | --- | --- |
| Supabase | 500 MB database, 500K function calls a month | Pro is $25/month; needed past a few hundred workers or to stop the free project pausing after a week unused |
| Backblaze B2 | 10 GB (about 70,000 photos) | $6/TB/month after that |
| GitHub Pages | Free for a public repo, 100 GB of traffic a month | Never at this size |
| Web push | Free | Never |
| AI models | Run on the phones | Never |
| Google Sheets | Free | Never |

# Crew Clock v2 setup

About an hour, once. Everything below has a free tier that covers a beta.
You need: a Supabase account, a Backblaze account, a GitHub account, a Google account for the Sheet,
and a computer with [Deno](https://deno.com) and the [Supabase CLI](https://supabase.com/docs/guides/cli).

## 1. Supabase project (database, logins, functions)

1. Create a project at supabase.com. Pick the US East region (closest to WV).
2. In this repo: `supabase link --project-ref YOUR_REF`, then `supabase db push`.
   That runs `supabase/migrations/20261022000000_init.sql` (tables, security rules, geofence).
   Leave `20261022000100_schedules.sql` for step 6.
3. Note from **Project Settings > API**: the project URL and the `anon` public key.
4. Note from **Project Settings > JWT**: the JWT secret.
   The app's PIN login signs session tokens with it (HS256). If the project only offers the newer
   asymmetric signing keys and no legacy secret, PIN tokens won't be accepted by the database API;
   the fix is moving `pin-login` to Supabase's custom access token hook (about an hour of work).

## 2. Backblaze B2 (photos)

1. Create a **private** bucket, e.g. `crewclock-photos`. Note its region from the endpoint,
   e.g. endpoint `s3.us-east-005.backblazeb2.com` means region `us-east-005`.
2. Create an application key limited to that bucket with read and write. Note the key ID and key.
3. Allow the app to upload from the browser (B2 CLI):

       b2 bucket update --cors-rules '[{"corsRuleName":"app","allowedOrigins":["https://YOUR-GITHUB-USER.github.io"],
         "allowedOperations":["s3_put","s3_get"],"allowedHeaders":["content-type"],"maxAgeSeconds":3600}]' crewclock-photos allPrivate

## 3. Secrets and functions

Make push keys once: `npx web-push generate-vapid-keys`. Make two random secrets
(`openssl rand -hex 32`) for `CRON_SECRET` and `REPORT_TOKEN`. Then:

    supabase secrets set \
      CREW_JWT_SECRET=<JWT secret from 1.4> \
      B2_KEY_ID=<key id> B2_APPLICATION_KEY=<key> B2_BUCKET=crewclock-photos B2_REGION=us-east-005 \
      VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:you@example.com \
      CRON_SECRET=<random> REPORT_TOKEN=<random> \
      APP_ORIGIN=https://YOUR-GITHUB-USER.github.io

    supabase functions deploy

## 4. The company and the boss

    deno run scripts/new-company.ts "Holroyd Construction" TEAYS "Dad" 1234

Paste the printed SQL into the Supabase SQL editor and run it. `TEAYS` is the company code.
Dad adds the crew himself from the app's **Crew** tab after that.

## 5. The app

1. Edit `config.js`: `backend: 'supabase'`, `supabaseUrl`, `supabaseAnonKey`, `orgCode: 'TEAYS'`,
   `vapidPublicKey`.
2. Bump `VERSION` in `sw.js` whenever app files change, so phones pick up the new version.
3. GitHub: **Settings > Pages**, deploy from branch `main`, folder `/`. The app is then at
   `https://YOUR-GITHUB-USER.github.io/crew-clock/`.

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

Send each person `https://YOUR-GITHUB-USER.github.io/crew-clock/?org=TEAYS`. On their phone:

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
| GitHub Pages | Free for public repos; private repos need GitHub Pro ($4/month) to publish Pages | Or host the same files on Cloudflare Pages for free |
| Web push | Free | Never |
| AI models | Run on the phones | Never |
| Google Sheets | Free | Never |

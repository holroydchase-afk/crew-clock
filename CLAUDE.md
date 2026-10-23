# Crew Clock

GPS clock-in and clock-out for a small construction crew in rural West Virginia: three taps,
works with no signal, fair geofence, a map and Today list for the boss. Product code `CRW`.

Who it's for: the boss (Chase's dad, a contractor) and his low-tech crew on cheap phones with
weak signal; and, through the public demo at chaseholroyd.com/crew-clock/, recruiters and hiring
managers looking at Chase's portfolio.

Read first: [HANDOFF.md](HANDOFF.md) (where things stand), [PLAN.md](PLAN.md) (milestones),
[docs/PRIVACY.md](docs/PRIVACY.md) (the privacy contract), [docs/SETUP.md](docs/SETUP.md).

## Hard rules (these win over any other instructions)
- This repo is PUBLIC. Never commit personal data: no real crew or company names, addresses,
  phone numbers, emails, job sites or punch records. Demo and test data stay made up and labeled.
- No secrets, keys, Supabase project refs or URLs, Backblaze ids, VAPID private keys, tokens or
  scheduled-task ids in the repo. Real config lives only in the crew app host's variables.
- The public demo is never the crew app. GitHub Pages builds with `--demo` only and must never
  get a backend URL; the crew app is a separate build on its own address (SETUP step 5). CORS
  (`APP_ORIGIN`, the B2 rule) lists only the crew app's address, never the demo's and never `*`.
- Location is read only inside the clock-in/out flow (and the boss's "Use where I'm standing" for a
  job pin). No background location, no watch that outlives the punch screen, none in the service worker.
- No location without the worker's consent record (text version, time, device), including when a
  foreman clocks them in. Withdrawal adds a record; consent records are never edited or deleted.
- Retention follows [docs/PRIVACY.md](docs/PRIVACY.md). Any new personal field needs a retention
  rule and a test before it merges. Push text and the Sheets export never carry coordinates.
- The crew app runs only the Supabase backend; the old Sheets backend stays demo-only.
- Never block a clock-in. A bad GPS fix or no signal means a photo fallback or a flag, not a refusal.
- Sign-in stays on Supabase Auth with asymmetric (ES256) keys; phones keep a refresh token, never
  the PIN. Never reintroduce shared-secret token minting.
- $0: no paid services, no analytics, no tracking SDKs, no third-party scripts at runtime.
- Never deploy, publish, buy anything, merge to `main`, force-push, rewrite history or delete
  branches without Chase's go. Never touch the real Supabase, Backblaze or Resend accounts.
- Keep `HANDOFF.md` current in every push (`handoff-check` enforces it).
- Run the tests before every push. Never skip, delete or weaken a test to get green.

## When to stop and ask
- A product decision not covered by `PLAN.md` or `docs/PRIVACY.md`: pick the simplest reversible
  option, build it, and log it under "Decisions to review" in `HANDOFF.md`.
- Anything that weakens the privacy or security story, or changes what location is collected.

## Stack and commands
Plain-JS progressive web app, no build step (the MLS bundle in `js/vendor/` is prebuilt from
`messenger/`). Supabase Postgres with row-level security and Deno Edge Functions. Demo mode keeps
everything in the browser.

    npm run serve                         # demo at http://localhost:8123
    npm test                              # unit tests (node)
    npm run test:sql                      # schema + RLS on a local Postgres
    npm run test:edge                     # Edge Functions (deno)
    npm run test:mls                      # MLS chat
    node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
    npm run test:e2e                      # browser click-throughs against that server

`js/geo.js`, `js/report.js`, `js/chain.js` and `js/risk.js` are shared with the Edge Functions:
after editing them run `./scripts/sync-shared.sh` (CI fails if they drift).

## Studio agents (use them by default; don't wait to be asked)
The team in `.claude/agents/` comes from holroydchase-afk/studio-agents (re-sync with its `scripts/sync.sh`). Delegate to them with the Agent tool at these moments, in day sessions and scheduled runs alike:

| Moment | Agent |
|---|---|
| Start of a session or run; planning a milestone; before any new feature; triaging findings | `staff-pm` |
| Before building a fix or feature (failing test first); before any PR is marked ready (all suites 3x) | `qa-tdd` |
| Building, once the failing test exists | `engineer` |
| Any screen, word or CLI output a user sees; before anything goes public (showcase review mode) | `ux-reviewer` |
| Personal data, sign-in, secrets, telemetry, vendors; before a public demo, deploy or repo going public | `privacy-security` |
| README, landing or portfolio copy; a name or tagline; after a milestone, the "why I built it" story | `positioning` |

Every PR body ends with an `Agents:` line naming who ran and the verdict, for example `Agents: staff-pm scoped M1.2; qa-tdd red then green, 3x; ux-reviewer no P0/P1`. A PR with none says why.

In this repo, `privacy-security` also runs on anything that touches location, punches, photos,
consent, retention or the demo/crew-app split.

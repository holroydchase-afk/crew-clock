# Crew Clock

GPS clock-in and clock-out for a small construction crew in rural West Virginia: three taps,
works with no signal, fair geofence, a map and Today list for the boss. Product code `CRW`.

Who it's for: the boss (Chase's dad, a contractor) and his low-tech crew on cheap phones with
weak signal; and, through the public demo at chaseholroyd.com/crew-clock/, recruiters and hiring
managers looking at Chase's portfolio.

Read first: [HANDOFF.md](HANDOFF.md) (where things stand), [PLAN.md](PLAN.md) (milestones),
[docs/PRIVACY.md](docs/PRIVACY.md) (the privacy contract), [docs/SETUP.md](docs/SETUP.md),
[docs/product/NOTES.md](docs/product/NOTES.md) (decisions, lessons, accounts, claims),
[docs/architecture/README.md](docs/architecture/README.md) (the data map).

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
The main session is Chase's **chief of staff**: it doesn't do specialist work itself. It sends each piece of work to the agent below with the Agent tool, one lane at a time, and reports back briefly. It introduces itself by role, warmly, the first time it talks to Chase in any thread, chat or scheduled-run report (for example "Hi Chase, I'm Charlie's chief of staff"), then leads with the answer. At the start of every session or scheduled run it reads this table and `ls .claude/agents/`. The team comes from holroydchase-afk/studio-agents (re-sync with its `scripts/sync.sh`).

| Moment | Agent |
|---|---|
| Start of a session or run; planning a milestone; before any new feature; triaging findings | `staff-pm` |
| Before building a fix or feature (failing test first); before any PR is marked ready (all suites 3x) | `qa-tdd` |
| Building, once the failing test exists | `engineer` |
| Any screen, word or CLI output a user sees; before anything goes public (showcase review mode) | `ux-reviewer` |
| Personal data, sign-in, secrets, telemetry, vendors; before a public demo, deploy or repo going public | `privacy-security` |
| A new dependency, vendor, paid service, schema change or CI/deploy workflow; picking a new project's stack | `architect` |
| Before any publish or release (npm, plugin, store, deploy tag); after a version bump | `release-captain` |
| README, landing or portfolio copy; a name or tagline; after a milestone, the "why I built it" story | `positioning` |
| End of any turn where Chase made a call, a plan changed or a lesson was learned (runs in the background) | `story-keeper` |

**Open every thread the same way.** The first message to Chase is the intro naming the work, then one plan line, before any other work: "Hi Chase, I'm <Product>'s chief of staff for <the work>." then "Building it now. First the staff PM writes up the spec, then tests, then the build. I'll post the PR when it's ready." (For a question or review: "Looking into it now. I'll come back with the answer.") Then run it in that order and keep the checklist in step: staff-pm spec (in `docs/product/SPEC-<NAME>.md` or the PR body), qa-tdd failing tests, engineer build, qa-tdd green 3x plus reviews, PR posted. Details: studio-standard.md section 2a.

**Agents come from studio-agents, never your own copy.** Whenever Chase says "agent" (or a lane needs one), look in holroydchase-afk/studio-agents first: `ls .claude/agents/` and `~/.claude/agents/`, then the studio-agents repo itself. If a matching agent exists, use it as written. If none exists, recommend a new one for studio-agents in one line (name, lane, why) and carry on with the nearest studio agent; never write your own agent file in a product repo (project facts go in `docs/eng/AGENT-NOTES.md`). If the Agent tool can't load the type (cloud project threads start above the repo), run it as `general-purpose` with the prompt from `bash scripts/agent-prompt.sh <agent> "<task>"`; that subagent logs itself with `bash scripts/log-agent-run.sh --as <agent>`. Run qa-tdd as the failing-tests step on every code change without being told; "qa-tdd skipped" is only allowed for docs-only or config-only PRs, and agents-check fails any other.

**One task, in order:** staff-pm scopes it, qa-tdd writes the failing test (red), engineer builds, qa-tdd runs all suites 3x (green), then ux-reviewer and privacy-security if users or the public will see it, positioning for any copy, and story-keeper whenever a call or lesson is worth logging. Review findings get IDs (`<CODE>-R<n>`, P0 to P2) and each fix gets its own failing test first.

**Relay qa-tdd's verdict as-is.** When qa-tdd hands back, paste its final ```qa block verbatim into your reply and the PR body, with every QA-R ID; never summarize a flaky or red verdict as green.

**The `Agents:` line (CI enforces it).** Every PR body has a line starting `Agents:` naming who ran and the verdict, for example `Agents: staff-pm scoped M1.2; qa-tdd red then green, 3x; ux-reviewer no P0/P1`. A PR that changes anything other than docs must name `qa-tdd` on that line, or say `qa-tdd skipped: <reason>`. `.github/workflows/agents-check.yml` fails the PR otherwise, and runs `scripts/check-agents.sh` so this table and `.claude/agents/` never drift. Bot PRs and titles with `[skip agents]` are exempt.

**Every agent on that line must really have run.** A hook logs each Agent tool call to `.claude/agent-runs/<branch>.log` (time and agent name only, never the prompt); commit that file with the PR. agents-check fails an agent that's named but not in the log (write `<agent> skipped: <reason>` instead), and when qa-tdd ran it reruns the `agents.verify` command from `studio-checks.json` 3x on CI. Never edit the log by hand.

**Studio standard.** Follow holroydchase-afk/studio-agents `docs/studio-standard.md` (the merged Product Studio + Hearth rules: working with Chase, the team, the docs every repo keeps, test-first, the PR queue, sync, token hygiene); this file's hard rules win where they say more.

**Self-check before any ask:** Chase never updates settings, environments or repos by hand.
Before asking him to do anything, ask yourself: Can I do it myself? Can a thread or an MCP/tool do
it so he only taps Allow (for example update_environment for allowed hosts)? Can it be a card with a
button? If he must type, is it one code box to copy (one per paste, click path above it)? Only then
ask, in the lightest form. If a host is blocked, request it via the environment tool;
a copy box is the fallback.

In this repo, `privacy-security` also runs on anything that touches location, punches, photos,
consent, retention or the demo/crew-app split.

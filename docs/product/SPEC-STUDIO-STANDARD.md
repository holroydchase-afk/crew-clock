# Spec: studio standard (CRW, issues #39, #40, #46)

One PR titled `studio standard`. Docs, synced studio files and CLAUDE.md wording; no app, demo or
schema change. Source: studio-agents `docs/studio-standard.md` section 3 and "Adopting it".

**Bet.** Any cold agent session in this repo finds Chase's past calls, past incidents, the
accounts and the data map in the repo, and stops asking Chase for things it can do itself. Proof:
the next three sessions cite a `CRW-DEC-n` or a lesson instead of re-asking a settled question.

**Already true (checked 2026-11-23, don't redo):** CLAUDE.md's Studio agents section matches
`templates/CLAUDE-agents.md` (story-keeper row, Studio standard paragraph); HANDOFF has the status
header; `docs/eng/AGENT-NOTES.md` exists; #40's sync is in the working tree (ux-reviewer,
qa-tdd, staff-pm, `.claude/design-rules.md`, `scripts/check-findings.mjs`, `scripts/ux-rules.mjs`,
`agents-check.yml`); this repo's `check-logs.mjs` and `handoff-check.yml` kept (newer).

**Stale after this PR:** HANDOFF status `now:`/`next:`, HANDOFF Done, CLAUDE.md "Read first",
PLAN (no task for this; add `M0.2` done). README, screenshots and the demo are not touched.

## Acceptance criteria (tests in `tests/studio-standard.test.js`, all read files; no clock)

| ID | Type | Given / When / Then |
|---|---|---|
| SS-1 | auto | Given CLAUDE.md, then the paragraph from #46 that starts `Self-check before any ask:` and ends `a copy box is the fallback.` appears exactly 1 time, verbatim, after the line starting `**Studio standard.**` and before `In this repo, \`privacy-security\``; and no line matches `/give Chase the fix/i` -> 0 matches |
| SS-2 | auto | Given CLAUDE.md, then the 13 `## Hard rules` bullets are kept: the section still has 13 lines starting `- `, including `Never touch the real Supabase, Backblaze or Resend accounts.` and `merge to \`main\`` |
| SS-3 | auto | Given CLAUDE.md, then the Studio agents table has 9 rows and the `story-keeper` row reads `\| End of any turn where Chase made a call, a plan changed or a lesson was learned (runs in the background) \| \`story-keeper\` \|` |
| SS-4 | auto | Given CLAUDE.md's `Read first:` line, then it links `docs/product/NOTES.md` and `docs/architecture/README.md`, and both files exist |
| SS-5 | auto | Given `docs/product/NOTES.md`, then it has `## Decisions`, `## Lessons`, `## Accounts`, `## Marketing claims register` in that order |
| SS-6 | auto | Given NOTES Decisions, then there are >= 10 entries with IDs `CRW-DEC-1`..`CRW-DEC-n`, numbered with no gap or repeat, each with a `YYYY-MM-DD` date and the words `Why:` and `Beat:` |
| SS-7 | auto | Given NOTES Lessons, then there are >= 5 entries whose dates read newest first (each date <= the one above); one names `2026-10-28` and `service worker`, one names `ubuntu-24.04`; each has `Rule:` |
| SS-8 | auto | Given NOTES Accounts, then it names `Supabase`, `Backblaze`, `Resend`, `GitHub Pages`, `Cloudflare Pages`, `Google` and `registrar`, each with `Rename cost:` |
| SS-9 | auto | Given NOTES Marketing, then its first paragraph says `positioning` owns it, and every claim row has a proof path in backticks that exists on disk (`fs.existsSync`) -> 0 missing; >= 5 claims |
| SS-10 | auto | Given `docs/architecture/README.md`, then it links `../PRIVACY.md` as the contract and names every table from `create table` in `supabase/migrations/*.sql` (13 today, parsed, not hard-coded) plus `cc.team`, `cc.consents`, `crewclock-chat` and `outbox` |
| SS-11 | auto | Given the architecture map, then its retention words match PRIVACY: raw GPS `90 days`, pictures `60 days`, hours `3 years`, chat `30 days`, consent `For good`/`never deleted` |
| SS-12 | auto | Given NOTES.md and `docs/architecture/README.md`, then 0 matches for an email (`/[\w.+-]+@[\w-]+\.\w+/`), `https?://`, `supabase.co`, a 20-letter ref (`/\b[a-z]{20}\b/`), `backblazeb2.com` |
| SS-13 | auto | Given the repo, then `scripts/check-findings.mjs`, `scripts/ux-rules.mjs`, `.claude/design-rules.md` exist; `agents-check.yml` names `scripts/check-agents.sh` and `scripts/check-agent-runs.sh`; `bash scripts/check-agents.sh` exits 0 |
| SS-14 | auto | Given `.claude/agents/*.md`, then 0 files mention `Crew Clock` or `CRW-` (product facts stay in AGENT-NOTES) |
| SS-15 | auto | Given HANDOFF.md, then lines 1..15 hold `<!-- status` .. `-->` with keys stage, goal, milestone, now, next, waiting_on_chase, blockers; `bash scripts/check-handoff-status.sh` prints 0 warnings; Done has one entry naming `#39`, `#40` and `#46` |
| SS-16 | manual | Re-run studio-agents `sync.sh .` and `install-rules.sh .` a second time -> `git diff --stat` shows "0 files changed" (same action twice is a no-op) |
| SS-17 | manual | PR body has `Closes #39`, `Closes #40`, `Closes #46` and an `Agents:` line naming qa-tdd; `npm test` green 3 times in a row |

Edge cases: a missing NOTES section (SS-5 fails, not crashes), a date out of order (SS-7), a
renamed proof path (SS-9), a new migration table (SS-10 parses, so it goes red on that PR). No
numbers are summed, so no rounding rule. Undo: revert the one PR; the demo files do not change.
lint-ok: SL-6 no sign-in, access or owner-only behavior changes; docs and studio files only, and SS-12 covers the public-repo leak case

```spec
verdict: ready
bet: Cold agent sessions find Chase's calls, incidents, accounts and the data map in the repo and stop asking him; it worked when the next 3 sessions cite a CRW-DEC or lesson instead of re-asking
step: M0.2.1 | qa-tdd writes tests/studio-standard.test.js | red for SS-1, SS-4, SS-15 for the right reason | 0.5 session
step: M0.2.2 | engineer adds the self-check paragraph, Read first links, HANDOFF status and Done, PLAN M0.2 | SS-1 to SS-15 green | 0.5 session
step: M0.2.3 | engineer re-runs install-rules.sh and keeps the newer local copies | SS-16 shows 0 files changed on a second run | 0.25 session
step: M0.2.4 | qa-tdd green 3x, privacy-security on NOTES and the architecture map, PR posted | SS-17 met | 0.5 session
criterion: SS-1 | auto | Given CLAUDE.md, then the Self-check before any ask paragraph appears 1 time after the Studio standard line and "give Chase the fix" appears 0 times
criterion: SS-2 | auto | Given CLAUDE.md, then the Hard rules section still has 13 bullets including "Never touch the real Supabase, Backblaze or Resend accounts."
criterion: SS-3 | auto | Given CLAUDE.md, then the Studio agents table has 9 rows including the story-keeper row verbatim
criterion: SS-4 | auto | Given the Read first line, then it links docs/product/NOTES.md and docs/architecture/README.md and both exist -> 2 of 2
criterion: SS-5 | auto | Given NOTES.md, then it has 4 headings in order: "## Decisions", "## Lessons", "## Accounts", "## Marketing claims register"
criterion: SS-6 | auto | Given NOTES Decisions, then 10 or more entries numbered CRW-DEC-1 to n with no gap, each with a date, "Why:" and "Beat:"
criterion: SS-7 | auto | Given NOTES Lessons, then 5 or more entries newest first, one with "2026-10-28" and "service worker", one with "ubuntu-24.04", each with "Rule:"
criterion: SS-8 | auto | Given NOTES Accounts, then 7 account types are named, each with "Rename cost:"
criterion: SS-9 | auto | Given NOTES Marketing, then positioning is named owner and every one of 5 or more claim proof paths exists -> 0 missing
criterion: SS-10 | auto | Given the architecture map, then it links "../PRIVACY.md" and names every table parsed from supabase/migrations -> 0 missing, plus "cc.team", "cc.consents", "crewclock-chat", "outbox"
criterion: SS-11 | auto | Given the architecture map, then it says "90 days" for raw GPS, "60 days" for pictures, "3 years" for hours, "30 days" for chat, "For good" for consent
criterion: SS-12 | auto | Given NOTES.md and the architecture map, then emails, links, project refs and storage hostnames match 0 times
criterion: SS-13 | auto | Given the repo, then the 3 synced files exist and scripts/check-agents.sh exits 0
criterion: SS-14 | auto | Given .claude/agents, then 0 files mention "Crew Clock" or "CRW-"
criterion: SS-15 | auto | Given HANDOFF.md, then the status header sits in lines 1 to 15 with 7 keys, check-handoff-status.sh prints 0 warnings, and one Done entry names "#39", "#40" and "#46"
criterion: SS-16 | manual | Re-run sync.sh and install-rules.sh a second time -> "0 files changed"
criterion: SS-17 | manual | Given the PR body, then it closes the 3 issues, has an Agents line naming qa-tdd, and npm test is green 3 times
cut: docs/STORY.md | story-keeper writes it from the private log
cut: Four separate decision, lesson, account and claims files | small-repo option until a section passes a screen
cut: Portfolio review items 2 to 5 | separate PRs, already next in HANDOFF
risk: A future migration adds a table the map never names | SS-10
risk: NOTES or the map leaks an account id or email in a public repo | SS-12
decision: Keep "never merge to main without Chase's go", since every main merge redeploys the public demo | keep it; logged as CRW-DEC-5, no change
handoff: qa-tdd | failing tests for SS-1 to SS-15 in tests/studio-standard.test.js | red for the right reason
handoff: engineer | CLAUDE.md, HANDOFF, PLAN and install-rules.sh per steps M0.2.2 and M0.2.3 | SS-1 to SS-15 green 3x
handoff: privacy-security | review NOTES.md and docs/architecture/README.md for public-repo leaks and accuracy against PRIVACY | no P0 or P1
```

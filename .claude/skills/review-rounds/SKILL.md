---
name: review-rounds
description: Run numbered review rounds (staff-pm ranks, ux-reviewer reviews, qa-tdd writes failing tests, engineer fixes) until nothing at P2 or above is left. Use for "review the UI", "recruiter-ready pass", "polish until done", or any loop of review then fix.
---

# Review rounds

The loop Energy Scanner ran seven times (ES-R1 to R68, `docs/reviews/`). The main session runs it as chief of staff and hands each step to the agent named in CLAUDE.md. ux-reviewer preloads this skill, so its findings come out in the format below.

## One round
1. **Scope (staff-pm).** Rank the touchpoints the target person hits, in order (for showcase work: link preview, first screen, demo, result, share, footer, README). Name the biggest risk.
2. **Check last round first (ux-reviewer).** For every finding from the previous round: Verified, Verified in code (confirm on device), or Not fixed, each with evidence (screenshot path or `file:line`).
3. **Review (ux-reviewer).** Build and serve the app locally. Screenshot every screen at 320x640, 390x844 and 1280x800, light and dark, and open each shot. Then hunt P0, then P1, then P2.
4. **Write it down.** New file `docs/reviews/<YYYY-MM-DD>-<name>.md` (format below). IDs continue from the last round (`<CODE>-R<n>`, never reused).
5. **Fix (qa-tdd, then engineer).** Per finding: qa-tdd writes a failing test with the ID in its title (red), engineer fixes, qa-tdd runs all suites 3x (green). A finding that needs a real device or person gets a manual AC instead and stays "confirm on device".
6. **Log.** HANDOFF.md "Done" lists each ID with one line; the PR body has the `Agents:` line.
7. **Stop rule.** Start the next round on the fixed build. Stop when a round finds nothing at P2 or above, or when told to stop. Never stop with an unverified P0.

## Priorities
- **P0:** blocks shipping or showing it (broken core flow, privacy breach, data loss, stale or false public claim).
- **P1:** hurts the impression or a core person gets stuck.
- **P2:** polish.
- Regressions say so: `P1 (regression from R46)`.

## Review file format
```markdown
# <Name> review, round <n> (<YYYY-MM-DD>)

Goal: <the ask, quoted>. Build reviewed: <branch @ short sha>, local preview. <What could not be checked, and why.>
Agents: <who ran>.

## Verdict: Ready | Needs changes | Blocker
- <Persona>: <one line>

## Round <n-1> fixes
| ID | Status | Evidence |
|---|---|---|

## Findings
| ID | Pri | Where | Problem | Fix |
|---|---|---|---|---|

## Acceptance criteria
- AC-R<n>: Given … When … Then … (auto | manual)
```

## Rules
- Only claim what you ran or opened. Say "verified in code" when you didn't see it on screen, and "confirm on device" for real-phone behavior.
- Each finding has exact words and sizes for the fix, so the engineer doesn't guess.
- New ideas found along the way go to the ideas log (or HANDOFF "Parked" during a freeze), not into the round.
- Findings feed the ux-reviewer eval: keep the ID, priority, screen and viewport accurate.

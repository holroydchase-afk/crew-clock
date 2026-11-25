# ux-reviewer: M2.0.5 intakes (CRW-9, CRW-18 ux half)

Scope: git diff origin/main...HEAD for docs/product/SPEC-INTAKES-2026-11-25.md. Demo build served on :8124
with a stub 52px portfolio header (as tests/e2e-intakes.js does), clock pinned to 2026-11-25, 390x844 at
deviceScaleFactor 1 and 1280x800, light and dark. Shots live in the session scratchpad (not committed).

**Verdict: Ready, 8/10.** No P0 or P1 survives the three-part test.
- Boss (least tech-savvy for Today): at 9:30 PM every closed row reads in the past tense ("Was on site",
  "Was near"), the header says "Not in (1)", and 0 rows say "on the clock". He can trust it at night.
- Crew worker on a cheap phone: Clock in sits whole at y 327-590 (263px tall, over the 180px floor) with the
  header and the demo banner; the page is exactly 844px, no scroll.
- Recruiter on a phone: the made-up town and jobs read as sample; the header and banner don't hide the button.

Critic's line (the boss): "Fine, it says he WAS there. Took you long enough."

**CRW-9: pass.** At 21:30, 390x844, boss Today rows: Billy S. "No GPS" 7:30-11:30, Cody M. "Was near"
7:12-3:12, Ray T. "Was on site" 6:54-3:24, Jake R. "Was on site" 7:03-3:30. 0 rows read "On site". Control at
10:00: open shifts still read "On site" / "Near" with "on the clock".

Measured: chip and time contrast on boss Today (light 5.32-7.25, dark 6.93-7.70, all 17px); Clock in box;
scroll width and height; 0 page errors; ux-rules on the sign-in page, 0 failures across 3 views. Inferred:
everything else read by eye.

## Changes
| ID | P | Rule | Where | Problem | Fix |
|---|---|---|---|---|---|
| UX-R1 | P2 | G6 | Crew build, no backend, sign-in, 390px | "No signal ... Try near the road or in town." On a misconfigured build this never clears, and the worker isn't told who can help | Add one line: "Still stuck? Tell your boss." and a "Try again" button (44px) |
| UX-R2 | P2 | D6, G12 | Boss Today, 1280px | The summary says "Didn't clock in: Travis K." and the card under it says "Not in (1)": two words for one state | Use "Not in" in the summary sentence too ("Not in: Travis K.") |

Cut list: nothing to cut in this diff; it changes words and spacing only, and both screens already fit.

Acceptance criteria for qa-tdd: UX-R1-AC no-backend sign-in shows "Tell your boss" and a Try again button of
at least 44px; UX-R2-AC at 21:30 the laptop summary contains "Not in: Travis K." and not "Didn't clock in".

For Chase: nothing needed. CLEAN-1 is still open (Medium blocks fetches): paste the article once and it gets checked.

Hard rules checked: DARK-1 pass, DARK-4 pass, DARK-5 pass, CONTRAST-1 pass, CONTRAST-2 pass, CONTRAST-3 pass, CLEAN-1 pending (source not readable)

```uxrun
date: 2026-11-25
product: Crew Clock
tier: advisory
model: claude-opus-5-5
tokens: 0
cost_usd: 0
flow: boss-today-2130 | phone,laptop | scratchpad/ux/today-390-light-2130.png
flow: crew-home | phone,laptop | scratchpad/ux/home-390-light-2130.png
flow: no-backend-signin | phone | scratchpad/ux/nobackend-390-light.png
finding: UX-R1 | P2 | G6 | scratchpad/ux/nobackend-390-light.png | no-signal message never clears on a misconfigured build | add "Tell your boss" and Try again
finding: UX-R2 | P2 | D6 | scratchpad/ux/today-1280-light-2130.png | "Didn't clock in" and "Not in" name one state | say "Not in" in the summary
verdict: Ready
rechecked: no
escalated: yes
escalation_reason: harness showed no token or cost count to record
```

```agentrun
date: 2026-11-25
agent: ux-reviewer
product: Crew Clock
tier: advisory
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: ux review of the M2.0.5 intakes diff, CRW-9 at 390x844 at 21:30
tool: agent-guard | ok | kill ux-reviewer not tripped
tool: playwright | ok | 26 shots at 390 and 1280, light and dark, 0 page errors
tool: ux-rules | ok | 0 rule failures across 3 views
tool: agent-guard | ok | cost not measured, escalated
verdict: Ready
findings: 2
p0: 0
escalated: yes
escalation_reason: harness showed no token or cost count to record
```

```findings
verdict: Ready
score: 8/10
UX-R1 | P2 | G6 | Crew build no backend, sign-in, 390px | No-signal note never clears on a misconfigured build and names no one to ask | Add "Still stuck? Tell your boss." and a 44px Try again button
UX-R2 | P2 | D6 | Boss Today summary, 1280px | "Didn't clock in" and "Not in (1)" name one state two ways | Say "Not in: Travis K." in the summary
```

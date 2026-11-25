# Demo bar showcase review (CRW M1.18, intake #38, DEMOBAR-15), 2026-11-25

ux-reviewer, Advisory tier. Branch `claude/project-thread-4p3a4i` built with `--demo` and served
locally; before shots from `origin/main` built the same way. Shots: `docs/product/demo-bar-2026-11-25/`
(PNG, deviceScaleFactor 2). Reviewed against `.claude/design-rules.md`, `docs/design/CRW-RESTYLE.md`,
the studio DEMO-BANNER standard and `docs/product/SPEC-DEMO-BAR.md`.

## Verdict: Needs changes, 7/10 (bar is 8)

- **Crew member on a cheap 360px Android (least tech-savvy):** the bar is quiet and out of the way, but
  on the job picker there are two "← Back" links stacked; the top one leaves the app (UX-R1).
- **Recruiter, phone, 90 seconds:** reads "← Portfolio · Demo · Sample data · Details" in one line at
  390px; Details opens a plain note with Reset and the way back. Passes S3 at 390 and up.
- **Hiring manager, laptop, 5 minutes:** one slim line instead of a 87px yellow-ish banner; the drawer
  is honest about the map tiles. At 1280 "Details" sits far from the rest of the bar (UX-R3).

DEMOBAR-15 (7 or more **and** no P0 or P1) is not met yet: the score is 7, but UX-R1 is a P1. With
UX-R1 fixed this is 8/10, Ready.

**The critic's line** (hiring manager who has seen a hundred AI demos): "Nice, it finally looks like
part of the app. Now why are there two Back buttons and which one loses my work?"

## Rules first (measured)

- `ux-rules.mjs` on names, closed and with `--click .demo-bar-toggle --click [data-bar=reset]`:
  0 rule failures across 3 and 7 views.
- Bar height 48px at 320, 360, 390 and 1280, light and dark; scrollWidth minus innerWidth 0 everywhere.
- Every bar and drawer text is 17px, Atkinson Hyperlegible Next. Targets: back 104x48 (76x48 as
  "Back"), toggle full height 48, No signal 134x48, Reset demo 127x48, Reset 78x48, Keep 73x48,
  "← More of Chase's work" 195x48. All meet W1/G8 (44) and DS-8 (48).
- "Sample data" never clips (scrollWidth equals clientWidth at 360 and 390); hidden at 320.
- Summary contrast (computed colors): light #5C564E on #FFFFFF about 7:1, dark #B2ACA2 on #1C1A17
  about 8:1 (CONTRAST-1 pass). Badge is an ink outline, not the accent (DEMO-R2 pass).
- Focus ring: 2px accent, visible in light and dark (`focus-toggle-390-*-after.png`).
- Drawer left edges (390): copy 12px, No signal knob 20px, link arrow 16px (UX-R2).
- Before: the old banner was 79px at 390, 87px at 1280 and 93px at 320/360, two rows, on a tinted fill.

## Walk (crew member, 360px, light)

1. Opens the demo, sees "← Back | Demo | Sample data | Details" above "Who are you?". Fine.
2. Taps Travis K., lands on Home. Bar is quiet; the Clock in button reads first (V1 pass).
3. Taps Clock in; sees "Which job are you at?" with "‹ Back" under a second "← Back" in the bar.
4. Wants to go back to Home: both say Back. Tapping the top one leaves for chaseholroyd.com.
   **Stops here (UX-R1).**

## Changes

| ID | P | Rule | Where | Problem | Person would | Fix |
|---|---|---|---|---|---|---|
| UX-R1 | P1 | Nielsen 4 consistency, D6 one word one meaning, S3 | Job picker and every screen with the app's own "‹ Back", 320 to 389px (`two-backs-360-light-after.png`) | Below 390px the bar's link reads "← Back", stacked over the app's "‹ Back". Same word, two meanings; the top one leaves the demo for chaseholroyd.com | Tap the top Back to return Home and land on the portfolio, losing their place | Keep "← Portfolio" at every width. Below 390px hide the "Sample data" summary instead (the Demo badge and Details carry it); at 320 the row needs about 267px. Remove `.demo-back-short` |
| UX-R2 | P2 | V4 one grid | Drawer, all widths (`drawer-open-390-light-after.png`) | Three left edges: copy at 12px, No signal knob at 20px, link arrow at 16px | Nothing; it looks slightly loose | `.demo-drawer .demo-switch { padding: 0 8px 0 0 }` and `.demo-link { padding: 0 }` (row stays 48px tall), so all start at 12px |
| UX-R3 | P2 | V4, V3 grouping (opinion) | Bar at 1280 (`drawer-open-1280-light-after.png`) | "Details" sits at the far right, about 1,050px from the summary it explains, while the app is a centered column | Miss Details on a wide screen | Keep the full-width surface, but cap the bar and drawer content at the app column's width (`max-width: 1120px; margin: 0 auto`), so Details ends where the app ends |
| UX-R4 | P2 | C4, C3 (opinion) | Drawer copy, 390 (`drawer-open-390-light-after.png`) | 52 words in 6 lines push the names grid down 290px; the map clause is the longest part | Skim past it | Hand to positioning and privacy-security: "This is the real Crew Clock with a made-up crew. What you change stays in this browser and is never sent anywhere; only map pictures load from map servers. Reset demo puts the sample data back." |
| UX-R5 | P2 | V10 craft | Drawer copy line 1, 360 and 390 | "made-" ends line 1 and "up" starts line 2 | Nothing | Write `made&#8209;up` (non-breaking hyphen) in `demoCopy()` |

## Cut list

- **The "Sample data" summary below 390px: cut** (UX-R1). Buys "← Portfolio" back on every phone; the
  Demo badge already says it.
- **The map clause in the drawer: shorten, don't cut** (UX-R4). Privacy S4 needs it to stay true.
- **The second way back in the drawer ("← More of Chase's work"): keep.** The standard asks for it and
  it is the only full-words exit at 320.
- Nothing else to cut: the bar holds one link and one button, which is the floor for S3.

## Evidence

Before and after pairs (`docs/product/demo-bar-2026-11-25/`): `names-{390,1280,360,320}-{light,dark}`,
`home-{390,1280}-{light,dark}`, `today-{390,1280}-{light,dark}` (the boss lands on Map, the default
tab). After only: `drawer-open-*`, `reset-confirm-*`, `restored-390-*`, `focus-toggle-390-*`,
`step7-home-390-*`, `step7-drawer-390-*`, `private-banner-390-*`, `two-backs-{360,390}-light-after`.
No after shots for the fixes yet: UX-R1..R5 are open. Measured: heights, widths, font size and family,
computed colors, left edges, scroll width. Inferred: the 1,050px gap (from the shot), copy length
effect. Not run: a real phone (keyboard and notch, DEMOBAR-16).

README screenshots replaced at the same names (390x844, light, scale 2): `docs/screenshots/demo-signin.png`,
`demo-home.png`, `demo-today.png` (Today taken at a fixed 1:30 PM so it reads "Today", as its alt says).
All three showed the old banner.

## Acceptance criteria for qa-tdd

- **UX-R1:** at 320x640, 360x740 and 390x844 the first link in `section[aria-label="Demo"]` has visible
  text "← Portfolio", no visible text "Back" in the bar, its scrollWidth equals clientWidth, and
  scrollWidth minus innerWidth is 0; at 360 and 320 `.demo-sum` is not visible; at 390 it reads "Sample data".
- **UX-R2:** with the drawer open at 390 and 1280, the left of `.demo-copy`, `.demo-switch .knob` and the
  text start of `.demo-link` are equal within 1px; each control stays 48px tall.
- **UX-R3:** at 1280 the right edge of `.demo-more` is within 1px of the right edge of the app column.
- **UX-R5:** at 360 and 390 the first line of `.demo-copy` does not end with "made-".

## For Chase

1. UX-R1 needs one call: the standard says "Sample data" shows from 360px, but at 17px it only fits
   beside "← Portfolio" from 390. I recommend hiding the summary below 390 rather than saying "Back".
2. Please check the bar on your own phone once it's deployed (DEMOBAR-16).
3. CLEAN-1 (Medium) is still pending, so the clean-UI rules could not be checked.

Hard rules checked: CONTRAST-1 pass, CONTRAST-2 pass, CONTRAST-3 pass, DARK-1 pass, DARK-4 pass, DARK-5 pass, CLEAN-1 not verifiable (pending, source unread)

```findings
verdict: Needs changes
score: 7/10
UX-R1 | P1 | Nielsen 4 + D6 + S3 | Job picker, 320-389px | Bar link shortens to "← Back" right above the app's own "‹ Back" and leaves the demo | Keep "← Portfolio" at every width; hide the "Sample data" summary below 390px
UX-R2 | P2 | V4 | Drawer, all widths | Copy at 12px, No signal knob at 20px, link arrow at 16px | Switch padding 0 8px 0 0 and link padding 0 so all start at 12px
UX-R3 | P2 | V4 + V3 | Bar, 1280px | Details sits about 1,050px from the summary | Cap bar and drawer content at the app column width, centered
UX-R4 | P2 | C4 + C3 | Drawer copy, 390px | 52 words in 6 lines push the app down 290px | Shorter copy via positioning and privacy-security (draft in the table)
UX-R5 | P2 | V10 | Drawer copy line 1, 360-390px | "made-" breaks across lines | Use a non-breaking hyphen in made-up
```

## Re-review after the fixes (round 2), 2026-11-25

Same branch, rebuilt with `--demo` and served locally. After shots retaken at the same names in
`docs/product/demo-bar-2026-11-25/`: `names-`, `drawer-open-` and `reset-confirm-` at 320, 360, 390,
600 and 1280, light and dark (320 and 360 drawer and reset as full page), plus `two-backs-{320,360,390}-light-after`.
README shots `docs/screenshots/demo-{signin,home,today}.png` retaken the same way (the bar moved a few
pixels at 390: the back link's underline and the badge's spacing).

### Verdict: Ready, 8/10 (bar is 8). DEMOBAR-15 met: 8 with no P0 or P1

- **Crew member, 360px:** the job picker now has one "Back" (the app's) under "← Portfolio | Demo | Details".
  The two words no longer collide (UX-R1 fixed, `two-backs-360-light-after.png`).
- **Recruiter, phone:** "← Portfolio · Demo · Sample data · Details" at 390, and "← Portfolio · Demo · Details"
  at 320 and 360. The way back and "Demo" show at every width (S3 pass).
- **Hiring manager, 1280:** the bar's content now ends where the app column ends; Details sits 24px from
  the summary instead of about 1,050px (UX-R3 fixed).

**The critic's line:** "OK, that's just part of the app now. Why is the line by Portfolio closer to one word than the other?"

### Last round's fixes (measured)

| ID | Status | Evidence |
|---|---|---|
| UX-R1 | Fixed | "← Portfolio" at 320, 360, 390, 600 and 1280 (104x48 below 600, 96x48 from 600, scrollWidth equals clientWidth). `.demo-sum` hidden at 320 and 360, "Sample data" at 390. On the job picker the bar reads "← Portfolio / Demo / Details" and the only Back is the app's |
| UX-R2 | Fixed | Drawer open: copy, No signal knob and link text all start at 12px (320 to 390), 16 at 600, 356 at 1280. Every drawer control is 48px tall |
| UX-R3 | Fixed | At 1280 the bar's inner row spans 344 to 936, which is the app column (`.center-col` 344 to 936); the Details chevron ends at 928 |
| UX-R4 | Fixed | 33 words, down from 52: 4 lines at 390 (was 6), drawer 239px tall; 3 lines at 600 and 1280 |
| UX-R5 | Fixed | "made‑up" uses U+2011; at 360 the line breaks after "made‑up", at 390 it stays on line 1 |

Tighter bar from 600px: the back link's text ends 4px before the divider, but "Demo" starts 8px after
it (the toggle kept its 8px left padding), so the divider reads as stuck to "Portfolio" (UX-R7). The
chevron sits 8px from the right edge of the column, as asked. "Sample data · changes stay in this
browser" fits whole at 600 (319px, scrollWidth equals clientWidth). Bar height 48 everywhere; no
sideways scroll at any width, light or dark. No page errors.

`ux-rules.mjs`: names closed, 0 failures across 3 views; with `--click .demo-bar-toggle --click [data-bar=reset]`,
0 failures across 7 views on two of three runs. On the other run home-laptop counted 0 h1s: the check ran
before the app drew the screen. The shot at the same size has the h1, so this is a timing problem in the check, not a finding.

### Changes (new)

| ID | P | Rule | Where | Problem | Person would | Fix |
|---|---|---|---|---|---|---|
| UX-R6 | P2 | V4 one grid | Bar and drawer, 600px and up (`drawer-open-1280-light-after.png`, `drawer-open-600-dark-after.png`) | Three left edges from 600 up: "← Portfolio" text at 12 (352 at 1280), drawer copy and knob at 16 (356), the app's content at 20 (360). Below 600 the bar and drawer share 12 | Nothing; it looks a little loose | In the `min-width: 600px` block set `.demo-in { padding: 12px 8px; }` so the copy, the knob and the link start where "← Portfolio" does |
| UX-R7 | P2 | V3 spacing, V10 craft | Bar divider, 600px and up (`names-600-light-after.png`) | 4px from "Portfolio" to the divider, 8px from the divider to "Demo" | Nothing | In the same block set `.demo-bar .demo-bar-toggle { padding-left: 4px; }`, so both sides are 4px. That also frees 4px for the summary |

### Cut list

Nothing more to cut. The bar has one link, a badge, a summary that steps aside below 390 and one
button. The drawer has three sentences and three controls. Each one is needed for S3 or PRIVACY S4.

### Acceptance criteria for qa-tdd

- **UX-R6:** at 600 and 1280 with the drawer open, the left of `.demo-copy`, `.demo-switch .knob` and
  the text start of `.demo-back` are equal within 1px.
- **UX-R7:** at 600 and 1280, the gap from the text end of `.demo-back` to `.demo-div` and from
  `.demo-div` to `.demo-badge` are equal within 1px.

### For Chase

1. Nothing blocks. The two P2s take about a minute of CSS each, so they can go in this PR or the next.
2. Please still check the bar on your own phone once it's deployed (DEMOBAR-16).

Hard rules checked: CONTRAST-1 pass, CONTRAST-2 pass, CONTRAST-3 pass, DARK-1 pass, DARK-4 pass, DARK-5 pass, CLEAN-1 not verifiable (pending, source unread)

```findings
verdict: Ready
score: 8/10
UX-R6 | P2 | V4 | Bar and drawer, 600px and up | Bar text at 12, drawer copy at 16, app content at 20 | Drawer .demo-in padding 12px 8px from 600 so copy and knob start under the Portfolio text
UX-R7 | P2 | V3 + V10 | Bar divider, 600px and up | 4px left of the divider, 8px right of it | Toggle padding-left 4px from 600 so both sides are 4px
```

```uxrun
date: 2026-11-25
product: crew-clock
tier: advisory
model: claude-opus-5-5
tokens: 0
cost_usd: 0
flow: demo-bar | phone,laptop | docs/product/demo-bar-2026-11-25
finding: UX-R6 | P2 | V4 | docs/product/demo-bar-2026-11-25/drawer-open-1280-light-after.png | Bar text, drawer copy and app content start at three edges from 600px | Drawer padding 12px 8px from 600
finding: UX-R7 | P2 | V3 | docs/product/demo-bar-2026-11-25/names-600-light-after.png | Divider gap 4px left, 8px right from 600px | Toggle padding-left 4px from 600
verdict: Ready
rechecked: yes
escalated: yes
escalation_reason: tokens and cost are not visible to the agent; the caller stamps them from the transcript
```

```agentrun
date: 2026-11-25
agent: ux-reviewer
product: crew-clock
tier: advisory
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: Round 2 recheck of the studio demo bar (intake 38, SPEC-DEMO-BAR, DEMOBAR-15): UX-R1..R5 re-shot and fixed, 2 new P2s; round 1 was Needs changes 7/10 with UX-R1 P1
tool: agent-guard | ok | kill ux-reviewer not tripped
tool: ux-rules | ok | 0 rule failures across 10 views (one timing-only h1 miss on a rerun, see round 2)
tool: playwright | ok | 33 shots retaken plus 3 README screenshots
tool: agent-guard | ok | cost not shown to the agent, escalated for stamping
verdict: Ready
findings: 2
p0: 0
artifact: docs/reviews/2026-11-25-demo-bar-ux.md
escalated: yes
escalation_reason: tokens and cost are not visible to the agent; the caller stamps them from the transcript
```

# SPEC: Demo hints (CRW, demo build only)

Status: todo. Owner: staff-pm. Scope: the public `--demo` build. The crew app does not change.

## The bet
Chase: "We do not need the demo checks, descriptors, the gps time clock for.. text. ... nudge them
vs literally saying 'try it on the screen' like pulsing dots they use all over the place."
A recruiter shown the real app, with a single pulsing dot on the next thing to tap, gets further
than one handed a pitch to read. The demo should look like the crew app plus the sample-data banner.
**Signal:** a fresh visitor reaches the boss map and the tamper check by following the dots alone
(e2e HINT-6). **Stop:** if the dot path can't be followed without words (UX review on a 390 px phone),
bring back one line of words under the banner. Don't bring the pitch back.

## 1. Inventory (js/app.js unless noted)
| # | Text today | Call | Why |
|---|---|---|---|
| I1 | h1 "A GPS time clock for a small construction crew" (`.pitch-title`) | Remove | This is pitch copy and belongs on the portfolio page and README. Replace it with the crew app's h1 "Who are you?" so the screen keeps an h1 |
| I2 | `.proof` list (3 check items) | Remove | These are marketing claims. The banner and the flow itself show them |
| I3 | `.pitch` section and its side-by-side laptop layout | Remove | Nothing is left to sit beside the names. Delete the dead CSS |
| I4 | h2 "Try it" (`#pick-title`) | Remove | This is the literal "try it" Chase cut. The section takes its label from the h1 |
| I5 | "Start here" chip on Travis K. | Replace: hint | Hint step 1 |
| I6 | "Clock in as a worker" (`.start-sub`) | Remove | Descriptor. Travis becomes a normal name button, first in the grid |
| I7 | "Or pick someone else. Pick the boss to see the team map." (`.pick-note`) | Replace: hint | Hint step 4. The "Boss" and "Foreman" role words on the name buttons stay because they identify people |
| I8 | "Demo: turn on No signal above, then clock in." (`.demo-hint`, home) | Replace: hint | Hint step 7 |
| I9 | "Demo: pretend I'm at the job" checkbox label | Keep the control, drop "Demo: " | It stops the demo from reading the visitor's real location (privacy). It needs a label (principle 3). The banner already says this is the demo |
| I10 | `.verify-hint` "Each punch is signed... Demo: 'Try tampering'..." (boss) | Remove | Explainer text. Hint step 6 points at the button instead |
| I11 | Banner sample-data label | Keep (now the Demo bar's "Sample data" and its Details drawer, SPEC-DEMO-BAR) | Hard rule: demo data stays labeled (SEP-3/4) |
| I12 | Banner controls "No signal" and Reset | Keep (now "No signal" and "Reset demo" in the Demo bar's drawer, SPEC-DEMO-BAR) | They are verbs on real controls, and Reset is the only way to start over |
| I13 | "Try tampering" and "Undo the change" (boss verify card) | Keep | These are verb buttons. They are the feature, not a description of it |
| I14 | "Yesterday (sample day)" heading (boss) | Keep | It labels the data and says which day the visitor is looking at |
| I15 | demo-backend.js, done screen, boss screen otherwise | No change | No other explanatory text found. The sample address answers are data, not copy |

## 2. The hint pattern ("hotspot")
- **What it is:** a 12 px dot in the accent color with a ring that pulses (about 1.6 s, ease-out),
  pinned to the top-right corner of the target. Principle 6: the accent means "tap here", so this
  use is on-brand. Plain CSS and a few lines of JS. No library.
- **Where:** `cfg.backend === 'demo'` only, using the same guard as `demoControls()`. Never in the crew app, and
  never in a crew build that fell back to demo.
- **Order:** each step has a screen, a target and a done-when. On any screen, show the earliest unfinished
  step whose target is on that screen. Show at most one.
  1. Names: Travis K. Done when tapped.
  2. Worker home: Clock in. Done when tapped.
  3. Worker home, once step 2 is done: "Not you?". Done when tapped.
  4. Names, once step 2 is done: the boss (Sam W.). Done when tapped.
  5. Boss: the "Today" tab (the boss opens on Map, and "Try tampering" is on Today). Done when tapped.
  6. Boss Today: "Try tampering". Done when tapped.
  7. Any screen with the demo bar, once steps 1 to 6 are done (SPEC-DEMO-BAR, M1.18): while the drawer
     is closed, the bar's "Demo details" toggle (the dot takes the chevron's place); opening it does not
     finish the step, the dot moves to the "No signal" switch in the drawer. Done when switched on.
- **Memory:** finished steps live in `localStorage` key `crewclock.hints`. The demo's Reset clears it by name (it is outside the `cc.` keys Reset sweeps).
- **Never in the way:** `pointer-events: none`. Placed in the target's own padding corner, clear of its
  text box. The target keeps its size (at least 48 px) and its layout, with no extra wrapper in the tab order.
- **Screen readers:** the dot is `aria-hidden`. The target gets `aria-describedby` pointing to a
  visually hidden "Suggested next step", so assistive tech gets the same nudge.
- **Reduced motion:** under `prefers-reduced-motion: reduce` the ring is static (no animation, no transition).
- **No word label.** The dot carries no text. This is a deliberate exception to principle 3
  ("Words, not puzzles"), limited to demo hints. It's a mild one because every target already has its own words.
  Logged under "Decisions to review" for Chase.

## Hooks (qa-tdd; the tests in tests/hints.test.js and tests/e2e-hints.js select by these)
- **The dot:** one element with class `hint-dot` inside the target, `aria-hidden="true"`, not focusable.
  It is the "hotspot" of section 2.
- **The target:** carries `data-hint="<step>"`, the step number from section 2 (`"1"` Travis K. to `"7"` No signal).
- **The screen-reader nudge:** the target's `aria-describedby` holds the id of a visually hidden element
  whose text is exactly "Suggested next step".
- **Memory:** finished steps live in `localStorage` key `crewclock.hints`. It does not start with `cc.`, so the
  demo's Reset must clear it by name.
- **The ring (UX-R70/R71, QA-R1 and QA-R2 design calls):** the markup is
  `<span class="hint-dot" aria-hidden="true"><span class="hint-ring"></span></span>`. `.hint-dot` is the round outer
  circle whose `border: 2px solid var(--ink)` is the separating stroke (no outline and no box-shadow, so DS-5 and
  DS-9 hold). `.hint-ring`, inside that stroke, is at least 16x16 px with a `--bg` fill, a 2px solid `--accent`
  border and an inner accent dot of at least 6px (`.hint-ring::after`). The pulse stays on `.hint-dot::before`.
  On every step, light and dark, the ink stroke, the accent edge or the `--bg` fill reaches 3:1 against the
  colour behind it. On boxed targets (name button, Clock in) the whole `.hint-dot`, stroke included, sits inside
  the target's border box. Static design rules: corners `50%` or `var(--radius-pill)`; any padding or margin on
  the grid (0, 4, 8, 12, 16, 24, 32 px), so place the ring and the inner dot with `top`/`left`/`inset`.
- **Clear of words (UX-R72/R73):** the dot, its stroke, `.hint-ring` and its pulse ring (wherever it shows at 0.2 opacity or
  more) overlap no visible word on screen, at 390x844 and 1280x800, light and dark.

## 3. Acceptance criteria (QA writes these red first)
- HINT-1 (auto, e2e): Given a fresh demo, when the names screen, worker home (Travis) and boss screen render, then none of these appear: "GPS time clock", "Try it", "Start here", "Clock in as a worker", "Or pick someone else", "Demo: turn on No signal", "Each punch is signed", "Demo: pretend".
- HINT-2 (auto, static): Given js/app.js, then none of the strings in HINT-1 appear in it, and the `.pitch`, `.proof`, `.pick-note`, `.demo-hint` and `.verify-hint` classes are gone from js/ and css/.
- HINT-3 (auto, e2e): Given a fresh demo, when each screen in the path renders, then exactly one `.hint-dot` is visible, on the target for that step (1 Travis, 2 Clock in, 3 Not you?, 4 Sam W., 5 the boss Today tab, 6 Try tampering, 7 No signal).
- HINT-4 (auto, e2e): Given a dot on its target, when the visitor taps the target, then that dot is gone, the next step's dot shows where its target is, and a reload doesn't bring the finished one back.
- HINT-5 (auto, e2e): Given some steps are finished, when the visitor taps Reset and confirms, then `crewclock.hints` is cleared and step 1 shows again.
- HINT-6 (auto, e2e): Given a fresh 390x844 demo, when a script taps only dotted targets (1 Travis, 2 Clock in, 3 Not you?, 4 Sam W., 5 Today, 6 Try tampering, 7 No signal), plus the flow's own Done (and a job choice if asked) and the tamper confirm if one exists, then it ends with "No signal" on, having passed through worker home, the done screen, the boss screen and the tamper result.
- HINT-7 (auto, e2e): Given the supabase crew-app build (the e2e-enhance.js ENH-1d setup), when the names screen, worker home and boss screen render, then there is no `.hint-dot` or `[data-hint]`, no `aria-describedby` pointing at a hint, and `crewclock.hints` is never written.
- HINT-8 (auto, e2e): Given `reducedMotion: 'reduce'`, when a dot shows, then its computed `animation-name` is `none` on it and its pseudo-elements, and the static ring is still visible.
- HINT-9 (auto, e2e): Given a dot on its target, then the dot's box doesn't overlap the target's text box, the target is still at least 48x48 with the same size it had without the hint, and the dot has `pointer-events: none` and `aria-hidden="true"`.
- HINT-10 (auto, e2e): Given a dotted target, then it has `aria-describedby` pointing to a visually hidden "Suggested next step", and axe reports no new violations on any demo screen.
- HINT-11 (auto, e2e): Given the demo names screen, then the h1 is "Who are you?", Travis K. is the first name button, and he is fully inside the first 390x844 and 1280x800 viewport.
- HINT-12 (auto, e2e): Given worker home with consent, then the checkbox reads "Pretend I'm at the job" and is checked by default (M1.6). SEP-5, e2e-demo:318 and AC-R64 still pass.
- HINT-13 (auto, all suites): LIVE-4 (banner at most 90 px), the axe and DS tests (e2e-design, theme.test.js) and SEP-3/4/5 all pass 3x with no edits.
- HINT-14 (manual, ux-reviewer): on a 390 px phone and a laptop, light and dark, the dot reads as "tap here" and never as a status or error.

**Tests these supersede.** These are requirement changes, not weakened tests. qa-tdd rewrites them to the new
criteria in the same PR and names each rewrite in the PR body:
UX-R1 (e2e-polish:65, "Start here" becomes HINT-11), UX-R17 (e2e-polish:84, the pitch is gone),
SHOW-4 (e2e-showcase:268, becomes HINT-3 and HINT-11), UX-R34 (e2e-enhance:442, the "Demo: turn on No signal"
line becomes the step 7 dot; QA-R1, chief of staff's call), and the e2e-polish:825 screenshot note.

## 4. Open questions for Chase (we build the default)
1. **The sign-in heading:** "Who are you?" (the crew app's) or no h1 at all? Default: "Who are you?". It's the
   real app's words, it needs no pitch, and a screen needs an h1 for screen readers.
2. **Rewriting UX-R1, UX-R17 and SHOW-4.** The hard rule bans weakening tests, and these assert the pitch you're
   cutting. Default: rewrite them to HINT-3 and HINT-11 in the same PR, each named in the PR body for your review.

## Not doing
- Coach marks, tooltips, tours or a "skip tour" button. That's more words, which is the opposite of the ask.
- Hints in the crew app for new crew. Not now: the crew app's audience is the real crew, who are shown in person.
- Analytics on hint completion. The $0, no-tracking rule rules it out.

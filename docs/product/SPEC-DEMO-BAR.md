# SPEC: Studio demo bar (CRW M1.18, intake #38, demo build only)

Status: todo. Standard: pm-tools `docs/DEMO-BANNER.md`; where it clashes with `docs/design/CRW-RESTYLE.md`, the
product rule wins (the standard leaves the look to the product). **Signal:** HINT-6 still walks the whole path
through the bar, and ux-reviewer scores 7/10 or more. **Stop:** if "Sample data" can't fit at 390 px in 17 px
type, stop and ask Chase; never truncate it.

## Design answers
- **Bar** (collapsed on load, in flow, not sticky): `<section class="demo-bar" aria-label="Demo">` with `← Portfolio`,
  a divider, then one toggle `aria-label="Demo details"` holding the badge, the summary and `Details` + chevron.
  48 px total, divider drawn inside it (DS-8 wants 48 px targets); safe-area top inset added above.
- **Product overrides:** 17 px text and badge (DS-3); badge "Demo", title case, weight 600, no uppercase (DS-2);
  focus ring 2 px `--accent` (DS-9); DS-4 spacing (12 px gutters allowed). Badge: 1 px `--ink` outline pill, never
  `--accent`. Tokens: `--demo-bg/fg/muted/line` read `--surface/--ink/--muted/--line`; body font.
- **Back link:** reads `← Portfolio` at every width, never `← Back` (the app's own `‹ Back` sits right under it; UX-R1).
- **Summary:** hidden below 390 px; `Sample data` from 390 to 599 px; `Sample data · changes stay in this browser`
  from 600 px, never cut off (UX-R1, QA-R1).
- **Column:** from 592 px the bar's and the drawer's content keep to the app column (centred, 560 px plus gutters),
  so Details sits near the summary; the backgrounds still run edge to edge (UX-R3).
- **Drawer copy** (true per PRIVACY S4: no off-site requests except map tiles; UX-R4, UX-R5, PS-R1): "This is the
  real Crew Clock with a made‑up crew. Changes stay in this browser, never sent anywhere. Map pictures come from map
  servers, which see the area. Reset demo starts over." ("made‑up" with a non-breaking hyphen, U+2011; the long form
  "which see the area shown" ran to 5 lines at 390 px, so the decided short form ships, 4 lines.) 17 px,
  line-height 1.5. The copy's first letter, the No signal knob and the link's arrow share one left edge (UX-R2).
- **Actions, in order:** (1) the **No signal** switch, moved from the banner (same `data-action="demo-offline"`,
  `role="switch"`, only when `demoControls()`); (2) **Reset demo**, outline in `--line`; (3) `← More of Chase's work`.
  Both back links go to `https://chaseholroyd.com/` (SEP-4's target; the demo lives at /crew-clock/, so that loops).
- **Reset:** inline, no `confirm()`. Reset demo hides and shows "Put the sample data back? Your changes will be
  lost." [Reset] [Keep], focus on Keep; Keep restores it and its focus. Reset runs today's clear (cc. keys,
  `crewclock.hints`, 3 IndexedDBs, DemoBackend.reset, Messenger.stop), sets sessionStorage `crewclock.restored`,
  reloads; on load the flag is removed, the drawer opens once and its copy starts "Sample data restored."
- **Hint step 7:** drawer closed, the dot sits on the toggle (`data-hint="7"`); opening it doesn't finish step 7,
  the dot moves to the switch; switching on finishes it.
- **Redraws:** open state, the confirm row and focus survive an `#app` redraw (state, or mount the bar once
  outside it). Esc closes and refocuses the toggle.
- **Private banner:** same words and role, directly under the bar. **Crew app:** no bar, switch or flag.
- **Removed:** `.demo-banner`, `.demo-label`, `.demo-actions`, the banner's `.wide-only`, "Sample data, made-up
  crew", "Reset sample data", "Back to chaseholroyd.com", and their CSS.

**Superseded tests** (requirement changes, rewritten in the same PR, named in the PR body): SEP-3, SEP-4 selector,
e2e-demo:259 and :315-320, RST-1, CHAT-SEED-5, LIVE-4 (90 to 48 px), e2e-enhance:174-209 and :462 (open Details
first), HINT-3/5/6, e2e-polish:725 and :828, e2e-showcase:164-166 and :291, e2e-design:263's `.demo-banner` skip.

**Screenshots (ux-reviewer, before and after, `tests/shots/demo-bar/`):** names, worker Home, boss Today at
390x844 and 1280x800, light and dark; at 390 light and dark: drawer open, Reset confirm, "Sample data restored.",
private banner, step 7 dot on Details; names at 320x640.

**Done, three states in HANDOFF.md.** Merged: suites green 3x; README step 2 ("open Details, turn on No signal")
and line 48, PRIVACY S4 evidence, SPEC-DEMO-HINTS I11/I12 and step 7, README screenshots updated. Deployed: the
pages.yml run. Checked: the live demo on a real phone and a laptop. HANDOFF says "merged", not "live", until
checked. Rollback: revert the merge; Pages redeploys the old banner; no data migration.

lint-ok: SL-1 no dates or periods here; the restored flag is read once per load.

```spec
verdict: ready
bet: A recruiter on a 390 px phone reads a slim Demo bar and still finds No signal and Reset; proved when HINT-6 passes through the bar and ux-reviewer scores it 7 or more
step: M1.18.1 | qa-tdd red tests for DEMOBAR-1..14 and 17 plus the superseded rewrites | all new cases red for the right reason | 1 session
step: M1.18.2 | engineer builds the bar, drawer, inline Reset, switch move and hint step 7 | DEMOBAR-1..14 and 17 green | 1 session
step: M1.18.3 | remove the old banner, update README, PRIVACY S4, SPEC-DEMO-HINTS, screenshots | DEMOBAR-13 green and docs match | 0.5 session
step: M1.18.4 | qa-tdd all suites 3x, ux-reviewer screenshots, privacy-security on copy | no P0 or P1 open | 1 session
step: M1.18.5 | merge, Pages deploy, live check on a phone | HANDOFF records merged, deployed and checked | 0.5 session
criterion: DEMOBAR-1 | auto | Given a fresh demo at 390x844, 1280x800 and 320x640 on names (signed-out visitor), worker Home (Travis K.) and boss Today (another user, Sam W.), then section[aria-label="Demo"] exists once, its height is at most 48, the toggle aria-expanded is "false", and scrollWidth minus innerWidth is 0
criterion: DEMOBAR-2 | auto | Given the bar at 320, 360, 389, 390, 599, 600 and 1280, then the first link reads exactly "← Portfolio" (never "← Back") with href "https://chaseholroyd.com/", its scrollWidth equals clientWidth and the page has no sideways scroll; the toggle (name "Demo details") contains "Demo" and "Details"; the summary is not visible below 390, reads "Sample data" from 390 to 599 and "Sample data · changes stay in this browser" from 600, never cut off (scrollWidth equal to clientWidth); at 1280 the bar's content and the drawer's content sit inside the app column (the screen's centred column), with Details ending within 48 px of its right edge (UX-R1, UX-R3)
criterion: DEMOBAR-3 | auto | Given the bar, when the toggle is clicked, then aria-expanded is "true", the panel named by aria-controls is visible, its copy reads exactly "This is the real Crew Clock with a made‑up crew. Changes stay in this browser, never sent anywhere. Map pictures come from map servers, which see the area shown. Reset demo starts over." (made‑up with a non-breaking hyphen U+2011; "which see the area" in place of "which see the area shown" only if the long form runs to 5 lines), at 390 the copy is at most 4 lines, the left edges of the copy text, the No signal switch knob and the drawer link's arrow (when the link starts its own row) are within 1 px of each other at 390 and 1280, and the app's first screen element moved down by the panel height (UX-R2, UX-R4, UX-R5, PS-R1)
criterion: DEMOBAR-4 | auto | Given the open drawer, when Esc is pressed, then aria-expanded is "false", the panel is hidden and document.activeElement is the toggle
criterion: DEMOBAR-5 | auto | Given the open drawer, then its controls in DOM order are the "No signal" switch, the "Reset demo" button, then a link to "https://chaseholroyd.com/"; every one is at least 48 px tall
criterion: DEMOBAR-6 | auto | Given visitor punches saved, when Reset demo then Keep is clicked, then no dialog event fires, Reset demo is visible and focused, and the outbox count is unchanged at 1
criterion: DEMOBAR-7 | auto | Given visitor punches saved and crewclock.hints set, when Reset demo then Reset is clicked, then no dialog event fires, after reload the drawer is open, its text starts "Sample data restored.", cc. keys and crewclock.hints are gone; after a second reload aria-expanded is "false"
criterion: DEMOBAR-17 | auto | Given empty storage, or sessionStorage and localStorage that throw on every call (private mode), when Reset demo then Reset is clicked, then the page reloads with 0 page errors and the bar shows with aria-expanded "false"
criterion: DEMOBAR-8 | auto | Given the drawer open with No signal on, when a sync redraws the screen, then aria-expanded stays "true" and the switch aria-checked stays "true"
criterion: DEMOBAR-9 | auto | Given hint steps 1 to 6 done and the drawer closed, then the one .hint-dot is inside the toggle with data-hint "7"; when the toggle is clicked, then crewclock.hints still lacks 7 and the dot is on the No signal switch; when the switch is clicked, then crewclock.hints contains 7 and no dot shows
criterion: DEMOBAR-10 | auto | Given light and dark themes, then the bar font-family starts "Atkinson Hyperlegible Next", font-size is 17px, background equals --surface, and the badge border and text colour are not the --accent value; focus on the toggle shows a 2px outline in --accent
criterion: DEMOBAR-11 | auto | Given Store.isVolatile() true in the demo, then the bar is node 1 and .private-banner node 2 in DOM order, both visible, overlap area 0
criterion: DEMOBAR-12 | auto | Given the supabase crew-app build, then there is no section[aria-label="Demo"], no "No signal" switch and sessionStorage crewclock.restored is never written
criterion: DEMOBAR-13 | auto | Given js/ and css/, then "demo-banner", "demo-label", "Sample data, made-up crew", "Reset sample data" and a confirm( call in demo-reset are absent
criterion: DEMOBAR-14 | auto | Given reducedMotion "reduce", when the toggle opens, then the chevron transition-duration is "0s"; axe reports no new violations with the drawer open and closed
criterion: DEMOBAR-15 | manual | ux-reviewer at 390 and 1280, light and dark, before and after shots -> score 7 or more, no P0 or P1
criterion: DEMOBAR-16 | manual | After deploy, follow the README walkthrough on the released live demo on a real phone -> every README claim about the bar, No signal and Reset matches, bar 1 line, back link lands on the portfolio
cut: Code on GitHub drawer link | optional in the standard; README already links the repo
cut: No signal state in the collapsed bar | Home already shows "waiting to send"; revisit if ux-reviewer flags it
cut: Sticky bar | the standard says in flow, not sticky
risk: "Sample data" does not fit at 390 in 17 px type and gets truncated | DEMOBAR-2
risk: The redraw of the app closes the drawer or drops focus mid-use | DEMOBAR-8
risk: Hiding No signal in the drawer breaks the hint path | DEMOBAR-9
decision: Back link target is the site root, not /crew-clock/ where the demo itself lives | keep the root until a case-study path exists
decision: The back link reads "← Portfolio" at every width; the summary is hidden below 390 instead (UX-R1, 2026-11-25) | reversible in css/app.css
handoff: qa-tdd | red tests DEMOBAR-1..14 and 17 and the superseded rewrites | each red for the right reason
handoff: engineer | build M1.18.2 and M1.18.3 | DEMOBAR-1..14 and 17 green 3x
handoff: ux-reviewer | screenshot list in this spec | DEMOBAR-15 met
handoff: privacy-security | drawer copy against PRIVACY S4 and the crew-app split | no finding at P1 or above
handoff: positioning | back-link label and drawer copy | wording approved or changed
```

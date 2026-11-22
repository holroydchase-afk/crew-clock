# Crew Clock restyle to the studio design system (DS-1)

Chase, 2026-11-21: follow the studio design system from holroydchase-afk/hearth `docs/design/`
(copied here as [STUDIO-CORE.md](STUDIO-CORE.md) and [tokens.json](tokens.json); Hearth's
`themes.css` was not on its main branch, so the CSS variables are derived here from tokens.json
with the section 3 recipe). Use Atkinson Hyperlegible Next, copy type/space/radius values as-is,
use the **Paper** theme (light, dark, high contrast), run the section 7 checklist. Changing any
section 2 principle needs Chase first.

## Acceptance criteria (each has a test)

- **DS-1 Font.** Atkinson Hyperlegible Next 400/500/600 is bundled (`vendor/fonts/atkinson-hyperlegible-next/`,
  woff2 + OFL), declared with `@font-face` (`font-display: swap`), listed in `sw.js` SHELL_FILES so it
  works offline, and `body` uses `"Atkinson Hyperlegible Next", system-ui, sans-serif`. No other
  font file or font host (no Google Fonts at runtime).
- **DS-2 Weights.** Only 400, 500, 600 in `css/app.css` (no `bold`, 700, 800). No `text-transform:
  uppercase`, no `font-style: italic`. Visible all-caps words in the UI ("CLOCK IN", "OFF") become
  sentence or title case ("Clock in", "off"); tests that look for the old words follow the new words.
- **DS-3 Type ramp.** Every `font-size` in `css/app.css` is one of 17, 22, 28, 34 px (or a `var()` of
  the ramp tokens `--type-base 17`, `--type-title 22`, `--type-display 28`, `--type-large 34`, or `inherit`/`1em`).
  Nothing under 17 px renders anywhere on the demo screens (e2e check of computed font sizes at 390
  and 1280, light). Body line-height 22 px. Sizes are px so the browser's text size setting still scales them.
- **DS-4 Space and corners.** Every padding, margin, gap value in px in `css/app.css` is one of 0, 4, 8,
  12, 16, 24, 32 (negatives of those allowed for optical alignment; `env()`/`calc()` built from those
  allowed). `border-radius` is 4, 12, 999 (pill) or 50% (round avatar/dot), via `--radius-small`,
  `--radius-medium`, `--radius-pill`. Exception: Leaflet's own controls and the map dots' size.
- **DS-5 Depth.** No `box-shadow` except focus rings and the map's markers/legend (they sit on a photo map: principle 5, solid backing).
- **DS-6 Paper theme.** `:root` holds Paper light's 7 base + derived tokens with studio names
  (`--bg --surface --ink --muted --line --fill --accent --accent-ink --accent-soft --safe --safe-soft
  --danger --on-danger --danger-text --tab-line --scrim`), values equal to tokens.json `themes.paper.light`;
  `@media (prefers-color-scheme: dark)` the same for `themes.paper.dark`; `@media (prefers-contrast: more)`
  (light and dark) the high contrast set: `muted` 7:1 on bg and fill, `line` 4.5:1 on bg, `accent` mixed
  at least 30% toward `ink` until `accent-ink` on it is 7:1. Product status extras (`--danger-soft`,
  `--warn`, `--warn-soft` for "Near"/"waiting to send"/the demo banner) are derived the same way as
  safeSoft (93% page light, 82% dark). The old blue/gray palette names are gone.
- **DS-7 Contrast test (section 7 step 3).** `tests/theme.test.js` checks in light, dark and both high
  contrast sets: ink 7:1 on bg; muted 4.5:1 on bg and fill (7:1 in high contrast); accent 4.5:1 on bg, fill,
  accent-soft; accent-ink on accent 4.5:1 (7:1 hc); safe and danger-text 4.5:1 on bg; tab-line 3:1 on bg
  and surface; warn 4.5:1 on warn-soft; danger-text 4.5:1 on danger-soft; white on the punch buttons 4.5:1.
- **DS-8 Targets.** Every button, link and input on the demo screens is at least 48x48 CSS px (e2e at 390,
  light), except inline links inside a sentence and Leaflet's attribution.
- **DS-9 Focus.** Focus rings are a 2 px `--accent` outline (`outline: 2px solid var(--accent)`), no layout shift.
- **DS-10 One accent.** Tap things use `--accent`; nothing decorative is accent (brand mark, avatars, job icons
  use ink/fill). Green/red stay status only, except the punch buttons: Chase chose 2026-11-21 to keep
  CLOCK IN green and CLOCK OUT red (shared studio safe #1C6E31 / danger #B3261E fills, white words, both modes),
  a Crew Clock exception to principle 6. A second exception (Chase, 2026-11-21, UX-R61): text links
  ("Not you?", "Stop using my location", "Wrong job? Fix it", "Sign out", "Back") are `--ink` and
  underlined, not accent, so rust/red only means Clock out; `.link.danger` stays `--danger-text`.
  Buttons, the tab bar's picked state and focus rings stay `--accent`.
- **DS-11 No grey boxes / no card in card.** Lists sit on the page; cards are `--surface` with a 1 px
  `--line` edge, tap rows get a `--tab-line` edge (3:1) so a target never relies on `--line` alone.
- Existing suites stay green: axe (e2e-showcase) at 390/1280 light/dark, LIVE-4 banner ≤ 90 px, week table fits at 360.
  If a rule here and an old test truly conflict, say which and why; never weaken a test to get green.

## Not in this change (logged in HANDOFF "Decisions to review")
- Principle 10's in-app light/dark picker and the optional "Bigger text" setting: follow-up.

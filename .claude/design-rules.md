# Studio design rules

The studio's opinion on screens, written down so a reviewer checks against rules instead of judging pixels by eye. Three layers, read in order, and stop as soon as you have what you need:

1. **General rules (G1-G14) and visual craft (V1-V12)** apply to every screen. They live in `plugins/studio/agents/ux-reviewer.md` so the reviewer always has them loaded. `tools/ux-rules.mjs` checks the ones marked *code*.
2. **Screen types** (below): what a list, form, dialog, result or landing page must have. Read only the types on the screen you're reviewing.
3. **Exceptions** (below): where the studio deliberately breaks a rule, and why.

Each product can add its own screen types and exceptions in its own `docs/design-rules.md`; the product file wins where they differ. `scripts/sync.sh` copies this file into each product as `.claude/design-rules.md`, so don't edit the copy.

Seeded on 2026-10-28 from what already works in Build Slate and chaseholroyd.com (both pass every code-checked rule) and from the patterns behind Energy Scanner's review findings ES-R1 to ES-R68.

## Layer 2: screen types

### List or board (Build Slate, Roadmap, Role Radar)
- L1. One primary "+ New ..." button in the header; filters are chips, never a second primary.
- L2. Empty list: a dashed empty-state box that names the next step and the button ("No projects yet. Use **+ New project** to put the first one on the slate."). A filtered list that's empty says which filter ("Nothing in Building right now.").
- L3. Loading is a sentence ("Loading your slate…"), not a blank grid.
- L4. Each card shows its status in words, not color alone.

### Form or edit dialog (Build Slate)
- F1. A visible label above every field; placeholders only show an example.
- F2. Buttons bottom right: Cancel (ghost) then Save (primary). Save says what it does if "Save" is ambiguous.
- F3. Delete sits on the left as an outline danger button. Pressing it swaps in an inline confirm that names the thing ("Delete this project?") with Delete and Keep. Never a browser `confirm()`.
- F4. Errors appear next to the field, say what happened and what to do, and keep what the person typed.

### Dialog
- D1. Native `<dialog>` with `showModal()`, so Escape and focus trapping work for free.
- D2. A title, one primary action, and a way out (Cancel, Close or Keep). A dialog that can't be dismissed is a P0.
- D3. Focus goes to the first field on open and back to the button that opened it on close.

### Result or reading (Energy Scanner, ccwatts playground)
- R1. After an action, scroll the result into view (`block: "nearest"`), and only when it's off screen (ES-R17, ES-R54, ES-R62).
- R2. The loudest line on the card is the answer, not a nag or a to-do (ES-R50).
- R3. One action row with one primary; secondary actions are ghost buttons with distinct words ("Scan this photo again", not "Scan again" next to "New photo") (ES-R52, ES-R53).
- R4. Don't repeat the card title in the status line (ES-R60).

### Start screen or landing (portfolio, demos)
- S1. In 3 seconds: what it is, who it's for, and one proof point, above the fold (ES-R48).
- S2. Copy matches the device: "Click and hold" on a mouse, "Press and hold" on touch; hide a "Take a photo" button where there's no camera (ES-R49, ES-R63, ES-R64).
- S3. A demo has a visible way back to the portfolio, plus one line on what it is and who it's for, near the top and not only in the footer. Missing either is a P0 (ES-R55).
- S4. The page, README, link preview and screenshots tell the same story with the same numbers (ES-R65, ES-R66).

### Long-form page (portfolio case studies, resume)
- P1. A 72-character reading column, 17px body text at line height 1.6.
- P2. A sticky slim header, a skip link, and a visible focus outline.
- P3. Colors are tokens on `:root`, redefined for dark mode, so both themes look intended.

### CLI output (ccwatts)
- C1. The answer first on one line, then the detail; every number with its range and unit.
- C2. Errors say what happened and the exact command to fix it.
- C3. No color-only meaning; works with `NO_COLOR`.

### Audience: older adults (Hearth's grandparents)
In NN/g's tests, people over 65 finished 55% of web tasks against 74% for people 21 to 55, and took about 43% longer. Hearth's grandparents also grew up in the 60s to 80s and tease what looks cheap, so these screens must be obvious and still impressive.
- A1. Body text 18px or more, and the layout still works at the largest system text size.
- A2. Every icon has a word with it; no gesture (swipe, long press, pinch) is the only way to do something.
- A3. One task per screen, few choices, targets 48px or more with room between them.
- A4. Their words, not ours: "album", "send to the family", "print", never "feed", "sync" or "upload".
- A5. Forgiving: undo instead of "Are you sure?", nothing lost on a slip, and the way back always in view.
- A6. Impressive, not clunky: the photos are the hero (big, edge to edge), one typeface with character, calm color. Large and simple is the style, never a beige "accessibility mode".
- A7. Calm, not watched: no read receipts, "x of y" or any count of who hasn't acted (G14). Show only positive signals, or nothing.

## Persona: the harshest critic
Every product names one in its personas doc, so the reviewer knows whose teasing to pre-empt. Card: who they are, what they grew up with, what they'd say about a cheap-looking screen (one line in their voice), and what would make them show it off. Hearth: the grandparents. Portfolio: a hiring manager who has seen a hundred AI-built demos.

## Layer 3: exceptions

| Rule | Exception | Why |
|---|---|---|
| G7 (text size) | Small caps eyebrow labels and chart counts at 11-11.5px (portfolio, Build Slate) | A deliberate label style, uppercase with letter spacing, never body text. The code floor is 11px for this reason. |
| G8 (tap targets, via ux-shots) | Links inside a sentence | WCAG 2.5.8 exempts inline links. |
| G1 (one primary) | Two equal choices on a start screen (Energy Scanner's Photo and Palm modes) | They're a mode switch: style them as tabs, not as two primary buttons. |

## Adding a rule
When Chase approves a design or a review round fixes the same kind of problem twice, write the pattern down: a new screen-type line here (or in the product's own file), with the finding IDs it came from. When a rule is wrong for a screen, add an exception row with the reason instead of ignoring the check. Keep each layer short; if a type grows past six lines, split it.

# Studio design core

The product-neutral part of Hearth's design system, written so Chase's other products can copy it and look like one family. Hearth's own layer (its themes, Easy view, the postcard) lives in [`docs/product/DESIGN-SYSTEM.md`](../product/DESIGN-SYSTEM.md). Numbers here are taken from the code (`app/src/ui/theme.ts`, exported as [`tokens.json`](tokens.json)), not invented.

**Proposed home:** the studio's shared tools repo, once Product Studio accepts it. Until then this copy is the source.

## 1. What we build on (don't invent)

| Layer | Use | Why |
|---|---|---|
| Behavior and controls | **Each phone's own design guidelines**: the iPhone Human Interface Guidelines on iPhone and the web, Material 3 on Android. Use the system control before making one. | People already know them; nothing to teach. |
| Token names | **Material 3's color roles** (primary, on-primary, surface, outline…) as the shared vocabulary (table in section 3). | The most complete open spec for color roles, type and shape; almost every component library can map onto it. |
| Components | **No component library.** Native controls on phones; on a web-only product a library is fine as long as it reads the same tokens. | A library adds weight and fights the native look. |
| Our overrides | Section 2. They win wherever they are stricter. | The guidelines are written for everyone; our users include people who struggle with phones. |

A custom control needs a written reason in its PR.

## 2. Principles (the studio overrides)

1. **Readable first.** Body text 17 pt, nothing smaller anywhere (captions and tab words included). Text grows with the phone's text size; never turn that off.
2. **Big enough to hit.** Every tap target is at least 48 × 48 pt, with space between targets.
3. **Words, not puzzles.** Buttons are verbs. An icon gets a word beside or under it unless the product has a deliberate "icons only" mode with spoken names.
4. **No hidden gestures.** Every swipe, long-press or pinch also has a button.
5. **Text on solid ground.** No text over glass, blur or a photo without a solid backing.
6. **One accent means "tap here".** Never use it for decoration. Green and red are for status only.
7. **No grey boxes.** Content sits on the plain page. Grey is for dividers and settings-style lists only. No card inside a card.
8. **Few big buttons.** Filled buttons only for deliberate moments (sign in, post, delete). Everything else is a row, a text button or a small tinted capsule, still 48 pt to tap.
9. **Never empty, never silent.** Errors and loading say what happened and what to do; a spinner always has a line of words.
10. **Follow the phone's accessibility settings**: larger text, increased contrast, reduced motion, light or dark. Also let people pick light or dark in the app.
11. **People choose, the app doesn't guess.** Offer one clear default and let people change it; don't automate a choice away.

## 3. Color: how to make a theme

A theme is **7 base colors per mode** (light and dark). Everything else is derived, so every product's themes behave the same.

| Studio token | Material 3 role | Use it for | Rule |
|---|---|---|---|
| `bg` | background / surface | The page | |
| `surface` | surface-container-low | Sheets, the tab bar | A hair off the page, or white on a light page |
| `ink` | on-surface | Everything you read | 7:1 on `bg` |
| `muted` | on-surface-variant | Dates, hints, secondary words | 4.5:1 on `bg` and `fill` |
| `line` | outline-variant | Dividers only | Never the only edge of a tap target |
| `fill` | surface-container | Fields, grey capsules, empty photo tiles | A shade off the page |
| `accent` | primary | The one tap color | 4.5:1 on `bg`, `fill` and `accentSoft` |

Derived (code does these, don't pick by hand):

| Studio token | Material 3 role | How |
|---|---|---|
| `accentInk` | on-primary | White in light mode, black in dark |
| `accentSoft` | primary-container | `accent` mixed into the page (93% page light, 82% dark) |
| `safe`, `safeSoft` | (custom success) | Shared green `#1C6E31` / `#7DD394`; soft = mixed into the page |
| `danger`, `onDanger`, `dangerText` | error, on-error | Shared red `#B3261E` (light), `#F2B8B5` fill and `#FF453A` words (dark) |
| `tabLine` | outline | `line` nudged toward `ink` until 3:1 against page and surface |
| `scrim` | scrim | Black 40% light, 60% dark |
| High contrast set | (contrast variants) | When the phone asks: `muted` to 7:1, `line` to 4.5:1, `accent` mixed 30% or more toward `ink` until `accentInk` on it is 7:1 (so it gets lighter in dark mode) |

Also tested: `accentInk` on `accent` 4.5:1, and `safe` and `danger` on `bg` 4.5:1.

Contrast is WCAG 2 and is tested, not eyeballed: a new theme ships with a test that checks every pair above in light, dark and high contrast. The template is Hearth's `app/src/ui/__tests__/themes.test.ts`.

## 4. Type

- **Font: Atkinson Hyperlegible Next** (Chase, Nov 21, DEC-78): a free, open font built for low-vision readers, bundled inside each product so every phone and the web show the same letters. One file per weight; on the web, load it with a real fallback stack (`"Atkinson Hyperlegible Next", system-ui, sans-serif`). Text must still grow with the phone's text-size setting.
- **Weights:** Regular (400) for reading, Medium (500) for a person's name, Semibold (600) for titles, buttons and the picked tab. No Bold, Light, italics or all caps.

Sizes in pt; on the web 1 pt = 1 CSS px. "Bigger text" is an optional in-app setting that steps the whole ramp up, on top of the phone's own text size.

| Style | Default size / line | Bigger text size / line |
|---|---|---|
| Body (`base`) | 17 / 22 | 21 / 27 |
| Title | 22 / 28 | 27 / 34 |
| Display | 28 / 34 | 35 / 42 |
| Large title (top of a main tab) | 34 | 34 |

Labels in tab bars and toolbars grow with the phone up to 1.5×, then stop; body text has no cap.

## 5. Space, corners, depth

- **Spacing** on a 4 pt grid: `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32`. Related things sit closer (sm) than unrelated ones (lg, xl). No other numbers.
- **Corners:** `small 4` (checkbox), `medium 12` (rows, cards, fields), `pill` (capsules, chips, avatars); optional for image-led products, `photo 16` (image tiles). Dialogs keep the phone's own corner (14 pt iPhone, 28 dp Android).
- **Depth:** no shadows, except (optional, image-led products) one soft shadow under image tiles in light mode only: `0 2 12` at 10% of the theme's `ink`. Dark mode has none.
- **Focus (web and keyboards):** a 2 px `accent` edge that follows the corner and is clear at rest, so focusing never shifts the layout.

## 6. Components

| Component | Rule |
|---|---|
| Tab bar | 2 to 5 tabs at the bottom. Either icon over word always shown, or the phone's own bar with icons only and every tab spoken by name. The picked tab is the accent. |
| Toolbar | At most two actions top right (for example Search). No row of buttons above the title. |
| Buttons | `primary` filled accent (deliberate moments only), `tinted` accent word on `accentSoft` capsule (a screen's main action), `secondary` ink on `fill`, `quiet` accent text link, `danger` filled red (cannot-undo only). All 48 pt. |
| Rows and lists | The settings-style grouped list for menus and settings; a row is the whole tap target. |
| Picked state | Never color alone: an accent mark (a check or a 2 pt accent outline) and the screen reader says "picked" or "selected". Avoid a filled background behind images or emoji. |
| Switches | The phone's own switch, with On or Off written beside it. |
| Sheets and dialogs | The phone's own sheet with a grabber and a Close button; destructive confirms name the action ("Delete post"), never "OK". |
| People | Show names, not initials, wherever there's room; a round photo once there is one. |
| Loading and errors | Words first (principle 9). |

## 7. Checklist for a new product

1. Copy `tokens.json`'s type, space, radius and target values as-is.
2. Make one theme: 7 base colors × light and dark, then derive the rest (section 3).
3. Add the contrast test before any screen.
4. Use the phone's own controls; write down any custom one.
5. Run the product's UI reviewer against section 2 before anything goes public.

Last checked against the code: Nov 21, 2026.

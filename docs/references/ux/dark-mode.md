# Dark mode (topic: dark)

## DARK-1 Follow the system appearance
- strength: hard
- status: fetched
- source: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- tags: dark, appearance, prefers-color-scheme, toggle
Apple's guidance: people set Dark Mode once for the whole device and expect apps to respect it, including Auto switching mid-session. An app-specific appearance setting means two settings to fight with, and can make the app look broken. On the web that means honoring `prefers-color-scheme`; a manual toggle may add to it, never replace it. Both modes must look intended.

## DARK-2 Dark palettes are designed, not inverted
- strength: guide
- status: fetched
- source: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- tags: dark, palette, inversion, semantic colors
Dark palettes use dimmer backgrounds and brighter foregrounds, but many colors are not simple inversions of their light twins. Use named, adaptive color tokens instead of hard-coded values, and check each screen state (empty, error, selected) in both modes.

## DARK-3 Soften white images and fix lost illustration detail
- strength: guide
- status: fetched
- source: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- tags: dark, images, illustration, glow
A picture with a white background glows against a dark surface: dim it slightly or provide a dark variant. Icons and illustrations that lose edges on dark need a subtle outline or a separate dark asset.

## DARK-4 Dark grey surface, off-white text, never pure black or pure white
- strength: hard
- status: search-summary
- source: https://m2.material.io/design/color/dark-theme
- tags: dark, surface, background, pure black, contrast, 121212
Material's dark theme recommends a dark grey base surface (about #121212) rather than pure black, and white body text on it reaching at least 15.8:1. Pure black with pure white text causes glare and halation and removes room to show elevation. Use a dark grey surface and off-white text (about 87% white). Status: the pure-black and 15.8:1 claims come from a search summary of the older Material 2 spec; the Material 3 source is silent on pure black (see DARK-5 for its tones).

## DARK-5 Show elevation with lighter surfaces, not shadows
- strength: hard
- status: fetched
- source: https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md
- tags: dark, elevation, shadow, surface, card, tone
Material 3 builds dark layers from a stack of surface roles (lowest, low, default, high, highest), each lighter than the last, instead of shadows or the old tinted overlay. Baseline tones on a 0 to 100 scale: page 6, containers 4, 10, 12, 17 and 22. Shadows are nearly invisible on dark, so a card or dialog at the page's shade, or with only a shadow, is P1. Read from the Material Components Android docs on GitHub; the m3.material.io pages were empty shells (see docs/design-references/sources/material3-dark-theme.md).

## DARK-6 Desaturate accent colors on dark
- strength: guide
- status: search-summary
- source: https://m2.material.io/design/color/dark-theme
- tags: dark, accent, saturation, vibration
Fully saturated accents vibrate against dark grey and fail contrast. Use a lighter, less saturated tone of the brand color for dark mode, keeping its character, and re-check its contrast.

## DARK-7 Test with Increase Contrast on
- strength: guide
- status: fetched
- source: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- tags: dark, prefers-contrast, increase contrast, accessibility
Apple warns that with Increase Contrast and Reduce Transparency on, dark text can end up less legible on dark backgrounds. Test the dark screens with those settings (`prefers-contrast: more` on the web) separately and together.

## DARK-8 Offer both modes; dark is not automatically better
- strength: guide
- status: fetched
- source: https://www.nngroup.com/articles/dark-mode/
- tags: dark, light, readability, vision, long reading
NN/g's literature review: for people with normal vision, light mode tends to give better reading performance, while some people with cataracts and similar conditions read better in dark. Long reading in light mode is linked with myopia. So give people the choice, do not force dark, and keep long-text screens comfortable in both.

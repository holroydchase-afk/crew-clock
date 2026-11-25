# Third-party notices

Crew Clock is MIT ([LICENSE](LICENSE)). It ships the open-source components below. Each
copyright line is quoted from that component's own license file.

## ts-mls 1.6.4

License: MIT

Copyright (c) 2025 Luka Jacobowitz

Shipped in: `js/vendor/crew-mls.js` (bundled by esbuild from `messenger/`)

## @noble/curves 2.0.1

License: MIT

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Shipped in: `js/vendor/crew-mls.js`

## @noble/hashes 2.4.0

License: MIT

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Shipped in: `js/vendor/crew-mls.js`

## @noble/hashes 2.0.1

License: MIT

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Shipped in: `js/vendor/crew-mls.js` (nested under @noble/curves)

## @noble/ciphers 2.1.1

License: MIT

Copyright (c) 2022 Paul Miller (https://paulmillr.com)
Copyright (c) 2016 Thomas Pornin <pornin@bolet.org>

Shipped in: `js/vendor/crew-mls.js`

## @hpke/core 1.9.0

License: MIT

Copyright (c) 2023 Ajitomi Daisuke

Shipped in: `js/vendor/crew-mls.js`

## @hpke/common 1.10.1

License: MIT

Copyright (c) 2024 Ajitomi Daisuke

Shipped in: `js/vendor/crew-mls.js`

## Leaflet 1.9.4

License: BSD-2-Clause

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade

Shipped in: `vendor/leaflet/` (full text in `vendor/leaflet/LICENSE`)

## Atkinson Hyperlegible Next

License: OFL-1.1

Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next) AtkinsonHyperlegibleNext-Italic[wght].ttf: Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next)

Shipped in: `vendor/fonts/atkinson-hyperlegible-next/` (latin 400, 500, 600; full text in `OFL.txt`)

---

The MIT permission text below applies to every section above marked "License: MIT":

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

Not listed because they do not ship: esbuild is build-only (it bundles `messenger/` and is not in
the output), and the Edge Functions' Deno imports are fetched at deploy time, not vendored here.
`docs/design/STUDIO-CORE.md` and `docs/design/tokens.json` are first-party copies from Chase's
Hearth repo, licensed MIT here by their author.

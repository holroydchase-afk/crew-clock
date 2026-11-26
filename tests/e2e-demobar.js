// Studio demo bar (docs/product/SPEC-DEMO-BAR.md, CRW M1.18, intake #38): browser cases DEMOBAR-1..12,
// 14 and 17 by criterion ID. DEMOBAR-13 (and the static half of DEMOBAR-10) is tests/demobar.test.ts;
// DEMOBAR-15 (ux-reviewer shots) and DEMOBAR-16 (live demo on a real phone) are manual.
// Hooks the spec names: the bar is `section[aria-label="Demo"]`, its toggle is the button named
// "Demo details" (aria-expanded, aria-controls naming the drawer), the drawer holds the "No signal"
// switch (data-action="demo-offline"), "Reset demo" and a link to https://chaseholroyd.com/.
// The spec names no hook for the summary, badge or chevron, so they are found by their words inside
// the toggle (QA-R finding in the M1.18 qa block). Against a demo build on :8123:
//   node scripts/build-site.mts dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-demobar.js            (or one case: node tests/e2e-demobar.js DEMOBAR-7)
// Every off-origin request (map tiles) is answered empty, never reaching the internet. DEMOBAR-12
// serves the crew app's config (backend: supabase) and a fake Supabase in the test, as
// tests/e2e-hints.js HINT-7 does. Every name here is the demo's made-up crew.
const path = require('path');
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const SMALL = { width: 320, height: 640 };
const PORTFOLIO = 'https://chaseholroyd.com/';
const BAR = 'section[aria-label="Demo"]';
const HINTS = 'crewclock.hints';
const RESTORED = 'crewclock.restored';
const AXE = require.resolve('axe-core/axe.min.js', { paths: [path.join(__dirname, '..')] });
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const cases = [];
const t = (name, fn) => cases.push({ name, fn });
let lastPage = null;

function gpsAtJob() {
  const at = () => /** @type {GeolocationPosition} */ ({ coords: { latitude: 38.454, longitude: -81.929, accuracy: 8 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok(at()), 0);
}

// Private browsing at its worst: both storages throw on every call (DEMOBAR-17).
function storageThrows() {
  const fail = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  for (const k of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) Storage.prototype[k] = fail;
}
// Private browsing on some phones: storage is there but every write throws (HRD-13), so
// Store.isVolatile() is true and the private banner shows (DEMOBAR-11).
function writesThrow() {
  Storage.prototype.setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
}

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || PHONE, colorScheme: opts.colorScheme || 'light',
    reducedMotion: opts.reducedMotion || 'no-preference', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.dialogs = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  // Any dialog is a failure for DEMOBAR-6/7/17; dismissed, so an old confirm() never resets anything
  page.on('dialog', (d) => { page.dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsAtJob);
  for (const f of opts.init || []) await page.addInitScript(f.fn || f, f.arg);
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  await settle(page);
  return page;
}
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const bar = (page) => page.locator(BAR);
const toggle = (page) => page.locator(BAR).getByRole('button', { name: 'Demo details', exact: true });
const noSignal = (page) => page.getByRole('switch', { name: 'No signal' });

// The bar and its toggle, or a plain failure that says which hook is missing.
async function needBar(page, where) {
  const n = await bar(page).count();
  if (n !== 1) throw new Error(`${where}: want one ${BAR}, see ${n}${n ? '' : ` (old banner .demo-banner: ${await page.locator('.demo-banner').count()})`}`);
  if (await toggle(page).count() !== 1) throw new Error(`${where}: no button named "Demo details" inside ${BAR}`);
}
async function expanded(page) { return toggle(page).getAttribute('aria-expanded'); }
async function openDrawer(page, where = 'bar') {
  await needBar(page, where);
  if (await expanded(page) !== 'true') await toggle(page).click();
  await settle(page, 150);
  if (await expanded(page) !== 'true') throw new Error(`${where}: clicking "Demo details" left aria-expanded ${await expanded(page)}`);
}
// The drawer named by the toggle's aria-controls: { id, shown, text, height }
function panelNow(sel) {
  const tg = [...document.querySelectorAll(`${sel} button`)].find((b) => (b.getAttribute('aria-label') || '') === 'Demo details');
  const id = tg && tg.getAttribute('aria-controls');
  const p = id ? document.getElementById(id) : null;
  if (!p) return { id, missing: id ? `aria-controls="${id}" names nothing` : 'the toggle has no aria-controls' };
  const r = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  const shown = !p.hidden && !p.closest('[hidden]') && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  return { id, shown, text: (p.innerText || '').replace(/\s+/g, ' ').trim(), all: (p.textContent || '').replace(/\s+/g, ' ').trim(), height: r.height };
}
const panel = (page) => page.evaluate(panelNow, BAR);

async function signIn(page, name) {
  await page.locator('.name-btn', { hasText: name }).first().click();
  await page.waitForSelector('.punch, .boss, .consent, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
  await settle(page);
}
async function signOut(page) {
  const b = page.getByRole('button', { name: 'Not you?' });
  if (await b.count()) await b.click();
  else await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');
  await settle(page);
}
async function bossToday(page) {
  await signIn(page, 'Sam W.');
  await page.waitForSelector('.boss');
  await page.click('[data-action="boss-tab"][data-tab="today"]');
  await page.waitForSelector('.boss-body.tab-today');
  await settle(page, 400);
}
// Clock in, through a job choice if asked, to the done screen's Done and back Home.
async function clockIn(page) {
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn, .big-check');
  if (await page.locator('.job-btn').count()) await page.locator('.job-btn').first().click();
  await page.waitForSelector('.big-check');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForSelector('.punch.out');
  await settle(page);
}
const outboxCount = (page) => page.evaluate(async () => (await Store.outbox.all()).length);
// Waits for the page to load again after `act`.
async function reloadAfter(page, act) {
  const loaded = page.waitForEvent('load', { timeout: 15000 });
  await act();
  await loaded;
  await page.waitForSelector('#app main, .name-btn', { timeout: 15000 });
  await settle(page, 400);
}
// The summary: the outermost element in the toggle whose words start "Sample data" (it holds neither
// the badge nor "Details"). Its visible words, and whether it is cut off.
function summaryNow(sel) {
  const tg = [...document.querySelectorAll(`${sel} button`)].find((b) => (b.getAttribute('aria-label') || '') === 'Demo details');
  if (!tg) return { missing: 'no toggle' };
  const el = [...tg.querySelectorAll('*')].find((e) => /^Sample data/.test((e.textContent || '').trim()) && !/Details/.test(e.textContent || ''));
  if (!el) return { missing: 'no element in the toggle starting "Sample data"' };
  const r = el.getBoundingClientRect();
  const visible = el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && r.width > 0 && r.height > 0 : r.width > 0 && r.height > 0;
  return { text: (el.innerText || '').replace(/\s+/g, ' ').trim(), visible, scrollW: el.scrollWidth, clientW: el.clientWidth };
}

// ---------- DEMOBAR-1: one slim, collapsed bar on every screen, no sideways scroll ----------
for (const vp of [PHONE, LAPTOP, SMALL]) {
  t(`DEMOBAR-1 ${vp.width}x${vp.height}: names, worker Home (Travis K.) and boss Today (Sam W.) each have one ${BAR}, at most 48 px tall, collapsed, no sideways scroll`, async (browser) => {
    const page = await open(browser, { viewport: vp });
    const errs = [];
    const check = async (where) => {
      const n = await bar(page).count();
      if (n !== 1) { errs.push(`${where}: ${n} ${BAR}`); return; }
      const h = await bar(page).evaluate((b) => b.getBoundingClientRect().height);
      if (h > 48) errs.push(`${where}: bar is ${h.toFixed(1)} px tall (want <= 48)`);
      const tg = toggle(page);
      if (await tg.count() !== 1) errs.push(`${where}: no "Demo details" toggle in the bar`);
      else if (await tg.getAttribute('aria-expanded') !== 'false') errs.push(`${where}: aria-expanded is ${await tg.getAttribute('aria-expanded')}, want "false"`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over !== 0) errs.push(`${where}: scrollWidth - innerWidth is ${over}`);
    };
    await check('names');
    await signIn(page, 'Travis K.');
    await check('worker Home');
    await signOut(page);
    await bossToday(page);
    await check('boss Today');
    if (errs.length) throw new Error(errs.join(' | '));
    return page;
  });
}

// ---------- DEMOBAR-2: back link, badge, Details, and the summary at each width ----------
t('DEMOBAR-2 390: the first link is "← Portfolio" to https://chaseholroyd.com/, the toggle holds "Demo" and "Details", the summary is "Sample data" and not cut off', async (browser) => {
  const page = await open(browser);
  await needBar(page, 'names');
  const errs = [];
  const link = await bar(page).locator('a').first().evaluate((a) => ({ text: a.innerText.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') })).catch(() => null);
  if (!link) errs.push('no link in the bar');
  else {
    if (link.text !== '← Portfolio') errs.push(`first link reads ${JSON.stringify(link.text)}, want "← Portfolio"`);
    if (link.href !== PORTFOLIO) errs.push(`first link goes to ${JSON.stringify(link.href)}, want "${PORTFOLIO}"`);
  }
  const words = (await toggle(page).innerText()).replace(/\s+/g, ' ');
  if (!/\bDemo\b/.test(words)) errs.push(`the toggle does not show "Demo": ${JSON.stringify(words)}`);
  if (!/\bDetails\b/.test(words)) errs.push(`the toggle does not show "Details": ${JSON.stringify(words)}`);
  const s = await page.evaluate(summaryNow, BAR);
  if (s.missing) errs.push(s.missing);
  else {
    if (s.text !== 'Sample data') errs.push(`summary reads ${JSON.stringify(s.text)} at 390, want "Sample data"`);
    if (!s.visible) errs.push('summary not visible at 390');
    if (s.scrollW !== s.clientW) errs.push(`summary is cut off: scrollWidth ${s.scrollW} vs clientWidth ${s.clientW}`);
  }
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});
t('DEMOBAR-2 1280: the summary reads "Sample data · changes stay in this browser"', async (browser) => {
  const page = await open(browser, { viewport: LAPTOP });
  await needBar(page, 'names');
  const s = await page.evaluate(summaryNow, BAR);
  if (s.missing) throw new Error(s.missing);
  if (s.text !== 'Sample data · changes stay in this browser') throw new Error(`summary reads ${JSON.stringify(s.text)} at 1280`);
  if (!s.visible || s.scrollW !== s.clientW) throw new Error(`summary visible ${s.visible}, scrollWidth ${s.scrollW} clientWidth ${s.clientW}`);
  return page;
});
t('DEMOBAR-2 320: the summary is not visible', async (browser) => {
  const page = await open(browser, { viewport: SMALL });
  await needBar(page, 'names');
  const s = await page.evaluate(summaryNow, BAR);
  if (s.missing) throw new Error(`setup: ${s.missing} (the summary must exist, hidden, at 320)`);
  if (s.visible) throw new Error(`summary ${JSON.stringify(s.text)} is visible at 320`);
  return page;
});

// UX-R1 (decision 2026-11-25, replaces spec decision 2's "← Back"): the back link reads "← Portfolio"
// at every width, never "← Back" (the app's own "‹ Back" sits right under it); the summary gives way
// instead: hidden below 390, "Sample data" from 390 to 599, the long form from 600.
for (const vp of [SMALL, { width: 360, height: 740 }, { width: 389, height: 844 }, PHONE, { width: 599, height: 844 }, { width: 600, height: 900 }, LAPTOP]) {
  t(`DEMOBAR-2 UX-R1 ${vp.width}: the first link reads exactly "← Portfolio" to ${PORTFOLIO}, not cut off, no "Back" in the bar, no sideways scroll`, async (browser) => {
    const page = await open(browser, { viewport: vp });
    await needBar(page, 'names');
    const errs = [];
    const link = await bar(page).locator('a').first().evaluate((a) => ({ text: a.innerText.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href'), sw: a.scrollWidth, cw: a.clientWidth })).catch(() => null);
    if (!link) errs.push('no link in the bar');
    else {
      if (link.text !== '← Portfolio') errs.push(`first link reads ${JSON.stringify(link.text)} at ${vp.width}, want "← Portfolio"`);
      if (link.href !== PORTFOLIO) errs.push(`first link goes to ${JSON.stringify(link.href)}`);
      if (link.sw > link.cw) errs.push(`first link is cut off: scrollWidth ${link.sw} vs clientWidth ${link.cw}`);
    }
    const words = (await bar(page).innerText()).replace(/\s+/g, ' ');
    if (/\bBack\b/.test(words)) errs.push(`the bar shows "Back": ${JSON.stringify(words)}`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over !== 0) errs.push(`scrollWidth - innerWidth is ${over}`);
    if (errs.length) throw new Error(errs.join(' | '));
    return page;
  });
}
for (const [vp, want] of /** @type {Array<[{ width: number, height: number }, string | null]>} */ ([[{ width: 360, height: 740 }, null], [{ width: 389, height: 844 }, null], [PHONE, 'Sample data'], [{ width: 599, height: 844 }, 'Sample data'], [{ width: 600, height: 900 }, 'Sample data · changes stay in this browser']])) {
  t(`DEMOBAR-2 UX-R1 ${vp.width}: the summary is ${want ? `"${want}", not cut off` : 'not visible (below 390)'}`, async (browser) => {
    const page = await open(browser, { viewport: vp });
    await needBar(page, 'names');
    const s = await page.evaluate(summaryNow, BAR);
    if (s.missing) throw new Error(`setup: ${s.missing}`);
    if (!want) { if (s.visible) throw new Error(`summary ${JSON.stringify(s.text)} is visible at ${vp.width}, want hidden below 390`); return page; }
    if (!s.visible) throw new Error(`summary not visible at ${vp.width}`);
    if (s.text !== want) throw new Error(`summary reads ${JSON.stringify(s.text)} at ${vp.width}, want ${JSON.stringify(want)}`);
    if (s.scrollW !== s.clientW) throw new Error(`summary is cut off: scrollWidth ${s.scrollW} vs clientWidth ${s.clientW}`);
    return page;
  });
}

// UX-R3: at 1280 the bar's and the drawer's content keep to the app column (the screen's centred
// column: .screen on names, .pad on boss Today), so Details sits near the summary, not 1,050 px away.
function columnNow(sel) {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; };
  const col = document.querySelector('#app .pad, #app .screen');
  const b = document.querySelector(sel);
  const tg = b && [...b.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Demo details');
  if (!col || !b || !tg) return { missing: `column ${!!col}, bar ${!!b}, toggle ${!!tg}` };
  const more = [...tg.querySelectorAll('*')].find((e) => (e.textContent || '').trim() === 'Details');
  const p = document.getElementById(tg.getAttribute('aria-controls') || '');
  const parts = { link: b.querySelector('a'), toggle: tg, details: more };
  const out = { col: box(col), parts: {} };
  for (const [k, e] of Object.entries(parts)) if (e) out.parts[k] = box(e);
  if (p && !p.hidden) for (const e of p.querySelectorAll('p, a, button:not([hidden]), [role="switch"]')) {
    const r = e.getBoundingClientRect(); if (r.width > 0) out.parts[`drawer ${(e.innerText || '').trim().slice(0, 16)}`] = box(e);
  }
  return out;
}
for (const where of ['names', 'boss Today']) {
  t(`DEMOBAR-2 UX-R3 1280 ${where}: the bar and the open drawer keep inside the app column, Details ends within 48 px of its right edge`, async (browser) => {
    const page = await open(browser, { viewport: LAPTOP });
    if (where === 'boss Today') await bossToday(page);
    await openDrawer(page, where);
    const c = await page.evaluate(columnNow, BAR);
    if (c.missing) throw new Error(`setup: ${c.missing}`);
    const errs = [];
    for (const [k, r] of Object.entries(c.parts)) {
      if (r.l < c.col.l - 1 || r.r > c.col.r + 1) errs.push(`${k} spans ${r.l.toFixed(0)}-${r.r.toFixed(0)}, outside the app column ${c.col.l.toFixed(0)}-${c.col.r.toFixed(0)}`);
    }
    if (!c.parts.details) errs.push('no "Details" in the toggle');
    else if (c.col.r - c.parts.details.r > 48) errs.push(`Details ends ${(c.col.r - c.parts.details.r).toFixed(0)} px left of the column's right edge (want within 48)`);
    if (errs.length) throw new Error(errs.join(' | '));
    return page;
  });
}

// ---------- DEMOBAR-3: Details opens the drawer, in flow ----------
// UX-R4 + PS-R1 + UX-R5: the drawer copy, word for word ("made‑up" with a non-breaking hyphen
// U+2011). The decision allows "which see the area" for "which see the area shown" only if the long
// form runs to 5 lines at 390.
const COPY = 'This is the real Crew Clock with a made‑up crew. Changes stay in this browser, never sent anywhere. Map pictures come from map servers, which see the area shown. Reset demo starts over.';
const COPY_SHORT = COPY.replace('which see the area shown.', 'which see the area.');
// The drawer's copy paragraph: its words, and how many lines it takes
function copyNow(sel) {
  const tg = [...document.querySelectorAll(`${sel} button`)].find((b) => (b.getAttribute('aria-label') || '') === 'Demo details');
  const p = tg && document.getElementById(tg.getAttribute('aria-controls') || '');
  const el = p && p.querySelector('p');
  if (!el) return { missing: 'no copy paragraph (p) in the drawer' };
  const rg = document.createRange();
  rg.selectNodeContents(el);
  const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.bottom)));
  return { text: (el.textContent || '').replace(/\s+/g, ' ').trim(), lines: tops.size };
}
t('DEMOBAR-3 390: clicking "Demo details" opens the drawer it names; its copy reads exactly the decided words (made‑up with U+2011) in at most 4 lines; the screen moves down by the drawer', async (browser) => {
  const page = await open(browser);
  await needBar(page, 'names');
  const topOf = () => page.evaluate(() => document.querySelector('.name-btn').getBoundingClientRect().top);
  const before = await topOf();
  const closed = await panel(page);
  if (closed.missing) throw new Error(closed.missing);
  if (closed.shown) throw new Error('the drawer shows before the toggle is clicked');
  await toggle(page).click();
  await settle(page, 400); // any open transition has ended
  const errs = [];
  if (await expanded(page) !== 'true') errs.push(`aria-expanded ${await expanded(page)} after the click`);
  const p = await panel(page);
  if (!p.shown) errs.push(`drawer #${p.id} is not visible`);
  if (!p.text.startsWith('This is the real Crew Clock')) errs.push(`drawer starts ${JSON.stringify(p.text.slice(0, 40))}`);
  if (!p.text.includes('never sent anywhere')) errs.push('drawer copy lacks "never sent anywhere"');
  if (!/\bmap\b/.test(p.text)) errs.push('drawer copy lacks "map"');
  const c = await page.evaluate(copyNow, BAR);
  if (c.missing) errs.push(c.missing);
  else {
    if (c.text !== COPY && c.text !== COPY_SHORT) errs.push(`drawer copy reads ${JSON.stringify(c.text)}, want ${JSON.stringify(COPY)}`);
    if (c.lines > 4) errs.push(`drawer copy runs to ${c.lines} lines at 390 (want 4 or fewer)`);
  }
  const moved = (await topOf()) - before;
  if (Math.abs(moved - p.height) > 2) errs.push(`the first name button moved ${moved.toFixed(1)} px, the drawer is ${p.height.toFixed(1)} px (in flow, not over the screen)`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

// UX-R2: one left edge in the drawer: the copy's first letter, the No signal knob and the link's arrow
function edgesNow(sel) {
  const tg = [...document.querySelectorAll(`${sel} button`)].find((b) => (b.getAttribute('aria-label') || '') === 'Demo details');
  const p = tg && document.getElementById(tg.getAttribute('aria-controls') || '');
  if (!p) return { missing: 'no drawer' };
  const textLeft = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const r = [...rg.getClientRects()].find((x) => x.width > 0); return r ? r.left : null; };
  const copy = p.querySelector('p');
  const sw = p.querySelector('[role="switch"]');
  const knob = sw && sw.querySelector('[aria-hidden="true"]');
  const link = [...p.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === 'https://chaseholroyd.com/');
  // The link shares the left edge only when it starts its own row (at 1280 it sits beside Reset demo)
  const ownRow = !!(link && sw) && link.getBoundingClientRect().top >= sw.getBoundingClientRect().bottom - 1;
  return { copy: copy && textLeft(copy), knob: knob && knob.getBoundingClientRect().left, arrow: link && textLeft(link), ownRow,
    missing: [!copy && 'copy p', !knob && 'No signal knob', !link && 'portfolio link'].filter(Boolean).join(', ') };
}
for (const vp of [PHONE, LAPTOP]) {
  t(`DEMOBAR-3 UX-R2 ${vp.width}: in the open drawer the copy, the No signal knob and the link's arrow start at one left edge (within 1 px; the link when it starts its own row)`, async (browser) => {
    const page = await open(browser, { viewport: vp });
    await signIn(page, 'Travis K.'); // No signal shows on worker Home
    await openDrawer(page, 'worker Home');
    const e = await page.evaluate(edgesNow, BAR);
    if (e.missing) throw new Error(`setup: missing ${e.missing}`);
    const xs = [e.copy, e.knob].concat(e.ownRow ? [e.arrow] : []);
    if (Math.max(...xs) - Math.min(...xs) > 1) throw new Error(`left edges: copy ${e.copy.toFixed(1)}, knob ${e.knob.toFixed(1)}, link arrow ${e.arrow.toFixed(1)} px${e.ownRow ? '' : ' (link beside Reset demo, not checked)'}`);
    return page;
  });
}

// ---------- DEMOBAR-4: Esc closes and gives focus back ----------
t('DEMOBAR-4 with focus inside the open drawer, Esc closes it, hides the drawer and focuses the toggle', async (browser) => {
  const page = await open(browser);
  await openDrawer(page, 'names');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).focus();
  await page.keyboard.press('Escape');
  await settle(page, 300);
  const errs = [];
  if (await expanded(page) !== 'false') errs.push(`aria-expanded ${await expanded(page)} after Esc`);
  if ((await panel(page)).shown) errs.push('the drawer still shows after Esc');
  const onToggle = await page.evaluate(() => { const a = document.activeElement; return !!a && a.getAttribute('aria-label') === 'Demo details'; });
  if (!onToggle) errs.push(`focus is on ${await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80))}, not the toggle`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

// ---------- DEMOBAR-5: the drawer's three controls, in order, 48 px ----------
t('DEMOBAR-5 the open drawer\'s controls are, in order, the "No signal" switch, "Reset demo", and a link to https://chaseholroyd.com/, each 48 px tall or more', async (browser) => {
  const page = await open(browser);
  await openDrawer(page, 'names');
  const id = (await panel(page)).id;
  const got = await page.evaluate((pid) => [...document.getElementById(pid).querySelectorAll('a[href], button, input, [role="switch"], [tabindex]:not([tabindex="-1"])')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', name: (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim(),
      href: e.getAttribute('href'), action: e.dataset.action || '', h: e.getBoundingClientRect().height })), id);
  const errs = [];
  const want = [
    (c) => c.role === 'switch' && /^No signal$/.test(c.name) && c.action === 'demo-offline',
    (c) => c.tag === 'button' && c.name === 'Reset demo',
    (c) => c.tag === 'a' && c.href === PORTFOLIO,
  ];
  const show = got.map((c) => `${c.tag}${c.role ? `[${c.role}]` : ''} "${c.name}"${c.href ? ` ${c.href}` : ''}`).join(', ');
  if (got.length !== 3 || !want.every((ok, i) => got[i] && ok(got[i]))) errs.push(`drawer controls: ${show || 'none'}; want No signal switch, Reset demo, link to ${PORTFOLIO}`);
  for (const c of got) if (c.h < 47.5) errs.push(`"${c.name}" is ${c.h.toFixed(1)} px tall`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

// ---------- DEMOBAR-6 / 7 / 17: inline Reset, no confirm() ----------
async function travisPunchHeld(page) {
  await signIn(page, 'Travis K.');
  await openDrawer(page, 'worker Home');
  await noSignal(page).click(); // the punch waits on the phone, so the outbox shows it
  await settle(page);
  await clockIn(page);
}
t('DEMOBAR-6 with a punch saved, Reset demo then Keep: no dialog, Reset demo is back and focused, the outbox still holds 1', async (browser) => {
  const page = await open(browser);
  await travisPunchHeld(page);
  const before = await outboxCount(page);
  if (before !== 1) throw new Error(`setup: want 1 punch in the outbox with No signal on, see ${before}`);
  await openDrawer(page, 'worker Home after clocking in');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await settle(page);
  const errs = [];
  const ask = page.getByText('Put the sample data back? Your changes will be lost.');
  if (!(await ask.count())) errs.push('no "Put the sample data back? Your changes will be lost." after Reset demo');
  const keep = page.getByRole('button', { name: 'Keep', exact: true });
  if (await keep.count() !== 1) throw new Error(`${errs.concat('no "Keep" button').join(' | ')}; dialogs: ${page.dialogs.join(' / ') || 'none'}`);
  if (!(await keep.evaluate((k) => k === document.activeElement))) errs.push('focus is not on Keep when the question shows');
  await keep.click();
  await settle(page);
  const reset = page.getByRole('button', { name: 'Reset demo', exact: true });
  if (!(await reset.isVisible())) errs.push('Reset demo is not visible after Keep');
  else if (!(await reset.evaluate((b) => b === document.activeElement))) errs.push('Reset demo does not have focus after Keep');
  if (page.dialogs.length) errs.push(`dialog(s): ${page.dialogs.join(' / ')}`);
  const after = await outboxCount(page);
  if (after !== 1) errs.push(`outbox holds ${after} after Keep, want 1`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

t('DEMOBAR-7 with a punch saved and hints set, Reset demo then Reset: no dialog; after the reload the drawer is open and starts "Sample data restored.", cc. keys and crewclock.hints are gone; a second reload is collapsed', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Travis K.'); // finishes hint step 1
  await clockIn(page);
  const set = await page.evaluate((k) => localStorage.getItem(k), HINTS);
  if (!set) throw new Error(`setup: ${HINTS} is not set after tapping the dotted Travis K.`);
  await openDrawer(page, 'worker Home');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await settle(page);
  const go = page.getByRole('button', { name: 'Reset', exact: true });
  if (await go.count() !== 1) throw new Error(`no inline "Reset" button after Reset demo; dialogs: ${page.dialogs.join(' / ') || 'none'}`);
  await reloadAfter(page, () => go.click());
  const errs = [];
  if (page.dialogs.length) errs.push(`dialog(s): ${page.dialogs.join(' / ')}`);
  await needBar(page, 'after Reset');
  if (await expanded(page) !== 'true') errs.push(`after Reset the drawer is not open (aria-expanded ${await expanded(page)})`);
  const p = await panel(page);
  if (!p.shown || !p.text.startsWith('Sample data restored.')) errs.push(`drawer ${p.shown ? 'starts' : 'hidden, text'} ${JSON.stringify((p.text || '').slice(0, 40))}, want "Sample data restored."`);
  const left = await page.evaluate((k) => ({
    // the fresh seed (cc.demo.db*) and the sign-in screen's crew list (cc.crewNames) come back on load, as in RST-1
    cc: Object.keys(localStorage).filter((x) => x.startsWith('cc.') && !x.startsWith('cc.demo.db') && x !== 'cc.crewNames'),
    hints: localStorage.getItem(k),
  }), HINTS);
  if (left.cc.length) errs.push(`visit keys left: ${left.cc.join(', ')}`);
  if (left.hints !== null) errs.push(`${HINTS} is still ${left.hints}`);
  await page.reload();
  await page.waitForSelector('.name-btn');
  await settle(page, 400);
  if (await expanded(page) !== 'false') errs.push(`after a second reload aria-expanded is ${await expanded(page)}, want "false" (the restored note shows once)`);
  if (await page.evaluate((k) => sessionStorage.getItem(k), RESTORED) !== null) errs.push(`sessionStorage ${RESTORED} is still set after it was read`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

// Spec note (QA-R finding): DEMOBAR-17 says aria-expanded "false" for both storages, but with empty
// working storage the restored flag is set, so DEMOBAR-7's open drawer applies; tested that way.
t('DEMOBAR-17 empty storage: Reset demo then Reset reloads with no page error and no dialog, the bar shows the restored note once', async (browser) => {
  const page = await open(browser);
  await openDrawer(page, 'names (fresh)');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await settle(page);
  const go = page.getByRole('button', { name: 'Reset', exact: true });
  if (await go.count() !== 1) throw new Error('no inline "Reset" button after Reset demo');
  await reloadAfter(page, () => go.click());
  await needBar(page, 'after Reset');
  const errs = [];
  if (page.dialogs.length) errs.push(`dialog(s): ${page.dialogs.join(' / ')}`);
  if (await expanded(page) !== 'true') errs.push(`aria-expanded ${await expanded(page)}, want "true" with the restored note`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});
t('DEMOBAR-17 private mode (sessionStorage and localStorage throw on every call): Reset demo then Reset reloads with 0 page errors and the bar collapsed', async (browser) => {
  const page = await open(browser, { init: [storageThrows] });
  await openDrawer(page, 'names (private mode)');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await settle(page);
  const go = page.getByRole('button', { name: 'Reset', exact: true });
  if (await go.count() !== 1) throw new Error('no inline "Reset" button after Reset demo');
  await reloadAfter(page, () => go.click());
  await needBar(page, 'after Reset (private mode)');
  const errs = [];
  if (page.dialogs.length) errs.push(`dialog(s): ${page.dialogs.join(' / ')}`);
  if (await expanded(page) !== 'false') errs.push(`aria-expanded ${await expanded(page)}, want "false" (no flag can be stored)`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page; // page.errors must be empty: checked by the runner
});

// ---------- DEMOBAR-8: an #app redraw keeps the drawer, the switch and the confirm row ----------
t('DEMOBAR-8 boss Today, drawer open with No signal on: a redraw of the screen (Week, Day, Refresh) keeps aria-expanded "true", the switch on, and an open Reset question', async (browser) => {
  const page = await open(browser);
  await bossToday(page);
  await openDrawer(page, 'boss Today');
  await noSignal(page).click();
  await settle(page);
  if (await noSignal(page).getAttribute('aria-checked') !== 'true') throw new Error('setup: No signal did not turn on');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await settle(page);
  await page.evaluate(() => document.querySelector('#app .boss-body').setAttribute('data-old', '1'));
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.waitForSelector('table.week');
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await page.waitForSelector('.boss-body.tab-today');
  if (await page.locator('[data-action="reload-team"]').count()) await page.click('[data-action="reload-team"]');
  await settle(page, 600);
  const redrawn = await page.evaluate(() => !!document.querySelector('#app .boss-body:not([data-old])') && !document.querySelector('#app .boss-body[data-old]'));
  if (!redrawn) throw new Error('setup: the boss screen was not redrawn');
  const errs = [];
  if (await expanded(page) !== 'true') errs.push(`aria-expanded ${await expanded(page)} after the redraw`);
  if (await noSignal(page).count() !== 1) errs.push('the No signal switch is gone after the redraw');
  else if (await noSignal(page).getAttribute('aria-checked') !== 'true') errs.push(`No signal aria-checked ${await noSignal(page).getAttribute('aria-checked')} after the redraw`);
  if (!(await page.getByText('Put the sample data back? Your changes will be lost.').isVisible().catch(() => false))) errs.push('the Reset question closed on the redraw');
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

// ---------- DEMOBAR-9: hint step 7 goes through the toggle ----------
function stepsOneToSix(key) {
  if (sessionStorage.getItem('hints-seeded')) return;
  sessionStorage.setItem('hints-seeded', '1');
  localStorage.setItem(key, JSON.stringify([1, 2, 3, 4, 5, 6]));
}
function dotNow() {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll('.hint-dot')].filter(vis).map((d) => {
    const tg = d.closest('[data-hint]');
    return { step: tg ? tg.dataset.hint : null, label: tg ? (tg.getAttribute('aria-label') || '') : '', role: tg ? (tg.getAttribute('role') || '') : '',
      text: tg ? (tg.innerText || '').replace(/\s+/g, ' ').trim() : '' };
  });
}
t('DEMOBAR-9 steps 1-6 done, drawer closed: the one dot is on the toggle (step 7); opening it leaves step 7 open and moves the dot to No signal; turning that on finishes step 7', async (browser) => {
  const page = await open(browser, { init: [{ fn: stepsOneToSix, arg: HINTS }] });
  await needBar(page, 'names');
  const errs = [];
  let ds = await page.evaluate(dotNow);
  if (ds.length !== 1 || ds[0].step !== '7' || ds[0].label !== 'Demo details') errs.push(`drawer closed: want one dot, step 7 on "Demo details"; see ${JSON.stringify(ds)}`);
  await toggle(page).click();
  await settle(page);
  const hints = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), HINTS);
  if ((await hints()).includes(7)) errs.push('opening Details finished step 7');
  ds = await page.evaluate(dotNow);
  if (ds.length !== 1 || ds[0].step !== '7' || ds[0].role !== 'switch' || !/No signal/.test(ds[0].text)) errs.push(`drawer open: want one dot, step 7 on the No signal switch; see ${JSON.stringify(ds)}`);
  await noSignal(page).click();
  await settle(page);
  if (!(await hints()).includes(7)) errs.push(`turning No signal on did not finish step 7 (${HINTS} ${JSON.stringify(await hints())})`);
  ds = await page.evaluate(dotNow);
  if (ds.length) errs.push(`a dot still shows: ${JSON.stringify(ds)}`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

// ---------- DEMOBAR-10: type, colours and focus ring, light and dark ----------
function lookNow(sel) {
  const b = document.querySelector(sel);
  if (!b) return { missing: `no ${sel}` };
  const tg = [...b.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Demo details');
  const badge = tg && [...tg.querySelectorAll('*')].find((e) => (e.textContent || '').trim() === 'Demo');
  const probe = (name) => { const p = document.createElement('span'); p.style.color = `var(${name})`; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const bgProbe = () => { const p = document.createElement('span'); p.style.backgroundColor = 'var(--surface)'; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
  const cs = getComputedStyle(b);
  const bs = badge ? getComputedStyle(badge) : null;
  return { font: cs.fontFamily, size: cs.fontSize, bg: cs.backgroundColor, surface: bgProbe(), accent: probe('--accent'),
    badge: bs ? { border: bs.borderTopColor, borderW: bs.borderTopWidth, color: bs.color, size: bs.fontSize } : null };
}
for (const scheme of ['light', 'dark']) {
  t(`DEMOBAR-10 390 ${scheme}: the bar is Atkinson Hyperlegible Next at 17px on --surface; the badge is not --accent; keyboard focus on the toggle is a 2px --accent outline`, async (browser) => {
    const page = await open(browser, { colorScheme: scheme });
    await needBar(page, 'names');
    const l = await page.evaluate(lookNow, BAR);
    const errs = [];
    if (!/^["']?Atkinson Hyperlegible Next/.test(l.font)) errs.push(`font-family ${l.font}`);
    if (l.size !== '17px') errs.push(`font-size ${l.size}`);
    if (l.bg !== l.surface) errs.push(`background ${l.bg}, --surface is ${l.surface}`);
    if (!l.badge) errs.push('no "Demo" badge in the toggle');
    else {
      if (l.badge.border === l.accent || l.badge.color === l.accent) errs.push(`badge border ${l.badge.border} / text ${l.badge.color} uses --accent ${l.accent}`);
      if (l.badge.size !== '17px') errs.push(`badge font-size ${l.badge.size}`);
    }
    // Keyboard focus: from the back link, Tab lands on the toggle
    await bar(page).locator('a').first().focus();
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a);
      return { on: a.getAttribute('aria-label'), w: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor }; });
    if (ring.on !== 'Demo details') errs.push(`Tab from the back link lands on ${JSON.stringify(ring.on)}, not the toggle`);
    else if (ring.w !== '2px' || ring.style === 'none' || ring.color !== l.accent) errs.push(`focus ring ${ring.w} ${ring.style} ${ring.color}, want 2px in --accent ${l.accent}`);
    if (errs.length) throw new Error(errs.join(' | '));
    return page;
  });
}

// ---------- DEMOBAR-11: the private banner sits under the bar ----------
t('DEMOBAR-11 private mode (Store.isVolatile() true): the bar comes first, the private banner (same words, role status) directly under it, both visible, no overlap', async (browser) => {
  const page = await open(browser, { init: [writesThrow] });
  if (!(await page.evaluate(() => Store.isVolatile()))) throw new Error('setup: Store.isVolatile() is false');
  await needBar(page, 'names (private mode)');
  const r = await page.evaluate((sel) => {
    const b = document.querySelector(sel); const p = document.querySelector('.private-banner');
    if (!p) return { missing: 'no .private-banner' };
    const br = b.getBoundingClientRect(); const pr = p.getBoundingClientRect();
    const ox = Math.max(0, Math.min(br.right, pr.right) - Math.max(br.left, pr.left));
    const oy = Math.max(0, Math.min(br.bottom, pr.bottom) - Math.max(br.top, pr.top));
    return { barFirst: !!(b.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING), barShown: br.width > 0 && br.height > 0, privShown: pr.width > 0 && pr.height > 0,
      overlap: ox * oy, gap: pr.top - br.bottom, role: p.getAttribute('role'), text: p.innerText.trim() };
  }, BAR);
  if (r.missing) throw new Error(r.missing);
  const errs = [];
  if (!r.barFirst) errs.push('the private banner comes before the bar in the page');
  if (!r.barShown || !r.privShown) errs.push(`visible: bar ${r.barShown}, private banner ${r.privShown}`);
  if (r.overlap > 0) errs.push(`they overlap by ${r.overlap.toFixed(1)} px²`);
  if (r.gap < -0.5 || r.gap > 1) errs.push(`the private banner is ${r.gap.toFixed(1)} px from the bar's bottom, want directly under`);
  if (r.role !== 'status') errs.push(`private banner role ${r.role}`);
  if (r.text !== 'Private mode: keep this tab open until it says Sent.') errs.push(`private banner reads ${JSON.stringify(r.text)}`);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

// ---------- DEMOBAR-12: the crew app has none of it ----------
const SB = 'https://fake.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (id, role) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({ org_id: 'org-1', crew_id: id, crew_role: role })}.sig`;
const CREW = [
  { id: '00000000-0000-4000-8000-0000000000b1', name: 'Test Worker', role: 'crew' },
  { id: '00000000-0000-4000-8000-0000000000b0', name: 'Test Boss', role: 'boss' },
];
const JOB = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Test job', address: 'Test Rd', lat: 38.45, lng: -81.93, radius_ft: 300, active: true };
async function openCrewApp(browser) {
  const ctx = await browser.newContext({ viewport: PHONE, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body:
    `window.APP_CONFIG = { backend: 'supabase', supabaseUrl: '${SB}', supabaseAnonKey: 'anon', orgCode: 'TEST', gpsTimeoutMs: 1500 };` }));
  await ctx.route(`${SB}/functions/v1/crew-list`, (r) => json(r, { ok: true, crew: CREW }));
  await ctx.route(`${SB}/functions/v1/pin-login`, (r) => {
    const req = r.request().postDataJSON();
    const me = CREW.find((c) => c.id === req.crewId);
    json(r, { ok: true, accessToken: token(me.id, me.role), refreshToken: 'rt-1', expiresAt: Date.now() + 3600000, me, deviceId: req.device.deviceId });
  });
  await ctx.route(`${SB}/rest/v1/**`, (r) => (r.request().method() === 'GET' ? json(r, []) : r.fulfill({ status: 201, body: '' })));
  await ctx.route(`${SB}/rest/v1/jobs*`, (r) => json(r, [JOB]));
  await ctx.route(`${SB}/rest/v1/crew*`, (r) => json(r, CREW));
  await ctx.route(`${SB}/rest/v1/punches*`, (r) => json(r, []));
  await ctx.route(`${SB}/functions/v1/sync`, (r) => json(r, { ok: true, accepted: (r.request().postDataJSON().items || []).map((i) => i.id), rejected: [] }));
  // Every sessionStorage write, before the app runs
  await page.addInitScript(() => {
    window.__sessionWrites = [];
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (this === window.sessionStorage) window.__sessionWrites.push(String(k)); return set.call(this, k, v); };
  });
  await page.addInitScript(gpsAtJob);
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  return page;
}
async function pinIn(page, name, pin) {
  await page.getByText(name, { exact: true }).click();
  await page.waitForSelector('.keypad');
  for (const k of pin) await page.click(`.keypad [data-k="${k}"]`);
}
t('DEMOBAR-12 the crew app (backend: supabase) has no Demo bar, no No signal switch, and never writes sessionStorage crewclock.restored, on names, worker Home and boss Today', async (browser) => {
  const found = [];
  const look = async (page, where) => {
    await settle(page, 400);
    if (await page.locator(BAR).count()) found.push(`${where}: ${BAR}`);
    if (await page.locator('[data-action="demo-offline"]').count()) found.push(`${where}: No signal switch in the page`);
    if (await page.getByRole('switch', { name: /No signal/ }).count()) found.push(`${where}: No signal switch`);
    if (await page.getByRole('button', { name: /Demo details|Reset demo/ }).count()) found.push(`${where}: demo bar control`);
    const w = await page.evaluate((k) => ({ writes: window.__sessionWrites.filter((x) => x === k), now: sessionStorage.getItem(k) }), RESTORED);
    if (w.writes.length || w.now !== null) found.push(`${where}: sessionStorage ${RESTORED} written`);
  };
  const page = await openCrewApp(browser);
  if (await page.evaluate(() => !!(self.Api && self.Api.isDemo))) throw new Error('setup: the supabase build came up in demo mode');
  await look(page, 'names');
  await pinIn(page, 'Test Worker', '1111');
  await page.waitForSelector('.consent, .punch, [data-action="prime-location"]');
  if (await page.locator('.consent').count()) await page.getByRole('button', { name: 'I agree', exact: true }).click();
  await page.waitForSelector('.punch, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) await page.click('[data-action="prime-location"]');
  await page.waitForSelector('.punch');
  await look(page, 'worker Home');
  await page.context().close();
  const boss = await openCrewApp(browser);
  await pinIn(boss, 'Test Boss', '1234');
  await boss.waitForSelector('.boss');
  await boss.click('[data-action="boss-tab"][data-tab="today"]');
  await boss.waitForSelector('.boss-body.tab-today');
  await look(boss, 'boss Today');
  if (found.length) throw new Error(found.join(' | '));
  return boss;
});

// ---------- DEMOBAR-14: reduced motion and axe ----------
async function axeNow(page) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => (await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, exclude: [['.leaflet-tile-pane']] }))
    .violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`), AXE_TAGS);
}
// The chevron: the toggle's decorative part after "Details" (an svg or an aria-hidden element that
// is not the hint dot).
function chevronNow(sel) {
  const tg = [...document.querySelectorAll(`${sel} button`)].find((b) => (b.getAttribute('aria-label') || '') === 'Demo details');
  if (!tg) return { missing: 'no toggle' };
  const parts = [...tg.querySelectorAll('svg, [aria-hidden="true"]')].filter((e) => !e.closest('.hint-dot') && !/Demo|Details|Sample/.test(e.textContent || ''));
  const c = parts[parts.length - 1];
  if (!c) return { missing: 'no chevron (svg or aria-hidden part) in the toggle' };
  return { dur: getComputedStyle(c).transitionDuration };
}
t('DEMOBAR-14 reduced motion: opening the drawer, the chevron transition-duration is 0s', async (browser) => {
  const page = await open(browser, { reducedMotion: 'reduce' });
  await openDrawer(page, 'names');
  const c = await page.evaluate(chevronNow, BAR);
  if (c.missing) throw new Error(c.missing);
  if (c.dur.split(',').some((x) => parseFloat(x) > 0)) throw new Error(`chevron transition-duration ${c.dur} under reduced motion`);
  return page;
});
for (const scheme of ['light', 'dark']) {
  t(`DEMOBAR-14 390 ${scheme}: axe finds nothing on the names screen with the drawer closed and open, nor on worker Home with it open`, async (browser) => {
    const page = await open(browser, { colorScheme: scheme });
    await needBar(page, 'names');
    const errs = [];
    for (const v of await axeNow(page)) errs.push(`names, closed: ${v}`);
    await openDrawer(page, 'names');
    for (const v of await axeNow(page)) errs.push(`names, open: ${v}`);
    await signIn(page, 'Travis K.');
    await openDrawer(page, 'worker Home');
    for (const v of await axeNow(page)) errs.push(`worker Home, open: ${v}`);
    if (errs.length) throw new Error(errs.join(' | '));
    return page;
  });
}

(async () => {
  const only = process.argv[2];
  const browser = await launch();
  let failed = 0;
  for (const c of cases.filter((x) => !only || x.name.startsWith(only))) {
    try {
      const page = await c.fn(browser);
      if (page && page.errors.length) throw new Error('page errors: ' + page.errors.join('; '));
      console.log(`ok     ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL   ${c.name}\n       ${e.message.split('\n').slice(0, 8).join('\n       ')}`);
    }
    for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
    lastPage = null;
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

// Demo hints (docs/product/SPEC-DEMO-HINTS.md): one pulsing dot on the next thing to tap, instead of
// the pitch and the "Demo: ..." explainers. Browser cases HINT-1 and HINT-3..HINT-12, by criterion ID;
// HINT-2 is static (tests/hints.test.ts) and HINT-14 is a manual ux-reviewer pass. UX-R70..R73
// (ux-reviewer findings) check the dot reads as a "tap here" ring and covers no words.
// Hooks (spec, "Hooks"): the dot is `.hint-dot` inside the target; the target has data-hint="1".."7"
// and aria-describedby naming a visually hidden "Suggested next step"; progress is in localStorage
// `crewclock.hints`. Against a demo build on :8123:
//   node scripts/build-site.mts dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-hints.js            (or one case: node tests/e2e-hints.js HINT-6)
// Every off-origin request (map tiles) is answered empty, never reaching the internet. HINT-7 serves
// the crew app's config (backend: supabase) and a fake Supabase in the test, as tests/e2e-enhance.js
// ENH-1d does.
const path = require('path');
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const KEY = 'crewclock.hints';
const AXE = require.resolve('axe-core/axe.min.js', { paths: [path.join(__dirname, '..')] });
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const cases = [];
const t = (name, fn) => cases.push({ name, fn });
let lastPage = null;

// The demo starts with "pretend I'm at the job" on, so these reads should never happen; counted anyway.
function gpsAtJob() {
  window.__reads = 0;
  const at = () => /** @type {GeolocationPosition} */ ({ coords: { latitude: 38.454, longitude: -81.929, accuracy: 8 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { window.__reads++; setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => { window.__reads++; setTimeout(() => ok(at()), 0); };
}

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || PHONE, colorScheme: opts.colorScheme || 'light',
    reducedMotion: opts.reducedMotion || 'no-preference', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsAtJob);
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  await settle(page);
  return page;
}
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const nameBtn = (page, name) => page.locator('.name-btn', { hasText: name }).first();

// Every visible dot on the page now: its step, what it sits in, and the target's words.
function dotsNow() {
  const seen = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  return [...document.querySelectorAll('.hint-dot')].filter(seen).map((d) => {
    const target = d.closest('[data-hint]');
    const words = target ? (target.getAttribute('aria-label') || target.innerText || '').replace(/\s+/g, ' ').trim() : '';
    return { step: target ? target.dataset.hint : null, action: target ? target.dataset.action || '' : '', words };
  });
}
const dots = (page) => page.evaluate(dotsNow);
const show = (ds) => ds.length ? ds.map((d) => `step ${d.step} on "${d.words.slice(0, 30)}"`).join(', ') : 'none';

// One dot, on the target named by `want` (step number and a test on its words).
async function expectOne(page, where, step, words) {
  const ds = await dots(page);
  if (ds.length !== 1) throw new Error(`${where}: want exactly one dot (step ${step}), see ${ds.length}: ${show(ds)}`);
  if (ds[0].step !== String(step) || !words.test(ds[0].words)) {
    throw new Error(`${where}: want the dot on step ${step} (${words}), see ${show(ds)}`);
  }
}
async function expectNone(page, where) {
  const ds = await dots(page);
  if (ds.length) throw new Error(`${where}: want no dot, see ${show(ds)}`);
}

// The clock-in flow after "Clock in": a job choice if asked, then the done screen's Done.
async function finishClockIn(page) {
  await page.waitForSelector('.job-btn, .big-check');
  if (await page.locator('.job-btn').count()) {
    await settle(page);
    await expectNone(page, 'job choice');
    await page.locator('.job-btn').first().click();
  }
  await page.waitForSelector('.big-check');
  await settle(page);
  await expectNone(page, 'done screen');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForSelector('.punch');
  await settle(page);
}
async function bossTab(page, tab) {
  await page.click(`[data-action="boss-tab"][data-tab="${tab}"]`);
  await page.waitForSelector(`.boss-body.tab-${tab}`);
  await settle(page);
}
const tamperBtn = (page) => page.getByRole('button', { name: 'Try tampering' });
async function waitTamper(page) {
  await tamperBtn(page).waitFor({ timeout: 10000 });
  await settle(page);
}
const noSignal = (page) => page.getByRole('switch', { name: 'No signal' });
// SPEC-DEMO-BAR (M1.18): No signal and Reset moved into the demo bar's "Demo details" drawer. Step 7's
// dot sits on the toggle while the drawer is closed, and moves to the switch when it opens.
const details = (page) => page.locator('section[aria-label="Demo"]').getByRole('button', { name: 'Demo details', exact: true });
async function openDetails(page) {
  if (await details(page).count() !== 1) throw new Error(`no "Demo details" toggle in section[aria-label="Demo"] (old .demo-banner: ${await page.locator('.demo-banner').count()})`);
  if (await details(page).getAttribute('aria-expanded') !== 'true') await details(page).click();
  await settle(page);
}

// ---------- HINT-1: none of the pitch or explainer words on any demo screen ----------
const GONE = [/GPS time clock/i, /\bTry it\b/i, /Start here/i, /Clock in as a worker/i, /Or pick someone else/i,
  /Demo: turn on No signal/i, /Each punch is signed/i, /Demo: pretend/i];
t('HINT-1 a fresh demo shows none of the pitch or "Demo:" words on the names screen, worker Home (Travis) or the boss screen', async (browser) => {
  const page = await open(browser);
  const found = [];
  const look = async (where) => {
    await settle(page);
    const text = await page.locator('body').innerText();
    for (const re of GONE) if (re.test(text)) found.push(`${where}: ${re}`);
  };
  await look('names');
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await look('worker Home');
  await page.getByRole('button', { name: 'Not you?' }).click();
  await page.waitForSelector('.name-btn');
  await nameBtn(page, 'Sam W.').click();
  await page.waitForSelector('.boss');
  await look('boss Map');
  await bossTab(page, 'today');
  await waitTamper(page);
  await look('boss Today');
  if (found.length) throw new Error(found.join(' | '));
  return page;
});

// ---------- HINT-3: exactly one dot, on the right target, on each screen of the path ----------
// The 7 steps (spec section 2): 1 Travis K., 2 Clock in, 3 Not you?, 4 Sam W., 5 the boss Today tab,
// 6 Try tampering, 7 the demo bar's "Demo details" toggle while the drawer is closed, then its No
// signal switch once open (any screen with the bar, once 1-6 are done). Rewritten for SPEC-DEMO-BAR.
const STEP7 = /^Demo details$/; // the toggle's aria-label, which dotsNow reads first
const STEP7_OPEN = /No signal/;
async function toTamperResult(page) {
  await tamperBtn(page).click();
  await page.waitForSelector('[data-verify-line].bad', { timeout: 10000 });
  await settle(page);
}
t('HINT-3 390: one dot per screen on the path: 1 Travis K., 2 Clock in, 3 Not you?, 4 Sam W., 5 Today tab, 6 Try tampering, 7 Demo details then No signal', async (browser) => {
  const page = await open(browser);
  await expectOne(page, 'names (fresh)', 1, /Travis K\./);
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await settle(page);
  await expectOne(page, 'worker Home (first visit)', 2, /^Clock in$/);
  await page.locator('.punch').click();
  await finishClockIn(page);
  await expectOne(page, 'worker Home (after clocking in)', 3, /^Not you\?$/);
  await page.getByRole('button', { name: 'Not you?' }).click();
  await page.waitForSelector('.name-btn');
  await settle(page);
  await expectOne(page, 'names (after clocking in)', 4, /Sam W\./);
  await nameBtn(page, 'Sam W.').click();
  await page.waitForSelector('.boss');
  await settle(page, 500);
  await expectOne(page, 'boss Map', 5, /Today/);
  await bossTab(page, 'today');
  await waitTamper(page);
  await expectOne(page, 'boss Today', 6, /^Try tampering$/);
  await toTamperResult(page);
  await expectOne(page, 'boss Today after tampering', 7, STEP7);
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');
  await settle(page);
  await expectOne(page, 'names (steps 1-6 done)', 7, STEP7);
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await settle(page);
  await expectOne(page, 'worker Home (steps 1-6 done)', 7, STEP7);
  await details(page).click();
  await settle(page);
  await expectOne(page, 'worker Home, Details open', 7, STEP7_OPEN);
  const done = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), KEY);
  if (done.includes(7)) throw new Error('opening Details finished step 7; only turning No signal on may');
  await noSignal(page).click();
  await settle(page);
  await expectNone(page, 'worker Home with No signal on');
  return page;
});

// ---------- HINT-4: a tapped dot goes, the next shows, a reload keeps it gone ----------
async function reloadTo(page, sel) {
  await page.reload();
  await page.waitForSelector(sel);
  await settle(page, 400);
}
t('HINT-4 tapping each of the 7 dotted targets finishes it: the next one shows, and a reload doesn\'t bring the finished one back', async (browser) => {
  const page = await open(browser);
  await expectOne(page, 'names (fresh)', 1, /Travis K\./);
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await settle(page);
  await expectOne(page, 'worker Home', 2, /^Clock in$/);
  const saved = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!saved) throw new Error(`step 1 done, but localStorage "${KEY}" is empty`);
  await reloadTo(page, '.punch');
  await expectOne(page, 'worker Home after a reload', 2, /^Clock in$/);
  await page.locator('.punch').click();
  await finishClockIn(page);
  await expectOne(page, 'worker Home after clocking in', 3, /^Not you\?$/);
  await reloadTo(page, '.punch');
  await expectOne(page, 'worker Home after clocking in and a reload', 3, /^Not you\?$/);
  await page.getByRole('button', { name: 'Not you?' }).click();
  await page.waitForSelector('.name-btn');
  await reloadTo(page, '.name-btn');
  const ds = await dots(page);
  if (ds.some((d) => d.step === '1' || /Travis/.test(d.words))) throw new Error(`names after a reload: Travis K.'s finished dot is back (${show(ds)})`);
  await expectOne(page, 'names after a reload', 4, /Sam W\./);
  await nameBtn(page, 'Sam W.').click();
  await page.waitForSelector('.boss');
  await settle(page, 500);
  await expectOne(page, 'boss Map', 5, /Today/);
  await bossTab(page, 'today');
  await waitTamper(page);
  await expectOne(page, 'boss Today', 6, /^Try tampering$/);
  await reloadTo(page, '.boss');
  await waitTamper(page);
  await expectOne(page, 'boss Today after a reload', 6, /^Try tampering$/);
  await bossTab(page, 'map');
  await expectNone(page, 'boss Map with step 5 done');
  await bossTab(page, 'today');
  await waitTamper(page);
  await toTamperResult(page);
  await expectOne(page, 'boss Today after tampering', 7, STEP7);
  await reloadTo(page, '.boss');
  await expectOne(page, 'boss after tampering and a reload', 7, STEP7);
  await openDetails(page); // SPEC-DEMO-BAR: the dot moves to the switch inside the drawer
  await expectOne(page, 'boss after tampering, Details open', 7, STEP7_OPEN);
  await noSignal(page).click();
  await settle(page);
  await expectNone(page, 'boss with No signal on');
  await reloadTo(page, '.boss');
  await expectNone(page, 'boss with No signal on, after a reload');
  return page;
});

// ---------- HINT-5: Reset starts the dots over ----------
// Rewritten for SPEC-DEMO-BAR (M1.18): Reset demo in the drawer, then the inline Reset (no confirm()).
t('HINT-5 Reset demo, then Reset, clears crewclock.hints and step 1 shows again on Travis K.', async (browser) => {
  const page = await open(browser);
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await page.locator('.punch').click();
  await finishClockIn(page);
  const before = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!before) throw new Error(`steps 1 and 2 done, but localStorage "${KEY}" is empty`);
  await openDetails(page);
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForSelector('.name-btn', { timeout: 15000 });
  await page.waitForLoadState('load');
  await settle(page, 400);
  const after = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (after !== null) throw new Error(`after Reset, "${KEY}" is still ${after}`);
  await expectOne(page, 'names after Reset', 1, /Travis K\./);
  return page;
});

// ---------- HINT-6: the dots alone lead a visitor through the demo ----------
// Rewritten for SPEC-DEMO-BAR (M1.18): step 7 is two taps through the bar, "Demo details" then No signal.
t('HINT-6 390x844: tapping only dotted targets 1..7 in order (7 = Demo details, then No signal; plus a job, Done and any tamper confirm) passes worker Home, done, boss and the tamper result and ends with No signal on', async (browser) => {
  const page = await open(browser, { viewport: PHONE });
  const passed = new Set();
  const trail = [];
  const seven = []; // what each step-7 dot sat on
  const note = async () => {
    if (await page.locator('.punch').count()) passed.add('worker Home');
    if (await page.locator('.big-check').count()) passed.add('done screen');
    if (await page.locator('.boss').count()) passed.add('boss screen');
    if (await page.locator('[data-verify-line].bad').count()) passed.add('tamper result');
  };
  // Something to act on: a dot, a job choice, the done screen, or No signal on. The demo's
  // pretend-GPS "Finding you" screen is a real ~900 ms pause with none of these, so wait it out.
  const actionable = () => page.waitForFunction(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return [...document.querySelectorAll('.hint-dot')].some(vis) || !!document.querySelector('.job-btn, .big-check')
      || !!document.querySelector('[role="switch"][aria-checked="true"]');
  }, null, { timeout: 5000 }).then(() => true, () => false);
  for (let i = 0; i < 25; i++) {
    await settle(page, 300);
    await actionable();
    await settle(page, 200);
    await note();
    if (await noSignal(page).count() && (await noSignal(page).getAttribute('aria-checked')) === 'true') break;
    const dot = page.locator('.hint-dot').filter({ visible: true });
    if (await dot.count()) {
      const target = dot.first().locator('xpath=ancestor::*[@data-hint][1]');
      const step = await target.getAttribute('data-hint');
      trail.push(`dot ${step}`);
      if (step === '7') seven.push((await target.getAttribute('aria-label')) || (await target.getAttribute('role')) || (await target.innerText()));
      await target.click();
      continue;
    }
    // The flow's own steps, which the spec lets a visitor take without a dot
    if (await page.locator('.job-btn').count()) { trail.push('a job'); await page.locator('.job-btn').first().click(); continue; }
    const done = page.getByRole('button', { name: 'Done', exact: true });
    if (await page.locator('.big-check').count() && await done.count()) { trail.push('Done'); await done.click(); continue; }
    const confirmTamper = page.getByRole('button', { name: /^(Change it|Yes|Confirm|Tamper)/ });
    if (await page.locator('.boss').count() && await confirmTamper.count()) { trail.push('tamper confirm'); await confirmTamper.first().click(); continue; }
    break; // nowhere to go: no dot and no flow step
  }
  await note();
  const on = (await noSignal(page).count()) && (await noSignal(page).getAttribute('aria-checked')) === 'true';
  const want = ['worker Home', 'done screen', 'boss screen', 'tamper result'];
  const missed = want.filter((w) => !passed.has(w));
  const order = trail.filter((x) => x.startsWith('dot ')).map((x) => x.slice(4));
  if (order.join(',') !== '1,2,3,4,5,6,7,7') missed.push(`the dots in order 1..6, then 7 twice (followed ${order.join(',') || 'none'})`);
  if (seven.length !== 2 || seven[0] !== 'Demo details' || seven[1] !== 'switch') missed.push(`step 7 through the bar: "Demo details" then the switch (dots sat on ${JSON.stringify(seven)})`);
  if (!on || missed.length) {
    throw new Error(`followed: ${trail.join(' > ') || 'nothing'}; No signal ${on ? 'on' : 'not on'}; never reached: ${missed.join(', ') || '-'}`);
  }
  if (await page.evaluate(() => window.__reads)) throw new Error('the demo read the visitor\'s location');
  return page;
});

// ---------- HINT-7: the crew app never gets a dot ----------
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
  // Every localStorage write whose key mentions hints, before the app runs
  await page.addInitScript(() => {
    window.__hintWrites = [];
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (/hint/i.test(String(k))) window.__hintWrites.push(String(k)); return set.call(this, k, v); };
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
function hintBitsNow(key) {
  const out = [];
  if (document.querySelector('.hint-dot')) out.push('.hint-dot');
  if (document.querySelector('[data-hint]')) out.push('[data-hint]');
  for (const el of document.querySelectorAll('[aria-describedby]')) {
    for (const id of el.getAttribute('aria-describedby').split(/\s+/)) {
      const d = document.getElementById(id);
      if (d && /Suggested next step/i.test(d.textContent)) out.push(`aria-describedby -> "Suggested next step" on ${el.tagName.toLowerCase()}`);
    }
  }
  if (/Suggested next step/i.test(document.body.textContent)) out.push('"Suggested next step" text');
  if (localStorage.getItem(key) !== null || localStorage.getItem('crewclock.demoHints') !== null) out.push('a hints key in localStorage');
  if (window.__hintWrites.length) out.push(`localStorage writes: ${window.__hintWrites.join(', ')}`);
  return out;
}
t('HINT-7 the crew app (backend: supabase) has no dot, no hint description and never writes crewclock.hints, on names, worker Home and the boss screen', async (browser) => {
  const found = [];
  const look = async (page, where) => {
    await settle(page, 400);
    for (const x of await page.evaluate(hintBitsNow, KEY)) found.push(`${where}: ${x}`);
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
  await look(boss, 'boss Map');
  await bossTab(boss, 'today');
  await look(boss, 'boss Today');
  if (found.length) throw new Error(found.join(' | '));
  return boss;
});

// ---------- HINT-8: reduced motion stops the pulse, keeps the ring ----------
function motionOf() {
  const d = document.querySelector('.hint-dot');
  if (!d) return null;
  const part = (pseudo) => {
    const cs = getComputedStyle(d, pseudo);
    return { anim: cs.animationName, dur: cs.transitionDuration, content: cs.content, w: parseFloat(cs.width) || 0, h: parseFloat(cs.height) || 0,
      border: parseFloat(cs.borderTopWidth) || 0, shadow: cs.boxShadow, outline: parseFloat(cs.outlineWidth) || 0,
      bg: cs.backgroundColor, opacity: Number(cs.opacity), display: cs.display, visibility: cs.visibility };
  };
  const r = d.getBoundingClientRect();
  // The span structure (QA-R2): the ring may be a .hint-ring child with its own pseudo-elements
  const ring = d.querySelector('.hint-ring');
  const ringPart = (pseudo) => { const cs = getComputedStyle(ring, pseudo); return { anim: cs.animationName, dur: cs.transitionDuration, border: parseFloat(cs.borderTopWidth) || 0,
    w: ring.getBoundingClientRect().width, opacity: Number(cs.opacity), visibility: cs.visibility, display: cs.display }; };
  return { self: part(null), before: part('::before'), after: part('::after'), box: { w: r.width, h: r.height },
    ring: ring && { self: ringPart(null), before: ringPart('::before'), after: ringPart('::after') } };
}
// A ring: a pseudo-element drawn with a border, shadow, outline or fill, or the dot's own shadow/outline
const hasRing = (m) => {
  const shown = (p) => p.content !== 'none' && p.content !== 'normal' && p.display !== 'none' && p.visibility !== 'hidden' && p.opacity > 0;
  const drawn = (p) => p.border > 0 || (p.shadow && p.shadow !== 'none') || p.outline > 0 || !/rgba\(0, 0, 0, 0\)|transparent/.test(p.bg);
  return [m.before, m.after].some((p) => shown(p) && (p.w > 0 || p.h > 0) && drawn(p))
    || (m.self.shadow && m.self.shadow !== 'none') || m.self.outline > 0
    || !!(m.ring && m.ring.self.border > 0 && m.ring.self.w > 0 && m.ring.self.opacity > 0 && m.ring.self.visibility !== 'hidden' && m.ring.self.display !== 'none');
};
t('HINT-8 under prefers-reduced-motion: reduce the dot and its ring have no animation or transition, and the ring is still drawn; without it, the ring pulses', async (browser) => {
  const errs = [];
  const still = await open(browser, { reducedMotion: 'reduce' });
  const m = await still.evaluate(motionOf);
  if (!m) throw new Error('reduce: no .hint-dot on the fresh names screen');
  const parts = { dot: m.self, '::before': m.before, '::after': m.after };
  if (m.ring) Object.assign(parts, { '.hint-ring': m.ring.self, '.hint-ring::before': m.ring.before, '.hint-ring::after': m.ring.after });
  for (const [k, p] of Object.entries(parts)) {
    if (p.anim !== 'none') errs.push(`reduce: ${k} animation-name ${p.anim}`);
    if (p.dur.split(',').some((x) => parseFloat(x) > 0)) errs.push(`reduce: ${k} transition-duration ${p.dur}`);
  }
  if (m.box.w < 8 || m.box.h < 8) errs.push(`reduce: the dot is ${m.box.w}x${m.box.h}, want about 12 px`);
  if (!hasRing(m)) errs.push('reduce: no static ring drawn around the dot');
  const moving = await open(browser, { reducedMotion: 'no-preference' });
  const n = await moving.evaluate(motionOf);
  if (!n) errs.push('no-preference: no .hint-dot on the fresh names screen');
  else if ([n.self, n.before, n.after].concat(n.ring ? [n.ring.self, n.ring.before, n.ring.after] : []).every((p) => p.anim === 'none')) errs.push('no-preference: nothing on the dot pulses (animation-name none on the dot and both pseudo-elements)');
  if (errs.length) throw new Error(errs.join('; '));
  return moving;
});

// ---------- HINT-9: the dot never gets in the way ----------
// Measures the dotted target, then takes the hint off (dot, data-hint, aria-describedby and its
// hidden text) and measures again: the target must not change size.
function wayOf(step) {
  const target = document.querySelector(`[data-hint="${step}"]`);
  const dot = target && target.querySelector('.hint-dot');
  if (!target || !dot) return { missing: !target ? `no [data-hint="${step}"]` : `[data-hint="${step}"] has no .hint-dot inside` };
  const tr = target.getBoundingClientRect();
  const dr = dot.getBoundingClientRect();
  const texts = [];
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || n.parentElement.closest('.hint-dot')) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) texts.push({ l: r.left, r: r.right, t: r.top, b: r.bottom, s: n.textContent.trim().slice(0, 20) });
  }
  const hits = texts.filter((x) => dr.left < x.r && dr.right > x.l && dr.top < x.b && dr.bottom > x.t).map((x) => x.s);
  const focusable = dot.matches('a, button, input, [tabindex]:not([tabindex="-1"])') || !!dot.querySelector('a, button, input, [tabindex]:not([tabindex="-1"])');
  const res = { w: tr.width, h: tr.height, hits, pe: getComputedStyle(dot).pointerEvents, hidden: dot.getAttribute('aria-hidden'), focusable };
  // Without the hint
  const ids = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  const nudge = ids.map((id) => document.getElementById(id)).filter((e) => e && /Suggested next step/i.test(e.textContent) && target.contains(e));
  dot.remove(); nudge.forEach((e) => e.remove());
  target.removeAttribute('data-hint'); target.removeAttribute('aria-describedby');
  const pr = target.getBoundingClientRect();
  res.plain = { w: pr.width, h: pr.height };
  return res;
}
async function checkWay(page, step, where, errs) {
  await settle(page);
  const r = await page.evaluate(wayOf, step);
  if (r.missing) { errs.push(`${where}: ${r.missing}`); return; }
  if (r.hits.length) errs.push(`${where}: the dot covers the target's words (${r.hits.join(', ')})`);
  if (r.w < 47.5 || r.h < 47.5) errs.push(`${where}: target is ${Math.round(r.w)}x${Math.round(r.h)}, under 48x48`);
  if (Math.abs(r.w - r.plain.w) > 0.5 || Math.abs(r.h - r.plain.h) > 0.5) errs.push(`${where}: target is ${r.w.toFixed(1)}x${r.h.toFixed(1)} with the hint, ${r.plain.w.toFixed(1)}x${r.plain.h.toFixed(1)} without`);
  if (r.pe !== 'none') errs.push(`${where}: dot pointer-events ${r.pe}`);
  if (r.hidden !== 'true') errs.push(`${where}: dot aria-hidden=${JSON.stringify(r.hidden)}`);
  if (r.focusable) errs.push(`${where}: the dot is in the tab order`);
  await page.reload(); // put the hint back for the rest of the walk
  await page.waitForSelector('#app main');
  await settle(page);
}
t('HINT-9 390: on each of the 7 dotted targets the dot is clear of its words, pointer-events none and aria-hidden, and the target stays 48x48+ at its own size', async (browser) => {
  const errs = [];
  const page = await open(browser);
  await checkWay(page, 1, 'Travis K.', errs);
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await checkWay(page, 2, 'Clock in', errs);
  await page.locator('.punch').click();
  await finishClockIn(page);
  await checkWay(page, 3, 'Not you?', errs);
  await page.getByRole('button', { name: 'Not you?' }).click();
  await page.waitForSelector('.name-btn');
  await checkWay(page, 4, 'Sam W.', errs);
  await nameBtn(page, 'Sam W.').click();
  await page.waitForSelector('.boss');
  await settle(page, 500);
  await checkWay(page, 5, 'Today tab', errs);
  await bossTab(page, 'today');
  await waitTamper(page);
  await checkWay(page, 6, 'Try tampering', errs);
  await waitTamper(page);
  await toTamperResult(page);
  await checkWay(page, 7, 'No signal (boss)', errs);
  if (errs.length) throw new Error(errs.join(' | '));
  return page;
});

// ---------- HINT-10: the same nudge for screen readers, and axe stays clean ----------
function nudgeOf() {
  const dot = document.querySelector('.hint-dot');
  const target = dot && dot.closest('[data-hint]');
  if (!target) return { err: dot ? 'the .hint-dot is not inside a [data-hint] target' : 'no .hint-dot' };
  const ids = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!ids.length) return { err: `target [data-hint="${target.dataset.hint}"] has no aria-describedby` };
  const el = ids.map((id) => document.getElementById(id)).find((e) => e && e.textContent.trim() === 'Suggested next step');
  if (!el) return { err: `aria-describedby="${ids.join(' ')}" names nothing that says exactly "Suggested next step"` };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const hidden = cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 1 || r.height <= 1 || /rect\(0/.test(cs.clip) || /inset\(50%\)/.test(cs.clipPath);
  return hidden ? null : { err: `"Suggested next step" is visible (${Math.round(r.width)}x${Math.round(r.height)})` };
}
async function axeNow(page) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => (await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, exclude: [['.leaflet-tile-pane']] }))
    .violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`), AXE_TAGS);
}
for (const scheme of ['light', 'dark']) {
  t(`HINT-10 390 ${scheme}: each dotted target is described by a visually hidden "Suggested next step", and axe finds nothing on any screen of the path`, async (browser) => {
    const errs = [];
    const page = await open(browser, { colorScheme: scheme });
    const check = async (where) => {
      await settle(page);
      const n = await page.evaluate(nudgeOf);
      if (n) errs.push(`${where}: ${n.err}`);
      for (const v of await axeNow(page)) errs.push(`${where}: axe ${v}`);
    };
    await check('names');
    await nameBtn(page, 'Travis K.').click();
    await page.waitForSelector('.punch');
    await check('worker Home (Clock in)');
    await page.locator('.punch').click();
    await finishClockIn(page);
    await check('worker Home (Not you?)');
    await page.getByRole('button', { name: 'Not you?' }).click();
    await page.waitForSelector('.name-btn');
    await check('names (Sam W.)');
    await nameBtn(page, 'Sam W.').click();
    await page.waitForSelector('.boss');
    await settle(page, 500);
    await check('boss Map (Today tab)');
    await bossTab(page, 'today');
    await waitTamper(page);
    await check('boss Today (Try tampering)');
    await toTamperResult(page);
    await check('boss after tampering (No signal)');
    await page.click('[data-action="sign-out"]');
    await page.waitForSelector('.name-btn');
    await nameBtn(page, 'Travis K.').click();
    await page.waitForSelector('.punch');
    await check('worker Home (No signal)');
    if (errs.length) throw new Error(errs.join(' | '));
    return page;
  });
}

// ---------- HINT-11: the crew app's heading, Travis K. first and on the first screen ----------
for (const vp of [PHONE, LAPTOP]) {
  t(`HINT-11 ${vp.width}x${vp.height}: the names screen's only h1 is "Who are you?", and Travis K. is the first name, fully on the first screen`, async (browser) => {
    const page = await open(browser, { viewport: vp });
    const r = await page.evaluate(() => {
      const h1s = [...document.querySelectorAll('h1')].map((h) => h.innerText.trim());
      const btns = [...document.querySelectorAll('.name-btn')];
      const first = btns[0];
      // First by reading order on screen too: topmost, then leftmost
      const byPos = btns.slice().sort((a, b) => { const x = a.getBoundingClientRect(); const y = b.getBoundingClientRect(); return (x.top - y.top) || (x.left - y.left); })[0];
      const rc = first ? first.getBoundingClientRect() : null;
      return { h1s, first: first && first.innerText.replace(/\s+/g, ' ').trim(), byPos: byPos && byPos.innerText.replace(/\s+/g, ' ').trim(),
        box: rc && { t: rc.top + scrollY, b: rc.bottom + scrollY, l: rc.left, r: rc.right } };
    });
    const errs = [];
    if (r.h1s.length !== 1 || r.h1s[0] !== 'Who are you?') errs.push(`h1s ${JSON.stringify(r.h1s)}, want ["Who are you?"]`);
    if (!/Travis K\./.test(r.first || '')) errs.push(`first name button is ${JSON.stringify(r.first)}`);
    if (!/Travis K\./.test(r.byPos || '')) errs.push(`top-left name button on screen is ${JSON.stringify(r.byPos)}`);
    if (r.box && (r.box.t < 0 || r.box.b > vp.height || r.box.l < 0 || r.box.r > vp.width)) {
      errs.push(`Travis K. spans x ${Math.round(r.box.l)}..${Math.round(r.box.r)} y ${Math.round(r.box.t)}..${Math.round(r.box.b)}, outside ${vp.width}x${vp.height}`);
    }
    if (errs.length) throw new Error(errs.join('; '));
    return page;
  });
}

// ---------- HINT-12: the pretend control drops "Demo: " and starts on ----------
t('HINT-12 worker Home (Travis, with consent): the checkbox is named exactly "Pretend I\'m at the job" and starts checked', async (browser) => {
  const page = await open(browser);
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  const box = page.getByRole('checkbox', { name: 'Pretend I\'m at the job', exact: true });
  if (await box.count() !== 1) {
    const labels = await page.locator('label').allInnerTexts();
    throw new Error(`no checkbox named exactly "Pretend I'm at the job"; labels on screen: ${JSON.stringify(labels.map((x) => x.trim()))}`);
  }
  if (!(await box.isChecked())) throw new Error('"Pretend I\'m at the job" starts unchecked');
  return page;
});

// ---------- UX-R70..R73: the dot reads as "tap here", not a status, and covers no words ----------
// Walks the 7 steps (step 7 on the boss after tampering, then the names screen and worker Home) and
// calls `check(step, where)` with the dot on screen at each.
async function walkSteps(page, check) {
  await check(1, 'names (Travis K.)');
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await settle(page);
  await check(2, 'worker Home (Clock in)');
  await page.locator('.punch').click();
  await finishClockIn(page);
  await check(3, 'worker Home (Not you?)');
  await page.getByRole('button', { name: 'Not you?' }).click();
  await page.waitForSelector('.name-btn');
  await settle(page);
  await check(4, 'names (Sam W.)');
  await nameBtn(page, 'Sam W.').click();
  await page.waitForSelector('.boss');
  await settle(page, 500);
  await check(5, 'boss Map (Today tab)');
  await bossTab(page, 'today');
  await waitTamper(page);
  await check(6, 'boss Today (Try tampering)');
  await toTamperResult(page);
  await check(7, 'boss after tampering (No signal)');
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');
  await settle(page);
  await check(7, 'names (No signal)');
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await settle(page);
  await check(7, 'worker Home (No signal)');
}

// In the page: the dot's paint against what sits behind it. Colours go through a canvas so any CSS
// colour syntax comes back as sRGB bytes.
function ringOf(step) {
  const target = document.querySelector(`[data-hint="${step}"]`);
  const dot = target && target.querySelector('.hint-dot');
  if (!dot) return { missing: target ? `[data-hint="${step}"] has no .hint-dot` : `no [data-hint="${step}"]` };
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const varColour = (name) => { const p = document.createElement('span'); p.style.color = `var(${name})`; dot.parentElement.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return rgba(c); };
  const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) <= (i === 3 ? 0.02 : 2));
  const hex = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('') + (c[3] < 1 ? `@${c[3].toFixed(2)}` : '');
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // What is painted behind the dot: the target's background, composited over its ancestors'
  const layers = [];
  for (let e = dot.parentElement; e; e = e.parentElement) {
    const c = rgba(getComputedStyle(e).backgroundColor);
    if (c[3] > 0) layers.push({ c, el: e });
    if (c[3] >= 1) break;
  }
  let behind = [255, 255, 255, 1];
  for (const l of layers.reverse()) behind = [0, 1, 2].map((i) => l.c[i] * l.c[3] + behind[i] * (1 - l.c[3])).concat(1);
  const bg = varColour('--bg');
  const accent = varColour('--accent');
  const ink = varColour('--ink');
  // QA-R2 design call: <span class="hint-dot"><span class="hint-ring"></span></span>. The outer
  // .hint-dot carries the --ink stroke as its border; .hint-ring inside has the --bg fill, the
  // --accent edge and the inner accent dot (::after). No outline, no box-shadow (DS-5, DS-9).
  const ring = dot.querySelector(':scope > .hint-ring');
  const cs = getComputedStyle(dot);
  const r = dot.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  const sidesOf = (st, want) => ['Top', 'Right', 'Bottom', 'Left'].map((x) => ({ x, w: parseFloat(st[`border${x}Width`]), style: st[`border${x}Style`], c: rgba(st[`border${x}Color`]) }))
    .filter((b) => Math.abs(b.w - 2) > 0.1 || b.style !== 'solid' || !same(b.c, want)).map((b) => `${b.x} ${b.w}px ${b.style} ${hex(b.c)}`);
  const round = (el, rc) => { const st = getComputedStyle(el); return ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].every((k) => {
    const v = st[`border${k}Radius`]; return /%/.test(v) ? parseFloat(v) >= 50 : parseFloat(v) >= Math.min(rc.width, rc.height) / 2 - 0.5; }); };
  const out = {
    w: r.width, h: r.height, bg: hex(bg), accent: hex(accent), ink: hex(ink),
    strokeBad: sidesOf(cs, ink), dotRound: round(dot, r),
    extras: [cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `outline ${cs.outlineWidth} ${cs.outlineStyle}` : null, cs.boxShadow !== 'none' ? `box-shadow ${cs.boxShadow}` : null].filter(Boolean),
    behind: hex(behind), behindFrom: layers.map((l) => `${l.el.tagName.toLowerCase()}${l.el.className ? '.' + String(l.el.className).trim().split(/\s+/).join('.') : ''}`).join(' over '),
    accentVsBehind: ratio(accent, behind), bgVsBehind: ratio(bg, behind), inkVsBehind: ratio(ink, behind),
    boxed: target.matches('.name-btn, .punch'),
    inside: r.left >= tr.left - 0.5 && r.right <= tr.right + 0.5 && r.top >= tr.top - 0.5 && r.bottom <= tr.bottom + 0.5,
    rect: `x ${r.left.toFixed(1)}..${r.right.toFixed(1)} y ${r.top.toFixed(1)}..${r.bottom.toFixed(1)}`,
    trect: `x ${tr.left.toFixed(1)}..${tr.right.toFixed(1)} y ${tr.top.toFixed(1)}..${tr.bottom.toFixed(1)}`,
    ring: null,
  };
  if (ring) {
    const rs = getComputedStyle(ring);
    const rr = ring.getBoundingClientRect();
    const pb = { l: r.left + parseFloat(cs.borderLeftWidth), r: r.right - parseFloat(cs.borderRightWidth), t: r.top + parseFloat(cs.borderTopWidth), b: r.bottom - parseFloat(cs.borderBottomWidth) };
    const pseudo = ['::before', '::after'].map((p) => {
      const ps = getComputedStyle(ring, p);
      return { p, content: ps.content, w: parseFloat(ps.width) || 0, h: parseFloat(ps.height) || 0, bg: rgba(ps.backgroundColor),
        shown: ps.content !== 'none' && ps.content !== 'normal' && ps.display !== 'none' && ps.visibility !== 'hidden' && Number(ps.opacity) > 0.9 };
    });
    out.ring = {
      w: rr.width, h: rr.height, fill: hex(rgba(rs.backgroundColor)), fillIsBg: same(rgba(rs.backgroundColor), bg),
      edgeBad: sidesOf(rs, accent), round: round(ring, rr),
      // The ring sits inside the stroke: within .hint-dot's padding box
      withinStroke: rr.left >= pb.l - 0.5 && rr.right <= pb.r + 0.5 && rr.top >= pb.t - 0.5 && rr.bottom <= pb.b + 0.5,
      rect: `x ${rr.left.toFixed(1)}..${rr.right.toFixed(1)} y ${rr.top.toFixed(1)}..${rr.bottom.toFixed(1)}`,
      inner: pseudo.find((x) => x.shown && x.w >= 6 && x.h >= 6 && same(x.bg, accent)) ? null
        : pseudo.map((x) => `${x.p} content ${x.content} ${x.w}x${x.h} bg ${hex(x.bg)}${x.shown ? '' : ' (not shown)'}`).join('; '),
    };
  }
  return out;
}
for (const scheme of ['light', 'dark']) {
  for (const vp of [PHONE, LAPTOP]) {
    t(`UX-R70/R71 ${vp.width}x${vp.height} ${scheme}: on all 7 steps .hint-dot is a round 2px solid --ink stroke (no outline or shadow) around a 16px+ .hint-ring (fill --bg, 2px solid --accent edge, inner accent dot 6px+), with stroke, edge or fill 3:1 against what is behind it, and inside boxed targets`, async (browser) => {
      // Reduced motion so the inner dot and ring are measured still, not mid-pulse
      const page = await open(browser, { viewport: vp, colorScheme: scheme, reducedMotion: 'reduce' });
      const errs = [];
      await walkSteps(page, async (step, where) => {
        await settle(page);
        const m = await page.evaluate(ringOf, step);
        if (m.missing) { errs.push(`${where}: ${m.missing}`); return; }
        // The stroke: .hint-dot's own border, 2px solid --ink, round, nothing else drawn around it
        if (m.strokeBad.length) errs.push(`${where}: .hint-dot border ${m.strokeBad.join(', ')}, want 2px solid --ink ${m.ink}`);
        if (m.extras.length) errs.push(`${where}: .hint-dot has ${m.extras.join(' and ')}; the stroke is its border (DS-5, DS-9)`);
        if (!m.dotRound) errs.push(`${where}: .hint-dot is not round`);
        if (!m.ring) errs.push(`${where}: no .hint-ring inside .hint-dot`);
        else {
          const g = m.ring;
          if (g.w < 16 || g.h < 16) errs.push(`${where}: .hint-ring is ${g.w}x${g.h}, want 16x16+`);
          if (m.w < g.w + 4 - 0.5 || m.h < g.h + 4 - 0.5) errs.push(`${where}: .hint-dot is ${m.w}x${m.h}, want the ring (${g.w}x${g.h}) plus a 2px stroke each side`);
          if (!g.withinStroke) errs.push(`${where}: .hint-ring ${g.rect} is not inside the stroke of .hint-dot ${m.rect}`);
          if (!g.fillIsBg) errs.push(`${where}: .hint-ring fill ${g.fill}, want --bg ${m.bg}`);
          if (g.edgeBad.length) errs.push(`${where}: .hint-ring border ${g.edgeBad.join(', ')}, want 2px solid --accent ${m.accent}`);
          if (!g.round) errs.push(`${where}: .hint-ring is not round`);
          if (g.inner) errs.push(`${where}: no inner accent dot 6px+ on .hint-ring (${g.inner})`);
        }
        const inkOk = !m.strokeBad.length && m.inkVsBehind >= 3;
        const accentOk = m.ring && !m.ring.edgeBad.length && m.accentVsBehind >= 3;
        const bgOk = m.ring && m.ring.fillIsBg && m.bgVsBehind >= 3;
        if (!inkOk && !accentOk && !bgOk) {
          const say = (ok, v) => (ok ? `${v.toFixed(2)}:1` : 'missing');
          errs.push(`${where}: behind the dot is ${m.behind} (${m.behindFrom}); --ink stroke ${say(!m.strokeBad.length, m.inkVsBehind)}, accent edge ${say(m.ring && !m.ring.edgeBad.length, m.accentVsBehind)}, --bg fill ${say(m.ring && m.ring.fillIsBg, m.bgVsBehind)}, want one 3:1+`);
        }
        if (m.boxed && !m.inside) errs.push(`${where}: .hint-dot ${m.rect} (stroke included) sticks out of the target ${m.trect}`);
      });
      if (errs.length) throw new Error(errs.join(' | '));
      return page;
    });
  }
}

// In the page: every visible word on screen (Range.getClientRects per word, every text node in the
// body, not only the target's) whose box overlaps what the hint paints: .hint-dot (stroke included),
// .hint-ring, any outline or shadow, and each shown ::before/::after (the pulse ring), sampled at 10 points of its animation and counted where its
// opacity is 0.2 or more.
function wordsUnderDot(step) {
  const target = document.querySelector(`[data-hint="${step}"]`);
  const dot = target && target.querySelector('.hint-dot');
  if (!dot) return { missing: target ? `[data-hint="${step}"] has no .hint-dot` : `no [data-hint="${step}"]` };
  const dr = dot.getBoundingClientRect();
  const dcs = getComputedStyle(dot);
  // Computed box-shadow layers: [{ colour, x, y, blur, spread, inset }]
  const shadows = (v) => (v === 'none' ? [] : v.split(/,(?![^(]*\))/).map((x) => {
    const colour = (x.match(/(rgba?|color|oklch|oklab|lab|lch|hsla?)\([^)]*\)/) || ['transparent'])[0];
    const n = x.replace(colour, '').match(/-?[\d.]+px/g) || [];
    const [ox, oy, blur, spread] = n.map(parseFloat).concat([0, 0, 0, 0]);
    return { colour, x: ox, y: oy, blur, spread, inset: /inset/.test(x) };
  }));
  // Paint outside the box: the outline (width + offset) and any outer box-shadow
  const outlineGrow = dcs.outlineStyle !== 'none' ? Math.max(0, (parseFloat(dcs.outlineWidth) || 0) + (parseFloat(dcs.outlineOffset) || 0)) : 0;
  const grow = Math.max(outlineGrow, ...shadows(dcs.boxShadow).filter((x) => !x.inset).map((x) => x.spread + x.blur + Math.max(Math.abs(x.x), Math.abs(x.y))));
  const parts = [{ part: 'dot', l: dr.left - grow, r: dr.right + grow, t: dr.top - grow, b: dr.bottom + grow }];
  const pseudoBox = (el, p) => {
    const ps = getComputedStyle(el, p);
    const er = el.getBoundingClientRect();
    const ecs = getComputedStyle(el);
    if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none' || ps.visibility === 'hidden' || Number(ps.opacity) < 0.2) return null;
    const w = parseFloat(ps.width) + parseFloat(ps.borderLeftWidth) + parseFloat(ps.borderRightWidth) + parseFloat(ps.paddingLeft) + parseFloat(ps.paddingRight);
    const h = parseFloat(ps.height) + parseFloat(ps.borderTopWidth) + parseFloat(ps.borderBottomWidth) + parseFloat(ps.paddingTop) + parseFloat(ps.paddingBottom);
    if (!(w > 0 && h > 0)) return null;
    const x = er.left + parseFloat(ecs.borderLeftWidth) + (parseFloat(ps.left) || 0);
    const y = er.top + parseFloat(ecs.borderTopWidth) + (parseFloat(ps.top) || 0);
    const [ox, oy] = ps.transformOrigin.split(' ').map(parseFloat);
    const m = ps.transform === 'none' ? new DOMMatrix() : new DOMMatrix(ps.transform);
    const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([a, c]) => { const q = new DOMPoint(a - ox, c - oy).matrixTransform(m); return [x + ox + q.x, y + oy + q.y]; });
    return { part: `${el === dot ? '' : '.hint-ring'}${p}`, l: Math.min(...pts.map((q) => q[0])), r: Math.max(...pts.map((q) => q[0])), t: Math.min(...pts.map((q) => q[1])), b: Math.max(...pts.map((q) => q[1])) };
  };
  const anims = dot.getAnimations({ subtree: true });
  // Everything the hint draws: .hint-dot (its border is the stroke), any child (.hint-ring) and their pseudo-elements
  const els = [dot, ...dot.querySelectorAll('*')];
  for (const el of els.slice(1)) { const q = el.getBoundingClientRect(); if (q.width && q.height) parts.push({ part: el.className || el.tagName, l: q.left, r: q.right, t: q.top, b: q.bottom }); }
  const sample = () => { for (const el of els) for (const p of ['::before', '::after']) { const bx = pseudoBox(el, p); if (bx) parts.push(bx); } };
  if (!anims.length) sample();
  else {
    const was = anims.map((a) => a.currentTime);
    anims.forEach((a) => a.pause());
    for (let i = 0; i < 10; i++) {
      anims.forEach((a) => { const dur = Number(a.effect.getComputedTiming().duration) || 0; a.currentTime = (dur * i) / 10; });
      sample();
    }
    anims.forEach((a, i) => { a.currentTime = was[i]; a.play(); });
  }
  const seen = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (/inset\(50%\)/.test(cs.clipPath) || /rect\(0/.test(cs.clip)) return false;
    }
    return true;
  };
  const hits = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || n.parentElement.closest('.hint-dot, script, style') || !seen(n.parentElement)) continue;
    for (const m of n.textContent.matchAll(/\S+/g)) {
      const rg = document.createRange();
      rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      for (const r of rg.getClientRects()) {
        if (r.width <= 1 || r.height <= 1) continue;
        for (const d of parts) {
          const ox = Math.min(d.r, r.right) - Math.max(d.l, r.left);
          const oy = Math.min(d.b, r.bottom) - Math.max(d.t, r.top);
          if (ox > 0.5 && oy > 0.5) {
            const hit = `"${m[0]}" under the ${d.part === 'dot' ? 'dot' : `dot's ${d.part}`}`;
            if (!hits.includes(hit)) hits.push(hit);
          }
        }
      }
    }
  }
  return { hits, rect: `x ${dr.left.toFixed(1)}..${dr.right.toFixed(1)} y ${dr.top.toFixed(1)}..${dr.bottom.toFixed(1)}` };
}
for (const scheme of ['light', 'dark']) {
  for (const vp of [PHONE, LAPTOP]) {
    t(`UX-R72/R73 ${vp.width}x${vp.height} ${scheme}: on all 7 steps the dot (and its pulse ring) covers no visible word anywhere on screen`, async (browser) => {
      const page = await open(browser, { viewport: vp, colorScheme: scheme });
      const errs = [];
      await walkSteps(page, async (step, where) => {
        await settle(page);
        const m = await page.evaluate(wordsUnderDot, step);
        if (m.missing) errs.push(`${where}: ${m.missing}`);
        else if (m.hits.length) errs.push(`${where}: dot ${m.rect} covers ${m.hits.join(', ')}`);
      });
      if (errs.length) throw new Error(errs.join(' | '));
      return page;
    });
  }
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
      console.log(`FAIL   ${c.name}\n       ${e.message.split('\n').slice(0, 10).join('\n       ')}`);
    }
    for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
    lastPage = null;
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

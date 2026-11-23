// Demo hints (docs/product/SPEC-DEMO-HINTS.md): one pulsing dot on the next thing to tap, instead of
// the pitch and the "Demo: ..." explainers. Browser cases HINT-1 and HINT-3..HINT-12, by criterion ID;
// HINT-2 is static (tests/hints.test.js) and HINT-14 is a manual ux-reviewer pass.
// Hooks (spec, "Hooks"): the dot is `.hint-dot` inside the target; the target has data-hint="1".."7"
// and aria-describedby naming a visually hidden "Suggested next step"; progress is in localStorage
// `crewclock.hints`. Against a demo build on :8123:
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
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
  const at = () => ({ coords: { latitude: 38.454, longitude: -81.929, accuracy: 8 }, timestamp: Date.now() });
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
// 6 Try tampering, 7 the banner's No signal switch (any screen with the banner, once 1-6 are done).
const STEP7 = /No signal/;
async function toTamperResult(page) {
  await tamperBtn(page).click();
  await page.waitForSelector('[data-verify-line].bad', { timeout: 10000 });
  await settle(page);
}
t('HINT-3 390: one dot per screen on the path: 1 Travis K., 2 Clock in, 3 Not you?, 4 Sam W., 5 Today tab, 6 Try tampering, 7 No signal', async (browser) => {
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
  await noSignal(page).click();
  await settle(page);
  await expectNone(page, 'boss with No signal on');
  await reloadTo(page, '.boss');
  await expectNone(page, 'boss with No signal on, after a reload');
  return page;
});

// ---------- HINT-5: Reset starts the dots over ----------
t('HINT-5 Reset (confirmed) clears crewclock.hints and step 1 shows again on Travis K.', async (browser) => {
  const page = await open(browser);
  await nameBtn(page, 'Travis K.').click();
  await page.waitForSelector('.punch');
  await page.locator('.punch').click();
  await finishClockIn(page);
  const before = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!before) throw new Error(`steps 1 and 2 done, but localStorage "${KEY}" is empty`);
  await page.getByRole('button', { name: 'Reset sample data' }).click(); // the confirm is accepted
  await page.waitForSelector('.name-btn', { timeout: 15000 });
  await page.waitForLoadState('load');
  await settle(page, 400);
  const after = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (after !== null) throw new Error(`after Reset, "${KEY}" is still ${after}`);
  await expectOne(page, 'names after Reset', 1, /Travis K\./);
  return page;
});

// ---------- HINT-6: the dots alone lead a visitor through the demo ----------
t('HINT-6 390x844: tapping only dotted targets 1..7 in order (plus a job, Done and any tamper confirm) passes worker Home, done, boss and the tamper result and ends with No signal on', async (browser) => {
  const page = await open(browser, { viewport: PHONE });
  const passed = new Set();
  const trail = [];
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
      trail.push(`dot ${await target.getAttribute('data-hint')}`);
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
  if (order.join(',') !== '1,2,3,4,5,6,7') missed.push(`the dots in order 1..7 (followed ${order.join(',') || 'none'})`);
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
  return { self: part(null), before: part('::before'), after: part('::after'), box: { w: r.width, h: r.height } };
}
// A ring: a pseudo-element drawn with a border, shadow, outline or fill, or the dot's own shadow/outline
const hasRing = (m) => {
  const shown = (p) => p.content !== 'none' && p.content !== 'normal' && p.display !== 'none' && p.visibility !== 'hidden' && p.opacity > 0;
  const drawn = (p) => p.border > 0 || (p.shadow && p.shadow !== 'none') || p.outline > 0 || !/rgba\(0, 0, 0, 0\)|transparent/.test(p.bg);
  return [m.before, m.after].some((p) => shown(p) && (p.w > 0 || p.h > 0) && drawn(p))
    || (m.self.shadow && m.self.shadow !== 'none') || m.self.outline > 0;
};
t('HINT-8 under prefers-reduced-motion: reduce the dot and its ring have no animation or transition, and the ring is still drawn; without it, the ring pulses', async (browser) => {
  const errs = [];
  const still = await open(browser, { reducedMotion: 'reduce' });
  const m = await still.evaluate(motionOf);
  if (!m) throw new Error('reduce: no .hint-dot on the fresh names screen');
  for (const [k, p] of Object.entries({ dot: m.self, '::before': m.before, '::after': m.after })) {
    if (p.anim !== 'none') errs.push(`reduce: ${k} animation-name ${p.anim}`);
    if (p.dur.split(',').some((x) => parseFloat(x) > 0)) errs.push(`reduce: ${k} transition-duration ${p.dur}`);
  }
  if (m.box.w < 8 || m.box.h < 8) errs.push(`reduce: the dot is ${m.box.w}x${m.box.h}, want about 12 px`);
  if (!hasRing(m)) errs.push('reduce: no static ring drawn around the dot');
  const moving = await open(browser, { reducedMotion: 'no-preference' });
  const n = await moving.evaluate(motionOf);
  if (!n) errs.push('no-preference: no .hint-dot on the fresh names screen');
  else if ([n.self, n.before, n.after].every((p) => p.anim === 'none')) errs.push('no-preference: nothing on the dot pulses (animation-name none on the dot and both pseudo-elements)');
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

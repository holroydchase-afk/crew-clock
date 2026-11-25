// M2.0.5 intakes (docs/product/SPEC-INTAKES-2026-11-25.md): the browser halves, each case named by
// its criterion. The unit halves are in tests/intakes.test.js. Against a demo build on :8123:
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-intakes.js            (or one case: node tests/e2e-intakes.js CRW-7)
// The page clock is pinned to 2026-11-25 (local time), never today's date. Every off-origin
// request is answered empty (or refused, for the Sheets URL in CRW-14), never reaching the internet.
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const SHEETS = 'https://sheets.example.invalid/exec';
/** 2026-11-25 at h:m, local time (the browser uses the same time zone as this process). */
const AT = (h, m = 0) => new Date(2026, 10, 25, h, m, 0, 0);
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

async function open(browser, { viewport = PHONE, when = AT(21, 30), config = null, init = null, demoBar = false } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.errors = [];
  page.sheets = 0;
  page.demoBarRequests = 0;
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => {
    if (r.request().url().startsWith(SHEETS)) { page.sheets++; return r.abort('internetdisconnected'); }
    return r.fulfill({ status: 204, body: '' });
  });
  if (config) {
    await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: `window.APP_CONFIG = ${JSON.stringify(config)};` }));
  }
  if (demoBar) {
    // A stand-in for the portfolio's header script: a 52px fixed bar, and the body padded to clear it.
    await ctx.route('**/assets/demo-bar.js', (r) => { page.demoBarRequests++; r.fulfill({ contentType: 'application/javascript', body: DEMO_BAR_STUB }); });
  }
  if (init) await page.addInitScript(init.fn, init.arg);
  await page.clock.install({ time: when });
  await page.goto(BASE);
  return page;
}

const DEMO_BAR_STUB = `(function () {
  function add() {
    if (document.getElementById('demo-bar-stub')) return;
    var bar = document.createElement('div');
    bar.id = 'demo-bar-stub';
    bar.setAttribute('style', 'position:fixed;top:0;left:0;right:0;height:52px;z-index:2147483647;background:#fff;border-bottom:1px solid #ccc');
    bar.textContent = 'Portfolio header stub';
    document.body.appendChild(bar);
    document.body.style.paddingTop = '52px';
  }
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();`;

async function signIn(page, name) {
  await page.waitForSelector('.name-btn');
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector('.punch, .boss, .consent, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
}
async function bossToday(page) {
  await signIn(page, 'Sam W.');
  await page.click('[data-action="boss-tab"][data-tab="today"]');
  await page.waitForSelector('.boss-body.tab-today');
  // The team list loads after sign-in: wait for the seeded rows
  await page.waitForFunction(() => document.querySelectorAll('.boss-body .shift').length >= 4, null, { timeout: 15000 });
  await page.waitForTimeout(300);
}
// Each Today row: name, time range, chip words and chip class.
function todayRows(page) {
  return page.$$eval('.boss-body .shift', (rows) => rows.map((r) => {
    const chip = r.querySelector('.shift-right .chip');
    return {
      name: (r.querySelector('.shift-name') || {}).textContent || '',
      times: ((r.querySelector('.shift-times') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      chip: chip ? chip.textContent.replace(/\s+/g, ' ').trim() : '',
      cls: chip ? [...chip.classList].filter((c) => c.startsWith('s-')).join(' ') : '',
    };
  }));
}
const fmt = (rows) => rows.map((r) => `${r.name}: "${r.chip}" (${r.cls}) ${r.times}`).join('; ');

// ---------- EF-CK-1 ----------

t('CRW-6 boss Today at 2026-11-25 21:30: Ray T.\'s closed on-site shift (6:54 AM - 3:24 PM) reads "Was on site", never "On site"', async (browser) => {
  const page = await open(browser, { when: AT(21, 30) });
  await bossToday(page);
  const rows = await todayRows(page);
  const ray = rows.find((r) => r.name.includes('Ray T.'));
  if (!ray) throw new Error(`no Ray T. row: ${fmt(rows)}`);
  const errs = [];
  if (!/6:54\s*AM\s*–\s*3:24\s*PM/.test(ray.times)) errs.push(`Ray T.'s row is not the closed 6:54 AM - 3:24 PM shift: "${ray.times}"`);
  if (ray.chip !== 'Was on site') errs.push(`Ray T.'s chip reads "${ray.chip}", want "Was on site"`);
  const stale = rows.filter((r) => r.chip === 'On site' && !/on the clock/.test(r.times));
  if (stale.length) errs.push(`closed shifts still read "On site": ${fmt(stale)}`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// Gives the sample day a closed shift of each status: Jake R. off site, Travis K. weak GPS. Ray T.
// stays on site, Cody M. near, Billy S. no GPS, as seeded.
function mixStatuses() {
  const key = Object.keys(localStorage).find((k) => k.startsWith('cc.demo.db'));
  const db = JSON.parse(localStorage.getItem(key));
  for (const p of db.punches) if (p.crewId === 'c2') p.status = 'offsite';
  const day = new Date(Date.now()); day.setHours(0, 0, 0, 0);
  const at = (h) => day.getTime() + h * 3600000;
  const j1 = db.jobs.find((j) => j.id === 'j1');
  db.punches.push(
    { id: 'test-weak-in', crewId: 'c5', byCrewId: 'c5', jobId: 'j1', type: 'in', at: at(8), lat: j1.lat, lng: j1.lng, accuracy: 120, status: 'weak', distanceFt: 0, receivedAt: at(8) + 30000 },
    { id: 'test-weak-out', crewId: 'c5', byCrewId: 'c5', jobId: 'j1', type: 'out', at: at(12), lat: j1.lat, lng: j1.lng, accuracy: 120, status: 'weak', distanceFt: 0, receivedAt: at(12) + 30000 },
  );
  localStorage.setItem(key, JSON.stringify(db));
}

t('CRW-7 closed shifts read "Was near", "Was off site", "Weak GPS", "No GPS" with colour classes unchanged; an open shift at 10:00 still reads "On site"', async (browser) => {
  const page = await open(browser, { when: AT(21, 30) });
  await page.waitForSelector('.name-btn'); // the sample is seeded
  await page.evaluate(mixStatuses);
  await page.reload();
  await bossToday(page);
  const rows = await todayRows(page);
  const want = {
    'Ray T.': ['Was on site', 's-onsite'],
    'Cody M.': ['Was near', 's-near'],
    'Jake R.': ['Was off site', 's-offsite'],
    'Travis K.': ['Weak GPS', 's-weak'],
    'Billy S.': ['No GPS', 's-nogps'],
  };
  const errs = [];
  for (const [name, [word, cls]] of Object.entries(want)) {
    const r = rows.find((x) => x.name.includes(name));
    if (!r) { errs.push(`no ${name} row`); continue; }
    if (r.chip !== word) errs.push(`${name} reads "${r.chip}", want "${word}"`);
    if (r.cls !== cls) errs.push(`${name} chip class ${r.cls}, want ${cls}`);
  }
  await page.context().close();

  // An open shift at 10:00 keeps the present tense
  const morning = await open(browser, { when: AT(10) });
  await bossToday(morning);
  const open10 = await todayRows(morning);
  const ray = open10.find((x) => x.name.includes('Ray T.'));
  const cody = open10.find((x) => x.name.includes('Cody M.'));
  if (!ray || !/on the clock/.test(ray.times)) errs.push(`10:00: Ray T. is not on the clock: ${fmt(open10)}`);
  else if (ray.chip !== 'On site' || ray.cls !== 's-onsite') errs.push(`10:00: Ray T.'s open shift reads "${ray.chip}" (${ray.cls}), want "On site" (s-onsite)`);
  if (cody && /on the clock/.test(cody.times) && (cody.chip !== 'Near' || cody.cls !== 's-near')) errs.push(`10:00: Cody M.'s open shift reads "${cody.chip}" (${cody.cls}), want "Near"`);
  if (morning.errors.length) errs.push('page errors at 10:00: ' + morning.errors.join('; '));
  if (errs.length) throw new Error(errs.join('; '));
  return null;
});

t('CRW-8 seeded at 14:00, reopened at 21:30: no row says "on the clock", Ray T. / Jake R. / Cody M. end 3:24 / 3:30 / 3:12 PM, the list header says "Not in"', async (browser) => {
  const page = await open(browser, { when: AT(14) });
  await page.waitForSelector('.name-btn'); // seeded at 14:00, c1-c3 on the clock
  const seeded = await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('cc.demo.db')));
  if (!seeded) throw new Error('the demo did not seed at 14:00');
  await page.clock.setSystemTime(AT(21, 30));
  await page.reload();
  await bossToday(page);
  await page.reload(); // load twice
  await page.click('[data-action="boss-tab"][data-tab="today"]').catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.boss-body .shift').length >= 4, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const rows = await todayRows(page);
  const errs = [];
  const onClock = rows.filter((r) => /on the clock/.test(r.times));
  if (onClock.length) errs.push(`rows still "on the clock" at 21:30: ${fmt(onClock)}`);
  for (const [name, end] of [['Ray T.', '3:24'], ['Jake R.', '3:30'], ['Cody M.', '3:12']]) {
    const r = rows.find((x) => x.name.includes(name));
    if (!r) errs.push(`no ${name} row`);
    else if (!new RegExp(`–\\s*${end}\\s*PM`).test(r.times)) errs.push(`${name} reads "${r.times}", want it to end ${end} PM`);
    if (r && /clocked out twice/.test(r.times)) errs.push(`${name} clocked out twice`);
  }
  const header = await page.$eval('.not-in-title', (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  if (!/^Not in \(\d+\)$/.test(header)) errs.push(`list header "${header}", want "Not in (n)"`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- EF-CK-11 ----------

// Jake R. signed in on this phone before: the crew app keeps his session, his jobs and his consent.
function signedInJake() {
  const day = 86400000;
  const set = (k, v) => localStorage.setItem('cc.' + k, JSON.stringify(v));
  const at = () => /** @type {GeolocationPosition} */ ({ coords: { latitude: 38.8001, longitude: -98.2001, accuracy: 8 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok(at()), 0);
  if (localStorage.getItem('cc.me')) return; // only once: a reload keeps what the app saved
  set('auth', { crewId: 'c2', pin: '' });
  set('me', { id: 'c2', name: 'Jake R.', role: 'crew', active: true });
  set('jobs', [{ id: 'j1', name: 'Sample job', address: 'Fernhollow (sample town)', lat: 38.8, lng: -98.2, radiusFt: 300, active: true }]);
  set('crew', [{ id: 'c2', name: 'Jake R.', role: 'crew', active: true }]);
  set('consents', { c2: { id: 'k-test', action: 'agree', textVersion: 'loc-v1', at: Date.now() - 20 * day } });
  set('locPrimed', true);
}

t('CRW-14 crew build with backend "supabase", no supabaseUrl and a Sheets backendUrl: Clock in saves to the outbox (pending 1), shows the done step, and never calls the Sheets URL', async (browser) => {
  const page = await open(browser, {
    when: AT(7),
    config: { backend: 'supabase', supabaseUrl: '', supabaseAnonKey: '', orgCode: '', backendUrl: SHEETS, sheetUrl: '', demoPin: false, gpsTimeoutMs: 1500, onPhoneAi: false },
    init: { fn: signedInJake },
  });
  await page.waitForSelector('.punch.in', { timeout: 15000 });
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn, .big-check', { timeout: 10000 });
  if (await page.locator('.job-btn').count()) await page.locator('.job-btn').first().click();
  // A photo fallback is fine too (never blocked): give it a picture
  const done = await page.waitForSelector('.big-check, input[data-action="photo-file"]', { state: 'attached', timeout: 15000 });
  if (await done.evaluate((e) => e.matches('input'))) {
    await page.setInputFiles('input[data-action="photo-file"]', require('path').join(__dirname, 'fixtures/site.jpg'));
    await page.waitForSelector('.big-check', { timeout: 15000 });
  }
  await page.waitForFunction(() => self.CrewClock && self.CrewClock.state.pending === 1, null, { timeout: 5000 }).catch(() => {});
  const pending = await page.evaluate(() => self.CrewClock && self.CrewClock.state.pending);
  const isDemo = await page.evaluate(() => self.Api && self.Api.isDemo);
  const errs = [];
  if (pending !== 1) errs.push(`outbox pending ${pending}, want 1`);
  if (isDemo !== false) errs.push(`Api.isDemo is ${isDemo}, want false`);
  if (page.sheets) errs.push(`the app called the Sheets backendUrl ${page.sheets} time(s)`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- #57 portfolio header ----------

for (const vp of [PHONE, LAPTOP]) {
  t(`CRW-16 ${vp.width}x${vp.height}: with the 52px portfolio header, no sideways scroll, Clock in on screen, the boss tab bar clear of the header, 0 page errors`, async (browser) => {
    const page = await open(browser, { viewport: vp, when: AT(10), demoBar: true });
    await page.waitForSelector('.name-btn');
    const errs = [];
    if (!page.demoBarRequests) {
      errs.push('the demo build never loaded /assets/demo-bar.js (no tag in index.html)');
      await page.addScriptTag({ content: DEMO_BAR_STUB }); // still measure the layout with the header in place
    }
    await page.waitForSelector('#demo-bar-stub', { state: 'attached', timeout: 5000 });

    // Crew Home: Travis K. is never on the clock when the demo opens
    await signIn(page, 'Travis K.');
    await page.waitForSelector('.punch.in');
    await page.waitForTimeout(300);
    const home = await page.evaluate(() => {
      const b = document.querySelector('.punch.in').getBoundingClientRect();
      const se = document.scrollingElement || document.documentElement;
      return { scrollW: se.scrollWidth, scrollH: se.scrollHeight, innerW: innerWidth, innerH: innerHeight, btnTop: b.top, btnBottom: b.bottom };
    });
    if (home.scrollW > vp.width) errs.push(`Home scrollWidth ${home.scrollW} > ${vp.width}`);
    if (home.btnBottom > vp.height) errs.push(`Clock in bottom at ${Math.round(home.btnBottom)} > ${vp.height}`);
    if (home.btnTop < 52) errs.push(`Clock in top at ${Math.round(home.btnTop)} is under the 52px header`);
    // Spec height budget: at 390x844 crew Home is at most 1 screen tall. Note: without the header the
    // demo Home is already 923px at 390x844 (demo banner above a 100vh screen), see QA-R in the run log.
    if (vp === PHONE && home.scrollH > home.innerH) errs.push(`Home is ${home.scrollH}px tall at ${vp.height}, over 1 screen (height budget)`);

    // Boss Today
    const notYou = page.getByRole('button', { name: 'Not you?' });
    if (await notYou.count()) await notYou.click(); else await page.click('[data-action="sign-out"]');
    await bossToday(page);
    const boss = await page.evaluate(() => {
      const bar = document.getElementById('demo-bar-stub').getBoundingClientRect();
      const tabs = document.querySelector('.tabbar').getBoundingClientRect();
      const row = document.querySelector('.boss-body .shift');
      const r = row ? row.getBoundingClientRect() : null;
      const se = document.scrollingElement || document.documentElement;
      return { barBottom: bar.bottom, tabsTop: tabs.top, tabsBottom: tabs.bottom, row: r && { top: r.top, bottom: r.bottom }, scrollW: se.scrollWidth };
    });
    if (boss.scrollW > vp.width) errs.push(`boss Today scrollWidth ${boss.scrollW} > ${vp.width}`);
    if (boss.tabsTop < boss.barBottom && boss.tabsBottom > 0) errs.push(`boss tab bar (top ${Math.round(boss.tabsTop)}) is under the header (bottom ${Math.round(boss.barBottom)})`);
    if (boss.tabsBottom > vp.height) errs.push(`boss tab bar bottom ${Math.round(boss.tabsBottom)} is below the screen`);
    // Height budget (phone): the tab bar sits at the bottom there, so the first whole row shows above it.
    // On a laptop the tab bar sits at the top, under the header: only the overlap check above applies.
    if (!boss.row) errs.push('boss Today has no shift row');
    else if (vp === PHONE && (boss.row.top < boss.barBottom || boss.row.bottom > boss.tabsTop)) errs.push(`first shift row (${Math.round(boss.row.top)}-${Math.round(boss.row.bottom)}) is not whole between the header (${Math.round(boss.barBottom)}) and the tab bar (${Math.round(boss.tabsTop)})`);
    if (errs.length) throw new Error(errs.join('; '));
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
      console.log(`FAIL   ${c.name}\n       ${e.message.split('\n').slice(0, 10).join('\n       ')}`);
    }
    for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

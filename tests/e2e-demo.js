// M1.1 demo separation: browser cases for SEP-2..SEP-5, against a demo build on :8123.
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-demo.js            (or one case: node tests/e2e-demo.js SEP-3)
// Every off-origin request is answered in the test (never reaches the internet) and logged.
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
// The one allowed exception: the boss map's tiles (streets and satellite).
const TILE_HOSTS = ['tile.openstreetmap.org', 'basemap.nationalmap.gov'];
const PORTFOLIO = /^https:\/\/chaseholroyd\.com(\/|$)/;
const J1 = { lat: 38.4537, lng: -81.9290, acc: 8 };
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

function gpsAt(pos) {
  const at = () => ({ coords: { latitude: pos.lat, longitude: pos.lng, accuracy: pos.acc }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok(at()), 0);
}

// What a phone that once ran the crew app (or a crew link) leaves behind. Made-up values only.
function staleCrewSession() {
  if (sessionStorage.getItem('stale-done')) return; // only before the first load
  sessionStorage.setItem('stale-done', '1');
  const uuid = '00000000-0000-4000-8000-00000000dead';
  localStorage.setItem('cc.sbSession', JSON.stringify({ accessToken: 'stale.at.sig', refreshToken: 'rt-stale', expiresAt: Date.now() - 1000,
    crewId: uuid, me: { id: uuid, name: 'Stale Worker', role: 'crew' }, deviceId: 'dev-stale' }));
  localStorage.setItem('cc.orgCode', JSON.stringify('ANY'));
  localStorage.setItem('cc.auth', JSON.stringify({ crewId: uuid }));
  localStorage.setItem('cc.me', JSON.stringify({ id: uuid, name: 'Stale Worker', role: 'crew' }));
  localStorage.setItem('cc.jobs', JSON.stringify([{ id: 'x1', name: 'Stale Job', lat: 38.1, lng: -81.1, radiusFt: 300, active: true }]));
  localStorage.setItem('cc.locPrimed', 'true');
}

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.offOrigin = [];
  // Context level, so the service worker's own fetches are logged too.
  ctx.on('request', (q) => { const u = new URL(q.url()); if (u.origin !== ORIGIN && u.protocol.startsWith('http')) page.offOrigin.push(q.url()); });
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsAt, J1);
  if (opts.stale) await page.addInitScript(staleCrewSession);
  await page.goto(BASE + (opts.query || ''));
  return { ctx, page };
}

async function signIn(page, name) {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector('.punch, .boss, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
}
async function signOut(page, label) {
  await page.getByRole('button', { name: label }).click();
  await page.waitForSelector('.name-btn');
}

const BOSS_TABS = ['map', 'today', 'jobs', 'crew', 'chat'];
async function bossTab(page, tab) {
  await page.click(`[data-action="boss-tab"][data-tab="${tab}"]`);
  await page.waitForSelector(`.boss-body.tab-${tab}`);
}

// Walks every demo screen and calls check(page, screenName) on each.
async function everyScreen(page, check) {
  await page.waitForSelector('.name-btn');
  await check(page, 'sign-in');
  await signIn(page, 'Travis K.'); // starts off the clock in the seed
  await check(page, 'crew home');
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn');
  await check(page, 'punch (pick a job)');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('.big-check');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForSelector('.punch.out');
  await signOut(page, 'Not you?');
  await signIn(page, 'Sam W.');
  await page.waitForSelector('.boss');
  for (const tab of BOSS_TABS) {
    await bossTab(page, tab);
    await check(page, `boss ${tab} tab`);
  }
}

function assertNoOffOrigin(page) {
  const bad = page.offOrigin.filter((u) => !TILE_HOSTS.some((h) => new URL(u).hostname === h || new URL(u).hostname.endsWith('.' + h)));
  if (bad.length) throw new Error(`${bad.length} off-origin request(s): ${[...new Set(bad)].slice(0, 5).join(' , ')}`);
}

async function assertDemoMode(page) {
  const demo = await page.evaluate(() => !!(self.Api && self.Api.isDemo) && !self.Api.signOut);
  if (!demo) throw new Error('the app left demo mode (Api is not the demo backend)');
}

// The boss adds a job by address (the demo's address search), then backs out.
async function addressSearch(page) {
  await bossTab(page, 'jobs');
  await page.click('[data-action="job-new"]');
  await page.fill('#job-address', 'Main St, Hurricane WV');
  await page.click('[data-action="geo-search"]');
  await page.waitForTimeout(600);
  await page.click('[data-action="boss-back"]');
}

t('SEP-2 demo opened with ?org=ANY stays in demo mode; sign-in, clock-in, boss tabs and address search make no off-origin request except map tiles', async (browser) => {
  const { page } = await open(browser, { query: '?org=ANY' });
  await assertDemoMode(page);
  await everyScreen(page, async () => {});
  await addressSearch(page);
  await assertDemoMode(page);
  assertNoOffOrigin(page);
  return page;
});

t('SEP-2 demo opened with a stale crew-app session in storage stays in demo mode, shows the sample crew, and makes no off-origin request except map tiles', async (browser) => {
  const { page } = await open(browser, { stale: true, query: '?org=ANY' });
  await page.waitForSelector('.name-btn, .punch, .boss');
  await assertDemoMode(page);
  const body = await page.locator('body').innerText();
  if (body.includes('Stale Worker')) throw new Error('the demo shows the stale crew-app worker "Stale Worker" instead of the sample sign-in');
  if (!(await page.locator('.name-btn').count())) throw new Error('the demo did not open on the sample sign-in screen');
  await everyScreen(page, async () => {});
  await addressSearch(page);
  await assertDemoMode(page);
  assertNoOffOrigin(page);
  return page;
});

t('SEP-3 every demo screen shows a visible "Sample data" label that says data stays in this browser', async (browser) => {
  const { page } = await open(browser);
  const missing = [];
  await everyScreen(page, async (p, where) => {
    const label = p.getByText(/Sample data/i).filter({ visible: true });
    if (!(await label.count())) return missing.push(`${where}: no visible "Sample data" label`);
    const text = (await label.first().innerText()) + ' ' + (await label.first().evaluate((e) => (e.closest('.demo-banner, [role="note"], [role="status"], header, div') || e).innerText));
    if (!/this browser/i.test(text)) missing.push(`${where}: label does not say data stays in this browser ("${text.trim().slice(0, 80)}")`);
  });
  if (missing.length) throw new Error(missing.join(' | '));
  return page;
});

t('SEP-4 every demo screen has a visible link to https://chaseholroyd.com', async (browser) => {
  const { page } = await open(browser);
  const missing = [];
  await everyScreen(page, async (p, where) => {
    const hrefs = await p.locator('a[href]').filter({ visible: true }).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    if (!hrefs.some((h) => PORTFOLIO.test(h))) missing.push(where);
  });
  if (missing.length) throw new Error(`no visible chaseholroyd.com link on: ${missing.join(', ')}`);
  return page;
});

// ---------- SEP-5: the crew app (backend: 'supabase') against a fake Supabase ----------
const SB = 'https://fake.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (id, role) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({ org_id: 'org-1', crew_id: id, crew_role: role })}.sig`;
const CREW = [
  { id: '00000000-0000-4000-8000-0000000000b1', name: 'Test Worker', role: 'crew' },
  { id: '00000000-0000-4000-8000-0000000000b0', name: 'Test Boss', role: 'boss' },
];
const JOB = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Test job', address: 'Test Rd', lat: 38.45, lng: -81.93, radius_ft: 300, active: true };

async function openCrewApp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(gpsAt, J1);
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
  // Playwright tries the last route first, so the catch-all goes before the specific ones.
  await ctx.route(`${SB}/rest/v1/**`, (r) => (r.request().method() === 'GET' ? json(r, []) : r.fulfill({ status: 201, body: '' })));
  await ctx.route(`${SB}/rest/v1/jobs*`, (r) => json(r, [JOB]));
  await ctx.route(`${SB}/rest/v1/crew*`, (r) => json(r, CREW));
  await ctx.route(`${SB}/rest/v1/punches*`, (r) => json(r, []));
  await ctx.route(`${SB}/functions/v1/sync`, (r) => json(r, { ok: true, accepted: (r.request().postDataJSON().items || []).map((i) => i.id), rejected: [] }));
  await page.goto(BASE);
  return { ctx, page };
}

async function noDemoBits(page, where, found) {
  const checks = [
    ['demo banner', page.locator('.demo-banner')],
    ['"Sample data" label', page.getByText(/Sample data/i)],
    ['chaseholroyd.com link', page.locator('a[href*="chaseholroyd.com"]')],
    ['"pretend I\'m at the job" control', page.getByText(/pretend I'?m at the job/i)],
    ['demo PIN hint', page.getByText(/Demo: tap anyone|Demo mode/i)],
  ];
  for (const [what, loc] of checks) if (await loc.count()) found.push(`${where}: ${what}`);
}

async function pinIn(page, name, pin, onPinScreen) {
  await page.getByText(name, { exact: true }).click();
  await page.waitForSelector('.keypad');
  if (onPinScreen) await onPinScreen();
  for (const k of pin) await page.click(`.keypad [data-k="${k}"]`);
}

t('SEP-5 the crew app (backend: supabase) shows no demo banner, sample-data label, portfolio link, demo hints or "pretend I\'m at the job"', async (browser) => {
  const found = [];
  const { ctx, page } = await openCrewApp(browser);
  await page.waitForSelector('.name-btn');
  if (await page.evaluate(() => !!(self.Api && self.Api.isDemo))) throw new Error('setup: the supabase build came up in demo mode');
  await noDemoBits(page, 'sign-in', found);
  await pinIn(page, 'Test Worker', '1111', () => noDemoBits(page, 'PIN', found));
  await page.waitForSelector('.punch, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) await page.click('[data-action="prime-location"]');
  await page.waitForSelector('.punch');
  await noDemoBits(page, 'crew home', found);
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn');
  await noDemoBits(page, 'punch (pick a job)', found);
  await ctx.close();

  const boss = await openCrewApp(browser);
  await boss.page.waitForSelector('.name-btn');
  await pinIn(boss.page, 'Test Boss', '1234');
  await boss.page.waitForSelector('.boss');
  for (const tab of BOSS_TABS) {
    await bossTab(boss.page, tab);
    await noDemoBits(boss.page, `boss ${tab} tab`, found);
  }
  if (found.length) throw new Error(found.join(' | '));
  page.errors.push(...boss.page.errors);
  return page;
});

(async () => {
  const only = process.argv[2];
  const browser = await launch();
  let failed = 0;
  for (const c of cases.filter((x) => !only || x.name.startsWith(only))) {
    let page;
    try {
      page = await c.fn(browser);
      const errs = page && page.errors.length ? page.errors : null;
      if (errs) throw new Error('page errors: ' + errs.join('; '));
      console.log(`ok     ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL   ${c.name}\n       ${e.message.split('\n')[0]}`);
      if (process.env.DEBUG) console.log(e.stack);
    }
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

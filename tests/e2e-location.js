// M1.3 location read only at the tap: browser cases for PRIVACY L1 and L2, against a demo build on :8123.
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-location.js            (or one case: node tests/e2e-location.js LOC-2)
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

// Counts every location read and every watch still running. With answer: false the GPS never
// answers, so a watch stays open until the app clears it.
function gpsSpy(opts) {
  window.__gps = { reads: 0, active: new Set(), next: 1 };
  const at = () => ({ coords: { latitude: 38.454, longitude: -81.929, accuracy: 8 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => {
    const id = window.__gps.next++;
    window.__gps.reads++;
    window.__gps.active.add(id);
    if (opts.answer) setTimeout(() => ok(at()), 0);
    return id;
  };
  navigator.geolocation.clearWatch = (id) => window.__gps.active.delete(id);
  navigator.geolocation.getCurrentPosition = (ok, err) => {
    window.__gps.reads++;
    setTimeout(() => (opts.answer ? ok(at()) : err && err({ code: 3, message: 'timeout' })), 0);
  };
}
const reads = (page) => page.evaluate(() => window.__gps.reads);
const watching = (page) => page.evaluate(() => window.__gps.active.size);

let lastPage = null;
async function open(browser, answer = true, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsSpy, { answer });
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  return page;
}
async function signIn(page, name) {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector('.punch, .boss, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
}
// Taps CLOCK IN or CLOCK OUT (whichever Home shows) and picks the first job if asked.
async function tapPunch(page) {
  await page.click('.punch');
  await page.waitForSelector('.job-btn, #skip-gps, .big-check, [data-action="photo-file"]', { state: 'attached' });
  if (await page.locator('.job-btn').count()) await page.locator('.job-btn').first().click();
}
async function noReadsDuring(page, what, fn) {
  const before = await reads(page);
  await fn();
  await page.waitForTimeout(300);
  const n = (await reads(page)) - before;
  if (n) throw new Error(`${what} read location ${n} time(s)`);
}

t('LOC-1 no location read on Home, the teammate list or the crew view; only Clock in reads, and nothing is left watching after', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Ray T.');
  await noReadsDuring(page, 'Home and the teammate list', async () => {
    await page.waitForTimeout(500);
    await page.click('[data-action="teammate"]');
    await page.waitForSelector('[data-action="mate-punch"]');
    await page.click('[data-action="go-home"]');
    await page.waitForSelector('.punch');
  });
  const before = await reads(page);
  await tapPunch(page);
  await page.waitForSelector('.big-check, [data-action="photo-file"]', { state: 'attached' });
  if ((await reads(page)) === before) throw new Error('Clock in did not read location');
  if (await watching(page)) throw new Error('a GPS watch is still running after the punch');
  await noReadsDuring(page, 'the screens after the punch', async () => { await page.waitForTimeout(1500); });
  return page;
});

t('LOC-1 the boss screens read no location: every tab, the job form and the crew form', async (browser) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const page = await open(browser, true, viewport);
    await signIn(page, 'Sam W.');
    await noReadsDuring(page, `the boss screens at ${viewport.width} wide`, async () => {
      for (const tab of await page.locator('[data-action="boss-tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab))) {
        await page.click(`[data-action="boss-tab"][data-tab="${tab}"]`);
        await page.waitForTimeout(250);
      }
      await page.click('[data-action="boss-tab"][data-tab="jobs"]');
      await page.click('[data-action="job-new"]');
      await page.waitForSelector('[data-action="job-save"]');
      await page.click('[data-action="boss-back"]');
      await page.click('[data-action="boss-tab"][data-tab="crew"]');
      await page.click('[data-action="crew-new"]');
      await page.waitForSelector('[data-action="crew-save"]');
      await page.click('[data-action="boss-back"]');
      await page.waitForSelector('.boss');
    });
    if (page.errors.length) return page;
  }
  return lastPage;
});

t('LOC-2 backing out of "Finding you" stops the GPS watch at once', async (browser) => {
  const page = await open(browser, false);
  await signIn(page, 'Ray T.');
  await tapPunch(page);
  await page.waitForSelector('#skip-gps', { state: 'attached' });
  if (!(await watching(page))) throw new Error('no GPS watch while finding you');
  await page.click('[data-action="go-home"]');
  await page.waitForSelector('.punch');
  const n = await watching(page);
  if (n) throw new Error(`${n} GPS watch(es) still running after Back`);
  return page;
});

t('LOC-2 "Take a picture instead" stops the GPS watch at once', async (browser) => {
  const page = await open(browser, false);
  await signIn(page, 'Ray T.');
  await tapPunch(page);
  await page.waitForSelector('#skip-gps:not([hidden])', { timeout: 12000 });
  await page.click('#skip-gps');
  await page.waitForSelector('[data-action="photo-file"]', { state: 'attached' });
  const n = await watching(page);
  if (n) throw new Error(`${n} GPS watch(es) still running after "Take a picture instead"`);
  return page;
});

t('LOC-2 the app going to the background while finding you stops the GPS watch, and the worker can still clock in with a picture', async (browser) => {
  const page = await open(browser, false);
  await signIn(page, 'Ray T.');
  await tapPunch(page);
  await page.waitForSelector('#skip-gps', { state: 'attached' });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const n = await watching(page);
  if (n) throw new Error(`${n} GPS watch(es) still running after the app went to the background`);
  await page.waitForSelector('[data-action="photo-file"]', { state: 'attached' });
  return page;
});

t('LOC-2 the boss leaving the job form while "Use where I\'m standing" is finding them stops the watch', async (browser) => {
  const page = await open(browser, false);
  await signIn(page, 'Sam W.');
  await page.click('[data-action="boss-tab"][data-tab="jobs"]');
  await page.click('[data-action="job-new"]');
  await page.click('[data-action="job-mode"][data-mode="here"]');
  await page.click('[data-action="job-here"]');
  if (!(await watching(page))) throw new Error('no GPS watch after "Use where I\'m standing"');
  await page.click('[data-action="boss-back"]');
  await page.waitForSelector('.boss');
  const n = await watching(page);
  if (n) throw new Error(`${n} GPS watch(es) still running after leaving the job form`);
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
      console.log(`FAIL   ${c.name}\n       ${e.message.split('\n').slice(0, 8).join('\n       ')}`);
      if (lastPage) {
        const h = await lastPage.locator('#app h1').first().innerText().catch(() => '?');
        console.log(`       screen: "${h.slice(0, 60)}"`);
      }
    }
    for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
    lastPage = null;
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

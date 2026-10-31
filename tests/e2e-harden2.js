// M1.12 Harden: browser cases named by finding ID (HRD-14 forms, HRD-13 private mode, PS-M111-1 PIN toast).
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   BASE_URL=http://localhost:8123/ node tests/e2e-harden2.js     (or one case: ... e2e-harden2.js HRD-13)
// Every off-origin request (map tiles) is answered empty in the test, never reaching the internet.
// Every name typed here is made up.
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const PHONE = { width: 390, height: 844 };
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

function gpsAtJob() {
  const at = () => ({ coords: { latitude: 38.454, longitude: -81.929, accuracy: 8 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok(at()), 0);
}

// Private browsing on some phones: storage exists but every write throws.
function privateMode() {
  const fail = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
  Storage.prototype.setItem = fail;
  try { indexedDB.open = () => { throw new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError'); }; } catch (e) { /* no IndexedDB */ }
}

async function open(browser, { init = [] } = {}) {
  const ctx = await browser.newContext({ viewport: PHONE, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsAtJob);
  for (const f of init) await page.addInitScript(f);
  const when = new Date(); when.setHours(13, 30, 0, 0);
  await page.clock.install({ time: when });
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  return page;
}

async function signIn(page, name) {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector('.punch, .boss, .consent, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
}
async function boss(page, tab) {
  await signIn(page, 'Sam W.');
  await page.waitForFunction(() => document.querySelector('.boss'));
  await page.click(`[data-action="boss-tab"][data-tab="${tab}"]`);
  await page.waitForSelector(`.boss-body.tab-${tab}`);
}
const maxlen = (page, sel) => page.$eval(sel, (el) => el.maxLength);

// ---------- HRD-14: forms cap length and drop control characters ----------

t('HRD-14 Add job: the name field takes at most 60 characters and the address at most 200', async (browser) => {
  const page = await open(browser);
  await boss(page, 'jobs');
  await page.click('[data-action="job-new"]');
  await page.waitForSelector('#job-name');
  const errs = [];
  if (await maxlen(page, '#job-name') !== 60) errs.push(`#job-name maxlength is ${await maxlen(page, '#job-name')}`);
  if (await maxlen(page, '#job-address') !== 200) errs.push(`#job-address maxlength is ${await maxlen(page, '#job-address')}`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

t('HRD-14 Add person: the name field takes at most 60 characters, and control characters are dropped on save', async (browser) => {
  const page = await open(browser);
  await boss(page, 'crew');
  await page.click('[data-action="crew-new"]');
  await page.waitForSelector('#crew-name');
  const errs = [];
  const n = await maxlen(page, '#crew-name');
  if (n !== 60) errs.push(`#crew-name maxlength is ${n}`);
  await page.$eval('#crew-name', (el) => { el.value = '‮Test\u0007 Person\u001b[2J'; });
  await page.fill('#crew-pin', '4826');
  await page.click('[data-action="crew-save"]');
  await page.waitForSelector('.boss');
  // Wait for the outbox to reach the demo store, then read what was kept, there and on screen.
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) {
    await page.clock.fastForward(500);
    await page.waitForTimeout(100);
    saved = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('cc.demo.db'));
      const db = key && JSON.parse(localStorage.getItem(key));
      const c = db && db.crew.find((x) => /Test/.test(x.name) && /Person/.test(x.name));
      return c ? c.name : null;
    });
  }
  if (!saved) errs.push('the new person never reached the demo store');
  // eslint-disable-next-line no-control-regex
  else if (/[\u0000-\u001f\u007f‪-‮]/.test(saved)) errs.push(`stored name keeps control characters: ${JSON.stringify(saved)}`);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.job-name')].map((e) => e.textContent).find((x) => /Person/.test(x)) || '');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f‪-‮]/.test(shown)) errs.push(`crew list shows control characters: ${JSON.stringify(shown)}`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- HRD-13: private mode (storage writes throw) gets a plain warning ----------

t('HRD-13 private mode: when storage writes throw, the app says to keep the tab open until it says Sent', async (browser) => {
  const page = await open(browser, { init: [privateMode] });
  await page.waitForTimeout(500);
  const warn = page.getByText(/private mode/i).first();
  if (!(await warn.count()) || !(await warn.isVisible())) {
    const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`no visible "Private mode" warning on the sign-in screen; it shows: "${body}"`);
  }
  const text = await warn.evaluate((el) => el.closest('[role="status"], [role="alert"], .banner, div').innerText);
  if (!/keep this tab open/i.test(text) || !/sent/i.test(text)) throw new Error(`warning does not say to keep the tab open until it says Sent: "${text}"`);
  // It stays after sign-in, where punches are made.
  await signIn(page, 'Jake R.');
  if (!(await page.getByText(/private mode/i).first().isVisible().catch(() => false))) throw new Error('the warning is gone on the clock-in screen');
  page.errors = page.errors.filter((e) => !/quota has been exceeded|did not allow mutations/i.test(e));
  return page;
});

t('HRD-13 (guard) a normal browser shows no private-mode warning', async (browser) => {
  const page = await open(browser);
  await page.waitForTimeout(300);
  if (await page.getByText(/private mode/i).count()) throw new Error('private-mode warning shown with working storage');
  return page;
});

// ---------- PS-M111-1: the new PIN does not stay in the page ----------

t('PS-M111-1 after Add person, the toast showing the new PIN leaves the page within 4 s', async (browser) => {
  const page = await open(browser);
  await boss(page, 'crew');
  await page.click('[data-action="crew-new"]');
  await page.waitForSelector('#crew-name');
  await page.fill('#crew-name', 'Test Person');
  await page.fill('#crew-pin', '4826');
  await page.click('[data-action="crew-save"]');
  await page.waitForSelector('.boss');
  const first = await page.$eval('#toast', (el) => el.textContent).catch(() => '');
  if (!first.includes('4826')) throw new Error(`the toast never showed the new PIN (it says "${first}"), so this case proves nothing`);
  await page.clock.fastForward(4000);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.body.innerHTML.includes('4826'));
  const toast = await page.$eval('#toast', (el) => el.textContent).catch(() => '');
  if (after) throw new Error(`4 s later the PIN is still in the page (#toast: "${toast}")`);
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
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

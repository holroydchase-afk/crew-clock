// M1.10 "works for real": the tab bar clear of Safari 26's floating toolbar, and empty states that say what to do.
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-works.js            (or one case: node tests/e2e-works.js IOS-TABBAR)
// Every off-origin request is answered in the test (never reaches the internet).
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

let lastPage = null;
async function open(browser, ctxOpts = {}, init) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }, ctxOpts));
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(() => { try { localStorage.setItem('cc.demoFake', 'true'); } catch (e) { /* ok */ } });
  if (init) await page.addInitScript(init);
  await page.goto(BASE);
  return { ctx, page };
}

async function signIn(page, name) {
  await page.waitForSelector('.name-btn');
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector('.punch, .boss, .consent, [data-action="prime-location"]');
  // Billy S. never agreed to location in the sample data: "Not now" takes him Home (picture clock-ins).
  if (await page.locator('.consent').count()) {
    await page.click('[data-action="consent-later"]');
    await page.waitForSelector('.punch');
  }
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
}
async function bossTab(page, tab) {
  await page.click(`[data-action="boss-tab"][data-tab="${tab}"]`);
  await page.waitForSelector(`.boss-body.tab-${tab}`);
}

// Gap between the lowest tab label and the bottom of the viewport, in CSS px.
async function tabLabelGap(page) {
  await signIn(page, 'Sam W.');
  await page.waitForSelector('.tabbar button span');
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const bottom = Math.max(...[...document.querySelectorAll('.tabbar button span')].map((s) => s.getBoundingClientRect().bottom));
    return Math.round(window.innerHeight - bottom);
  });
}

// ---------- M1.10-c IOS-TABBAR ----------

t('IOS-TABBAR-1 iPhone Safari 26 (in the browser, not installed): the boss tab labels sit 24px+ above the bottom, clear of the floating toolbar', async (browser) => {
  const { page } = await open(browser, { userAgent: IPHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const gap = await tabLabelGap(page);
  if (gap < 24) throw new Error(`tab labels end ${gap}px above the viewport bottom on iPhone Safari; want 24px+ (Safari 26's toolbar covers them)`);
  return page;
});

t('IOS-TABBAR-2 (guard) desktop Chrome: the boss tab bar keeps its current size (labels within 24px of the bottom)', async (browser) => {
  const { page } = await open(browser, { userAgent: DESKTOP_UA });
  const gap = await tabLabelGap(page);
  if (gap >= 24) throw new Error(`tab labels end ${gap}px above the bottom on desktop Chrome; the extra iOS padding leaked`);
  return page;
});

t('IOS-TABBAR-3 (guard) iPhone, installed to the Home Screen (standalone): no extra toolbar padding', async (browser) => {
  const { page } = await open(browser, { userAgent: IPHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
    () => { Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true }); });
  const gap = await tabLabelGap(page);
  if (gap >= 24) throw new Error(`tab labels end ${gap}px above the bottom in the installed app; Safari's toolbar isn't there, so no extra padding`);
  return page;
});

// ---------- M1.10-d EMPTY STATES (HRD-12 / UX-12) ----------

// Empties the demo's sample data after it is seeded: every job archived and no punches. Then reloads.
async function emptyDemo(page) {
  await page.waitForSelector('.name-btn');
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('cc.demo.db'));
    const db = JSON.parse(localStorage.getItem(key));
    db.jobs.forEach((j) => { j.active = false; });
    db.punches = [];
    localStorage.setItem(key, JSON.stringify(db));
    ['cc.jobs', 'cc.team', 'cc.last'].forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
}
const text = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();

t('EMPTY-1 boss with no active jobs: the Jobs tab shows an empty state with its own "Add job" button, not a bare line', async (browser) => {
  const { page } = await open(browser);
  await emptyDemo(page);
  await signIn(page, 'Sam W.');
  await bossTab(page, 'jobs');
  const body = await text(page, '.boss-body.tab-jobs');
  if (/Smith kitchen|Miller roof/.test(body)) throw new Error('archived jobs still listed; the test could not empty the demo');
  const cta = page.locator('.boss-body.tab-jobs .list').getByRole('button', { name: /add.*job/i });
  if (!(await cta.count())) throw new Error(`no "Add job" button in the empty Jobs list; it says: "${await text(page, '.boss-body.tab-jobs .list')}"`);
  return page;
});

t('EMPTY-2 boss with no punches at all: Today says plainly that no one has clocked in today (not a "sample day" heading over an empty list)', async (browser) => {
  const { page } = await open(browser);
  await emptyDemo(page);
  await signIn(page, 'Sam W.');
  await bossTab(page, 'today');
  const body = await text(page, '.boss-body.tab-today');
  if (!/(no one|nobody)[^.]*clock/i.test(body)) throw new Error(`Today doesn't say no one has clocked in: "${body.slice(0, 160)}"`);
  const h = await text(page, '.boss-body.tab-today h2');
  if (/yesterday|sample day/i.test(h)) throw new Error(`with no punches at all Today is headed "${h}" while the list says no one clocked in today`);
  return page;
});

t('EMPTY-3 a worker with no active jobs sees on Home a plain message to ask the boss', async (browser) => {
  const { page } = await open(browser);
  await emptyDemo(page);
  await signIn(page, 'Travis K.');
  const home = await text(page, '.screen.home');
  if (!/ask (the|your) boss/i.test(home)) throw new Error(`Home with no jobs doesn't tell the worker to ask the boss: "${home.slice(0, 200)}"`);
  return page;
});

t('EMPTY-4 a crew member (not a lead) with no groups is told who can start one, not just "No groups yet."', async (browser) => {
  const { page } = await open(browser);
  await signIn(page, 'Billy S.'); // in no group (Travis K. joined the sample group in UX-R19)
  await page.click('[data-to="chat-list"]');
  await page.waitForFunction(() => { const l = document.querySelector('#app .list'); return l && !/Loading/.test(l.innerText); }, null, { timeout: 20000 });
  const list = await text(page, '#app .list');
  if (!/(boss|foreman)/i.test(list) || !/start/i.test(list)) throw new Error(`empty chat list for a crew member says: "${list}"; want who can start a group`);
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

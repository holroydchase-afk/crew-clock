// M1.2 location consent: browser cases for CON-1..CON-6, against a demo build on :8123.
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-consent.js            (or one case: node tests/e2e-consent.js CON-2)
// In the demo seed every worker has agreed except Billy S., so a fresh visitor sees the screen once.
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const J1 = { lat: 38.454, lng: -81.929, acc: 8 };
const VERSION = 'loc-v1';
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

// Counts every location read, so a test can prove none happened.
function gpsCounter(pos) {
  // The demo starts with "pretend I'm at the job" on (M1.6); these tests drive the real GPS path.
  try { localStorage.setItem('cc.demoFake', 'false'); } catch (e) { /* ok */ }
  window.__gpsReads = 0;
  const at = () => ({ coords: { latitude: pos.lat, longitude: pos.lng, accuracy: pos.acc }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { window.__gpsReads++; setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => { window.__gpsReads++; setTimeout(() => ok(at()), 0); };
}

let lastPage = null;
async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.dialogs = [];
  page.on('dialog', (d) => { page.dialogs.push(d.message()); d.accept(); });
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsCounter, J1);
  if (opts.init) await page.addInitScript(opts.init, opts.initArg);
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  return { ctx, page };
}

const SCREENS = '.consent, .punch, .boss, [data-action="prime-location"]';
async function tapName(page, name) {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector(SCREENS);
}
// Signs in someone who has agreed (or the boss) and lands on Home or the boss screen.
async function signIn(page, name) {
  await tapName(page, name);
  if (await page.locator('.consent').count()) throw new Error(`${name} was asked for consent but has agreed`);
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
}
async function signOut(page) {
  await page.getByRole('button', { name: 'Not you?' }).click();
  await page.waitForSelector('.name-btn');
}
const gpsReads = (page) => page.evaluate(() => window.__gpsReads);
const demoDb = (page) => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('cc.demo.db'));
  return JSON.parse(localStorage.getItem(k));
});
const outbox = (page) => page.evaluate(() => Store.outbox.all());
async function drained(page, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!(await outbox(page)).length) return;
    await page.waitForTimeout(100);
  }
  throw new Error('the outbox never emptied');
}
async function consentScreenText(page) {
  const text = await page.locator('.consent').innerText();
  if (!/only when you tap Clock in or Clock out/i.test(text)) throw new Error(`consent words are wrong: ${JSON.stringify(text.slice(0, 160))}`);
  for (const b of ['I agree', 'Not now']) {
    if (!(await page.getByRole('button', { name: b, exact: true }).count())) throw new Error(`no "${b}" button on the consent screen`);
  }
  return text;
}

t('CON-1 a worker with no consent on record sees the location consent at sign-in, before Home and before the phone permission screen', async (browser) => {
  const { page } = await open(browser);
  await tapName(page, 'Billy S.');
  if (!(await page.locator('.consent').count())) throw new Error('no consent screen after sign-in');
  if (await page.locator('.punch, [data-action="prime-location"]').count()) throw new Error('Home or the permission primer showed with the consent screen');
  await consentScreenText(page);
  if (await gpsReads(page)) throw new Error('location was read before consent');
  await page.getByRole('button', { name: 'I agree', exact: true }).click();
  await page.waitForSelector('.punch, [data-action="prime-location"]');
  if (!(await page.locator('[data-action="prime-location"]').count())) throw new Error('the phone permission primer did not follow "I agree"');
  return page;
});

t('CON-1 (guard) a worker who has agreed is not asked again at sign-in, and the boss is never asked', async (browser) => {
  const { page } = await open(browser);
  await signIn(page, 'Jake R.');
  await signOut(page);
  await signIn(page, 'Sam W.');
  await page.waitForSelector('.boss');
  return page;
});

t('CON-2 with no consent, Clock in reads no location: the app asks first, and "Not now" still clocks in with a picture', async (browser) => {
  const { page } = await open(browser);
  await tapName(page, 'Billy S.');
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.waitForSelector('[data-action="prime-location"], .punch');
  if (await page.locator('[data-action="prime-location"]').count()) await page.click('[data-action="prime-location"]');
  await page.waitForSelector('.punch.in');
  await page.click('.punch.in');
  await page.waitForSelector('.consent');
  await consentScreenText(page);
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.waitForSelector('.job-btn');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('[data-action="photo-file"]', { state: 'attached' });
  const why = await page.locator('main').innerText();
  if (!/location is off/i.test(why)) throw new Error(`the photo screen does not say why: ${JSON.stringify(why.slice(0, 160))}`);
  await page.click('[data-action="no-photo"]');
  await page.waitForSelector('.big-check');
  if (await gpsReads(page)) throw new Error(`location was read ${await gpsReads(page)} time(s) with no consent`);
  await drained(page);
  const p = (await demoDb(page)).punches.filter((x) => x.crewId === 'c4').pop();
  if (!p || p.type !== 'in' || p.lat != null) throw new Error(`the clock-in was not saved without location: ${JSON.stringify(p)}`);
  return page;
});

t('CON-2 a foreman clocking in a teammate with no consent reads no location', async (browser) => {
  const { page } = await open(browser);
  await signIn(page, 'Ray T.');
  const before = await gpsReads(page);
  await page.click('[data-action="teammate"]');
  await page.locator('.row-card', { hasText: 'Billy S.' }).locator('[data-action="mate-punch"][data-type="in"]').click();
  await page.waitForSelector('.job-btn');
  if (await page.locator('.consent').count()) throw new Error('the foreman was asked to agree for Billy');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('[data-action="photo-file"]', { state: 'attached' });
  const why = await page.locator('main').innerText();
  if (!/Billy S\..*location/i.test(why)) throw new Error(`the photo screen does not say Billy has no location consent: ${JSON.stringify(why.slice(0, 160))}`);
  await page.click('[data-action="no-photo"]');
  await page.waitForSelector('.big-check');
  const reads = (await gpsReads(page)) - before;
  if (reads) throw new Error(`location was read ${reads} time(s) clocking in Billy with no consent`);
  return page;
});

t('CON-2 (guard) a foreman clocking in a teammate who agreed still uses location', async (browser) => {
  const { page } = await open(browser);
  await signIn(page, 'Ray T.');
  // The teammates' consent status loads after sign-in; until then the app safely reads no location.
  await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('cc.team')).consents; } catch (e) { return false; } });
  const before = await gpsReads(page);
  await page.click('[data-action="teammate"]');
  await page.locator('.row-card', { hasText: 'Travis K.' }).locator('[data-action="mate-punch"][data-type="in"]').click();
  await page.waitForSelector('.job-btn');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('[data-action="photo-file"]', { state: 'attached' });
  if (!((await gpsReads(page)) - before)) throw new Error('no location was read for a teammate who agreed');
  return page;
});

t('CON-3 "I agree" with no signal queues one consent record that sends when signal returns', async (browser) => {
  const { ctx, page } = await open(browser);
  await tapName(page, 'Billy S.');
  await ctx.setOffline(true);
  await page.getByRole('button', { name: 'I agree', exact: true }).click();
  await page.waitForSelector('[data-action="prime-location"], .punch');
  const queued = (await outbox(page)).filter((x) => x.kind === 'consent');
  if (queued.length !== 1) throw new Error(`expected 1 queued consent record, got ${queued.length}`);
  const q = queued[0];
  if (q.crewId !== 'c4' || q.action !== 'agree' || q.textVersion !== VERSION || typeof q.at !== 'number' || !('deviceId' in q)) {
    throw new Error(`queued record is missing fields: ${JSON.stringify(q)}`);
  }
  if ((await demoDb(page)).consents.some((c) => c.crewId === 'c4')) throw new Error('the record reached the demo store while offline');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await drained(page);
  const saved = (await demoDb(page)).consents.filter((c) => c.crewId === 'c4');
  if (saved.length !== 1 || saved[0].id !== q.id || saved[0].action !== 'agree' || saved[0].textVersion !== VERSION || !saved[0].receivedAt) {
    throw new Error(`expected one synced agree record for Billy, got ${JSON.stringify(saved)}`);
  }
  return page;
});

t('CON-3 a worker who agreed offline and signed out is not asked again at the next sign-in, before the record has reached the server', async (browser) => {
  const { ctx, page } = await open(browser);
  await tapName(page, 'Billy S.');
  await ctx.setOffline(true);
  await page.getByRole('button', { name: 'I agree', exact: true }).click();
  await page.waitForSelector('[data-action="prime-location"], .punch');
  if (await page.locator('[data-action="prime-location"]').count()) await page.click('[data-action="prime-location"]');
  await page.waitForSelector('.punch');
  await signOut(page); // the record stays queued for Billy (HRD-1)
  await ctx.setOffline(false);
  await tapName(page, 'Billy S.');
  if (await page.locator('.consent').count()) throw new Error('Billy agreed on this phone and was asked again');
  await drained(page);
  const saved = (await demoDb(page)).consents.filter((c) => c.crewId === 'c4');
  if (saved.length !== 1 || saved[0].action !== 'agree') throw new Error(`expected one agree record for Billy, got ${JSON.stringify(saved)}`);
  return page;
});

t('CON-3 (PS) a consent record the server refuses is forgotten on the phone: no location, and the worker is asked again', async (browser) => {
  const { page } = await open(browser, { init: () => {
    let demo;
    Object.defineProperty(self, 'DemoBackend', { configurable: true, get: () => demo, set: (v) => {
      const handle = v.handle;
      demo = Object.assign({}, v, { handle: (a, p) => {
        if (a !== 'sync') return handle(a, p);
        const refused = (p.items || []).filter((i) => i.kind === 'consent');
        const rest = (p.items || []).filter((i) => i.kind !== 'consent');
        return (rest.length ? handle(a, Object.assign({}, p, { items: rest })) : Promise.resolve({ ok: true, accepted: [], rejected: [], reasons: [] }))
          .then((r) => Object.assign({}, r, { rejected: r.rejected.concat(refused.map((i) => i.id)), reasons: (r.reasons || []).concat(refused.map((i) => ({ id: i.id, reason: 'Consent too old' }))) }));
      } });
    } });
  } });
  await tapName(page, 'Billy S.');
  await page.getByRole('button', { name: 'I agree', exact: true }).click();
  await page.waitForSelector('[data-action="prime-location"], .punch');
  if (await page.locator('[data-action="prime-location"]').count()) await page.click('[data-action="prime-location"]');
  await page.waitForSelector('[data-action="consent-ask"]', { timeout: 5000 }).catch(() => {});
  if (!(await page.locator('[data-action="consent-ask"]').count())) throw new Error('Home still treats Billy as agreed after the server refused his record');
  const left = (await outbox(page)).filter((x) => x.kind === 'consent');
  if (left.length) throw new Error(`the refused consent record is still queued: ${JSON.stringify(left)}`);
  const before = await gpsReads(page);
  await page.click('.punch.in');
  await page.waitForSelector('.consent');
  if ((await gpsReads(page)) - before) throw new Error('location was read after the consent record was refused');
  return page;
});

t('CON-5 "Stop using my location" adds a withdraw record, the next clock-in asks again, and the boss sees "No location consent"', async (browser) => {
  const { page } = await open(browser);
  await signIn(page, 'Jake R.');
  await page.getByRole('button', { name: 'Stop using my location' }).click();
  await page.waitForSelector('[data-action="consent-ask"]');
  await drained(page);
  const mine = (await demoDb(page)).consents.filter((c) => c.crewId === 'c2');
  if (mine.length < 2 || mine[mine.length - 1].action !== 'withdraw') throw new Error(`no withdraw record added: ${JSON.stringify(mine)}`);
  if (mine[0].action !== 'agree') throw new Error('the earlier agree record was changed or removed');
  const before = await gpsReads(page);
  await page.click('.punch');
  await page.waitForSelector('.consent');
  if ((await gpsReads(page)) - before) throw new Error('location was read after withdrawal');
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.waitForSelector('.job-btn, .big-check, [data-action="photo-file"]', { state: 'attached' });
  await page.goto(BASE); // reopen the app: they said no, so Home, not the consent screen again
  await page.waitForSelector('.punch, .consent');
  if (await page.locator('.consent').count()) throw new Error('asked again on reopening the app right after withdrawing');
  await signOut(page);
  await signIn(page, 'Sam W.');
  await page.click('[data-action="boss-tab"][data-tab="crew"]');
  await page.waitForSelector('.boss-body.tab-crew');
  await page.locator('.job-btn', { hasText: 'Jake R.' }).locator('.no-consent').waitFor({ timeout: 3000 }).catch(() => {}); // team status loads after sign-in
  const row = await page.locator('.job-btn', { hasText: 'Jake R.' }).innerText();
  if (!/No location consent/i.test(row)) throw new Error(`Jake's row does not say "No location consent": ${JSON.stringify(row)}`);
  const ray = await page.locator('.job-btn', { hasText: 'Ray T.' }).innerText();
  if (/No location consent/i.test(ray)) throw new Error('Ray agreed but the Crew tab says "No location consent"');
  return page;
});

t('CON-5 (guard) a worker can agree again after withdrawing', async (browser) => {
  const { page } = await open(browser);
  await signIn(page, 'Jake R.');
  await page.getByRole('button', { name: 'Stop using my location' }).click();
  await page.click('[data-action="consent-ask"]');
  await page.waitForSelector('.consent');
  await page.getByRole('button', { name: 'I agree', exact: true }).click();
  await page.waitForSelector('.punch');
  if (!(await page.getByRole('button', { name: 'Stop using my location' }).count())) throw new Error('Home does not offer "Stop using my location" after agreeing again');
  await drained(page);
  const acts = (await demoDb(page)).consents.filter((c) => c.crewId === 'c2').map((c) => c.action);
  if (acts.join(',') !== 'agree,withdraw,agree') throw new Error(`expected agree, withdraw, agree; got ${acts}`);
  return page;
});

t('CON-6 a worker who agreed to an older consent text is asked again at sign-in', async (browser) => {
  const { page } = await open(browser, { init: () => {
    if (sessionStorage.getItem('aged')) return;
    sessionStorage.setItem('aged', '1');
    // The demo store, made on first load, with Jake's agreement turned into an older text version
    const k = Object.keys(localStorage).find((x) => x.startsWith('cc.demo.db')) || 'cc.demo.db.v5';
    const tick = setInterval(() => {
      const db = JSON.parse(localStorage.getItem(k) || 'null');
      if (!db) return;
      clearInterval(tick);
      db.consents.filter((c) => c.crewId === 'c2').forEach((c) => { c.textVersion = 'loc-v0'; });
      localStorage.setItem(k, JSON.stringify(db));
      location.reload();
    }, 20);
  } });
  await page.waitForFunction(() => sessionStorage.getItem('aged'));
  await page.waitForSelector('.name-btn');
  await page.waitForTimeout(300);
  await tapName(page, 'Jake R.');
  if (!(await page.locator('.consent').count())) throw new Error('Jake agreed to loc-v0 and was not asked again');
  return page;
});

t('CON-4 (demo) the demo store refuses a consent record made for someone else', async (browser) => {
  const { page } = await open(browser);
  await signIn(page, 'Ray T.');
  const r = await page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('cc.auth'));
    return Api.sync(auth, [{ kind: 'consent', id: 'x-1', crewId: 'c4', action: 'agree', textVersion: 'loc-v1', at: Date.now(), deviceId: null }]);
  });
  if (!r.rejected.includes('x-1')) throw new Error(`a foreman's consent for Billy was accepted: ${JSON.stringify(r)}`);
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

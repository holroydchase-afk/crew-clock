// M1.5 hardening: browser cases for the HRD tickets, against a demo build on :8123.
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-harden.js            (or one case: node tests/e2e-harden.js HRD-5)
// GPS is stubbed in the page so every fix arrives exactly when the test says (no sleeps).
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const JOBS = { j1: { lat: 38.4537, lng: -81.9290 }, j2: { lat: 38.4204, lng: -81.7907 }, j4: { lat: 38.4326, lng: -82.0201 } };
const SITE_JPG = fs.readFileSync(path.join(__dirname, 'fixtures/site.jpg')).toString('base64');
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

// mode 'auto': every GPS request answers at pos; 'deny': permission denied; 'manual': the test fires each watch.
function gpsStub(cfg) {
  const g = window.__gps = { mode: cfg.mode, pos: cfg.pos, watches: [] };
  const at = (p) => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok, err) => {
    const w = { ok, err, cleared: false };
    g.watches.push(w);
    if (g.mode === 'auto') setTimeout(() => !w.cleared && ok(at(g.pos)), 0);
    if (g.mode === 'deny') setTimeout(() => !w.cleared && err && err({ code: 1 }), 0);
    return g.watches.length;
  };
  navigator.geolocation.clearWatch = (id) => { if (g.watches[id - 1]) g.watches[id - 1].cleared = true; };
  navigator.geolocation.getCurrentPosition = (ok, err) =>
    setTimeout(() => (g.mode === 'auto' ? ok(at(g.pos)) : err && err({ code: 1 })), 0);
  window.__fire = (i, p) => { const w = g.watches[i]; if (!w || w.cleared) return false; w.ok(at(p)); return true; };
}

async function open(browser, mode, pos) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(gpsStub, { mode, pos: Object.assign({ acc: 8 }, pos || JOBS.j1) });
  await page.goto(BASE);
  return { ctx, page };
}

async function signIn(page, name, pin) {
  await page.getByRole('button', { name, exact: false }).first().click();
  for (const k of pin) await page.click(`.keypad [data-k="${k}"]`);
  await page.waitForSelector('.punch, .boss, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
  await installProbes(page);
}

// Tracks punches between "about to save" and "in the outbox", so a test can wait until the phone is quiet.
async function installProbes(page) {
  await page.evaluate(() => {
    if (window.__busy) return;
    window.__busy = new Set();
    const sign = Device.sign;
    Device.sign = (p) => { __busy.add(p.id); return sign(p); };
    const add = Store.outbox.add;
    Store.outbox.add = (item) => { __busy.add(item.id); return add(item).finally(() => __busy.delete(item.id)); };
  });
}
const quiet = (page) => page.waitForFunction(() => window.__busy && window.__busy.size === 0);

// Every punch the phone has saved: still in the outbox, or already on the (demo) server.
async function punches(page) {
  return page.evaluate(async () => {
    const box = await Store.outbox.all(); // outbox first: an item leaves it only after the server has it
    const db = JSON.parse(localStorage.getItem('cc.demo.db') || '{"punches":[]}');
    const all = new Map();
    db.punches.forEach((p) => all.set(p.id, Object.assign({ where: 'server' }, p)));
    box.filter((i) => i.kind === 'punch').forEach((p) => all.set(p.id, Object.assign({ where: 'outbox' }, p)));
    return [...all.values()];
  });
}
const now = (page) => page.evaluate(() => Date.now());
const tapOk = (page) => page.getByRole('button', { name: 'OK', exact: true }).click();
async function syncAndWait(page) {
  await page.evaluate(() => self.CrewClock.syncNow());
  await page.waitForFunction(() => !self.CrewClock.state.syncing);
}

// Jake starts on the clock in the seed data. Clock him out and back in while offline: two unsent punches.
async function jakeTwoUnsent(browser) {
  const { ctx, page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, 'Jake R.', '1111');
  await ctx.setOffline(true);
  await page.click('.punch.out');
  await page.waitForSelector('.big-check');
  await tapOk(page);
  await page.click('.punch.in');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('.big-check');
  await tapOk(page);
  await quiet(page);
  const queued = (await punches(page)).filter((p) => p.where === 'outbox' && p.crewId === 'c2').map((p) => p.id);
  if (queued.length !== 2) throw new Error(`setup: expected 2 unsent punches for Jake, got ${queued.length}`);
  await page.getByRole('button', { name: 'Not you?' }).click(); // the confirm() is accepted
  await page.waitForSelector('.name-btn');
  await ctx.setOffline(false);
  return { ctx, page, queued };
}

t('HRD-1 Jake leaves 2 unsent punches, Cody signs in and syncs: they stay queued for Jake', async (browser) => {
  const { page, queued } = await jakeTwoUnsent(browser);
  await signIn(page, 'Cody M.', '2222');
  await syncAndWait(page);
  const all = await punches(page);
  const left = queued.filter((id) => all.some((p) => p.id === id && p.where === 'outbox'));
  const asCody = all.filter((p) => queued.includes(p.id) && p.where === 'server');
  if (left.length !== 2) throw new Error(`Jake's punches still in the outbox: ${left.length} of 2 (deleted after Cody's sync)`);
  if (asCody.length) throw new Error(`Jake's punches reached the server under Cody's sign-in: ${JSON.stringify(asCody.map((p) => p.byCrewId))}`);
  return page;
});

// The "Not you?" prompt says "They will send when this person signs in again", so the intent is:
// queued for Jake, sent as Jake's when Jake signs back in, never re-attributed to whoever is signed in.
t('HRD-1 Jake leaves 2 unsent punches, the boss signs in and syncs: they stay queued, then send as Jake\'s', async (browser) => {
  const { page, queued } = await jakeTwoUnsent(browser);
  await signIn(page, 'Dad', '1234');
  await syncAndWait(page);
  let all = await punches(page);
  const sentByBoss = all.filter((p) => queued.includes(p.id) && p.where === 'server');
  if (sentByBoss.length) {
    throw new Error(`boss's sync sent Jake's punches: ${sentByBoss.length} of 2 recorded with byCrewId=${sentByBoss.map((p) => p.byCrewId).join(',')}`);
  }
  await page.getByRole('button', { name: 'Switch' }).click();
  await page.waitForSelector('.name-btn');
  await signIn(page, 'Jake R.', '1111');
  await syncAndWait(page);
  all = await punches(page);
  const asJake = all.filter((p) => queued.includes(p.id) && p.where === 'server' && p.byCrewId === 'c2');
  if (asJake.length !== 2) throw new Error(`after Jake signed back in, ${asJake.length} of 2 were recorded as his`);
  return page;
});

// The server's real reply shape (supabase/functions/sync/index.ts): ids in rejected, words in reasons.
async function rejectEverything(page, reason) {
  await page.evaluate((why) => {
    self.Api.sync = async (auth, items) => ({ ok: true, accepted: [], rejected: items.map((i) => i.id), reasons: items.map((i) => ({ id: i.id, reason: why })) });
  }, reason);
}

async function jakeOneUnsent(browser) {
  const { ctx, page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, 'Jake R.', '1111');
  await ctx.setOffline(true);
  await page.click('.punch.out');
  await page.waitForSelector('.big-check');
  await tapOk(page);
  await quiet(page);
  const [p] = (await punches(page)).filter((x) => x.where === 'outbox');
  return { ctx, page, id: p.id };
}

t('HRD-2 a punch the server rejects as "Punch too old" stays on the phone and the reason is shown', async (browser) => {
  const { ctx, page, id } = await jakeOneUnsent(browser);
  await rejectEverything(page, 'Punch too old');
  await ctx.setOffline(false);
  await syncAndWait(page);
  const still = (await punches(page)).some((p) => p.id === id && p.where === 'outbox');
  const text = await page.evaluate(() => document.body.innerText);
  const shown = /too old|phone'?s (clock|date)|clock .*(wrong|behind)|date .*wrong/i.test(text.replace(/CLOCK (IN|OUT)/g, ''));
  if (!still) throw new Error('the rejected punch was deleted from the outbox');
  if (!shown) throw new Error(`no reason on screen; page says: ${JSON.stringify(text.slice(0, 200))}`);
  return page;
});

t('HRD-2 (guard, other direction) a permission rejection is removed from the outbox', async (browser) => {
  const { ctx, page, id } = await jakeOneUnsent(browser);
  await rejectEverything(page, 'Only a foreman can clock in a teammate');
  await ctx.setOffline(false);
  await syncAndWait(page);
  const still = (await punches(page)).some((p) => p.id === id && p.where === 'outbox');
  if (still) throw new Error('a permission rejection stayed in the outbox');
  return page;
});

t('HRD-3 double-tap a job in the "Wrong job? Fix it" picker: one void and one new punch', async (browser) => {
  const { page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, 'Jake R.', '1111');
  await page.click('.punch.out');
  await page.waitForSelector('.big-check');
  await tapOk(page);
  await page.click('.punch.in');
  await page.click('.job-btn[data-id="j1"]');
  await page.getByRole('button', { name: 'Wrong job? Fix it' }).click();
  await page.waitForSelector('.job-btn[data-id="j2"]');
  await quiet(page);
  const before = new Set((await punches(page)).map((p) => p.id));
  await page.evaluate(() => { const b = document.querySelector('.job-btn[data-id="j2"]'); b.click(); b.click(); });
  await page.waitForSelector('.big-check');
  await quiet(page);
  const added = (await punches(page)).filter((p) => !before.has(p.id));
  const voids = added.filter((p) => p.type === 'void').length;
  const ins = added.filter((p) => p.type === 'in').length;
  if (voids !== 1 || ins !== 1) throw new Error(`expected 1 void + 1 in, saved ${voids} void + ${ins} in`);
  return page;
});

// Found while writing HRD-3: .btn { display: flex } beats the [hidden] attribute, so "Take a picture
// instead" shows the moment "Finding you" opens, right where the job button was.
t('HRD-3 "Take a picture instead" stays hidden when "Finding you" opens (so a second tap cannot hit it)', async (browser) => {
  const { page } = await open(browser, 'manual');
  await signIn(page, 'Jake R.', '1111');
  await page.click('.punch.out');
  await page.waitForSelector('[aria-label="Finding you"]');
  if (await page.locator('#skip-gps').isVisible()) throw new Error('"Take a picture instead" is visible at once, not after the 8 s GPS wait');
  return page;
});

t('HRD-3 double-tap a job in the picker with fast GPS: one punch', async (browser) => {
  const { page } = await open(browser, 'manual');
  await signIn(page, 'Jake R.', '1111');
  // Seed has Jake on the clock; clock out first with one quick fix.
  await page.click('.punch.out');
  await page.waitForFunction(() => __gps.watches.length === 1);
  await page.evaluate((p) => __fire(0, p), Object.assign({ acc: 8 }, JOBS.j1));
  await page.waitForSelector('.big-check');
  await tapOk(page);
  await quiet(page);
  const start = await now(page);
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn[data-id="j1"]');
  await page.locator('.job-btn[data-id="j1"]').dblclick();
  const n = await page.evaluate(() => __gps.watches.length - 1);
  await page.evaluate((p) => __gps.watches.forEach((w, i) => i > 0 && __fire(i, p)), Object.assign({ acc: 8 }, JOBS.j1));
  await page.waitForSelector('.big-check, [data-action="photo-file"]', { state: 'attached' });
  if (await page.locator('[data-action="photo-file"]').count()) {
    throw new Error('the second tap landed on "Take a picture instead": photo screen with GPS fine, no punch saved');
  }
  await quiet(page);
  const ins =(await punches(page)).filter((p) => p.type === 'in' && p.at >= start);
  if (ins.length !== 1) throw new Error(`saved ${ins.length} clock-ins (${n} GPS waits started)`);
  return page;
});

t('HRD-3 (guard) double-tap CLOCK OUT: one punch', async (browser) => {
  const { page } = await open(browser, 'manual');
  await signIn(page, 'Jake R.', '1111');
  const start = await now(page);
  await page.locator('.punch.out').dblclick();
  await page.waitForFunction(() => __gps.watches.length >= 1);
  const n = await page.evaluate(() => __gps.watches.length);
  await page.evaluate((p) => __gps.watches.forEach((w, i) => __fire(i, p)), Object.assign({ acc: 8 }, JOBS.j1));
  await page.waitForSelector('.big-check');
  await quiet(page);
  const outs = (await punches(page)).filter((p) => p.type === 'out' && p.at >= start);
  if (outs.length !== 1) throw new Error(`saved ${outs.length} clock-outs (${n} GPS waits started)`);
  return page;
});

// "Finding you" has no Back button; the way out is "Take a picture instead" (shown after 8 s).
t('HRD-4 leave "Finding you", start a new punch, then the old GPS fix arrives: it does not finish the new punch', async (browser) => {
  const { page } = await open(browser, 'manual');
  await signIn(page, 'Jake R.', '1111');
  await page.click('.punch.out'); // GPS wait #0 starts
  await page.waitForSelector('#skip-gps:not([hidden])', { timeout: 15000 });
  await page.click('#skip-gps');
  await page.getByRole('button', { name: "I can't take a picture" }).click();
  await page.waitForSelector('.big-check');
  await tapOk(page);
  await page.click('.punch.in');
  await page.click('.job-btn[data-id="j2"]'); // GPS wait #1 starts
  await page.waitForFunction(() => __gps.watches.length === 2);
  await quiet(page);
  const start = await now(page);
  // The old wait finally gets a fix, far from the new job.
  await page.evaluate((p) => __fire(0, p), Object.assign({ acc: 5 }, JOBS.j4));
  await quiet(page);
  const early = (await punches(page)).filter((p) => p.type === 'in' && p.queuedAt >= start);
  const screen = await page.evaluate(() => self.CrewClock.state.screen);
  // Now the new wait gets its own fix at the new job.
  await page.evaluate((p) => __fire(1, p), Object.assign({ acc: 5 }, JOBS.j2));
  await page.waitForSelector('.big-check');
  await quiet(page);
  const ins = (await punches(page)).filter((p) => p.type === 'in' && p.queuedAt >= start);
  if (early.length) {
    throw new Error(`the old fix finished the new clock-in (screen=${screen}, lat ${early[0].lat}, status ${early[0].status}); ${ins.length} clock-ins in total`);
  }
  if (ins.length !== 1 || Math.abs(ins[0].lat - JOBS.j2.lat) > 0.001) throw new Error(`expected 1 clock-in at the new job, got ${JSON.stringify(ins.map((p) => [p.lat, p.status]))}`);
  return page;
});

async function jakeOnPhotoScreen(browser) {
  const { page } = await open(browser, 'deny');
  await signIn(page, 'Jake R.', '1111');
  const start = await now(page);
  await page.click('.punch.out');
  await page.waitForSelector('[data-action="no-photo"]');
  return { page, start };
}

t('HRD-5 tap "I can\'t take a picture" twice: one punch', async (browser) => {
  const { page, start } = await jakeOnPhotoScreen(browser);
  await page.evaluate(() => { const b = document.querySelector('[data-action="no-photo"]'); b.click(); b.click(); });
  await page.waitForSelector('.big-check');
  await quiet(page);
  const outs = (await punches(page)).filter((p) => p.type === 'out' && p.at >= start);
  if (outs.length !== 1) throw new Error(`saved ${outs.length} clock-outs`);
  return page;
});

t('HRD-5 pick a photo, then tap "I can\'t take a picture": one punch', async (browser) => {
  const { page, start } = await jakeOnPhotoScreen(browser);
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'site.jpg', { type: 'image/jpeg' }));
    const input = document.querySelector('input[data-action="photo-file"]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-action="no-photo"]').click();
  }, SITE_JPG);
  await page.waitForSelector('.big-check');
  // The photo is still being stamped; wait for it to finish (or be refused) before counting.
  await page.waitForFunction(() => { const f = self.CrewClock.state.flow; return f && (f.photo || f.photoProblem || f.photoRefused); }, null, { timeout: 5000 }).catch(() => {});
  await quiet(page);
  const outs = (await punches(page)).filter((p) => p.type === 'out' && p.at >= start);
  if (outs.length !== 1) throw new Error(`saved ${outs.length} clock-outs`);
  return page;
});

// Decision logged for Chase: the foreman can finish without a photo; the punch is flagged high risk.
t('HRD-9 foreman with no camera clocking in a teammate can finish without a photo, flagged high risk', async (browser) => {
  const { page } = await open(browser, 'deny');
  await signIn(page, 'Ray T.', '3333');
  await page.getByRole('button', { name: /teammate/ }).click();
  await page.locator('.row-card', { hasText: 'Cody M.' }).getByRole('button', { name: 'In' }).click();
  await page.click('.job-btn[data-id="j2"]');
  await page.waitForSelector('input[data-action="photo-file"]', { state: 'attached' });
  const way = page.getByRole('button', { name: /can.t take a picture/i });
  if (!(await way.count())) {
    const text = await page.evaluate(() => document.querySelector('main').innerText);
    throw new Error(`no way out on the teammate photo screen; it shows: ${JSON.stringify(text)}`);
  }
  await way.click();
  await page.waitForSelector('.big-check');
  await quiet(page);
  const p = (await punches(page)).find((x) => x.crewId === 'c3' && x.byCrewId === 'c1' && x.type === 'in');
  if (!p) throw new Error('no clock-in saved for Cody');
  const level = await page.evaluate((x) => Risk.topLevel(Risk.assess(x, { receivedAt: x.at })), p);
  if (level !== 'high') throw new Error(`teammate punch with no photo flagged ${level}, expected high`);
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
    }
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

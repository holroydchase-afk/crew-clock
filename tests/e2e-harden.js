// M1.5 hardening: browser cases for the HRD tickets, against a demo build on :8123.
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-harden.js            (or one case: node tests/e2e-harden.js HRD-5)
// GPS is stubbed in the page so every fix arrives exactly when the test says (no sleeps).
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const JOBS = { j1: { lat: 38.454, lng: -81.929 }, j2: { lat: 38.420, lng: -81.791 }, j4: { lat: 38.433, lng: -82.020 } };
const SITE_JPG = fs.readFileSync(path.join(__dirname, 'fixtures/site.jpg')).toString('base64');
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

// mode 'auto': every GPS request answers at pos; 'deny': permission denied; 'manual': the test fires each watch.
// A rough reading (the job list's sort, the permission primer) isn't a punch watch: it answers on its
// own as the old one-shot read did (M1.3 moved those reads to a watch so they can be stopped).
function gpsStub(cfg) {
  const g = window.__gps = { mode: cfg.mode, pos: cfg.pos, watches: [] };
  const at = (p) => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc }, timestamp: Date.now() });
  let rough = 1000;
  navigator.geolocation.watchPosition = (ok, err, opts) => {
    if (opts && opts.enableHighAccuracy === false) {
      setTimeout(() => (g.mode === 'auto' ? ok(at(g.pos)) : err && err({ code: 1 })), 0);
      return ++rough;
    }
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
  page.dialogs = [];
  page.on('dialog', (d) => { page.dialogs.push(d.message()); d.accept(); });
  await page.addInitScript(gpsStub, { mode, pos: Object.assign({ acc: 8 }, pos || JOBS.j1) });
  await page.goto(BASE);
  return { ctx, page };
}

async function signIn(page, name, pin) {
  await page.getByRole('button', { name, exact: false }).first().click();
  // The demo signs in on the tap (demoPin off); the PIN screen only shows when it's on
  await page.waitForSelector('.keypad, .punch, .boss, [data-action="prime-location"]');
  if (await page.locator('.keypad').count()) {
    for (const k of pin) await page.click(`.keypad [data-k="${k}"]`);
    await page.waitForSelector('.punch, .boss, [data-action="prime-location"]');
  }
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
    const key = Object.keys(localStorage).find((k) => k.startsWith('cc.demo.db')); // the demo store, whatever its version
    const db = JSON.parse((key && localStorage.getItem(key)) || '{"punches":[]}');
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
  await signIn(page, 'Sam W.', '1234');
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

// Leaves "Finding you" through "Take a picture instead" (shown after 8 s); since UX-9 there is also a Back button.
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
  // Travis is off the clock in the seed (Cody is on, so since UX-4 his row only offers "Clock out").
  await page.locator('.row-card', { hasText: 'Travis K.' }).getByRole('button', { name: 'Clock in' }).click();
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
  const p = (await punches(page)).find((x) => x.crewId === 'c5' && x.byCrewId === 'c1' && x.type === 'in');
  if (!p) throw new Error('no clock-in saved for Travis');
  const level = await page.evaluate((x) => Risk.topLevel(Risk.assess(x, { receivedAt: x.at })), p);
  if (level !== 'high') throw new Error(`teammate punch with no photo flagged ${level}, expected high`);
  return page;
});

// ---------- PS-2: a permanent refusal keeps a stub only (no GPS, no photo) and is not resent ----------

// Records every id the app hands to Api.sync; `reply` decides what the "server" says.
async function recordSync(page, reply) {
  await page.evaluate((mode) => {
    window.__sent = [];
    self.Api.sync = async (auth, items) => {
      items.forEach((i) => window.__sent.push(i.id));
      if (mode === 'down') throw Object.assign(new Error('Server error'), { status: 503, offline: true });
      if (mode === 'photo') return { ok: true, accepted: [], rejected: [], reasons: [] }; // photo upload failed (HRD-6 shape)
      return { ok: true, accepted: [], rejected: items.map((i) => i.id), reasons: items.map((i) => ({ id: i.id, reason: mode })) };
    };
  }, reply);
}
// Via all(), so a missing id is null here (Store.outbox.get() resolves undefined since UX-1).
const outboxItem = (page, id) => page.evaluate(async (x) => (await Store.outbox.all()).find((i) => i.id === x) || null, id);
const FAKE_PHOTO = 'data:image/jpeg;base64,' + Buffer.from('made-up test photo').toString('base64');
async function givePhoto(page, id) {
  await page.evaluate(async ({ x, photo }) => { const it = await Store.outbox.get(x); it.photo = photo; await Store.outbox.add(it); }, { x: id, photo: FAKE_PHOTO });
}
const PERSONAL = ['lat', 'lng', 'accuracy', 'photo', 'photoKey', 'photoSha256', 'data', 'distanceFt', 'signature', 'deviceId'];

for (const reason of ['Punch too old', 'Bad punch type', 'Bad id', 'unknown kind']) {
  t(`PS-2 a punch refused as "${reason}" is cut to a stub with no location or photo and is not resent`, async (browser) => {
    const { ctx, page, id } = await jakeOneUnsent(browser);
    await givePhoto(page, id);
    const before = await outboxItem(page, id);
    if (before.lat == null || !before.photo) throw new Error('setup: punch should start with GPS and a photo');
    await recordSync(page, reason);
    await ctx.setOffline(false);
    await syncAndWait(page);
    const stub = await outboxItem(page, id);
    if (!stub) throw new Error('the refused punch left the phone entirely (its stub should stay to explain it)');
    const kept = PERSONAL.filter((k) => stub[k] != null);
    if (kept.length) throw new Error(`stub still holds ${kept.join(', ')}: ${JSON.stringify(Object.keys(stub))}`);
    for (const k of ['id', 'crewId', 'byCrewId', 'type', 'at', 'jobId']) if (stub[k] == null) throw new Error(`stub lost ${k}`);
    if (!/too old|bad|unknown|couldn't take/i.test(await page.locator('[data-sync-line]').first().innerText())) throw new Error('sync line no longer explains the refusal');
    const n = await page.evaluate(() => window.__sent.length);
    await syncAndWait(page);
    const resent = await page.evaluate(() => window.__sent.length);
    if (resent !== n) throw new Error(`the refused punch was sent again on the next sync (${n} -> ${resent} sends)`);
    await ctx.close();
    return page;
  });
}

for (const [mode, label] of [['down', 'server 5xx'], ['photo', 'photo upload failed']]) {
  t(`PS-2 (guard) a transient failure (${label}) keeps the punch's location and photo and resends it`, async (browser) => {
    const { ctx, page, id } = await jakeOneUnsent(browser);
    await givePhoto(page, id);
    await recordSync(page, mode);
    await ctx.setOffline(false);
    await syncAndWait(page);
    const it = await outboxItem(page, id);
    if (!it || it.lat == null || !it.photo) throw new Error(`transient failure stripped the punch: ${JSON.stringify(it && Object.keys(it))}`);
    await syncAndWait(page);
    const sends = await page.evaluate((x) => window.__sent.filter((s) => s === x).length, id);
    if (sends < 2) throw new Error(`not resent after a transient failure (sent ${sends} time(s))`);
    await ctx.close();
    return page;
  });
}

// ---------- PS-7a: "Not you?" must not tell the next person how many the last one left ----------

t('PS-7a the "Not you?" confirm does not show the previous person\'s unsent count', async (browser) => {
  const { page } = await jakeTwoUnsent(browser);
  const msg = page.dialogs.find((m) => /not sent|switch/i.test(m));
  if (!msg) throw new Error(`no confirm was shown; dialogs: ${JSON.stringify(page.dialogs)}`);
  if (/\d/.test(msg)) throw new Error(`confirm shows a number: ${JSON.stringify(msg)}`);
  if (!/send when this person signs in again/i.test(msg)) throw new Error(`confirm lost "send when this person signs in again": ${JSON.stringify(msg)}`);
  return page;
});

// ---------- PS-7b: a job/crew edit queued before byCrewId existed is sent only by a boss ----------

async function legacyEditQueued(browser, name, pin) {
  const { ctx, page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, name, pin);
  await page.waitForFunction(() => !self.CrewClock.state.syncing); // no sign-in sync still running
  await page.evaluate(() => Store.outbox.add({ kind: 'job', id: 'legacy-edit-1', data: { id: 'j-test-legacy', name: 'Made-up test job', radiusFt: 300, active: true } }));
  await page.evaluate(() => {
    window.__sent = [];
    const real = self.Api.sync;
    self.Api.sync = (auth, items) => { items.forEach((i) => window.__sent.push(i.id)); return real(auth, items); };
  });
  await syncAndWait(page);
  return { ctx, page };
}

t('PS-7b an old queued job edit with no byCrewId is not sent by a crew member and stays queued', async (browser) => {
  const { ctx, page } = await legacyEditQueued(browser, 'Jake R.', '1111');
  const sent = await page.evaluate(() => window.__sent.includes('legacy-edit-1'));
  if (sent) throw new Error('a crew member\'s sync sent an old boss edit (the server would refuse it "Boss only" and it would be dropped)');
  if (!(await outboxItem(page, 'legacy-edit-1'))) throw new Error('the old edit was removed from the outbox');
  await ctx.close();
  return page;
});

t('PS-7b (guard) the boss does send an old queued job edit with no byCrewId', async (browser) => {
  const { ctx, page } = await legacyEditQueued(browser, 'Sam W.', '1234');
  const sent = await page.evaluate(() => window.__sent.includes('legacy-edit-1'));
  if (!sent) throw new Error('the boss\'s sync did not send the old edit');
  if (await outboxItem(page, 'legacy-edit-1')) throw new Error('the old edit is still queued after the boss sent it');
  await ctx.close();
  return page;
});

// ---------- M1.5 ux-reviewer findings ----------

const outboxCount = (page) => page.evaluate(async () => (await Store.outbox.all()).length);
async function drained(page, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(async () => !self.CrewClock.state.syncing && (await Store.outbox.all()).length === 0)) return;
    if (Date.now() > end) throw new Error(`outbox did not drain in ${ms} ms: ${await outboxCount(page)} left`);
    await page.waitForTimeout(100);
  }
}

// Jake is standing at Miller roof (j2) but taps Smith kitchen (j1), waits for "All sent", then fixes it.
t('UX-1 "Wrong job? Fix it" after the clock-in already synced keeps its time and GPS, one void for it, outbox drains', async (browser) => {
  const { page } = await open(browser, 'auto', JOBS.j2);
  await signIn(page, 'Jake R.', '1111');
  await page.click('.punch.out');
  await page.waitForSelector('.big-check');
  await tapOk(page);
  await page.click('.punch.in');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('.big-check');
  await quiet(page);
  await drained(page).catch((e) => { throw new Error('setup: ' + e.message); });
  const orig = (await punches(page)).filter((p) => p.type === 'in' && p.crewId === 'c2').sort((a, b) => b.at - a.at)[0];
  if (!orig || orig.where !== 'server') throw new Error('setup: the clock-in did not reach the server: ' + JSON.stringify((await punches(page)).map((p) => [p.crewId, p.type, p.at, p.where])));
  const lead = await page.locator('main .lead').innerText();
  await page.getByRole('button', { name: 'Wrong job? Fix it' }).click();
  await page.click('.job-btn[data-id="j2"]');
  await page.waitForSelector('.big-check, [data-action="no-photo"]');
  if (await page.locator('[data-action="no-photo"]').count()) throw new Error('fixing the job jumped to the photo screen ("GPS couldn\'t find you")');
  await quiet(page);
  const timeBefore = lead.split('\n').pop().trim();
  const leadAfter = await page.locator('main .lead').innerText();
  if (!leadAfter.includes(timeBefore)) throw new Error(`done screen time changed: ${JSON.stringify(lead)} -> ${JSON.stringify(leadAfter)}`);
  const all = await punches(page);
  const voids = all.filter((p) => p.type === 'void' && p.crewId === 'c2');
  if (voids.length !== 1 || voids[0].voidsId !== orig.id) throw new Error(`expected 1 void of ${orig.id}, got ${JSON.stringify(voids.map((v) => v.voidsId))}`);
  const fixed = all.find((p) => p.type === 'in' && p.jobId === 'j2' && p.crewId === 'c2');
  if (orig.status !== 'offsite') throw new Error(`setup: wrong-job clock-in should be offsite, was ${orig.status}`);
  if (!fixed || fixed.at !== orig.at || fixed.lat !== orig.lat || fixed.status !== 'onsite') {
    throw new Error(`fixed punch lost the original time/GPS: ${JSON.stringify(fixed && [fixed.at, fixed.lat, fixed.status])} vs ${JSON.stringify([orig.at, orig.lat])}, expected onsite`);
  }
  if (!/on site/i.test(await page.locator('main').innerText())) throw new Error('done screen does not show the on-site status');
  await drained(page);
  await tapOk(page);
  const sub = await page.locator('.status-sub').innerText();
  if (!/since \d/.test(sub)) throw new Error(`Home status line: ${JSON.stringify(sub)}`);
  return page;
});

async function jakeClocksIn(browser, offline) {
  const { ctx, page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, 'Jake R.', '1111');
  await page.click('.punch.out');
  await page.waitForSelector('.big-check');
  await tapOk(page);
  await drained(page);
  if (offline) await ctx.setOffline(true);
  await page.click('.punch.in');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('.big-check');
  return { ctx, page };
}

t('UX-2 online clock-in: the done screen shows "Sent" within 3 s and no "saved on your phone" note', async (browser) => {
  const { ctx, page } = await jakeClocksIn(browser, false);
  await page.waitForFunction(() => /sent to the boss/i.test(document.querySelector('main').innerText), null, { timeout: 3000 })
    .catch(async () => { throw new Error(`no "Sent" on the done screen after 3 s; it says ${JSON.stringify(await page.locator('main').innerText())}`); });
  const note = await page.locator('main .notice').count();
  if (note) throw new Error(`amber note shown online: ${JSON.stringify(await page.locator('main .notice').innerText())}`);
  await ctx.close();
  return page;
});

t('UX-2 (guard) offline clock-in: the done screen shows the amber "saved on your phone" note', async (browser) => {
  const { ctx, page } = await jakeClocksIn(browser, true);
  await quiet(page);
  await page.waitForTimeout(300);
  const note = page.locator('main .notice');
  if (!(await note.count()) || !/saved on your phone/i.test(await note.innerText())) throw new Error('no amber note offline');
  if (/sent to the boss/i.test(await page.locator('main').innerText())) throw new Error('says "Sent" while offline');
  await ctx.close();
  return page;
});

// Seed: Ray (foreman) is on at Smith kitchen (j1, where he stands); Cody is on at Miller roof (j2).
t('UX-3 foreman clocks a teammate out: the punch uses the teammate\'s open job, not the foreman\'s nearest', async (browser) => {
  const { page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, 'Ray T.', '3333');
  await page.getByRole('button', { name: /teammate/ }).click();
  await page.locator('.row-card', { hasText: 'Cody M.' }).locator('[data-action="mate-punch"][data-type="out"]').click();
  await page.waitForSelector('.job-btn.nearest, [data-action="no-photo"]');
  let picker = null;
  if (await page.locator('.job-btn.nearest').count()) { // what a foreman does: tap the top job
    picker = await page.locator('.job-btn.nearest .job-name').innerText();
    await page.click('.job-btn.nearest');
    await page.waitForSelector('[data-action="no-photo"]');
  }
  await page.click('[data-action="no-photo"]');
  await page.waitForSelector('.big-check');
  await quiet(page);
  const out = (await punches(page)).find((p) => p.crewId === 'c3' && p.type === 'out');
  if (!out) throw new Error('no clock-out saved for Cody');
  if (out.jobId !== 'j2') throw new Error(`Cody's clock-out went to ${out.jobId} (picker opened with "${picker}" on top), his open job is j2`);
  return page;
});

t('UX-3 foreman clocking a teammate in sees "Which job is <name> at?"', async (browser) => {
  const { page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, 'Ray T.', '3333');
  await page.getByRole('button', { name: /teammate/ }).click();
  await page.locator('.row-card', { hasText: 'Billy S.' }).locator('[data-action="mate-punch"][data-type="in"]').click();
  const h = await page.locator('main h1').innerText();
  if (h !== 'Which job is Billy S. at?') throw new Error(`title is ${JSON.stringify(h)}`);
  return page;
});

t('UX-4 pick-teammate: one button per row, at least 96x48, "Clock in" when off and "Clock out" when on, with a status line', async (browser) => {
  const { page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, 'Ray T.', '3333');
  await page.getByRole('button', { name: /teammate/ }).click();
  await page.waitForSelector('.row-card');
  await page.waitForFunction(() => self.CrewClock.state.team); // the team list arrives after sign-in; the rows redraw
  await page.waitForTimeout(50);
  const rows = await page.$$eval('.row-card', (els) => els.map((r) => ({
    text: r.innerText,
    buttons: [...r.querySelectorAll('button')].map((b) => { const x = b.getBoundingClientRect(); return { label: b.innerText.trim(), w: x.width, h: x.height }; }),
  })));
  const want = { 'Jake R.': ['Clock out', /On at Smith kitchen since \d/], 'Cody M.': ['Clock out', /On at Miller roof since \d/], 'Billy S.': ['Clock in', /\bOff\b/], 'Travis K.': ['Clock in', /\bOff\b/] };
  for (const [name, [label, line]] of Object.entries(want)) {
    const r = rows.find((x) => x.text.includes(name));
    if (!r) throw new Error(`no row for ${name}`);
    if (r.buttons.length !== 1) throw new Error(`${name}: ${r.buttons.length} buttons (${r.buttons.map((b) => `${b.label} ${b.w}x${b.h}`).join(', ')})`);
    const b = r.buttons[0];
    if (b.label !== label) throw new Error(`${name}: button says ${JSON.stringify(b.label)}, expected ${label}; row ${JSON.stringify(r.text)}`);
    if (b.w < 96 || b.h < 48) throw new Error(`${name}: button is ${b.w}x${b.h}, needs at least 96x48`);
    if (!line.test(r.text)) throw new Error(`${name}: status line missing; row says ${JSON.stringify(r.text)}`);
  }
  return page;
});

async function bossOnMap(browser) {
  const { page } = await open(browser, 'auto', JOBS.j1);
  await signIn(page, 'Sam W.', '1234');
  await page.click('[data-tab="map"]');
  await page.waitForSelector('.leaflet-control-attribution');
  return page;
}

for (const [w, h] of [[390, 844], [1280, 800]]) {
  t(`UX-5 boss Map tab at ${w}x${h}: the whole tab bar is on screen under the demo banner`, async (browser) => {
    const page = await bossOnMap(browser);
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => (window.scrollTo(0, 0), { scrollY, scrollH: document.scrollingElement.scrollHeight, bottom: document.querySelector('.tabbar').getBoundingClientRect().bottom, labels: [...document.querySelectorAll('.tabbar span')].map((s) => s.getBoundingClientRect().bottom), ih: innerHeight }));
    if (r.bottom > r.ih + 0.5 || r.labels.some((b) => b > r.ih + 0.5) || r.scrollH > r.ih) {
      throw new Error(`tab bar bottom ${r.bottom}, labels ${r.labels.map(Math.round)}, window ${r.ih}, page height ${r.scrollH} (scrollY ${r.scrollY})`);
    }
    return page;
  });
}

t('UX-6 boss Map at 390: the legend does not sit under the map attribution', async (browser) => {
  const page = await bossOnMap(browser);
  const [a, b] = await page.evaluate(() => ['.map-legend', '.leaflet-control-attribution'].map((q) => {
    const x = document.querySelector(q).getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom };
  }));
  const hit = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  if (hit) throw new Error(`legend ${JSON.stringify(a)} overlaps attribution ${JSON.stringify(b)}`);
  return page;
});

t('UX-9 "Finding you" has a Back button; backing out then a late GPS fix saves nothing', async (browser) => {
  const { page } = await open(browser, 'manual');
  await signIn(page, 'Jake R.', '1111');
  const start = await now(page);
  await page.click('.punch.out');
  await page.waitForSelector('[aria-label="Finding you"]');
  const back = page.getByRole('button', { name: 'Back' });
  if (!(await back.count()) || !(await back.isVisible())) throw new Error('no visible Back on "Finding you"');
  await back.click();
  await page.waitForSelector('.punch.out');
  await page.evaluate((p) => __fire(0, p), Object.assign({ acc: 5 }, JOBS.j1));
  await page.waitForTimeout(300);
  await quiet(page);
  const outs = (await punches(page)).filter((p) => p.type === 'out' && p.at >= start);
  if (outs.length) throw new Error(`backing out still saved ${outs.length} clock-out(s)`);
  return page;
});

t('UX-9 the photo screen has a Back button that goes home without saving', async (browser) => {
  const { page, start } = await jakeOnPhotoScreen(browser);
  const back = page.getByRole('button', { name: 'Back' });
  if (!(await back.count())) throw new Error('no Back on the photo screen');
  await back.click();
  await page.waitForSelector('.punch.out');
  await quiet(page);
  const outs = (await punches(page)).filter((p) => p.type === 'out' && p.at >= start);
  if (outs.length) throw new Error(`Back from the photo screen saved ${outs.length} clock-out(s)`);
  return page;
});

t('UX-10 "Finding you" says "GPS signal: weak (about 1.2 mi)" for a rough fix and "GPS signal: good" for a close one', async (browser) => {
  const { page } = await open(browser, 'manual');
  await signIn(page, 'Jake R.', '1111');
  await page.click('.punch.out');
  await page.waitForFunction(() => __gps.watches.length === 1);
  await page.evaluate((p) => __fire(0, p), Object.assign({}, JOBS.j1, { acc: 1931 })); // about 1.2 mi
  const weak = await page.locator('#live-acc').innerText();
  if (weak !== 'GPS signal: weak (about 1.2 mi)') throw new Error(`rough fix reads ${JSON.stringify(weak)}`);
  await page.evaluate((p) => __fire(0, p), Object.assign({}, JOBS.j1, { acc: 200 })); // still worse than the 152 m "weak" line
  const mid = await page.locator('#live-acc').innerText();
  if (mid !== 'GPS signal: weak (about 660 ft)') throw new Error(`200 m fix reads ${JSON.stringify(mid)}`);
  // 30 m is good enough to judge the geofence (no photo needed), while the phone keeps refining toward 20 m.
  await page.evaluate((p) => __fire(0, p), Object.assign({}, JOBS.j1, { acc: 30 }));
  const good = await page.locator('#live-acc').innerText();
  if (good !== 'GPS signal: good') throw new Error(`30 m fix reads ${JSON.stringify(good)}`);
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

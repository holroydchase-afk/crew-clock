// M1.13 enhancements for a recruiter's 90-second visit, against a demo build on :8123:
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-enhance.js            (or one case: node tests/e2e-enhance.js ENH-2)
// ENH-1 visible tamper check, ENH-2 the demo's "No signal" switch, ENH-3 the boss's weekly timesheet.
// Every off-origin request is answered in the test and never reaches the internet.
const fs = require('fs');
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const cases = [];
const t = (name, fn) => cases.push({ name, fn });
const CONTEXT = { viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true };

// Counts every location read (the demo pretends the visitor is at the job, so it should read none),
// and lets a case move the page's clock forward (window.__skew, in ms) without fake timers.
function watchPage() {
  window.__reads = 0;
  const far = () => ({ coords: { latitude: 40.71, longitude: -74.0, accuracy: 20 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { window.__reads++; setTimeout(() => ok(far()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => { window.__reads++; setTimeout(() => ok(far()), 0); };
  const realNow = Date.now.bind(Date);
  window.__skew = 0;
  Date.now = () => realNow() + window.__skew;
}

let lastPage = null;
// opts.viewport, and opts.hour to start the page clock at that hour today (8.3 = 8:18 AM)
async function open(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({}, CONTEXT, opts.viewport ? { viewport: opts.viewport } : {}));
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(watchPage);
  if (opts.hour != null) {
    const when = new Date(); when.setHours(Math.floor(opts.hour), Math.round((opts.hour % 1) * 60), 0, 0);
    await page.clock.install({ time: when });
  }
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
async function signOut(page) {
  const b = page.getByRole('button', { name: 'Not you?' });
  if (await b.count()) await b.click();
  else await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');
}
async function bossToday(page) {
  await signIn(page, 'Sam W.');
  await page.waitForSelector('.boss');
  await page.click('[data-action="boss-tab"][data-tab="today"]');
  await page.waitForSelector('.boss-body.tab-today');
}
const text = async (loc) => (await loc.first().innerText()).replace(/\s+/g, ' ').trim();
const demoDb = (page) => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('cc.demo.db'));
  return JSON.parse(localStorage.getItem(k));
});
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
}
// UX-R32: plain words, singular for one punch
const VERIFIED = /^Verified: (?:all (\d+) punches match what the phones sent|(1) punch matches what the phone sent)\.$/;
async function verifiedCount(page) {
  const line = page.locator('[data-verify-line]');
  return until(async () => {
    if (!(await line.count())) return null;
    const m = VERIFIED.exec(await text(line));
    return m ? +(m[1] || m[2]) : null;
  }, 8000, 'the verify line says every punch matches what the phones sent');
}
// No hashes, signatures, keys or coordinates anywhere on screen
async function noSecretsOnScreen(page, where) {
  const body = await page.locator('body').innerText();
  const long = body.match(/[A-Za-z0-9_-]{32,}/);
  if (long) throw new Error(`${where}: a hash- or key-like string is on screen: ${long[0].slice(0, 20)}…`);
  const coord = body.match(/-?\d{1,3}\.\d{4,}/);
  if (coord) throw new Error(`${where}: a coordinate is on screen: ${coord[0]}`);
}

// ---------- ENH-1 visible tamper check ----------
t('ENH-1a the boss\'s Today says every sample punch is signed and chained, with a lock icon and no hashes or coordinates', async (browser) => {
  const page = await open(browser);
  await bossToday(page);
  const n = await verifiedCount(page);
  if (n < 5) throw new Error(`only ${n} punches counted`);
  if (!(await page.locator('[data-verify-line] svg').count())) throw new Error('the verify line has no icon');
  await noSecretsOnScreen(page, 'Today');
  return page;
});

t('ENH-1b "Try tampering" edits one stored punch; the check turns red and names it in plain words; Undo puts it back', async (browser) => {
  const page = await open(browser);
  await bossToday(page);
  const n = await verifiedCount(page);
  const tamper = page.getByRole('button', { name: 'Try tampering' });
  if (await tamper.count() !== 1) throw new Error('expected one "Try tampering" button on Today');
  const before = (await demoDb(page)).punches.find((p) => p.crewId === 'c2' && p.type === 'in');
  await tamper.click();
  const line = page.locator('[data-verify-line]');
  const said = await until(async () => {
    const s = (await line.count()) ? await text(line) : '';
    return /was changed to/.test(s) ? s : null;
  }, 8000, 'the check names the changed punch');
  if (!/Jake R\.'s clock-in was changed to \d{1,2}:\d{2}\s?[AP]M after their phone signed it\./.test(said)) throw new Error(`the red line does not name Jake R.'s clock-in plainly: ${JSON.stringify(said)}`);
  if (!(await line.evaluate((el) => el.classList.contains('bad')))) throw new Error('the verify line is not marked bad (red)');
  if (VERIFIED.test(said)) throw new Error('still says Verified');
  const after = (await demoDb(page)).punches.find((p) => p.id === before.id);
  if (after.at === before.at) throw new Error('the stored punch time did not change');
  await noSecretsOnScreen(page, 'Today (tampered)');
  if (await page.getByRole('button', { name: 'Try tampering' }).count()) throw new Error('"Try tampering" still offered after tampering');
  await page.getByRole('button', { name: 'Undo the change' }).click();
  const back = await verifiedCount(page);
  if (back !== n) throw new Error(`after Undo: ${back} of ${back}, was ${n}`);
  const restored = (await demoDb(page)).punches.find((p) => p.id === before.id);
  if (restored.at !== before.at) throw new Error('Undo did not put the time back');
  return page;
});

t('ENH-1c a punch the visitor makes is signed on this phone and counted by the boss\'s check', async (browser) => {
  const page = await open(browser);
  await bossToday(page);
  const n = await verifiedCount(page);
  await signOut(page);
  await signIn(page, 'Travis K.');
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('.big-check');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForSelector('.punch.out');
  await until(async () => /All sent/.test(await text(page.locator('[data-sync-line]'))), 8000, 'the clock-in is sent');
  await signOut(page);
  await bossToday(page);
  const m = await verifiedCount(page);
  // Before 9 AM the sample day is yesterday, and Travis's clock-in makes today the day shown
  const shownToday = /^Today/.test(await text(page.locator('.boss-body h2')));
  const want = shownToday
    ? await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('cc.demo.db'));
      return JSON.parse(localStorage.getItem(k)).punches.filter((p) => p.at >= Report.startOfDay(Date.now())).length;
    })
    : n + 1;
  if (m !== want) throw new Error(`expected ${want} verified punches after Travis's clock-in, got ${m}`);
  if (!(await page.locator('.shift', { hasText: 'Travis K.' }).count())) throw new Error('Travis\'s clock-in is not on the list');
  return page;
});

// ---------- ENH-2 the demo's "No signal" switch ----------
t('ENH-2a "No signal" holds a clock-in on the phone; turning it off sends it; the boss sees it came late, no signal', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Travis K.');
  const sw = page.getByRole('switch', { name: 'No signal' });
  if (await sw.count() !== 1) throw new Error('expected one "No signal" switch');
  await sw.click();
  if (await sw.getAttribute('aria-checked') !== 'true') throw new Error('the switch does not say it is on');
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('.big-check');
  await until(async () => /Saved on your phone/.test(await text(page.locator('[data-done-sync]'))), 5000, 'the done screen says it is saved on the phone');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForSelector('.punch.out');
  await until(async () => /1 waiting to send/.test(await text(page.locator('[data-sync-line]'))), 5000, 'Home says 1 waiting to send');
  if ((await demoDb(page)).punches.some((p) => p.crewId === 'c5')) throw new Error('the punch reached the demo server with "No signal" on');
  if (await page.getByRole('switch', { name: 'No signal' }).getAttribute('aria-checked') !== 'true') throw new Error('the switch did not stay on');
  await page.evaluate(() => { window.__skew = 10 * 60000; }); // ten minutes in a dead spot
  await page.getByRole('switch', { name: 'No signal' }).click();
  await until(async () => /All sent/.test(await text(page.locator('[data-sync-line]'))), 8000, 'it sends once signal is back');
  const p = (await demoDb(page)).punches.find((x) => x.crewId === 'c5');
  if (!p) throw new Error('the punch never reached the demo server');
  await signOut(page);
  await bossToday(page);
  const row = page.locator('.shift', { hasText: 'Travis K.' });
  await row.first().waitFor();
  const said = await text(row);
  if (!/Sent at \d{1,2}:\d{2}\s?[AP]M \(no signal\)/.test(said)) throw new Error(`Travis's row does not say it was sent late with no signal: ${JSON.stringify(said)}`);
  const reads = await page.evaluate(() => window.__reads);
  if (reads) throw new Error(`the demo read the visitor's location ${reads} time(s)`);
  return page;
});

t('ENH-2b "No signal" is in the demo banner on the boss screen too, and boss Refresh with it on keeps the last list', async (browser) => {
  const page = await open(browser);
  await bossToday(page);
  await verifiedCount(page); // the team list has loaded
  const rows = await page.locator('.shift').count();
  await page.getByRole('switch', { name: 'No signal' }).click();
  await page.click('[data-action="reload-team"]');
  await page.waitForTimeout(600);
  if (await page.locator('.shift').count() !== rows) throw new Error('Refresh with no signal changed the list');
  return page;
});

// ---------- ENH-3 weekly timesheet ----------
t('ENH-3a Today has Day | Week; Week shows hours per person Mon to Sun with totals, over several sample days', async (browser) => {
  const page = await open(browser);
  await bossToday(page);
  await verifiedCount(page); // the team's punches have loaded
  const week = page.getByRole('button', { name: 'Week', exact: true });
  await week.click();
  await page.waitForSelector('table.week');
  if (await week.getAttribute('aria-pressed') !== 'true') throw new Error('Week is not marked as the chosen view');
  // Full day names are in each heading (a phone shows one letter, UX-R29, with the name as its title)
  const head = await page.locator('table.week thead th').evaluateAll((ths) => ths.map((th) => th.textContent.trim()));
  const want = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Total'];
  for (const w of want) if (!head.some((h) => h.startsWith(w))) throw new Error(`week header lacks ${w}: ${head.join('|')}`);
  const rows = await page.locator('table.week tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
  if (rows.length < 4) throw new Error(`only ${rows.length} people in the week`);
  const num = (s) => (s === '' || s === '–' ? 0 : parseFloat(s));
  for (const r of rows) {
    const sum = r.slice(1, 8).reduce((a, s) => a + num(s), 0);
    if (Math.abs(sum - num(r[8])) > 0.051) throw new Error(`${r[0]}: days add to ${sum.toFixed(1)}, total says ${r[8]}`);
  }
  // The multi-day sample: the week the boss opens to, or the one before, has 3+ days of work
  const daysWorked = (rs) => new Set(rs.flatMap((r) => r.slice(1, 8).map((s, i) => (num(s) > 0 ? i : -1)).filter((i) => i >= 0))).size;
  let n = daysWorked(rows);
  if (n < 3) {
    await page.getByRole('button', { name: 'Last week' }).click();
    await page.waitForTimeout(200);
    const prev = await page.locator('table.week tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
    n = daysWorked(rows) + daysWorked(prev);
  }
  if (n < 3) throw new Error(`the sample week has work on only ${n} day(s)`);
  await noSecretsOnScreen(page, 'Week');
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await page.waitForSelector('.shift');
  return page;
});

t('ENH-3b "Download CSV" gives name, date, in, out, hours, and no GPS, job pins, photo keys or risk data', async (browser) => {
  const page = await open(browser);
  await bossToday(page);
  await verifiedCount(page); // the team's punches have loaded (CI ran the click before they had)
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.waitForSelector('table.week');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download CSV/ }).click()]);
  if (!/\.csv$/.test(dl.suggestedFilename())) throw new Error(`file name ${dl.suggestedFilename()}`);
  const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
  const lines = csv.trim().split(/\r?\n/);
  if (lines[0] !== 'Name,Date,In,Out,Hours') throw new Error(`header: ${lines[0]}`);
  if (lines.length < 3) throw new Error(`only ${lines.length - 1} row(s)`);
  if (/-?\d{1,3}\.\d{4,}/.test(csv)) throw new Error('the CSV carries a coordinate');
  if (/photo|risk|hash|signature|lat|lng|accuracy/i.test(csv)) throw new Error('the CSV carries a field it should not');
  if (/\bj\d\b|\bc\d\b/.test(csv)) throw new Error('the CSV carries an internal id');
  return page;
});

// ---------- M1.13 round 2: ux-reviewer findings UX-R28 to UX-R34 ----------
const SMALL = [{ width: 360, height: 740 }, { width: 390, height: 844 }];
async function travisClocksIn(page) {
  await signIn(page, 'Travis K.');
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn');
  await page.click('.job-btn[data-id="j1"]');
  await page.waitForSelector('.big-check');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForSelector('.punch.out');
  await until(async () => /All sent/.test(await text(page.locator('[data-sync-line]'))), 8000, 'the clock-in is sent');
}
// Edits the demo's stored records the way a test fixture would (before the boss signs in)
const editDb = (page, fn) => page.evaluate((src) => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('cc.demo.db'));
  const db = JSON.parse(localStorage.getItem(k));
  (0, eval)(`(${src})`)(db);
  localStorage.setItem(k, JSON.stringify(db));
}, fn.toString());

t('UX-R28 at 8:18 AM a visitor\'s clock-in is added to the sample day; the boss still sees the sample crew', async (browser) => {
  const page = await open(browser, { hour: 8.3 });
  await bossToday(page);
  const n = await verifiedCount(page);
  if (!/sample day/.test(await text(page.locator('.boss-body h2')))) throw new Error('setup: before 9 AM the sample day should be yesterday');
  await signOut(page);
  await travisClocksIn(page);
  await signOut(page);
  await bossToday(page);
  const m = await verifiedCount(page); // the team list has loaded
  const h2 = await text(page.locator('.boss-body h2'));
  if (!/sample day/.test(h2)) throw new Error(`the sample day was replaced: heading "${h2}"`);
  const rows = await page.locator('.shift').count();
  if (rows < 5) throw new Error(`only ${rows} people on Today after the visitor's clock-in`);
  const travis = page.locator('.shift', { hasText: 'Travis K.' });
  if (!(await travis.count())) throw new Error('the visitor\'s own row is missing');
  if (!/on the clock/.test(await text(travis))) throw new Error('the visitor\'s row does not say on the clock');
  const notIn = (await page.locator('.not-in').count()) ? await text(page.locator('.not-in')) : '';
  if (/Travis/.test(notIn)) throw new Error('Travis is listed as not in');
  if (m !== n + 1) throw new Error(`verify line counts ${m}, want ${n + 1}`);
  return page;
});

for (const vp of SMALL) {
  t(`UX-R29 ${vp.width}: the Week table fits its box for this week and last week, with one-letter day headings and 14px numbers`, async (browser) => {
    const page = await open(browser, { viewport: vp, hour: 13.5 });
    await bossToday(page);
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await page.waitForSelector('table.week');
    const errs = [];
    for (const which of ['this week', 'last week']) {
      if (which === 'last week') { await page.getByRole('button', { name: 'Last week' }).click(); await page.waitForTimeout(200); }
      const r = await page.evaluate(() => {
        const w = document.querySelector('.week-wrap');
        const heads = [...document.querySelectorAll('table.week thead th')].slice(1, 8).map((th) => th.innerText.trim().split(/\s+/)[0]);
        return { sw: w.scrollWidth, cw: w.clientWidth, heads, px: parseFloat(getComputedStyle(document.querySelector('table.week td')).fontSize) };
      });
      if (r.sw > r.cw) errs.push(`${which}: .week-wrap scrolls (${r.sw} > ${r.cw})`);
      if (r.heads.join('') !== 'MTWTFSS') errs.push(`${which}: day headings ${JSON.stringify(r.heads)}`);
      if (r.px < 14) errs.push(`${which}: ${r.px}px numbers`);
    }
    if (errs.length) throw new Error(errs.join('; '));
    return page;
  });

  t(`UX-R30 ${vp.width}: "Sent at … (no signal)" is its own wrapping line with a cloud-off icon, inside the text column, clear of the chip`, async (browser) => {
    const page = await open(browser, { viewport: vp, hour: 13.5 });
    await editDb(page, (db) => { const p = db.punches.find((x) => x.crewId === 'c2' && x.type === 'in'); p.receivedAt = p.at + 10 * 60000; });
    await bossToday(page);
    await verifiedCount(page);
    const r = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.shift')].find((x) => /Jake R\./.test(x.innerText));
      const grow = row.querySelector('.grow').getBoundingClientRect();
      const times = row.querySelector('.shift-times').getBoundingClientRect();
      const right = [...row.querySelectorAll('.shift-right > *')].map((e) => e.getBoundingClientRect());
      const els = [...row.querySelectorAll('.grow *')].filter((e) => /Sent at .*\(no signal\)/.test(e.innerText) &&
        ![...e.children].some((c) => /Sent at .*\(no signal\)/.test(c.innerText)));
      const el = els[0] && els[0].closest('div'); // the line holding the words
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const overlaps = right.some((c) => !(b.right <= c.left || b.left >= c.right || b.bottom <= c.top || b.top >= c.bottom));
      const sticking = [...document.querySelectorAll('.shift')].flatMap((s) => {
        const g = s.querySelector('.grow').getBoundingClientRect();
        return [...s.querySelectorAll('.shift-times, .shift-times *')].filter((e) => e.getBoundingClientRect().right > g.right + 1).map((e) => e.innerText);
      });
      return { text: el.innerText.trim(), icon: !!el.querySelector('svg'), right: b.right, growRight: grow.right, top: b.top, timesBottom: times.bottom,
        inTimes: !!el.closest('.shift-times'), overlaps, sticking };
    });
    if (!r) throw new Error('Jake\'s row does not say "Sent at … (no signal)"');
    const errs = [];
    if (/^·/.test(r.text)) errs.push(`starts with a dot: "${r.text}"`);
    if (!r.icon) errs.push('no icon');
    if (r.inTimes || r.top < r.timesBottom - 1) errs.push('not on its own line under the times');
    if (r.right > r.growRight + 1) errs.push(`runs past the text column (${Math.round(r.right)} > ${Math.round(r.growRight)})`);
    if (r.overlaps) errs.push('overlaps the status chip');
    if (r.sticking.length) errs.push(`.shift-times pieces past the column: ${JSON.stringify(r.sticking)}`);
    if (errs.length) throw new Error(errs.join('; '));
    return page;
  });
}

t('UX-R31 after "Try tampering" the red line says what changed in plain words, the row drops "no signal", and "Show me" scrolls to it', async (browser) => {
  const page = await open(browser, { hour: 13.5 });
  await bossToday(page);
  await verifiedCount(page);
  await page.getByRole('button', { name: 'Try tampering' }).click();
  const line = page.locator('[data-verify-line]');
  const said = await until(async () => { const s = await text(line); return /changed/.test(s) ? s : null; }, 8000, 'the red line');
  if (!/^Jake R\.'s clock-in was changed to 6:33\sAM after their phone signed it\./.test(said)) throw new Error(`red line: ${JSON.stringify(said)}`);
  const row = page.locator('.shift', { hasText: 'Jake R.' });
  if (/no signal/.test(await text(row))) throw new Error('the tampered punch is labeled as sent with no signal');
  if (/\blate\b/i.test(await text(row))) throw new Error('the tampered punch is labeled late');
  const show = page.getByRole('link', { name: 'Show me' }).or(page.getByRole('button', { name: 'Show me' }));
  if (await show.count() !== 1) throw new Error('no "Show me" link on the red line');
  await page.evaluate(() => window.scrollTo(0, 0));
  await show.click();
  await page.waitForTimeout(800);
  const inView = await row.evaluate((el) => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; });
  if (!inView) throw new Error('"Show me" did not bring Jake\'s row into view');
  return page;
});

t('UX-R31b a redraw of the boss\'s Today (like the check finishing) keeps where the boss had scrolled to', async (browser) => {
  const page = await open(browser, { hour: 13.5, viewport: { width: 390, height: 600 } });
  await bossToday(page);
  await verifiedCount(page);
  const top = await page.evaluate(() => { const b = document.querySelector('.boss-body'); b.scrollTop = b.scrollHeight; return b.scrollTop; });
  if (top < 100) throw new Error(`setup: Today does not scroll (scrollTop ${top})`);
  // A redraw without moving the page: the Day button, pressed from script
  await page.evaluate(() => document.querySelector('[data-action="today-view"][data-view="day"]').click());
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.querySelector('.boss-body').scrollTop);
  if (Math.abs(after - top) > 2) throw new Error(`scroll jumped from ${top} to ${after} on a redraw`);
  return page;
});

t('UX-R32/R35 with a single punch the verify line and the summary use the singular', async (browser) => {
  const page = await open(browser, { hour: 13.5 });
  await editDb(page, (db) => { db.punches = db.punches.filter((p) => p.crewId === 'c2' && p.type === 'in'); });
  await bossToday(page);
  const n = await verifiedCount(page);
  if (n !== 1) throw new Error(`verified ${n}`);
  if (!/1 punch matches what the phone sent/.test(await text(page.locator('[data-verify-line]')))) throw new Error('not singular');
  const summary = await text(page.locator('.summary'));
  if (!/1 of 1 shift was/.test(summary)) throw new Error(`summary: ${summary}`);
  const hint = await text(page.locator('.verify-demo'));
  if (!/signed on the phone and chained/.test(hint)) throw new Error(`the demo hint does not say how: ${hint}`);
  return page;
});

t('UX-R33 Week shows hours so far for shifts still open today as "6.6+", with a footnote', async (browser) => {
  const page = await open(browser, { hour: 13.5 });
  await bossToday(page);
  await verifiedCount(page); // the team's punches have loaded
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.waitForSelector('table.week');
  const r = await page.evaluate(() => {
    const col = (new Date().getDay() + 6) % 7 + 1;
    const rows = [...document.querySelectorAll('table.week tbody tr')].map((tr) => ({ name: tr.children[0].innerText.trim(), today: tr.children[col].innerText.trim(), total: tr.children[8].innerText.trim() }));
    return { rows, foot: document.querySelector('.boss-body').innerText };
  });
  const jake = r.rows.find((x) => x.name === 'Jake R.');
  const billy = r.rows.find((x) => x.name === 'Billy S.');
  const errs = [];
  if (!/^\d+\.\d\+$/.test(jake.today)) errs.push(`Jake today "${jake.today}"`);
  if (!/\+$/.test(jake.total)) errs.push(`Jake total "${jake.total}"`);
  if (/\+/.test(billy.today)) errs.push(`Billy (clocked out) "${billy.today}"`);
  if (!/\+ still on the clock/.test(r.foot)) errs.push('no "+ still on the clock" footnote');
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

t('UX-R34 demo worker Home invites a visitor to try No signal, until it is on', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Travis K.');
  const hint = page.getByText('Demo: turn on No signal above, then clock in.');
  if (await hint.count() !== 1) throw new Error('no hint on worker Home');
  await page.getByRole('switch', { name: 'No signal' }).click();
  await page.waitForTimeout(200);
  if (await hint.count()) throw new Error('the hint stays while No signal is on');
  return page;
});

// ---------- showcase round: UX-R42, UX-R44, UX-R46 ----------
t('UX-R42 at 7 PM Jake R.\'s Today row and his Week cell for today show the same hours, "8.5"', async (browser) => {
  const page = await open(browser, { hour: 19 });
  await bossToday(page);
  await verifiedCount(page);
  const row = page.locator('.shift', { hasText: 'Jake R.' });
  const rowHours = await text(row.locator('.shift-hours'));
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.waitForSelector('table.week');
  const cell = await page.evaluate(() => {
    const col = (new Date().getDay() + 6) % 7 + 1;
    const tr = [...document.querySelectorAll('table.week tbody tr')].find((x) => x.children[0].innerText.trim() === 'Jake R.');
    return tr ? tr.children[col].innerText.trim() : null;
  });
  const errs = [];
  if (rowHours !== '8.5 h') errs.push(`Today row says "${rowHours}", want "8.5 h"`);
  if (cell !== '8.5') errs.push(`Week cell says "${cell}", want "8.5"`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

t('UX-R44 fresh demo at 1:30 PM: one Today row says "Sent at 7:58 AM (no signal)", Cody M.\'s, and every punch still verifies', async (browser) => {
  const page = await open(browser, { hour: 13.5 });
  await bossToday(page);
  await verifiedCount(page);
  const rows = await page.locator('.shift').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  const late = rows.filter((r) => r.includes('Sent at 7:58 AM (no signal)'));
  const errs = [];
  if (late.length !== 1) errs.push(`${late.length} rows say "Sent at 7:58 AM (no signal)", want 1`);
  else if (!/Cody M\./.test(late[0])) errs.push(`the late row is not Cody M.'s: "${late[0]}"`);
  const line = await text(page.locator('[data-verify-line]'));
  if (!/^Verified: all/.test(line)) errs.push(`verify line: "${line}"`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

t('UX-R46a at 7 PM the boss\'s Today says "Not in (1)", never "Not in yet"', async (browser) => {
  const page = await open(browser, { hour: 19 });
  await bossToday(page);
  await verifiedCount(page);
  const body = await text(page.locator('.boss-body'));
  const errs = [];
  if (!/Not in \(1\)/.test(body)) errs.push('no "Not in (1)"');
  if (/Not in yet/.test(body)) errs.push('still says "Not in yet" at 7 PM');
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

t('UX-R46b before 9 AM, with a visitor\'s clock-in on "Yesterday (sample day)", the summary does not say "so far today"', async (browser) => {
  const page = await open(browser, { hour: 8.3 });
  await travisClocksIn(page);
  await signOut(page);
  await bossToday(page);
  await verifiedCount(page);
  const h2 = await text(page.locator('.boss-body h2'));
  if (h2 !== 'Yesterday (sample day)') throw new Error(`setup: heading "${h2}"`);
  const summary = await text(page.locator('#summary-text, .summary'));
  if (/so far today/.test(summary)) throw new Error(`the sample day's summary says "so far today": "${summary}"`);
  if (!/^\d+ people (have )?worked \d+\.\d hours across \d+ jobs\./.test(summary)) throw new Error(`summary does not read like "5 people have worked 29.0 hours across 4 jobs": "${summary}"`);
  return page;
});

// ---------- the crew app never gets the demo controls ----------
const SB = 'https://fake.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (id, role) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({ org_id: 'org-1', crew_id: id, crew_role: role })}.sig`;
const CREW = [
  { id: '00000000-0000-4000-8000-0000000000b1', name: 'Test Worker', role: 'crew' },
  { id: '00000000-0000-4000-8000-0000000000b0', name: 'Test Boss', role: 'boss' },
];
const JOB = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Test job', address: 'Test Rd', lat: 38.45, lng: -81.93, radius_ft: 300, active: true };
const PUNCH = { id: '00000000-0000-4000-8000-0000000000d1', crew_id: CREW[0].id, by_crew_id: CREW[0].id, job_id: JOB.id, type: 'in',
  phone_at: new Date(Date.now() - 3600000).toISOString(), received_at: new Date(Date.now() - 3590000).toISOString(),
  status: 'onsite', risk: [], sig_ok: true, seq: 1, hash: 'h', signature: 's', device_id: '00000000-0000-4000-8000-0000000000e1' };

async function openCrewApp(browser) {
  const ctx = await browser.newContext(CONTEXT);
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
  await ctx.route(`${SB}/rest/v1/punches*`, (r) => json(r, [PUNCH]));
  await ctx.route(`${SB}/functions/v1/sync`, (r) => json(r, { ok: true, accepted: (r.request().postDataJSON().items || []).map((i) => i.id), rejected: [] }));
  await page.addInitScript(watchPage);
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  return page;
}
async function pinIn(page, name, pin) {
  await page.getByText(name, { exact: true }).click();
  await page.waitForSelector('.keypad');
  for (const k of pin) await page.click(`.keypad [data-k="${k}"]`);
}

t('ENH-1d/ENH-2c the crew app (backend: supabase) never shows "Try tampering" or "No signal", and no verify line without the phones\' keys', async (browser) => {
  const page = await openCrewApp(browser);
  if (await page.evaluate(() => !!(self.Api && self.Api.isDemo))) throw new Error('setup: the supabase build came up in demo mode');
  const found = [];
  const look = async (where) => {
    if (await page.getByRole('button', { name: /Try tampering|Undo the change/ }).count()) found.push(`${where}: tamper control`);
    if (await page.getByText(/No signal/).filter({ has: page.locator('input') }).count()) found.push(`${where}: No signal switch`);
    if (await page.getByRole('checkbox', { name: /No signal/ }).count()) found.push(`${where}: No signal switch`);
    if (await page.getByRole('switch', { name: /No signal/ }).count()) found.push(`${where}: No signal switch`);
    if (await page.locator('[data-action="demo-tamper"], [data-action="demo-offline"]').count()) found.push(`${where}: demo control in the page`);
    if (await page.getByText(/Demo: turn on No signal/).count()) found.push(`${where}: demo No signal hint`);
  };
  await look('sign-in');
  await pinIn(page, 'Test Boss', '1234');
  await page.waitForSelector('.boss');
  await page.click('[data-action="boss-tab"][data-tab="today"]');
  await page.waitForSelector('.boss-body.tab-today');
  await page.waitForTimeout(800); // a verify pass would have finished
  await look('boss Today');
  if (await page.locator('[data-verify-line]').count()) {
    const said = await text(page.locator('[data-verify-line]'));
    if (/Verified|changed/i.test(said)) found.push(`boss Today: verify line without the phones' keys: ${said}`);
  }
  if (found.length) throw new Error(found.join(' | '));
  return page;
});

async function pageState(page) {
  return page.evaluate(() => {
    const h = document.querySelector('#app h1, #app h2, #app .boss-body');
    return `screen "${h ? h.innerText.trim().slice(0, 60) : '?'}"`;
  }).catch((e) => `unreadable (${e.message.split('\n')[0]})`);
}

(async () => {
  const only = process.argv[2];
  const browser = await launch();
  let failed = 0;
  for (const c of cases.filter((x) => !only || x.name.startsWith(only))) {
    let page;
    try {
      page = await c.fn(browser);
      if (page && page.errors.length) throw new Error('page errors: ' + page.errors.join('; '));
      console.log(`ok     ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL   ${c.name}\n       ${e.message.split('\n').slice(0, 10).join('\n       ')}`);
      if (lastPage) console.log(`       page state: ${await pageState(lastPage)}`);
    }
    for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
    lastPage = null;
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

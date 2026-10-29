// M1.6 showcase polish: every demo screen a visitor can reach, at 390x844 and 1280x800, light and
// dark, has no axe violations (WCAG 2.2 A/AA) and the app logs no console errors. Against a demo
// build on :8123:
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   npm install --no-save axe-core@4.11.3
//   node tests/e2e-showcase.js            (or one combo: node tests/e2e-showcase.js 390-dark)
// Map tiles and other off-origin requests are answered empty here, so only same-origin errors count.
const path = require('path');
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const AXE = require.resolve('axe-core/axe.min.js', { paths: [path.join(__dirname, '..')] });
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function gpsAtJob() {
  const at = () => ({ coords: { latitude: 38.454, longitude: -81.929, accuracy: 8 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok(at()), 0);
}

async function newPage(browser, viewport, colorScheme) {
  const ctx = await browser.newContext({ viewport, colorScheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (url && !url.startsWith(ORIGIN)) return; // a tile or other off-origin request
    page.problems.push(`console error: ${m.text()}`);
  });
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsAtJob);
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  return page;
}

// Runs axe on what is on screen now and records each violation against the screen's name.
async function check(page, screen, found) {
  await page.waitForTimeout(150); // let a re-render settle
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async (tags) => {
    const r = await window.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      exclude: [['.leaflet-tile-pane']], // map tiles are images from another site, empty here
    });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1]) }));
  }, TAGS);
  for (const v of res) found.push({ screen, ...v });
  for (const p of page.problems.splice(0)) found.push({ screen, id: 'console', impact: 'serious', help: p, nodes: [] });
}

async function signIn(page, name) {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector('.punch, .boss, .consent, [data-action="prime-location"]');
}
async function signOut(page) {
  const b = page.getByRole('button', { name: 'Not you?' });
  if (await b.count()) await b.click();
  else await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');
}

// Opens a chat thread from the boss's Chat tab and makes sure one of the boss's own bubbles shows.
async function openThread(page, group) {
  await page.click('[data-action="boss-tab"][data-tab="chat"]');
  await page.waitForSelector('[data-action="chat-open"]', { timeout: 20000 });
  await page.locator('[data-action="chat-open"]', { hasText: group }).first().click();
  await page.waitForSelector('#chat-text', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length >= 3, null, { timeout: 20000 }).catch(() => {});
  if (!(await page.locator('.bubble.mine').count())) {
    await page.fill('#chat-text', 'On my way with the trim');
    await page.press('#chat-text', 'Enter');
    await page.waitForSelector('.bubble.mine', { timeout: 20000 });
  }
  await page.waitForTimeout(200);
}

async function walk(browser, viewport, colorScheme) {
  const found = [];
  const page = await newPage(browser, viewport, colorScheme);
  await check(page, 'sign-in names', found);

  // A worker who hasn't agreed: consent, then the primer, then Home with location off.
  await signIn(page, 'Billy S.');
  await check(page, 'consent', found);
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.waitForSelector('.punch, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await check(page, 'permission primer', found);
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
  await check(page, 'home (location off)', found);
  await signOut(page);

  // A crew member: Home, clock in, the done screen.
  await signIn(page, 'Jake R.');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
  await check(page, 'home (crew)', found);
  await page.click('.punch');
  await page.waitForSelector('.job-btn, .big-check, [data-action="photo-file"]', { state: 'attached' });
  if (await page.locator('.job-btn').count()) {
    await check(page, 'job list', found);
    await page.locator('.job-btn').first().click();
  }
  await page.waitForSelector('.big-check, [data-action="photo-file"]', { state: 'attached' });
  await check(page, (await page.locator('.big-check').count()) ? 'done' : 'photo', found);
  if (await page.locator('[data-action="go-home"]').count()) await page.locator('[data-action="go-home"]').first().click();
  else await page.goto(BASE);
  await page.waitForSelector('.punch, .name-btn');
  if (await page.locator('[data-to="chat-list"]').count()) {
    await page.click('[data-to="chat-list"]');
    await page.waitForTimeout(300);
    await check(page, 'chat list', found);
    await page.goBack().catch(() => {});
  }
  await page.goto(BASE);
  await page.waitForSelector('.punch, .name-btn');
  if (await page.locator('.punch').count()) await signOut(page);

  // The foreman: teammate list.
  await signIn(page, 'Ray T.');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
  await page.click('[data-action="teammate"]');
  await page.waitForSelector('[data-action="mate-punch"]');
  await check(page, 'teammate list', found);
  await page.click('[data-action="go-home"]');
  await page.waitForSelector('.punch');
  await signOut(page);

  // The boss: every tab, the job form and the crew form.
  await signIn(page, 'Sam W.');
  await page.waitForSelector('.boss');
  const tabs = await page.locator('[data-action="boss-tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab));
  for (const tab of tabs) {
    await page.click(`[data-action="boss-tab"][data-tab="${tab}"]`);
    await check(page, `boss ${tab}`, found);
  }
  // M1.13: the tamper check (verified, then tampered), the week view, and "No signal" turned on.
  await page.click('[data-action="boss-tab"][data-tab="today"]');
  await page.waitForSelector('.verify.ok, .verify.bad', { timeout: 8000 });
  await check(page, 'boss today (verified)', found);
  await page.click('[data-action="demo-tamper"]');
  await page.waitForSelector('.verify.bad', { timeout: 8000 });
  await check(page, 'boss today (tampered)', found);
  await page.click('[data-action="demo-untamper"]');
  await page.waitForSelector('.verify.ok', { timeout: 8000 });
  await page.click('[data-action="today-view"][data-view="week"]');
  await page.waitForSelector('table.week');
  await check(page, 'boss week', found);
  await page.click('[data-action="today-view"][data-view="day"]');
  await page.click('[data-action="demo-offline"]');
  await check(page, 'boss today (no signal on)', found);
  await page.click('[data-action="demo-offline"]');
  // UX-R41: an open chat thread, with one of the boss's own bubbles in it
  await openThread(page, 'Smith kitchen crew');
  await check(page, 'boss chat thread', found);
  await page.click('[data-action="chat-back"]');
  await page.waitForSelector('.boss');
  await page.click('[data-action="boss-tab"][data-tab="jobs"]');
  await page.click('[data-action="job-new"]');
  await page.waitForSelector('[data-action="job-save"]');
  await check(page, 'job form', found);
  await page.click('[data-action="boss-back"]');
  await page.click('[data-action="boss-tab"][data-tab="crew"]');
  await page.click('[data-action="crew-new"]');
  await page.waitForSelector('[data-action="crew-save"]');
  await check(page, 'crew form', found);
  await page.context().close();
  return found;
}

// The first 90 seconds of a recruiter's visit (ux-reviewer showcase SC-1..SC-3).
const firstVisit = [];
const fv = (name, fn) => firstVisit.push({ name, fn });

async function freshVisitor(browser, at) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  if (at) await page.clock.install({ time: at });
  // A visitor far from West Virginia; counts every location read.
  await page.addInitScript(() => {
    window.__reads = 0;
    const far = () => ({ coords: { latitude: 40.71, longitude: -74.0, accuracy: 20 }, timestamp: Date.now() });
    navigator.geolocation.watchPosition = (ok) => { window.__reads++; setTimeout(() => ok(far()), 0); return 1; };
    navigator.geolocation.clearWatch = () => {};
    navigator.geolocation.getCurrentPosition = (ok) => { window.__reads++; setTimeout(() => ok(far()), 0); };
  });
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  return page;
}
const localAt = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };

fv('SHOW-2 a first-time visitor clocks in without the demo reading their real location, and lands "On site"', async (browser) => {
  const page = await freshVisitor(browser);
  await page.getByRole('button', { name: 'Travis K.' }).first().click();
  await page.waitForSelector('.punch');
  await page.click('.punch');
  await page.waitForSelector('.job-btn, .big-check', { state: 'attached' });
  if (await page.locator('.job-btn').count()) await page.locator('.job-btn').first().click();
  await page.waitForSelector('.big-check, [data-action="photo-file"]', { state: 'attached', timeout: 15000 });
  const reads = await page.evaluate(() => window.__reads);
  if (reads) throw new Error(`the demo read the visitor's location ${reads} time(s)`);
  const text = await page.locator('main').innerText();
  if (!/on site/i.test(text)) throw new Error(`the first clock-in did not land on site: ${JSON.stringify(text.slice(0, 160))}`);
  return page;
});

for (const [h, m] of [[2, 15], [7, 30], [10, 0], [15, 0], [21, 0]]) {
  fv(`SHOW-3 opened at ${h}:${String(m).padStart(2, '0')}, the sample crew works daytime hours and the boss sees a full day`, async (browser) => {
    const page = await freshVisitor(browser, localAt(h, m));
    const hours = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('cc.demo.db'));
      return JSON.parse(localStorage.getItem(k)).punches.map((p) => { const d = new Date(p.at); return d.getHours() + d.getMinutes() / 60; });
    });
    const odd = hours.filter((x) => x < 6 || x > 18);
    if (odd.length) throw new Error(`sample punches at night: ${odd.map((x) => x.toFixed(2)).join(', ')}`);
    await page.getByRole('button', { name: 'Sam W.' }).first().click();
    await page.waitForSelector('.boss');
    await page.click('[data-action="boss-tab"][data-tab="today"]');
    await page.waitForSelector('.shift', { timeout: 5000 }).catch(() => {});
    const rows = await page.locator('.shift').count();
    if (rows < 3) throw new Error(`the boss's day list shows ${rows} shift(s)`);
    return page;
  });
}

fv('SHOW-5 with "pretend I\'m at the job" on (the demo default), a worker who said "Not now" still clocks in with no location', async (browser) => {
  const page = await freshVisitor(browser);
  await page.getByRole('button', { name: 'Billy S.' }).first().click();
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.waitForSelector('.punch');
  await page.click('.punch');
  await page.waitForSelector('.consent');
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.waitForSelector('.job-btn');
  await page.locator('.job-btn').first().click();
  await page.waitForSelector('[data-action="photo-file"]', { state: 'attached' });
  await page.click('[data-action="no-photo"]');
  await page.waitForSelector('.big-check');
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('cc.demo.db'));
    return JSON.parse(localStorage.getItem(k)).punches.filter((x) => x.crewId === 'c4').pop();
  });
  if (!p || p.lat != null || p.lng != null) throw new Error(`Billy's punch carries a location: ${JSON.stringify(p)}`);
  if (await page.evaluate(() => window.__reads)) throw new Error('the demo read the visitor\'s location');
  return page;
});

fv('SHOW-4 the demo\'s first screen says what this is and what to try', async (browser) => {
  const page = await freshVisitor(browser);
  const text = await page.locator('main').innerText();
  const start = await page.locator('.name-btn', { hasText: 'Start here' }).innerText().catch(() => '');
  if (!/Travis K\./.test(start)) throw new Error(`"Start here" is not on a crew member who is off the clock: ${JSON.stringify(start)}`);
  for (const want of [/construction crew/i, /no signal/i, /Start here/, /boss/i]) {
    if (!want.test(text)) throw new Error(`the sign-in screen does not mention ${want}: ${JSON.stringify(text.slice(0, 240))}`);
  }
  return page;
});

// UX-R41: the boss's own bubble in dark mode, text and time, at 4.5:1 or better
fv('UX-R41 dark 390: the boss\'s own chat bubble text and its time have at least 4.5:1 contrast on the bubble', async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(e.message));
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsAtJob);
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  await signIn(page, 'Sam W.');
  await page.waitForSelector('.boss');
  await openThread(page, 'Smith kitchen crew');
  const r = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) stack.push(parse(getComputedStyle(e).backgroundColor)); let c = { r: 0, g: 0, b: 0, a: 1 }; for (const x of stack.reverse()) c = over(x, c); return c; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (el) => { const bg = bgOf(el); const fg = over(parse(getComputedStyle(el).color), bg); const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return { ratio: (hi + 0.05) / (lo + 0.05), fg: getComputedStyle(el).color, bg: getComputedStyle(el.closest('.bubble')).backgroundColor }; };
    const b = document.querySelector('.bubble.mine');
    if (!b) return null;
    const textEl = b.querySelector('span') || b;
    const small = b.querySelector('small');
    return { text: ratio(textEl), small: small ? ratio(small) : null };
  });
  if (!r) throw new Error('no .bubble.mine in the thread');
  const errs = [];
  if (r.text.ratio < 4.5) errs.push(`bubble text ${r.text.fg} on ${r.text.bg}: ${r.text.ratio.toFixed(2)}:1`);
  if (!r.small) errs.push('the bubble has no time (small)');
  else if (r.small.ratio < 4.5) errs.push(`bubble time ${r.small.fg} on ${r.small.bg}: ${r.small.ratio.toFixed(2)}:1`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

(async () => {
  const only = process.argv[2];
  const browser = await launch();
  let failed = 0;
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    for (const scheme of ['light', 'dark']) {
      const name = `${viewport.width}-${scheme}`;
      if (only && name !== only && !`SHOW-1 ${name}`.startsWith(only)) continue;
      try {
        const found = await walk(browser, viewport, scheme);
        if (!found.length) { console.log(`ok     SHOW-1 ${name}: no axe violations or console errors on any screen`); continue; }
        failed++;
        console.log(`FAIL   SHOW-1 ${name}: ${found.length} problem(s)`);
        for (const f of found) console.log(`       [${f.screen}] ${f.id} (${f.impact}): ${f.help}${f.nodes.length ? '\n         ' + f.nodes.join('\n         ') : ''}`);
      } catch (e) {
        failed++;
        console.log(`FAIL   SHOW-1 ${name}: ${e.message.split('\n')[0]}`);
      }
    }
  }
  for (const c of firstVisit.filter((x) => !only || x.name.startsWith(only))) {
    try {
      const page = await c.fn(browser);
      if (page.problems.length) throw new Error('page errors: ' + page.problems.join('; '));
      console.log(`ok     ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL   ${c.name}\n       ${e.message.split('\n')[0]}`);
    }
    for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

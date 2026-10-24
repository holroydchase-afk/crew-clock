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

(async () => {
  const only = process.argv[2];
  const browser = await launch();
  let failed = 0;
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    for (const scheme of ['light', 'dark']) {
      const name = `${viewport.width}-${scheme}`;
      if (only && name !== only) continue;
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
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

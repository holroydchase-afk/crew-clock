// Smoke test of demo mode: crew clock in/out, offline queue, boss map. node tests/e2e.js
const { launch } = require('./browser.js');
(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'],
    geolocation: { latitude: 38.45380, longitude: -81.92900, accuracy: 10 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: `tests/shots/${n}.png` });
  // The demo starts with "pretend I'm at the job" on (M1.6); this smoke test drives the real GPS path.
  await ctx.addInitScript(() => localStorage.setItem('cc.demoFake', 'false'));
  // The sample day depends on the hour (before 9 AM it's yesterday's, "Not in" instead of "Not in yet"),
  // so CI failed overnight. Like e2e-harden, the page's clock starts at 1:30 PM today and runs on.
  const afternoon = new Date(); afternoon.setHours(13, 30, 0, 0);
  await page.clock.install({ time: afternoon });
  await page.goto('http://localhost:8123/');
  // Demo default: no PIN, tapping a name signs in. Boss is labeled and isn't called "Dad".
  const bossLabel = await page.textContent('.name-btn:has-text("Sam W.") .name-role');
  const saysDad = await page.locator('text=Dad').count();
  await page.getByText('Jake R.').click();
  await page.getByText('OK, ask me').click();
  await page.waitForSelector('.punch');
  if (await page.locator('.punch.out').count()) { // seeded demo data has Jake on the clock
    await page.click('.punch.out'); await page.waitForSelector('.big-check'); await page.getByText('OK', { exact: true }).click();
  }
  await page.waitForSelector('.punch.in'); await shot('1-home');
  await page.click('.punch.in');
  await page.waitForSelector('.job-btn.nearest'); await shot('2-pick-job');
  const first = await page.textContent('.job-btn.nearest .job-name');
  await page.click('.job-btn.nearest');
  await page.waitForSelector('.big-check'); await shot('3-done');
  const chipIn = await page.textContent('.chip');
  await page.getByText('OK', { exact: true }).click();
  // offline clock-out queues
  await ctx.setOffline(true);
  await page.click('.punch.out');
  await page.waitForSelector('.big-check');
  const offlineNote = await page.locator('.notice').count(); await shot('4-done-offline');
  await page.getByText('OK', { exact: true }).click();
  // A sync started while online may still be finishing ("Sending…"); the line must settle on "waiting"
  await page.waitForFunction(() => document.querySelector('.sync-line').textContent.includes('waiting'), null, { timeout: 5000 }).catch(() => {});
  const waiting = await page.textContent('.sync-line');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('.sync-line').textContent.includes('All sent'), null, { timeout: 5000 });
  // boss
  await page.getByText('Not you?').click();
  await page.getByText('Sam W.').click();
  await page.waitForSelector('.crew-dot'); await page.waitForTimeout(800); await shot('5-boss-map');
  const dots = await page.locator('.crew-dot').count();
  await page.click('[data-tab="today"]'); await shot('6-boss-today');
  const notIn = await page.textContent('.not-in').catch(() => '');
  await page.click('[data-tab="jobs"]'); await page.getByText('Add job').click();
  await page.fill('#job-name', 'Test job');
  await page.click('[data-mode="pin"]');
  await page.click('#job-map', { position: { x: 150, y: 150 } });
  await page.click('[data-ft="600"]');
  await page.getByText('Save job').click();
  await page.waitForSelector('text=Test job'); await shot('7-jobs');
  // demoPin on: the PIN screen comes back and a wrong PIN doesn't get in
  const pinCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pinPage = await pinCtx.newPage();
  await pinPage.route('**/config.js', async (route) => {
    const body = (await (await route.fetch()).text()).replace('demoPin: false', 'demoPin: true');
    route.fulfill({ body, contentType: 'application/javascript' });
  });
  await pinPage.goto('http://localhost:8123/');
  await pinPage.getByText('Cody M.').click();
  await pinPage.waitForSelector('.keypad');
  for (const k of '9999') await pinPage.click(`.keypad [data-k="${k}"]`);
  await pinPage.waitForSelector('.error');
  for (const k of '2222') await pinPage.click(`.keypad [data-k="${k}"]`);
  await pinPage.waitForSelector('.punch, .big-icon');
  const pinMode = true;
  console.log(JSON.stringify({ bossLabel, saysDad, first, chipIn, offlineNote, waiting, dots, notIn, pinMode, errors }, null, 1));
  await browser.close();
  if (errors.length || bossLabel !== 'Boss' || saysDad || !chipIn.includes('On site') || !offlineNote || !waiting.includes('waiting') || dots < 1 || !notIn.includes('Not in yet')) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

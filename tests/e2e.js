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
  await page.goto('http://localhost:8123/');
  await page.getByText('Jake R.').click();
  for (const k of '1111') await page.click(`.keypad [data-k="${k}"]`);
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
  const waiting = await page.textContent('.sync-line');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('.sync-line').textContent.includes('All sent'), null, { timeout: 5000 });
  // boss
  await page.getByText('Not you?').click();
  await page.getByText('Dad').click();
  for (const k of '1234') await page.click(`.keypad [data-k="${k}"]`);
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
  console.log(JSON.stringify({ first, chipIn, offlineNote, waiting, dots, notIn, errors }, null, 1));
  await browser.close();
  if (errors.length || !chipIn.includes('On site') || !offlineNote || !waiting.includes('waiting') || dots < 1 || !notIn.includes('Not in yet')) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

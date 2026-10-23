// Demo-mode chat: the boss starts an encrypted group with Jake, they trade messages,
// and the shared store never holds plaintext. node tests/e2e-chat.js (with npm run serve)
const { launch } = require('./browser.js');
(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 38.4538, longitude: -81.929, accuracy: 10 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const login = async (name) => { await page.getByText(name, { exact: true }).click(); }; // demo: no PIN
  const signOut = async () => { page.once('dialog', (d) => d.accept()); await page.click('[data-action="sign-out"]'); };
  await page.goto('http://localhost:8123/');
  await login('Jake R.');
  await page.getByText('OK, ask me').click().catch(() => {});
  await page.waitForSelector('[data-to="chat-list"]');
  await page.waitForFunction(() => JSON.stringify(localStorage).includes('keyPackages') && localStorage.getItem('cc.demo.chat').includes('c2'), null, { timeout: 15000 });
  await signOut();
  await login('Sam W.');
  await page.click('[data-tab="chat"]');
  await page.click('[data-action="chat-new"]');
  await page.fill('#chat-name', 'Smith kitchen crew');
  await page.check('.pick input[value="c2"]');
  await page.click('[data-action="chat-create"]');
  await page.waitForSelector('#chat-text');
  await page.fill('#chat-text', 'Be there at 7, bring the nail gun');
  await page.press('#chat-text', 'Enter');
  await page.waitForSelector('.bubble.mine');
  await page.screenshot({ path: 'tests/shots/8-chat-dad.png' });
  await page.click('[data-action="chat-back"]');
  await signOut();
  await login('Jake R.');
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-to="chat-list"]').count())) console.log('SCREEN:', (await page.locator('#app').innerText()).slice(0, 400), errors);
  await page.click('[data-to="chat-list"]');
  await page.waitForSelector('[data-action="chat-open"]', { timeout: 15000 });
  await page.click('[data-action="chat-open"]');
  await page.waitForSelector('.bubble:not(.mine)');
  const got = await page.textContent('.bubble:not(.mine) span');
  await page.fill('#chat-text', 'On my way');
  await page.press('#chat-text', 'Enter');
  await page.waitForSelector('.bubble.mine');
  await page.screenshot({ path: 'tests/shots/9-chat-jake.png' });
  const store = await page.evaluate(() => localStorage.getItem('cc.demo.chat'));
  const leaked = store.includes('nail gun') || store.includes('On my way');
  console.log(JSON.stringify({ got, leaked, errors }));
  await browser.close();
  if (got !== 'Be there at 7, bring the nail gun' || leaked || errors.length) process.exit(1);
})().catch(async (e) => { console.error('FAIL', e.message); process.exit(1); });

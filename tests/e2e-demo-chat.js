// M1.10-a CHAT-SEED: a visitor to the public demo finds a sample crew chat already going.
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-demo-chat.js            (or one case: node tests/e2e-demo-chat.js CHAT-SEED-2)
// Every off-origin request is answered in the test (never reaches the internet).
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const CONTEXT = { viewport: { width: 390, height: 844 }, serviceWorkers: 'block' };
const cases = [];
const t = (name, fn) => cases.push({ name, fn });
const WAIT = 20000; // the first chat load fetches the MLS bundle and joins groups

let lastPage = null;
async function open(browser) {
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(() => { try { localStorage.setItem('cc.demoFake', 'true'); } catch (e) { /* ok */ } });
  await page.goto(BASE);
  return { ctx, page };
}

async function signIn(page, name) {
  await page.waitForSelector('.name-btn');
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector('.punch, .boss, [data-action="prime-location"]');
  if (await page.locator('[data-action="prime-location"]').count()) {
    await page.click('[data-action="prime-location"]');
    await page.waitForSelector('.punch');
  }
}
async function signOut(page) {
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');
}

// Opens the chat list for whoever is signed in (boss: Chat tab; crew: Messages on Home)
// and waits until it has loaded (no "Loading…").
async function chatList(page) {
  if (await page.locator('.boss').count()) {
    await page.click('[data-action="boss-tab"][data-tab="chat"]');
    await page.waitForSelector('.boss-body.tab-chat');
  } else {
    await page.click('[data-to="chat-list"]');
  }
  await page.waitForFunction(() => {
    const l = document.querySelector('#app .list');
    return l && !/Loading/.test(l.innerText);
  }, null, { timeout: WAIT });
}

// Rows in the loaded chat list, as { name, preview }. Waits a while for a seeded group to show up.
async function groups(page, expectSome) {
  if (expectSome) await page.waitForSelector('[data-action="chat-open"]', { timeout: WAIT }).catch(() => {});
  return page.$$eval('[data-action="chat-open"]', (rows) => rows.map((r) => ({
    name: (r.querySelector('.job-name') || r).innerText.trim(),
    preview: (r.querySelector('.job-addr') || { innerText: '' }).innerText.trim(),
  })));
}
async function listText(page) { return (await page.locator('#app .list').first().innerText()).trim().slice(0, 120); }

async function openGroup(page, name) {
  await page.locator('[data-action="chat-open"]', { hasText: name }).first().click();
  await page.waitForSelector('.screen.chat');
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length >= 3, null, { timeout: WAIT }).catch(() => {});
  return page.$$eval('.bubble', (bs) => bs.map((b) => ({
    from: b.classList.contains('mine') ? 'me' : (b.querySelector('b') || { innerText: '' }).innerText.trim(),
    text: (b.querySelector('span') || { innerText: '' }).innerText.trim(),
  })));
}

// The boss's first look at Chat: a sample group with a preview, readable messages from 2+ named crew.
async function bossSeesSample(page) {
  await signIn(page, 'Sam W.');
  await chatList(page);
  const gs = await groups(page, true);
  if (!gs.length) throw new Error(`the boss's Chat tab shows no sample group, it says: "${await listText(page)}"`);
  const g = gs.find((x) => x.preview && !/No messages yet/i.test(x.preview));
  if (!g) throw new Error(`no sample group has a last-message preview: ${JSON.stringify(gs)}`);
  const msgs = await openGroup(page, g.name);
  const readable = msgs.filter((m) => m.text.length >= 4);
  if (readable.length < 3) throw new Error(`"${g.name}" shows ${readable.length} readable message(s), want 3+: ${JSON.stringify(msgs)}`);
  const senders = [...new Set(msgs.filter((m) => m.from !== 'me').map((m) => m.from))];
  if (senders.length < 2 || senders.some((s) => !s || s === 'Crew')) throw new Error(`want messages from 2+ named sample crew, got senders ${JSON.stringify(senders)}`);
  return { group: g.name, texts: readable.map((m) => m.text) };
}

t('CHAT-SEED-1 fresh demo: the boss sees a sample group with a preview and 3+ readable messages from 2+ named crew', async (browser) => {
  const { page } = await open(browser);
  await bossSeesSample(page);
  return page;
});

t('CHAT-SEED-2 the shared demo chat store holds only ciphertext, never the sample messages in plain text', async (browser) => {
  const { page } = await open(browser);
  const { texts } = await bossSeesSample(page);
  const store = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
  if (!store.includes('demo.chat')) throw new Error('no demo chat store in localStorage (expected cc.demo.chat)');
  const leaked = texts.filter((s) => store.includes(s) || store.includes(JSON.stringify(s).slice(1, -1)));
  if (leaked.length) throw new Error(`localStorage holds sample messages in plain text: ${JSON.stringify(leaked)}`);
  return page;
});

t('CHAT-SEED-3 Jake R. (a member) sees the sample group and the same messages; Travis K. (not a member) does not see it', async (browser) => {
  const { page } = await open(browser);
  const { group, texts } = await bossSeesSample(page);
  await page.click('[data-action="chat-back"]');
  await signOut(page);
  await signIn(page, 'Jake R.');
  await chatList(page);
  const jg = await groups(page, true);
  if (!jg.some((g) => g.name === group)) throw new Error(`Jake doesn't see "${group}"; his list says "${await listText(page)}"`);
  const jm = (await openGroup(page, group)).map((m) => m.text);
  const missing = texts.filter((s) => !jm.includes(s));
  if (missing.length) throw new Error(`Jake is missing messages the boss sees: ${JSON.stringify(missing)}`);
  await page.click('[data-action="chat-back"]');
  await page.click('[data-action="go-home"]');
  await signOut(page);
  await signIn(page, 'Travis K.');
  await chatList(page);
  await page.waitForTimeout(1500);
  const tg = await groups(page, false);
  if (tg.some((g) => g.name === group)) throw new Error(`Travis K. is not in "${group}" but sees it`);
  return page;
});

t('CHAT-SEED-4 a visitor (as the boss) sends a new message in the sample group and Jake R. sees it', async (browser) => {
  const { page } = await open(browser);
  const { group } = await bossSeesSample(page);
  const mine = 'Visitor test message 4471';
  await page.fill('#chat-text', mine);
  await page.press('#chat-text', 'Enter');
  await page.waitForSelector(`.bubble.mine:has-text("${mine}")`);
  await page.click('[data-action="chat-back"]');
  await signOut(page);
  await signIn(page, 'Jake R.');
  await chatList(page);
  await groups(page, true);
  await page.locator('[data-action="chat-open"]', { hasText: group }).first().click();
  await page.waitForSelector(`.bubble:not(.mine):has-text("${mine}")`, { timeout: WAIT })
    .catch(() => { throw new Error(`Jake doesn't see the visitor's message in "${group}"`); });
  const store = await page.evaluate(() => localStorage.getItem('cc.demo.chat') || '');
  if (store.includes(mine)) throw new Error('the shared demo chat store holds the visitor message in plain text');
  return page;
});

t('CHAT-SEED-5 after "Reset sample data" the sample group is back for the boss', async (browser) => {
  const { page } = await open(browser);
  const before = await bossSeesSample(page);
  await page.click('[data-action="chat-back"]');
  await page.getByRole('button', { name: 'Reset sample data' }).click();
  await page.waitForSelector('.name-btn');
  const after = await bossSeesSample(page);
  if (after.group !== before.group) throw new Error(`after reset the sample group is "${after.group}", before it was "${before.group}"`);
  return page;
});

async function pageState(page) {
  return page.evaluate(() => {
    const h = document.querySelector('#app h1, #app h2, #app .job-name');
    return `screen "${h ? h.innerText.trim().slice(0, 50) : '?'}"`;
  }).catch((e) => `unreadable (${e.message.split('\n')[0]})`);
}

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
      if (lastPage) console.log(`       page state: ${await pageState(lastPage)}`);
    }
    for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
    lastPage = null;
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

// The Supabase adapter against a fake Supabase: PIN login registers the phone key,
// a no-GPS clock-in takes a photo, the photo goes to Backblaze, and the punch
// arrives signed and chained. node tests/e2e-supabase.js (with npm run serve)
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SB = 'https://fake.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ org_id: 'org-1', crew_id: '00000000-0000-4000-8000-0000000000b1', crew_role: 'crew', device_id: 'x', exp: 9e9 })}.sig`;
const JAKE = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Jake R.', role: 'crew' };
const JOB = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Smith kitchen', address: 'Teays Valley', lat: 38.4537, lng: -81.929, radius_ft: 300, active: true };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errors = [];
  const seen = { login: null, syncs: [], b2: 0, upload: 0 };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    // GPS that never answers, like a phone deep in a hollow.
    navigator.geolocation.watchPosition = () => 1;
    navigator.geolocation.clearWatch = () => {};
    navigator.geolocation.getCurrentPosition = (ok, err) => err && err({ code: 3 });
  });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body:
    `window.APP_CONFIG = { backend: 'supabase', supabaseUrl: '${SB}', supabaseAnonKey: 'anon', orgCode: 'TEAYS', gpsTimeoutMs: 1500 };` }));
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`${SB}/functions/v1/crew-list`, (r) => json(r, { ok: true, crew: [JAKE] }));
  await page.route(`${SB}/functions/v1/pin-login`, (r) => { seen.login = r.request().postDataJSON(); json(r, { ok: true, token, expiresAt: Date.now() + 864e5, me: JAKE }); });
  await page.route(`${SB}/rest/v1/jobs*`, (r) => json(r, [JOB]));
  await page.route(`${SB}/rest/v1/crew*`, (r) => json(r, [JAKE]));
  await page.route(`${SB}/rest/v1/punches*`, (r) => json(r, []));
  await page.route(`${SB}/rest/v1/mls_*`, (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 201, body: '' }) : json(r, [])));
  await page.route(`${SB}/rest/v1/chat_*`, (r) => json(r, []));
  await page.route(`${SB}/functions/v1/photo-upload`, (r) => { seen.upload++; json(r, { ok: true, key: 'org-1/day/p.jpg', url: 'https://b2.test/put-here' }); });
  await page.route('https://b2.test/**', (r) => { seen.b2 = r.request().postDataBuffer().length; r.fulfill({ status: 200, body: '' }); });
  await page.route(`${SB}/functions/v1/sync`, (r) => {
    const items = r.request().postDataJSON().items;
    seen.syncs.push(items);
    json(r, { ok: true, accepted: items.map((i) => i.id), rejected: [] });
  });

  await page.goto('http://localhost:8123/');
  await page.getByText('Jake R.', { exact: true }).click();
  for (const k of '1111') await page.click(`.keypad [data-k="${k}"]`);
  await page.getByText('OK, ask me').click();
  await page.click('.punch.in');
  await page.click('.job-btn');
  await page.waitForSelector('input[data-action="photo-file"]', { state: 'attached' });
  await page.setInputFiles('input[data-action="photo-file"]', path.join(__dirname, 'fixtures/site.jpg'));
  await page.waitForSelector('.big-check');
  const chip = await page.textContent('.chip');
  await page.getByText('OK', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.sync-line').textContent.includes('All sent'), null, { timeout: 10000 });

  const punch = seen.syncs.flat().find((i) => i.kind === 'punch');
  const result = {
    chip,
    loginSentPublicKey: !!(seen.login && seen.login.device && seen.login.device.publicKey && seen.login.device.publicKey.kty === 'EC'),
    loginSentNoPrivateKey: !JSON.stringify(seen.login).includes('"d"'),
    photoUploadedBytes: seen.b2,
    punchHasPhotoKey: punch && punch.photoKey === 'org-1/day/p.jpg',
    punchCarriesNoPhotoData: punch && !punch.photo,
    signed: punch && !!punch.signature && punch.seq === 1 && punch.prevHash === 'genesis' && !!punch.photoSha256,
    errors,
  };
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
  const ok = result.chip.includes('No GPS') && result.loginSentPublicKey && result.loginSentNoPrivateKey && result.photoUploadedBytes > 1000 &&
    result.punchHasPhotoKey && result.punchCarriesNoPhotoData && result.signed && !errors.length;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

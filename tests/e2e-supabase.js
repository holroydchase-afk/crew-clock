// The Supabase adapter against a fake Supabase: PIN login registers the phone key,
// a no-GPS clock-in takes a photo, the photo goes to Backblaze, and the punch
// arrives signed and chained. Sessions refresh with Supabase Auth and the PIN is never stored.
// node tests/e2e-supabase.js (with npm run serve)
const path = require('path');
const { launch } = require('./browser.js');
const SB = 'https://fake.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenN = (n) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({ org_id: 'org-1', crew_id: '00000000-0000-4000-8000-0000000000b1', crew_role: 'crew', n })}.sig`;
const JAKE = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Jake R.', role: 'crew' };
const JOB = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Smith kitchen', address: 'Teays Valley', lat: 38.4537, lng: -81.929, radius_ft: 300, active: true };

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errors = [];
  const seen = { login: null, syncs: [], b2: 0, upload: 0, refreshes: [], bearers: new Set() };
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
  // The first access token is about to run out, so the app has to refresh before using it.
  await page.route(`${SB}/functions/v1/pin-login`, (r) => { seen.login = r.request().postDataJSON();
    json(r, { ok: true, accessToken: tokenN(0), refreshToken: 'rt-0', expiresAt: Date.now() + 30000, me: JAKE, deviceId: seen.login.device.deviceId }); });
  await page.route(`${SB}/auth/v1/token*`, (r) => {
    if (seen.revoked) return json(r, { error: 'invalid_grant', error_description: 'Refresh Token Not Found' }, 400);
    const n = seen.refreshes.push(r.request().postDataJSON().refresh_token);
    json(r, { access_token: tokenN(n), refresh_token: `rt-${n}`, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
  });
  page.on('request', (q) => { if (q.url().startsWith(SB) && !q.url().includes('/auth/v1/')) seen.bearers.add(q.headers().authorization); });
  await page.route(`${SB}/rest/v1/jobs*`, (r) => json(r, [JOB]));
  await page.route(`${SB}/rest/v1/crew*`, (r) => json(r, [JAKE]));
  await page.route(`${SB}/rest/v1/punches*`, (r) => json(r, []));
  // Jake agreed to location on install day (M1.2), so sign-in goes straight on to the permission primer
  await page.route(`${SB}/rest/v1/location_consents*`, (r) => json(r, [{ id: 'k-1', crew_id: JAKE.id, action: 'agree', text_version: 'loc-v1', phone_at: '2026-10-01T11:00:00Z' }]));
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

  const pinNotStored = !(await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)))).includes('1111');

  // Boss changes Jake's PIN: the server drops his refresh token, so the phone goes back to the name list.
  seen.revoked = true;
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('cc.sbSession'));
    localStorage.setItem('cc.sbSession', JSON.stringify(Object.assign(s, { expiresAt: 0 })));
    return self.CrewClock.syncNow();
  });
  await page.waitForFunction(() => !self.CrewClock.state.auth, null, { timeout: 5000 }).catch(() => {});
  const signedOutWhenRevoked = await page.evaluate(() => !self.CrewClock.state.auth && !localStorage.getItem('cc.sbSession'));

  const punch = seen.syncs.flat().find((i) => i.kind === 'punch');
  const result = {
    chip,
    loginSentPublicKey: !!(seen.login && seen.login.device && seen.login.device.publicKey && seen.login.device.publicKey.kty === 'EC'),
    loginSentNoPrivateKey: !JSON.stringify(seen.login).includes('"d"'),
    photoUploadedBytes: seen.b2,
    punchHasPhotoKey: punch && punch.photoKey === 'org-1/day/p.jpg',
    punchCarriesNoPhotoData: punch && !punch.photo,
    signed: punch && !!punch.signature && punch.seq === 1 && punch.prevHash === 'genesis' && !!punch.photoSha256,
    refreshedWithLoginToken: seen.refreshes[0] === 'rt-0',
    staleTokenNeverUsed: ![...seen.bearers].includes(`Bearer ${tokenN(0)}`),
    signedOutWhenRevoked,
    pinNotStored,
    errors,
  };
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
  const ok = result.chip.includes('No GPS') && result.loginSentPublicKey && result.loginSentNoPrivateKey && result.photoUploadedBytes > 1000 &&
    result.punchHasPhotoKey && result.punchCarriesNoPhotoData && result.signed &&
    result.refreshedWithLoginToken && result.staleTokenNeverUsed && result.pinNotStored && result.signedOutWhenRevoked && !errors.length;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

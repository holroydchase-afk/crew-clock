// Studio design-system restyle, what a person sees (docs/design/CRW-RESTYLE.md):
//   DS-1 the bundled Atkinson Hyperlegible Next actually loads, from this site, and body uses it
//   DS-2 nothing renders bold (700+), italic or text-transform: uppercase; the punch button reads "Clock in"
//   DS-3 no rendered text under 17 px on the demo screens
//   DS-8 every button, link and input is at least 48x48 CSS px at 390 (inline links in a sentence
//        and Leaflet's attribution are exempt, as the spec says)
// Screens: sign-in, worker Home, boss Map / Today / Jobs / Crew / Messages, at 390x844 and
// 1280x800, light. Static CSS checks are in tests/theme.test.js. Against a demo build on :8123:
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8123 -c-1 -s &
//   node tests/e2e-design.js               (or one viewport: node tests/e2e-design.js 390)
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const FAMILY = 'Atkinson Hyperlegible Next';
const BOSS_TABS = ['map', 'today', 'jobs', 'crew', 'chat'];
// Words a person may see in capitals because they are written that way, not shouted
const ACRONYMS = new Set(['GPS', 'CSV', 'PIN', 'AM', 'PM', 'ID', 'OK', 'WV', 'PWA', 'MLS', 'US', 'SMS', 'PDF', 'URL', 'OSM', 'USGS', 'ES256']);

function gpsAtJob() {
  const at = () => ({ coords: { latitude: 38.454, longitude: -81.929, accuracy: 8 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok(at()), 0);
}

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'light', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.problems = [];
  page.fonts = { local: [], offsite: [] };
  page.on('pageerror', (e) => page.problems.push(`page error: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  page.on('response', (r) => { if (/\.woff2?(\?|$)/.test(r.url()) && r.url().startsWith(ORIGIN)) page.fonts.local.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await ctx.route((u) => u.origin !== ORIGIN, (r) => {
    const req = r.request();
    if (req.resourceType() === 'font' || /fonts\.(googleapis|gstatic)/.test(req.url())) page.fonts.offsite.push(req.url());
    return r.fulfill({ status: 204, body: '' });
  });
  await page.addInitScript(gpsAtJob);
  await page.goto(BASE);
  await page.waitForSelector('.name-btn');
  return page;
}

async function signIn(page, name) {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForSelector('.punch, .boss, .consent, [data-action="prime-location"]');
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

// Runs in the page: looks at every rendered text node and every control on screen now.
function audit({ checkTargets, acronyms }) {
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    if (typeof el.className === 'string' && el.className.trim()) s += `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
    if (el.dataset && el.dataset.action) s += `[data-action=${el.dataset.action}]`;
    return s;
  };
  // Visually hidden (screen-reader-only) or not on the page at all
  const hidden = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
      const r = e.getBoundingClientRect();
      if ((r.width <= 1 || r.height <= 1) && cs.overflow !== 'visible') return true;
    }
    return false;
  };
  const out = { small: [], caps: [], heavy: [], italic: [], upper: [], targets: [] };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || el.closest('script, style, noscript, .leaflet-tile-pane')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rr = range.getBoundingClientRect();
    if (rr.width < 1 || rr.height < 1 || hidden(el)) continue;
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const what = `${label(el)} "${text.slice(0, 28)}"`;
    if (px < 17) out.small.push(`${what} ${px}px`);
    if (Number(cs.fontWeight) >= 700) out.heavy.push(`${what} weight ${cs.fontWeight}`);
    if (cs.fontStyle !== 'normal') out.italic.push(`${what} ${cs.fontStyle}`);
    if (cs.textTransform === 'uppercase') out.upper.push(what);
    // A node that is only initials ("TK" on an avatar or map dot) is a name, not shouting
    const shouty = /^[A-Z]{1,3}$/.test(text) ? [] : (text.match(/\b[A-Z]{2,}\b/g) || []).filter((w) => !acronyms.includes(w));
    if (shouty.length) out.caps.push(`${what}: ${shouty.join(' ')}`);
  }
  if (checkTargets) {
    const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=switch], [role=tab], [role=checkbox]';
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('.leaflet-control-attribution')) continue;
      // A checkbox, radio or visually hidden input is hit through its label
      let box = el;
      const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
      if (el.matches('input') && lab && (el.matches('[type=checkbox], [type=radio]') || hidden(el))) box = lab;
      if (hidden(box)) continue;
      // An inline link inside a sentence (the spec's exemption): the block around it has other words
      if (el.matches('a') && getComputedStyle(el).display === 'inline') {
        const block = el.parentElement.closest('p, li, div, span, small, label') || el.parentElement;
        if (block.textContent.replace(/\s+/g, ' ').trim().length > el.textContent.trim().length + 3) continue;
      }
      const r = box.getBoundingClientRect();
      if (r.width < 47.5 || r.height < 47.5) out.targets.push(`${label(el)} "${(el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return out;
}

// Signs in to each screen in turn and audits it; returns findings keyed by check, plus the font state.
async function walk(browser, viewport) {
  const found = { small: [], caps: [], heavy: [], italic: [], upper: [], targets: [], punch: [] };
  const page = await newPage(browser, viewport);
  const checkTargets = viewport.width === 390;
  const look = async (screen) => {
    await page.waitForTimeout(200); // let a re-render settle
    const r = await page.evaluate(audit, { checkTargets, acronyms: [...ACRONYMS] });
    for (const k of Object.keys(r)) for (const x of r[k]) found[k].push(`[${screen}] ${x}`);
  };
  await look('sign-in');

  // Worker Home: Travis K. is the visitor's "Start here", off the clock
  await signIn(page, 'Travis K.');
  await page.waitForSelector('.punch');
  await look('worker Home');
  if (!(await page.getByRole('button', { name: 'Clock in', exact: true }).count())) {
    found.punch.push(`[worker Home] no button named exactly "Clock in" (punch reads ${JSON.stringify((await page.locator('.punch').innerText()).trim())})`);
  }
  await signOut(page);

  // The boss, every tab the spec names
  await signIn(page, 'Sam W.');
  await page.waitForSelector('.boss');
  for (const tab of BOSS_TABS) {
    const btn = page.locator(`[data-action="boss-tab"][data-tab="${tab}"]`);
    if (!(await btn.count())) { found.punch.push(`boss tab "${tab}" is missing`); continue; }
    await btn.click();
    if (tab === 'map') await page.waitForSelector('.leaflet-container', { timeout: 8000 }).catch(() => {});
    if (tab === 'today') await page.waitForSelector('.shift', { timeout: 8000 }).catch(() => {});
    if (tab === 'chat') await page.waitForSelector('[data-action="chat-open"]', { timeout: 20000 }).catch(() => {});
    await look(`boss ${tab}`);
  }

  const fonts = await page.evaluate(async (family) => {
    await document.fonts.ready;
    const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === family);
    return {
      faces: faces.map((f) => `${f.weight} ${f.status}`),
      check: document.fonts.check(`17px "${family}"`) && document.fonts.check(`600 17px "${family}"`),
      body: getComputedStyle(document.body).fontFamily,
    };
  }, FAMILY);
  const net = page.fonts;
  const problems = page.problems.slice();
  await page.context().close();
  return { found, fonts, net, problems };
}

const uniq = (xs) => [...new Set(xs)];
const show = (xs) => { const u = uniq(xs); return `${u.length} found:\n         ${u.slice(0, process.env.VERBOSE ? u.length : 15).join('\n         ')}${u.length > 15 && !process.env.VERBOSE ? `\n         ... and ${u.length - 15} more` : ''}`; };

(async () => {
  const only = process.argv[2];
  const browser = await launch();
  let failed = 0;
  const report = (name, errs) => {
    if (!errs) { console.log(`ok     ${name}`); return; }
    failed++;
    console.log(`FAIL   ${name}\n       ${errs}`);
  };
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const vp = `${viewport.width}x${viewport.height} light`;
    if (only && !String(viewport.width).startsWith(only)) continue;
    let res;
    try {
      res = await walk(browser, viewport);
    } catch (e) {
      failed++;
      console.log(`FAIL   DS-* ${vp}: the walk did not finish: ${e.message.split('\n')[0]}`);
      continue;
    }
    const { found, fonts, net, problems } = res;

    const ds1 = [];
    const loaded = (w) => fonts.faces.includes(`${w} loaded`);
    if (!loaded(400) || !loaded(600)) ds1.push(`${FAMILY} 400 and 600 not both loaded (faces: ${JSON.stringify(fonts.faces)})`);
    if (!fonts.check) ds1.push('document.fonts.check() is false for the family');
    if (!/^"?Atkinson Hyperlegible Next"?\s*,/.test(fonts.body)) ds1.push(`body font-family is ${fonts.body}`);
    if (!net.local.some((x) => /^200 .*\/vendor\/fonts\/atkinson-hyperlegible-next\/.*\.woff2$/.test(x))) ds1.push(`no woff2 loaded from this site (${JSON.stringify(net.local)})`);
    if (net.offsite.length) ds1.push(`font requests off the site: ${uniq(net.offsite).join(', ')}`);
    report(`DS-1 ${vp}: the bundled ${FAMILY} loads from this site and body uses it first`, ds1.length ? ds1.join('; ') : null);

    const ds2 = [...found.heavy, ...found.italic, ...found.upper, ...found.caps, ...found.punch];
    report(`DS-2 ${vp}: no bold, italic or all-caps text on any screen; the punch button reads "Clock in"`, ds2.length ? show(ds2) : null);

    report(`DS-3 ${vp}: no rendered text under 17px on sign-in, worker Home and the boss's five tabs`, found.small.length ? show(found.small) : null);

    if (viewport.width === 390) {
      report(`DS-8 ${vp}: every button, link and input is at least 48x48 (inline links and Leaflet attribution exempt)`, found.targets.length ? show(found.targets) : null);
    }
    if (problems.length) report(`DS-* ${vp}: no page errors`, problems.join('; '));
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

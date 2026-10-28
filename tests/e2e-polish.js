// M1.11 "UI to 8/10": the ux-reviewer's showcase findings (UX-R1 to UX-R17), each as a browser case
// named by its finding ID. Wording is matched loosely (key words); behavior and geometry firmly.
//   node scripts/build-site.mjs dist --demo && npx http-server dist -p 8125 -c-1 -s &
//   BASE_URL=http://localhost:8123/ node tests/e2e-polish.js     (or one case: ... e2e-polish.js UX-R4)
// Every off-origin request (map tiles) is answered empty in the test, never reaching the internet.
// The page clock starts at 1:30 PM today, so the sample crew is mid-shift and Billy S. is clocked out.
const { launch } = require('./browser.js');

const BASE = process.env.BASE_URL || 'http://localhost:8123/';
const ORIGIN = new URL(BASE).origin;
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const cases = [];
const t = (name, fn) => cases.push({ name, fn });

function gpsAtJob() {
  const at = () => ({ coords: { latitude: 38.454, longitude: -81.929, accuracy: 8 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(at()), 0); return 1; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok(at()), 0);
}

async function open(browser, viewport = PHONE, hour = 13.5, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route((u) => u.origin !== ORIGIN, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(gpsAtJob);
  const when = new Date(); when.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  await page.clock.install({ time: when });
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
async function bossTab(page, tab) {
  await page.click(`[data-action="boss-tab"][data-tab="${tab}"]`);
  await page.waitForSelector(`.boss-body.tab-${tab}`);
  await page.waitForTimeout(200);
}
async function boss(page, tab) {
  await signIn(page, 'Sam W.');
  await page.waitForFunction(() => document.querySelector('.boss'));
  await bossTab(page, tab);
}
// Waits for the map's crew markers (the team list loads after sign-in).
async function crewMarkers(page) {
  await page.waitForSelector('.leaflet-marker-icon .crew-dot', { timeout: 10000 });
  await page.waitForTimeout(200);
}
const box = (page, sel) => page.locator(sel).first().boundingBox();

// ---------- UX-R1: "Start here" in the first viewport ----------
for (const vp of [PHONE, LAPTOP]) {
  t(`UX-R1 ${vp.width}x${vp.height}: the "Start here" entry (Travis K.) is fully on the first screen, no scrolling`, async (browser) => {
    const page = await open(browser, vp);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('button, a')].filter((b) =>
        /start here/i.test(b.innerText) && /travis/i.test(b.innerText) || /try it as a worker/i.test(b.innerText));
      const b = cands[0];
      if (!b) return null;
      const rc = b.getBoundingClientRect();
      return { top: rc.top + scrollY, bottom: rc.bottom + scrollY, left: rc.left, right: rc.right, text: b.innerText.replace(/\s+/g, ' ') };
    });
    if (!r) throw new Error('no "Start here" (Travis K.) button or "Try it as a worker" button found');
    if (r.top < 0 || r.bottom > vp.height || r.left < 0 || r.right > vp.width) {
      throw new Error(`"${r.text}" spans y ${Math.round(r.top)}..${Math.round(r.bottom)}; the first screen ends at ${vp.height}`);
    }
    return page;
  });
}

// ---------- UX-R17: laptop sign-in is pitch + app side by side ----------
t('UX-R17 1280x800: sign-in shows the pitch and the names side by side, content at least 900px wide', async (browser) => {
  const page = await open(browser, LAPTOP);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const pitch = [...document.querySelectorAll('#app *')].find((el) => el.children.length && /GPS time clock/i.test(el.innerText)
      && ![...el.children].some((k) => /GPS time clock/i.test(k.innerText) && k.children.length));
    const grid = document.querySelector('.name-grid');
    if (!pitch || !grid) return null;
    const a = pitch.getBoundingClientRect(); const b = grid.getBoundingClientRect();
    return { a: { l: a.left, r: a.right, t: a.top, b: a.bottom }, b: { l: b.left, r: b.right, t: b.top, b: b.bottom } };
  });
  if (!r) throw new Error('pitch box or names grid missing');
  const { a, b } = r;
  const sideBySide = (a.r <= b.l + 1 || b.r <= a.l + 1) && a.t < b.b && b.t < a.b;
  const width = Math.max(a.r, b.r) - Math.min(a.l, b.l);
  const visible = a.t < 800 && b.t < 800;
  if (!sideBySide || width < 900 || !visible) {
    throw new Error(`pitch x ${Math.round(a.l)}..${Math.round(a.r)} y ${Math.round(a.t)}..${Math.round(a.b)}; names x ${Math.round(b.l)}..${Math.round(b.r)} y ${Math.round(b.t)}..${Math.round(b.b)}; `
      + `side by side ${sideBySide}, content width ${Math.round(width)} (want >= 900), both start on screen ${visible}`);
  }
  return page;
});

// ---------- UX-R2: clocked-out people look different on the map ----------
t('UX-R2 boss map: a clocked-out person (Billy S. at 1:30 PM) has a visibly different marker, and the legend has a "Clocked out" chip', async (browser) => {
  const page = await open(browser);
  await boss(page, 'map');
  await crewMarkers(page);
  const r = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.leaflet-marker-icon')].find((x) => /^Billy S\./.test(x.getAttribute('title') || ''));
    if (!m) return null;
    const dot = m.querySelector('.crew-dot') || m;
    const cs = getComputedStyle(dot);
    // The same status colour on someone still on the clock, for comparison.
    const statusCls = [...dot.classList].find((c) => /^s-/.test(c)) || '';
    const probe = document.createElement('div');
    probe.className = `crew-dot ${statusCls}`;
    m.parentNode.appendChild(probe);
    const ps = getComputedStyle(probe);
    const res = { cls: dot.className, opacity: +cs.opacity * +getComputedStyle(m).opacity, bg: cs.backgroundColor, onBg: ps.backgroundColor };
    probe.remove();
    res.legend = [...document.querySelectorAll('.map-legend > *')].map((c) => c.innerText.trim());
    return res;
  });
  if (!r) throw new Error('no map marker for Billy S.');
  const errs = [];
  if (!(r.opacity <= 0.7 || r.bg !== r.onBg)) errs.push(`Billy's dot (${r.cls}) is ${r.bg} at opacity ${r.opacity}, same as an on-shift dot (${r.onBg})`);
  if (!r.legend.some((w) => /clocked out|off (the )?clock|off shift|^off$/i.test(w))) errs.push(`legend has no "Clocked out" chip: ${JSON.stringify(r.legend)}`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R3: map and Today agree ----------
t("UX-R3 1:30 PM: Billy S.'s status word on the map marker matches his Today row's badge", async (browser) => {
  const page = await open(browser);
  await boss(page, 'today');
  await page.waitForSelector('.shift');
  const todayWord = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.shift')].find((s) => /Billy S\./.test(s.innerText));
    const c = row && row.querySelector('.chip');
    return c ? c.innerText.trim() : null;
  });
  if (!todayWord) throw new Error('no Today row with a status chip for Billy S.');
  await bossTab(page, 'map');
  await crewMarkers(page);
  const marker = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.leaflet-marker-icon')].find((x) => /^Billy S\./.test(x.getAttribute('title') || ''));
    return m ? (m.getAttribute('alt') || '') + ' | ' + (m.getAttribute('title') || '') : null;
  });
  if (!marker) throw new Error('no map marker for Billy S.');
  if (!marker.toLowerCase().includes(todayWord.toLowerCase())) {
    throw new Error(`Today says "${todayWord}" for Billy S.; the map marker says "${marker}"`);
  }
  return page;
});

// ---------- UX-R4: inline, announced form errors that don't follow you ----------
// Checks the error after an empty save: a visible role=alert/aria-live element (not the toast) near
// the field, and the field marked aria-invalid.
async function inlineError(page, fieldSel) {
  await page.waitForTimeout(250);
  return page.evaluate((sel) => {
    const field = document.querySelector(sel);
    if (!field) return { err: `no field ${sel}` };
    const fb = field.getBoundingClientRect();
    const live = [...document.querySelectorAll('#app [role="alert"], #app [aria-live]')]
      .filter((el) => el.id !== 'toast' && !el.closest('#toast') && el.offsetParent !== null && el.innerText.trim());
    const near = live.find((el) => { const b = el.getBoundingClientRect(); return b.top >= fb.top - 60 && b.top <= fb.bottom + 140; });
    const invalid = field.getAttribute('aria-invalid') === 'true' || !!field.querySelector('[aria-invalid="true"]')
      || !!(field.closest('.field') && field.closest('.field').querySelector('[aria-invalid="true"]'));
    const toast = document.getElementById('toast');
    return { near: near ? near.innerText.trim() : null, live: live.map((l) => l.innerText.trim()), invalid,
      toast: toast && toast.classList.contains('show') ? toast.innerText : null };
  }, fieldSel);
}
async function nothingLingers(page) {
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const toast = document.getElementById('toast');
    const shown = toast && (toast.classList.contains('show') || +getComputedStyle(toast).opacity > 0.1) ? toast.innerText : null;
    const alerts = [...document.querySelectorAll('[role="alert"]')].filter((el) => el.offsetParent !== null && el.innerText.trim()).map((el) => el.innerText.trim());
    return shown || alerts[0] || null;
  });
}
function errorProblems(what, r) {
  const errs = [];
  if (r.err) return [r.err];
  if (!r.near) errs.push(`${what}: no inline error with role="alert"/aria-live next to the field (live regions: ${JSON.stringify(r.live)}; toast: ${JSON.stringify(r.toast)})`);
  if (!r.invalid) errs.push(`${what}: field not marked aria-invalid="true"`);
  return errs;
}

t('UX-R4 Add job / Add person / New group, empty save: inline announced error, aria-invalid, nothing left over after Back', async (browser) => {
  const page = await open(browser);
  await boss(page, 'jobs');
  const errs = [];

  await page.click('[data-action="job-new"]');
  await page.waitForSelector('#job-name');
  await page.click('[data-action="job-save"]');
  errs.push(...errorProblems('Add job', await inlineError(page, '#job-name')));
  await page.click('.back');
  await page.waitForSelector('.boss');
  let left = await nothingLingers(page);
  if (left) errs.push(`after Back from Add job, still showing "${left}"`);

  await bossTab(page, 'crew');
  await page.click('[data-action="crew-new"]');
  await page.waitForSelector('#crew-name');
  await page.click('[data-action="crew-save"]');
  errs.push(...errorProblems('Add person', await inlineError(page, '#crew-name')));
  await page.click('.back');
  await page.waitForSelector('.boss');
  left = await nothingLingers(page);
  if (left) errs.push(`after Back from Add person, still showing "${left}"`);

  await bossTab(page, 'chat');
  await page.waitForSelector('[data-action="chat-new"]', { timeout: 15000 });
  await page.click('[data-action="chat-new"]');
  await page.waitForSelector('#chat-name');
  await page.fill('#chat-name', 'Test group');
  await page.click('[data-action="chat-create"]');
  const list = await page.evaluate(() => {
    const cb = document.querySelector('#app input[type="checkbox"]');
    const f = cb && cb.closest('.field');
    if (f) f.setAttribute('data-test-people', '');
    return !!f;
  });
  if (!list) errs.push('New group: no people field');
  else errs.push(...errorProblems('New group', await inlineError(page, '[data-test-people]')));
  await page.click('.back');
  await page.waitForSelector('.boss');
  left = await nothingLingers(page);
  if (left) errs.push(`after Back from New group, still showing "${left}"`);

  if (errs.length) throw new Error(errs.join('\n'));
  return page;
});

// ---------- UX-R5: clock-out success ----------
t('UX-R5 worker clock-out done: the success circle is not red, and it says how long they worked', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Jake R.'); // on the clock since about 7 AM in the sample day
  await page.waitForSelector('.punch.out');
  await page.click('.punch');
  await page.waitForSelector('.big-check, h1:has-text("clocked out")', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const check = document.querySelector('.big-check') || document.querySelector('main [class*="check"]');
    const probe = (v) => { const d = document.createElement('div'); d.style.color = `var(${v})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const reds = [probe('--red'), probe('--red-bg')];
    const cs = check ? getComputedStyle(check) : null;
    const svg = check && check.querySelector('svg');
    return { bg: cs && cs.backgroundColor, color: svg ? getComputedStyle(svg).color : cs && cs.color, reds, text: document.querySelector('main').innerText.replace(/\s+/g, ' ') };
  });
  const errs = [];
  if (r.reds.includes(r.bg) || r.reds.includes(r.color)) errs.push(`clock-out success is red (circle ${r.bg}, icon ${r.color}; red tokens ${r.reds.join(', ')})`);
  if (!/worked\b[^.]*\d+\s?(h|hr|hours?|min)/i.test(r.text)) errs.push(`no time worked on the done screen: "${r.text}"`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R7: one layout system ----------
t('UX-R7 1280x800 boss: the tab bar is not a 1280px bottom bar, and the header lines up with the list column', async (browser) => {
  const page = await open(browser, LAPTOP);
  await boss(page, 'today');
  await page.waitForSelector('.shift');
  const r = await page.evaluate(() => {
    const nav = document.querySelector('.tabbar, nav');
    const n = nav.getBoundingClientRect();
    const head = document.querySelector('.boss-head .brand, .boss-head > :first-child').getBoundingClientRect();
    const col = document.querySelector('.boss-body .pad > :first-child, .boss-body h2').getBoundingClientRect();
    return { nav: { l: n.left, w: n.width, h: n.height, t: n.top }, headL: head.left, colL: col.left };
  });
  const errs = [];
  const sideOrTop = r.nav.h > r.nav.w || r.nav.t < 200;
  if (!(r.nav.w <= 720 || sideOrTop)) errs.push(`tab bar is ${Math.round(r.nav.w)}px wide at y ${Math.round(r.nav.t)} (want <= 720px, or a side/top nav)`);
  if (Math.abs(r.headL - r.colL) > 2) errs.push(`header content starts at x ${Math.round(r.headL)}, list column at x ${Math.round(r.colL)}`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

t('UX-R7 390: worker Home and boss Today use the same side gutter', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Jake R.');
  const worker = await page.evaluate(() => document.querySelector('main.screen > :not(.back)').getBoundingClientRect().left);
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');
  await boss(page, 'today');
  const bossL = await page.evaluate(() => document.querySelector('.boss-body .pad > :first-child, .boss-body h2').getBoundingClientRect().left);
  if (Math.round(worker) !== Math.round(bossL)) throw new Error(`worker content starts at x ${worker}, boss content at x ${bossL}`);
  return page;
});

// ---------- UX-R9: header controls read as controls ----------
t('UX-R9 boss header: Refresh is a real button (icon or word, with a border or background) and "Switch" says Sign out / Switch person', async (browser) => {
  const page = await open(browser);
  await boss(page, 'today');
  const r = await page.evaluate(() => {
    const head = document.querySelector('.boss-head');
    const btns = [...head.querySelectorAll('button, [role="button"], a')];
    const name = (b) => (b.getAttribute('aria-label') || b.innerText || '').trim();
    const ref = btns.find((b) => /refresh/i.test(name(b)) || b.dataset.action === 'reload-team');
    const out = { names: btns.map(name) };
    if (ref) {
      const cs = getComputedStyle(ref);
      const hcs = getComputedStyle(head);
      const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
      const border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && alpha(cs.borderTopColor) > 0;
      const bg = alpha(cs.backgroundColor) > 0 && cs.backgroundColor !== hcs.backgroundColor;
      out.ref = { name: name(ref), icon: !!ref.querySelector('svg'), isButton: ref.tagName === 'BUTTON' || ref.getAttribute('role') === 'button', border, bg };
    }
    return out;
  });
  const errs = [];
  if (!r.ref) errs.push(`no refresh control in the header (${JSON.stringify(r.names)})`);
  else {
    if (!r.ref.isButton) errs.push('refresh control has no button role');
    if (!(r.ref.icon || /refresh/i.test(r.ref.name))) errs.push(`refresh control "${r.ref.name}" has neither an icon nor the word Refresh`);
    if (!(r.ref.border || r.ref.bg)) errs.push(`refresh control "${r.ref.name}" has no visible border or background (reads as a label)`);
  }
  if (!r.names.some((n) => /sign out|switch person/i.test(n))) errs.push(`no "Sign out"/"Switch person" in the header: ${JSON.stringify(r.names)}`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R10: foreman photo screen names the action ----------
t('UX-R10 foreman clocking Jake R. out: the photo screen says it is a clock-out, for Jake', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Ray T.');
  await page.click('[data-action="teammate"]');
  // Jake's button says Clock out once the team list (with his open clock-in) has loaded; before that
  // every teammate shows Clock in, and tapping it then would test a clock-in (flaky, 2 of 3 full runs).
  await page.locator('.row-card', { hasText: 'Jake R.' }).locator('.mate-btn.out').waitFor({ timeout: 15000 });
  await page.locator('.row-card', { hasText: 'Jake R.' }).locator('.mate-btn').click();
  await page.waitForSelector('[data-action="photo-file"]', { state: 'attached', timeout: 15000 });
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  if (!/clock(ing)? (him |them )?out.*Jake|Jake.*clock(ing)? (him |them )?out/i.test(text)) throw new Error(`photo screen never says clock out + Jake: "${text}"`);
  return page;
});

// ---------- UX-R12: Today times don't wrap; "Check ..." says why ----------
t('UX-R12 390 Today: no time wraps mid-value, and the "Check ..." sentence says why', async (browser) => {
  const page = await open(browser);
  await boss(page, 'today');
  await page.waitForSelector('.shift');
  const r = await page.evaluate(() => {
    const wrapped = [];
    const re = /\d{1,2}:\d{2}[\s  ]?[AP]M/g;
    document.querySelectorAll('.shift').forEach((row) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(n.data))) {
          const range = document.createRange();
          range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
          const tops = new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
          if (tops.size > 1) wrapped.push(m[0]);
        }
      }
    });
    const summary = (document.querySelector('#summary-text, .summary') || {}).innerText || '';
    const check = (summary.match(/Check[^.]*\.?/) || [''])[0];
    return { wrapped, check };
  });
  const errs = [];
  if (r.wrapped.length) errs.push(`times wrap across lines: ${JSON.stringify(r.wrapped)}`);
  if (!r.check) errs.push('no "Check ..." sentence in the summary');
  else if (!/no gps|near|off site|outside/i.test(r.check)) errs.push(`"${r.check}" doesn't say why`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R13: targets and small text ----------
t('UX-R13 390: map job pins >= 44x44, demo checkbox row >= 44px, sign-in role labels >= 15px', async (browser) => {
  const page = await open(browser);
  const errs = [];
  const roles = await page.evaluate(() => [...document.querySelectorAll('.name-role')].map((e) => ({ t: e.innerText, px: parseFloat(getComputedStyle(e).fontSize) })));
  const small = roles.filter((x) => x.px < 15);
  if (!roles.length) errs.push('no role labels on sign-in');
  if (small.length) errs.push(`role labels under 15px: ${small.map((x) => `${x.t} ${x.px}px`).join(', ')}`);

  await signIn(page, 'Travis K.');
  const toggle = await box(page, '.demo-toggle, label:has(input[data-action="demo-fake"])');
  if (!toggle) errs.push('no demo checkbox row on Home');
  else if (toggle.height < 44) errs.push(`demo checkbox row is ${Math.round(toggle.height)}px tall`);
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');

  await boss(page, 'map');
  await page.waitForSelector('.job-pin');
  const pins = await page.evaluate(() => [...document.querySelectorAll('.job-pin')].map((p) => {
    const m = p.closest('.leaflet-marker-icon') || p;
    const a = m.getBoundingClientRect(); const b = p.getBoundingClientRect();
    return { w: Math.max(a.width, b.width), h: Math.max(a.height, b.height) };
  }));
  const tiny = pins.filter((p) => p.w < 44 || p.h < 44);
  if (tiny.length) errs.push(`${tiny.length} job pins under 44x44 (e.g. ${Math.round(tiny[0].w)}x${Math.round(tiny[0].h)})`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R11: location off means no "pretend I'm at the job" box, and the line says what Clock in does ----------
t('UX-R11 Billy S. after "Not now": no demo GPS checkbox, and the location-off line says Clock in will ask again', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Billy S.');
  await page.waitForSelector('.consent');
  await page.click('[data-action="consent-later"]');
  await page.waitForSelector('.punch');
  const r = await page.evaluate(() => ({
    toggle: [...document.querySelectorAll('.demo-toggle, input[data-action="demo-fake"]')].some((el) => el.offsetParent !== null),
    line: ((document.querySelector('.location-off') || {}).innerText || '').trim(),
  }));
  const errs = [];
  if (r.toggle) errs.push('the "pretend I\'m at the job" checkbox shows while location is off');
  if (!/ask/i.test(r.line)) errs.push(`location-off line "${r.line}" doesn't say Clock in will ask again`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R15: placeholders ----------
t("UX-R15 Add job name placeholder isn't a sample job's name; Add person PIN placeholder isn't 1234", async (browser) => {
  const page = await open(browser);
  await boss(page, 'jobs');
  const jobs = await page.$$eval('.job-name', (els) => els.map((e) => e.innerText.trim().toLowerCase()));
  await page.click('[data-action="job-new"]');
  await page.waitForSelector('#job-name');
  const jobPh = (await page.getAttribute('#job-name', 'placeholder')) || '';
  await page.click('.back');
  await page.waitForSelector('.boss');
  await bossTab(page, 'crew');
  await page.click('[data-action="crew-new"]');
  await page.waitForSelector('#crew-pin');
  const pinPh = (await page.getAttribute('#crew-pin', 'placeholder')) || '';
  const errs = [];
  if (jobs.some((j) => jobPh.toLowerCase().includes(j))) errs.push(`job name placeholder "${jobPh}" is a sample job (${jobs.join(', ')})`);
  if (/^\s*\d{4}\s*$/.test(pinPh)) errs.push(`PIN placeholder is "${pinPh}"`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R16: consent "Not now" is the standard secondary button ----------
t('UX-R16 consent "Not now" looks like the app\'s other secondary buttons (full width, same style)', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Billy S.');
  await page.waitForSelector('.consent');
  const style = (sel) => page.evaluate((s) => {
    const el = typeof s === 'string' ? document.querySelector(s) : null;
    if (!el) return null;
    const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    const col = el.parentElement.getBoundingClientRect();
    const pcs = getComputedStyle(el.parentElement);
    const inner = col.width - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
    return { cls: el.className, h: Math.round(b.height), fill: b.width / inner, radius: cs.borderRadius, bg: cs.backgroundColor,
      shadow: cs.boxShadow, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, font: `${cs.fontSize} ${cs.fontWeight}` };
  }, sel);
  const notNow = await style('[data-action="consent-later"]');
  await page.click('[data-action="consent-later"]');
  await page.waitForSelector('.punch');
  const ref = await style('main .btn.secondary');
  if (!notNow || !ref) throw new Error(`missing button: Not now ${!!notNow}, Home secondary ${!!ref}`);
  const errs = [];
  for (const k of ['h', 'radius', 'bg', 'shadow', 'border', 'font']) {
    if (notNow[k] !== ref[k]) errs.push(`${k}: Not now "${notNow[k]}" vs Home secondary "${ref[k]}"`);
  }
  if (notNow.fill < 0.95) errs.push(`Not now fills ${Math.round(notNow.fill * 100)}% of its column (Home secondary ${Math.round(ref.fill * 100)}%)`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ================= After-review findings (UX-R18 to UX-R25) =================

// Waits until the chat list has loaded (no "Loading…").
async function chatLoaded(page) {
  await page.waitForFunction(() => {
    const l = document.querySelector('#app .list');
    return l && !/Loading/.test(l.innerText);
  }, null, { timeout: 20000 });
}
// Clock in (picking the first job if asked) and straight back out; returns the done screen's text.
async function inThenOut(page) {
  await page.waitForSelector('.punch.in');
  await page.click('.punch.in');
  await page.waitForSelector('.big-check, .job-btn', { timeout: 15000 });
  if (!(await page.locator('.big-check').count())) await page.locator('.job-btn').first().click();
  await page.waitForSelector('.big-check', { timeout: 15000 });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForSelector('.punch.out');
  await page.click('.punch.out');
  await page.waitForSelector('.big-check', { timeout: 15000 });
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ');
}

// ---------- UX-R18: New group people rows are rows, not tall cards ----------
for (const vp of [PHONE, LAPTOP]) {
  t(`UX-R18 ${vp.width}: New group lists each person as one row (checkbox, avatar, name side by side, <= 80px tall)`, async (browser) => {
    const page = await open(browser, vp);
    await boss(page, 'chat');
    await page.waitForSelector('[data-action="chat-new"]', { timeout: 20000 });
    await page.click('[data-action="chat-new"]');
    await page.waitForSelector('#chat-name');
    const rows = await page.$$eval('#app .people label', (ls) => ls.map((l) => {
      const r = l.getBoundingClientRect();
      const cb = l.querySelector('input').getBoundingClientRect();
      const name = l.querySelector('.grow').getBoundingClientRect();
      return { text: l.innerText.trim(), h: Math.round(r.height), dir: getComputedStyle(l).flexDirection,
        cbLeftOfName: cb.right <= name.left, sameLine: Math.abs((cb.top + cb.bottom) / 2 - (name.top + name.bottom) / 2) < 12 };
    }));
    if (!rows.length) throw new Error('New group lists nobody');
    const bad = rows.filter((r) => r.h > 80 || r.dir === 'column' || !r.cbLeftOfName || !r.sameLine);
    if (bad.length) throw new Error(`rows laid out wrong: ${JSON.stringify(bad)}`);
    return page;
  });
}

// ---------- UX-R19: the Start-here person is in the sample chat ----------
t('UX-R19 Travis K. (Start here) opens Messages and finds the sample group with messages in it', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Travis K.');
  await page.click('[data-to="chat-list"]');
  await chatLoaded(page);
  await page.waitForSelector('[data-action="chat-open"]', { timeout: 20000 }).catch(() => {});
  const rows = await page.$$eval('[data-action="chat-open"]', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')));
  if (!rows.some((r) => /Smith kitchen crew/.test(r))) throw new Error(`Travis's Messages list: ${JSON.stringify(rows)} (${(await page.locator('#app .list').innerText()).trim()})`);
  if (rows.some((r) => /No messages yet/.test(r) && /Smith kitchen crew/.test(r))) throw new Error('the sample group shows no messages for Travis');
  return page;
});

// ---------- UX-R20: a short shift never says "0 min" ----------
t('UX-R20 Travis K. clocks in and straight out: the done screen says "less than a minute", never "0 min"', async (browser) => {
  const page = await open(browser);
  await signIn(page, 'Travis K.');
  const text = await inThenOut(page);
  if (/\b0 min\b/.test(text)) throw new Error(`done screen says 0 min: "${text}"`);
  if (!/worked less than a minute/i.test(text)) throw new Error(`done screen doesn't say "worked less than a minute": "${text}"`);
  return page;
});

// ---------- UX-R21: midday summary counts open shifts ----------
t('UX-R21 1:30 PM Today summary counts the shifts still open and says "so far today"; 11:20 PM (all out) does not', async (browser) => {
  const read = async (hour) => {
    const page = await open(browser, PHONE, hour);
    await boss(page, 'today');
    await page.waitForSelector('.shift');
    const text = (await page.locator('#summary-text, .summary').first().innerText()).replace(/\s+/g, ' ');
    const finished = await page.$$eval('.shift', (els) => els.reduce((a, e) => a + Number((e.innerText.match(/(\d+\.\d) h/) || [0, 0])[1]), 0));
    const onClock = await page.locator('.shift .on-clock').count();
    return { text, finished, open: onClock };
  };
  const mid = await read(13.5);
  const night = await read(23 + 20 / 60);
  const errs = [];
  const hrs = Number((mid.text.match(/([\d.]+) hours/) || [0, NaN])[1]);
  if (!mid.open) errs.push('test setup: nobody is on the clock at 1:30 PM');
  if (!/so far today/i.test(mid.text)) errs.push(`1:30 PM summary lacks "so far today": "${mid.text}"`);
  if (!(hrs > mid.finished + mid.open * 4)) errs.push(`1:30 PM summary says ${hrs} hours; finished shifts alone are ${mid.finished.toFixed(1)} h and ${mid.open} people have been on since morning`);
  if (/so far/i.test(night.text)) errs.push(`11:20 PM (everyone clocked out) still says "so far": "${night.text}"`);
  if (errs.length) throw new Error(errs.join('; '));
  return null;
});

// ---------- UX-R22: name placeholders aren't sample names ----------
t('UX-R22 Add person name and New group name placeholders are "e.g." examples, not sample crew or group names', async (browser) => {
  const page = await open(browser);
  await boss(page, 'crew');
  const crew = await page.evaluate(() => [...document.querySelectorAll('.boss-body .row-card, .boss-body .shift')]
    .map((r) => (r.querySelector('.grow b, .job-name, .shift-name, .grow') || r).innerText.split('\n')[0].trim()).filter(Boolean));
  await page.click('[data-action="crew-new"]');
  await page.waitForSelector('#crew-name');
  const namePh = (await page.getAttribute('#crew-name', 'placeholder')) || '';
  await page.click('.back');
  await page.waitForSelector('.boss');
  await bossTab(page, 'chat');
  await chatLoaded(page);
  await page.waitForSelector('[data-action="chat-open"]', { timeout: 20000 }).catch(() => {});
  const groupNames = await page.$$eval('[data-action="chat-open"] .job-name', (els) => els.map((e) => e.innerText.trim()));
  await page.click('[data-action="chat-new"]');
  await page.waitForSelector('#chat-name');
  const groupPh = (await page.getAttribute('#chat-name', 'placeholder')) || '';
  const errs = [];
  const sample = ['Sam W.', 'Ray T.', 'Jake R.', 'Cody M.', 'Billy S.', 'Travis K.', ...crew];
  if (!/^e\.g\. /.test(namePh)) errs.push(`Add person name placeholder "${namePh}" isn't an "e.g." example`);
  if (sample.some((n) => n && namePh.includes(n))) errs.push(`Add person name placeholder "${namePh}" is a sample crew name`);
  if (!/^e\.g\. /.test(groupPh)) errs.push(`New group placeholder "${groupPh}" isn't an "e.g." example`);
  if (['Smith kitchen crew', ...groupNames].some((g) => groupPh.toLowerCase().includes(g.toLowerCase()))) errs.push(`New group placeholder "${groupPh}" is the sample group's name`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R23: one word for chat ----------
t('UX-R23 390: the boss tab, the chat page heading and the worker\'s button use the same word, and the tab label fits on one line', async (browser) => {
  const page = await open(browser);
  await boss(page, 'chat');
  const tab = await page.evaluate(() => {
    const s = document.querySelector('[data-action="boss-tab"][data-tab="chat"] span');
    const r = s.getBoundingClientRect();
    return { word: s.innerText.trim(), lines: Math.round(r.height / parseFloat(getComputedStyle(s).lineHeight || 18)), clipped: s.scrollWidth > s.clientWidth + 1,
      size: parseFloat(getComputedStyle(s).fontSize), btnClipped: s.closest('button').scrollWidth > s.closest('button').clientWidth + 1 };
  });
  const heading = (await page.locator('.boss-body h2').first().innerText()).trim();
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.name-btn');
  await signIn(page, 'Jake R.');
  const btn = (await page.locator('[data-to="chat-list"]').innerText()).replace(/\d+/g, '').trim();
  const errs = [];
  if (new Set([tab.word, heading, btn]).size !== 1) errs.push(`tab "${tab.word}", page heading "${heading}", worker button "${btn}"`);
  if (tab.size < 15) errs.push(`tab label is ${tab.size}px`);
  if (tab.clipped || tab.btnClipped || tab.lines > 1) errs.push(`tab label "${tab.word}" doesn't fit: ${JSON.stringify(tab)}`);
  if (errs.length) throw new Error(errs.join('; '));
  return page;
});

// ---------- UX-R24: the hours stay with the times ----------
t('UX-R24 390 Today: the hours ("4.0 h") never sit alone on a line starting with "·"', async (browser) => {
  const page = await open(browser);
  await boss(page, 'today');
  await page.waitForSelector('.shift');
  const bad = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.shift').forEach((row) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let n; let lastTimeTop = null;
      while ((n = walker.nextNode())) {
        const rects = (s, e) => { const r = document.createRange(); r.setStart(n, s); r.setEnd(n, e); return [...r.getClientRects()].filter((x) => x.width > 0); };
        let m; const reT = /\d{1,2}:\d{2}[\s  ]?[AP]M/g;
        while ((m = reT.exec(n.data))) { const rs = rects(m.index, m.index + m[0].length); if (rs.length) lastTimeTop = Math.round(rs[rs.length - 1].top); }
        const reH = /(·\s*)?\d+\.\d\s?h\b/g;
        while ((m = reH.exec(n.data))) {
          const rs = rects(m.index, m.index + m[0].length);
          if (!rs.length) continue;
          const top = Math.round(rs[0].top);
          if (m[1] && (lastTimeTop == null || Math.abs(top - lastTimeTop) > 2)) out.push(`${row.querySelector('.shift-name').innerText}: "${m[0]}" on its own line`);
        }
      }
    });
    return out;
  });
  if (bad.length) throw new Error(bad.join('; '));
  return page;
});

// ---------- UX-R25: Start-here avatar contrast ----------
for (const scheme of ['light', 'dark']) {
  t(`UX-R25 ${scheme}: the Start-here card's avatar initials have at least 4.5:1 contrast`, async (browser) => {
    const page = await open(browser, PHONE, 13.5, scheme);
    const r = await page.evaluate(() => {
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
      const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) stack.push(parse(getComputedStyle(e).backgroundColor)); let c = { r: 255, g: 255, b: 255, a: 1 }; for (const x of stack.reverse()) c = over(x, c); return c; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const av = document.querySelector('.start-btn .avatar');
      if (!av) return null;
      const bg = bgOf(av); const fg = over(parse(getComputedStyle(av).color), bg);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return { ratio: (hi + 0.05) / (lo + 0.05), fg: getComputedStyle(av).color, bg: getComputedStyle(av).backgroundColor };
    });
    if (!r) throw new Error('no Start-here avatar');
    if (r.ratio < 4.5) throw new Error(`initials ${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}:1`);
    return page;
  });
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
    }
    for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
  }
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

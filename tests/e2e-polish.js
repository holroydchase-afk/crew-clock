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

async function open(browser, viewport = PHONE, hour = 13.5) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
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
  await page.waitForSelector('.mate-btn');
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

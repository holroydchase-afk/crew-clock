// Crew Clock: screens, punch flow, sync loop and the boss views.
(function () {
  const { Geo, Report, Store, Api, Icons } = self;
  const cfg = self.APP_CONFIG || {};
  const $app = document.getElementById('app');
  const FIX_WINDOW_MS = 2 * 60 * 1000;

  // iPhone/iPad Safari in the browser (not installed to the Home Screen): Safari 26's floating
  // toolbar sits over the bottom of the page, so the CSS lifts the boss tab bar clear of it.
  try {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installed = navigator.standalone === true || (self.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (ios && !installed) document.documentElement.classList.add('ios-safari-tab');
  } catch (e) { /* old browser: no extra padding */ }

  const STATUS = {
    onsite: { word: 'On site', cls: 's-onsite' },
    near: { word: 'Near', cls: 's-near' },
    offsite: { word: 'Off site', cls: 's-offsite' },
    weak: { word: 'Weak GPS', cls: 's-weak' },
    nogps: { word: 'No GPS', cls: 's-nogps' },
  };
  const FENCES = [
    { ft: 150, word: 'Small', hint: 'House in town' },
    { ft: 300, word: 'Normal', hint: 'Most jobs' },
    { ft: 600, word: 'Big', hint: 'Big lot or road' },
  ];

  const state = {
    auth: Store.local.get('auth', null),
    me: Store.local.get('me', null),
    jobs: Store.local.get('jobs', []),
    crew: Store.local.get('crew', []),
    last: Store.local.get('last', null),
    team: Store.local.get('team', null),
    pending: 0,
    syncing: false,
    lastSyncAt: Store.local.get('lastSyncAt', null),
    screen: null,
    flow: null, // the punch being built
    bossTab: Store.local.get('bossTab', 'map'),
  };

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  const dayLabel = (ms) => {
    const d0 = Report.startOfDay(Date.now());
    if (ms >= d0) return 'Today';
    if (ms >= d0 - 86400000) return 'Yesterday';
    return new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const jobById = (id) => state.jobs.find((j) => j.id === id) || (state.team && state.team.jobs.find((j) => j.id === id));
  const crewById = (id) => (state.team && state.team.crew.find((c) => c.id === id)) || state.crew.find((c) => c.id === id) || (state.me && state.me.id === id ? state.me : null);
  const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const isBoss = () => state.me && state.me.role === 'boss';
  const isLead = () => state.me && (state.me.role === 'foreman' || state.me.role === 'boss');

  // ---------- location consent (docs/PRIVACY.md "Consent") ----------
  // A new text version asks everyone again (C4). The words live in screens.consent and PRIVACY.md.
  const CONSENT_VERSION = 'loc-v1';
  const agreed = (c) => !!c && c.action === 'agree' && c.textVersion === CONSENT_VERSION;
  // This phone's newest record per worker, so a worker who agreed offline stays agreed.
  const knownConsents = () => Store.local.get('consents', {});
  function rememberConsent(crewId, c) {
    if (!c) return;
    const all = knownConsents();
    if (all[crewId] && all[crewId].at > c.at) return; // newest wins, here or from the server
    all[crewId] = { id: c.id, action: c.action, textVersion: c.textVersion, at: c.at };
    Store.local.set('consents', all);
  }
  // A record the server refused never counts: forget it, so the worker is asked again and no GPS is read.
  function forgetConsent(crewId, id) {
    const all = knownConsents();
    if (all[crewId] && all[crewId].id === id) { delete all[crewId]; Store.local.set('consents', all); }
  }
  // Own record from this phone or the server; a teammate's from the team status (unknown = no).
  function hasConsent(crewId) {
    if (state.me && crewId === state.me.id) return agreed(knownConsents()[crewId]);
    const st = state.team && state.team.consents;
    return !!st && agreed(st.find((c) => c.crewId === crewId));
  }
  async function saveConsent(action) {
    let deviceId = null;
    if (self.Device && Device.supported()) {
      try { const d = await Device.get(); deviceId = d ? d.id : null; } catch (e) { /* recorded without a device id */ }
    }
    const item = { kind: 'consent', id: Store.uid(), crewId: state.me.id, byCrewId: state.me.id,
      action, textVersion: CONSENT_VERSION, at: Date.now(), deviceId };
    await Store.outbox.add(item); // same offline queue as punches (C5)
    rememberConsent(state.me.id, item);
    await countPending();
    syncNow();
  }

  function chip(status, hasPhoto) {
    const s = STATUS[status] || STATUS.nogps;
    return `<span class="chip ${s.cls}"><i></i>${s.word}${hasPhoto ? ` <span class="chip-cam">${Icons.camera}</span>` : ''}</span>`;
  }

  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = ''; }, 3000);
  }

  function setScreen(name, data) {
    state.screen = name;
    if (data) Object.assign(state, data);
    render();
    window.scrollTo(0, 0);
  }

  // ---------- sync ----------
  // Only what the signed-in person made is theirs to send. Someone else's queued punches
  // stay on the phone until that person signs in again (HRD-1).
  // A job/crew edit queued before edits carried byCrewId is the boss's to send (PS-7b).
  const isMine = (it) => (it.byCrewId ? !!state.me && it.byCrewId === state.me.id
    : (it.kind !== 'job' && it.kind !== 'crew') || isBoss());
  // A refused item's stub: enough for the sync line to explain it, no GPS, photo or edit data (PS-2).
  const STUB_KEYS = ['kind', 'id', 'crewId', 'byCrewId', 'type', 'at', 'jobId', 'queuedAt'];
  const toStub = (it, reason) => {
    const stub = {};
    STUB_KEYS.forEach((k) => { if (it[k] !== undefined) stub[k] = it[k]; });
    return Object.assign(stub, { rejected: reason, rejectedAt: Date.now() });
  };

  async function countPending() {
    const items = (await Store.outbox.all()).filter(isMine);
    state.pending = items.length;
    state.stuck = items.filter((it) => it.rejected);
    return items;
  }

  // Server refusals that mean "this phone may never send this": safe to drop.
  const PERMISSION = /^(Only a foreman|Unknown crew member|Boss only|Not yours)/i;
  function rejectWords(reason) {
    if (/too old/i.test(reason || '')) return "Punch too old. Check the phone's clock and date are right, then tell the boss.";
    return `The office couldn't take it (${reason || 'no reason given'}). Tell the boss.`;
  }

  async function syncNow() {
    if (state.syncing) { state.syncAgain = true; return; } // saved mid-sync: send it right after (UX-1)
    if (!state.auth) return;
    // This sync belongs to whoever is signed in now; if they sign out mid-sync, its answers
    // (and its errors) must never land on the next person
    const auth = state.auth;
    state.syncAgain = false;
    if (navigator.onLine === false) { await countPending(); updateSyncLine(); return; }
    state.syncing = true;
    updateSyncLine();
    try {
      // Refused stubs are never resent; only network, server or photo-upload failures retry (PS-2).
      const items = (await countPending()).filter((it) => !it.rejected);
      // Small batches so a slow one-bar connection still gets punches through.
      for (let i = 0; i < items.length; i += 4) {
        const batch = items.slice(i, i + 4);
        const res = await Api.sync(auth, batch);
        const why = {};
        (res.reasons || []).forEach((r) => { why[r.id] = r.reason; });
        const drop = (res.rejected || []).filter((id) => PERMISSION.test(why[id] || ''));
        // A refused consent record is dropped and forgotten; the consent screen asks again.
        const refusedConsents = batch.filter((x) => x.kind === 'consent' && (res.rejected || []).includes(x.id));
        refusedConsents.forEach((x) => forgetConsent(x.crewId, x.id));
        await Store.outbox.remove([...(res.accepted || []), ...drop, ...refusedConsents.map((x) => x.id)]);
        if (refusedConsents.length && state.auth === auth) {
          toast("Your location answer didn't save. You'll be asked again.");
          if (state.screen === 'home') render();
        }
        // Any other refusal is permanent: keep only a stub with the reason on screen (HRD-2, PS-2).
        for (const id of res.rejected || []) {
          const it = !drop.includes(id) && batch.find((x) => x.id === id && x.kind !== 'consent');
          if (it) await Store.outbox.add(toStub(it, why[id] || 'Refused'));
        }
      }
      await countPending();
      if (state.pending === 0 && state.auth === auth) await refreshData(auth);
      state.sendFailed = false;
      state.lastSyncAt = Date.now();
      Store.local.set('lastSyncAt', state.lastSyncAt);
    } catch (e) {
      state.sendFailed = true;
      if (state.auth === auth) { // signed out mid-sync: not the next person's error
        if (e.signIn) signOut('Please sign in again with your PIN.');
        else if (e.server && /PIN/.test(e.message)) signOut('Your PIN was changed. Ask the boss for the new one.');
      }
    } finally {
      await countPending();
      state.syncing = false; // cleared only once the counts are fresh, so the line never shows stale state
      updateSyncLine();
    }
    if (state.syncAgain) return syncNow();
  }

  async function refreshData(auth = state.auth) {
    const res = await Api.refresh(auth);
    if (state.auth !== auth) return; // someone else signed in while it was on its way
    state.me = res.me;
    state.jobs = res.jobs || [];
    state.crew = res.crew || [];
    Store.local.set('me', state.me);
    Store.local.set('jobs', state.jobs);
    Store.local.set('crew', state.crew);
    // Trust the server's last punch only when it is newer than ours.
    if (res.last && (!state.last || res.last.at >= state.last.at)) setLast(res.last);
    if (res.consent) rememberConsent(res.me.id, res.consent);
    if (isLead()) await loadTeam();
    if (['home', 'boss', 'pick-teammate'].includes(state.screen)) render();
  }

  async function loadTeam() {
    try {
      const res = await Api.team(state.auth);
      const keep = state.team && state.team.consents; // an unreadable status keeps the last one
      state.team = { punches: res.punches, crew: res.crew, jobs: res.jobs, consents: res.consents || keep || null, at: Date.now() };
      Store.local.set('team', state.team);
    } catch (e) { /* keep the cached copy */ }
  }

  function setLast(p) {
    state.last = p ? { id: p.id, jobId: p.jobId, type: p.type, at: p.at, status: p.status } : null;
    Store.local.set('last', state.last);
  }

  function syncLineHtml() {
    if (state.syncing) return `<span class="sync busy">${Icons.cloud} Sending…</span>`;
    if (state.stuck && state.stuck.length) {
      return `<span class="sync wait">${Icons.alert} ${state.stuck.length} not sent: ${esc(rejectWords(state.stuck[0].rejected))}</span>`;
    }
    if (state.pending > 0) {
      return `<span class="sync wait">${Icons.cloudOff} ${state.pending} waiting to send. Open the app when you get signal.</span>`;
    }
    return `<span class="sync ok">${Icons.cloud} All sent</span>`;
  }
  // The done screen's line: "Sent" once the outbox is empty; the amber note only offline or after a failed send (UX-2).
  function doneSyncHtml() {
    if (state.stuck && state.stuck.length) return `<p class="notice">${Icons.alert} ${esc(rejectWords(state.stuck[0].rejected))}</p>`;
    if (state.pending === 0 && !state.syncing) return `<p class="sync ok">${Icons.cloud} Sent to the boss</p>`;
    if (navigator.onLine === false || state.sendFailed) {
      return `<p class="notice">${Icons.cloudOff} Saved on your phone. It will send itself when you get signal.</p>`;
    }
    return `<p class="sync busy">${Icons.cloud} Sending…</p>`;
  }
  function updateSyncLine() {
    document.querySelectorAll('[data-sync-line]').forEach((el) => { el.innerHTML = syncLineHtml(); });
    document.querySelectorAll('[data-done-sync]').forEach((el) => { el.innerHTML = doneSyncHtml(); });
  }

  // ---------- punches ----------
  async function savePunch(p) {
    let item = Object.assign({ kind: 'punch', id: Store.uid(), byCrewId: state.me.id }, p);
    if (self.Device && Device.supported()) {
      try { item = await Device.sign(item); } catch (e) { /* unsigned punches still save; the server flags them */ }
    }
    await Store.outbox.add(item);
    if (item.crewId === state.me.id && item.type !== 'void') setLast(item);
    else if (item.crewId !== state.me.id) {
      state.matePunches = (state.matePunches || []).concat({ id: item.id, crewId: item.crewId, jobId: item.jobId, type: item.type, at: item.at, voidsId: item.voidsId });
    }
    await countPending();
    syncNow();
    return item;
  }

  // A teammate's open clock-in, from the team list plus what this phone just saved for them (UX-3).
  function mateOpen(crewId) {
    const p = Report.lastPunchByCrew(teamPunches().concat(state.matePunches || []))[crewId];
    return p && p.type === 'in' ? p : null;
  }

  function startPunch(type, opts) {
    const o = opts || {};
    const crewId = o.crewId || state.me.id;
    // No consent, no location (PRIVACY L3): the worker is asked first; a teammate can't be asked
    // by the foreman, so their clock-in uses a picture. Either way the clock-in still happens.
    const noLocation = !hasConsent(crewId);
    if (noLocation && !o.crewId && !o.fixing && !o.consentAsked) return setScreen('consent', { consentNext: { type } });
    state.flow = { type, crewId, forTeammate: !!o.crewId, fixing: o.fixing || null, noLocation };
    const open = type !== 'out' ? null : o.crewId ? mateOpen(o.crewId) : state.last && state.last.type === 'in' ? state.last : null;
    if (open) {
      state.flow.jobId = open.jobId;
      return locate();
    }
    setScreen('pick-job');
    if (!noLocation) sortJobsByDistance();
  }

  // In the demo, "pretend I'm at the job" starts on, so a visitor's own location is never read
  // unless they turn it off (M1.6, showcase SC-1).
  function fakeGps() { return Api.isDemo && cfg.backend === 'demo' && Store.local.get('demoFake', true); } // never in a crew build that fell back to demo

  // One rough reading for the job list; it stops when they pick a job or leave the list (L2).
  async function sortJobsByDistance() {
    if (fakeGps()) return;
    const flow = state.flow;
    const fix = await watchGps(navigator.geolocation, () => state.screen === 'pick-job' && state.flow === flow,
      { timeoutMs: 8000, goodEnoughM: Infinity, highAccuracy: false, maximumAgeMs: 120000 });
    if (!fix || state.screen !== 'pick-job' || state.flow !== flow) return;
    flow.roughFix = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy };
    render();
  }

  function pickJob(jobId) {
    if (state.flow.picked) return; // a double tap picks once (HRD-3)
    state.flow.picked = true;
    state.flow.jobId = jobId;
    if (state.flow.fixing) {
      // Same time and place as the original punch, just the right job.
      const orig = state.flow.fixing;
      state.flow.fix = orig.lat == null ? null : { lat: orig.lat, lng: orig.lng, accuracy: orig.accuracy };
      state.flow.at = orig.at;
      state.flow.photo = orig.photo || null;
      return afterFix();
    }
    locate();
  }

  // Plain words for the live fix; "weak" is the same line that asks for a photo (UX-10).
  function gpsWords(accuracyM) {
    return Geo.fenceStatus(0, accuracyM, 1) === 'weak'
      ? `GPS signal: weak (about ${Geo.formatDistance(Geo.toFeet(accuracyM))})` : 'GPS signal: good';
  }

  // The one GPS watch the app may have open, and the screen it belongs to (PRIVACY L2). Leaving
  // that screen, or the app going to the background, stops it at once.
  let gpsWatch = null;
  function watchGps(geolocation, stillWanted, opts) {
    stopGps();
    const ac = new AbortController();
    const w = { stillWanted, ac };
    gpsWatch = w;
    return Geo.bestFix(geolocation, Object.assign({}, opts, { signal: ac.signal }))
      .finally(() => { if (gpsWatch === w) gpsWatch = null; });
  }
  function stopGps() {
    if (gpsWatch) { gpsWatch.ac.abort(); gpsWatch = null; }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopGps(); });

  async function locate() {
    const flow = state.flow; // a late fix must only finish the flow that asked for it (HRD-4)
    flow.at = Date.now();
    if (flow.noLocation) { flow.fix = null; return afterFix(); }
    flow.liveAccuracy = null;
    setScreen('locating');
    const job = jobById(state.flow.jobId);
    let fix;
    if (fakeGps() && job) {
      await new Promise((r) => setTimeout(r, 900));
      fix = { lat: job.lat + 0.0002, lng: job.lng - 0.0001, accuracy: 9, at: Date.now() };
    } else {
      fix = await watchGps(navigator.geolocation, () => state.screen === 'locating' && state.flow === flow, {
        timeoutMs: cfg.gpsTimeoutMs || 20000,
        goodEnoughM: 20,
        onUpdate: (best) => {
          if (state.flow !== flow) return;
          flow.liveAccuracy = best.accuracy;
          const el = document.getElementById('live-acc');
          if (el) el.textContent = gpsWords(best.accuracy);
        },
      });
    }
    if (state.flow !== flow || state.screen !== 'locating') return; // they backed out or moved on
    state.flow.fix = fix;
    afterFix();
  }

  function afterFix() {
    const job = jobById(state.flow.jobId);
    const check = Geo.checkFix(state.flow.fix, job);
    state.flow.check = check;
    const photoRequired = state.flow.forTeammate || state.flow.noLocation || Geo.needsPhoto(check.status);
    if (photoRequired && !state.flow.photo) return setScreen('photo');
    finishPunch();
  }

  async function finishPunch() {
    const f = state.flow;
    if (!f || f.finishing) return; // one punch per flow, however many taps (HRD-5)
    f.finishing = true;
    if (f.fixing) await savePunch({ crewId: f.crewId, type: 'void', voidsId: f.fixing.id, at: Date.now() });
    const fix = f.fix;
    const saved = await savePunch({
      crewId: f.crewId,
      jobId: f.jobId,
      type: f.type,
      at: f.at,
      lat: fix ? fix.lat : null,
      lng: fix ? fix.lng : null,
      accuracy: fix ? Math.round(fix.accuracy) : null,
      status: f.check.status,
      distanceFt: f.check.distanceFt,
      photo: f.photo || null,
    });
    f.saved = saved;
    f.savedAt = Date.now();
    setScreen('done');
  }

  // Shrink to 1024px and stamp who/where/when on the picture.
  function stampPhoto(file, lines) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1024;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const fs = Math.max(16, Math.round(w / 34));
        ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
        const pad = fs * 0.6;
        const boxH = lines.length * fs * 1.3 + pad * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, h - boxH, w, boxH);
        ctx.fillStyle = '#fff';
        lines.forEach((t, i) => ctx.fillText(t, pad, h - boxH + pad + fs * (i + 1) * 1.2));
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  // ---------- auth ----------
  async function loadNames() {
    try {
      const res = await Api.listCrew();
      Store.local.set('crewNames', res.crew);
      return res.crew;
    } catch (e) {
      return Store.local.get('crewNames', null);
    }
  }

  // Demo with PINs turned off (config demoPin): tapping a name signs straight in.
  const demoNoPin = () => Api.isDemo && !!Api.demoLogin && !cfg.demoPin;

  async function tryLogin(crewId, pin) {
    try {
      const res = pin == null ? await Api.demoLogin(crewId) : await Api.login(crewId, pin);
      state.auth = res.auth || { crewId, pin };
      Store.local.set('auth', state.auth);
      state.me = res.me;
      state.jobs = res.jobs || [];
      state.crew = res.crew || [];
      Store.local.set('me', state.me);
      Store.local.set('jobs', state.jobs);
      Store.local.set('crew', state.crew);
      setLast(res.last);
      if (res.consent) rememberConsent(res.me.id, res.consent);
      if (isLead()) loadTeam().then(() => { if (['boss', 'pick-teammate'].includes(state.screen)) render(); });
      goHome();
      countPending().then(() => syncNow()); // send what this person left queued last time
    } catch (e) {
      state.pinEntry = '';
      state.pinError = e.offline ? 'No signal. The first sign-in needs signal.' : "That PIN didn't work. Try again.";
      render();
      const dots = document.querySelector('.pin-dots');
      if (dots) dots.classList.add('shake');
    }
  }

  async function signOut(msg) {
    const waiting = await countPending();
    if (waiting.length && !msg) {
      if (!confirm(`Some clock-ins have not sent yet. Switch anyway? They will send when this person signs in again.`)) return;
    }
    if (Api.signOut) Api.signOut();
    ['auth', 'me', 'last', 'team', 'jobs', 'crew'].forEach((k) => Store.local.remove(k));
    Object.assign(state, { auth: null, me: null, last: null, team: null, jobs: [], crew: [], matePunches: [], consentAsked: false });
    if (msg) toast(msg);
    setScreen('names');
  }

  function goHome() {
    if (!state.auth) return setScreen('names');
    if (isBoss()) return setScreen('boss');
    if (!hasConsent(state.me.id)) {
      // CON-1: asked before Home, unless they said no to these same words (then only when clocking in)
      const mine = knownConsents()[state.me.id];
      const saidNo = mine && mine.action === 'withdraw' && mine.textVersion === CONSENT_VERSION;
      if (!state.consentAsked && !saidNo) return setScreen('consent', { consentNext: null });
      return setScreen('home'); // "Not now": no location, so no phone permission to ask for
    }
    if (!Store.local.get('locPrimed', false) && !fakeGps()) return setScreen('primer');
    setScreen('home');
  }

  // ---------- screens ----------
  const screens = {};

  // One line on every demo screen (SEP-3, SEP-4); the crew app never shows it (SEP-5).
  function demoBanner() {
    return Api.isDemo ? `<div class="demo-banner" role="note"><span>Sample data, made-up crew, saved only in this browser</span>
      <span class="demo-actions"><button type="button" data-action="demo-reset">Reset sample data</button>
      <a href="https://chaseholroyd.com/">Back to chaseholroyd.com</a></span></div>` : '';
  }

  screens.names = () => {
    loadNames().then((list) => {
      // Redraw only when the list changed: a redraw under a finger swallows the tap
      const same = JSON.stringify(list) === JSON.stringify(state.names);
      state.names = list;
      if (state.screen === 'names' && !same) paint(namesHtml());
    });
    return namesHtml();
  };
  const DEMO_START = 'c5'; // the sample crew member who is never on the clock when the demo opens
  function namesHtml() {
    const list = state.names;
    let body;
    if (list === undefined) body = '<p class="muted center">Loading…</p>';
    else if (!list) body = '<p class="notice">No signal. The first time you sign in, you need signal. Try near the road or in town.</p>';
    else {
      const role = { boss: 'Boss', foreman: 'Foreman' };
      body = `${demoNoPin() ? `<div class="demo-intro"><p><b>A GPS time clock for a small construction crew.</b> Three taps to clock in, and it works with no signal.</p>
        <p>Try it: tap the name marked <b>Start here</b> to clock in, then the boss for the team map.</p></div>` : ''}
        <div class="name-grid">${list.map((c) => `
        <button class="name-btn" data-action="pick-name" data-id="${esc(c.id)}">
          <span class="avatar">${esc(initials(c.name))}</span><span>${esc(c.name)}</span>
          ${demoNoPin() && role[c.role] ? `<span class="name-role">${role[c.role]}</span>` : ''}
          ${demoNoPin() && c.id === DEMO_START ? '<span class="name-role start">Start here</span>' : ''}
        </button>`).join('')}</div>`;
    }
    return `<main class="screen">
        <div class="brand">${Icons.job}<span>Crew Clock</span></div>
        <h1>Who are you?</h1>
        <p class="privacy">${Icons.pin}<span>This app only checks where you are when you tap <b>Clock In</b> or <b>Clock Out</b>. It does not follow you.</span></p>
        ${body}
      </main>`;
  }

  screens.pin = () => {
    const c = (state.names || []).find((x) => x.id === state.pinFor) || {};
    const n = (state.pinEntry || '').length;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
    return `<main class="screen">
        <button class="back" data-action="go" data-to="names">${Icons.back} Back</button>
        <div class="pin-head">
          <span class="avatar big">${esc(initials(c.name))}</span>
          <h1>Hi ${esc(c.name)}</h1>
          <p class="muted">Type your 4 number PIN</p>
        </div>
        <div class="pin-dots" aria-label="${n} of 4 numbers typed">${[0, 1, 2, 3].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
        ${state.pinError ? `<p class="error center">${esc(state.pinError)}</p>` : ''}
        <div class="keypad">${keys.map((k) => k === '' ? '<span></span>'
          : k === 'del' ? `<button data-action="pin-del" aria-label="Delete">${Icons.back}</button>`
            : `<button data-action="pin-key" data-k="${k}">${k}</button>`).join('')}</div>
      </main>`;
  };

  // The words a worker agrees to (version loc-v1, docs/PRIVACY.md). Changing them means a new CONSENT_VERSION.
  screens.consent = () => `
    <main class="screen center-col consent">
      ${state.consentNext ? `<button class="back" data-action="consent-back">${Icons.back} Back</button>` : ''}
      <div class="big-icon blue">${Icons.pin}</div>
      <h1>Crew Clock uses your location only when you tap Clock in or Clock out.</h1>
      <p class="lead">The boss sees where and when. It never tracks you in between. You can stop this any time on the home screen.</p>
      <button class="btn primary xl" data-action="consent-agree">I agree</button>
      <button class="btn secondary" data-action="consent-later">Not now</button>
      <p class="muted">Not now? You can still clock in with a picture.</p>
    </main>`;

  screens.primer = () => `
    <main class="screen center-col">
      <div class="big-icon blue">${Icons.pin}</div>
      <h1>Your phone will ask to use your location</h1>
      <p class="lead">Tap <b>Allow</b> so the app can show the boss you made it to the job.</p>
      <div class="fake-prompt">
        <p>Allow “Crew Clock” to use your location?</p>
        <div><span>Don't Allow</span><span class="hl">Allow While Using App</span></div>
      </div>
      <p class="muted">It only checks when you clock in or out.</p>
      <button class="btn primary xl" data-action="prime-location">OK, ask me</button>
    </main>`;

  screens.home = () => {
    const onClock = state.last && state.last.type === 'in';
    const job = onClock ? jobById(state.last.jobId) : null;
    const status = onClock
      ? `<div class="status-card on"><span class="status-dot"></span><div>
          <div class="status-title">You are ON the clock</div>
          <div class="status-sub">${esc(job ? job.name : 'Job')} · since ${time(state.last.at)}</div></div></div>`
      : `<div class="status-card off"><span class="status-dot"></span><div>
          <div class="status-title">You are OFF the clock</div>
          <div class="status-sub">${state.last ? `Last clocked out ${dayLabel(state.last.at).toLowerCase()} at ${time(state.last.at)}` : 'Tap the green button when you get to the job'}</div></div></div>`;
    const big = onClock
      ? `<button class="punch out" data-action="punch" data-type="out">${Icons.out}<span>CLOCK OUT</span></button>`
      : `<button class="punch in" data-action="punch" data-type="in">${Icons.in}<span>CLOCK IN</span></button>`;
    const fake = Api.isDemo
      ? `<label class="demo-toggle"><input type="checkbox" data-action="demo-fake" ${fakeGps() ? 'checked' : ''}> Demo: pretend I'm at the job</label>`
      : '';
    return `<main class="screen home">
        <header class="home-head">
          <div><div class="muted small">Signed in as</div><div class="who">${esc(state.me.name)}</div></div>
          <button class="link" data-action="sign-out">Not you?</button>
        </header>
        ${status}
        ${state.jobs.some((j) => j.active !== false) ? '' : '<p class="notice">No jobs yet. Ask the boss to add the job.</p>'}
        ${big}
        <div class="sync-line" data-sync-line>${syncLineHtml()}</div>
        ${isLead() ? `<button class="btn secondary" data-action="teammate">${Icons.teammate} Clock in or out a teammate</button>` : ''}
        ${state.me.role === 'foreman' ? `<button class="btn secondary" data-action="go" data-to="boss">${Icons.map} See the team map</button>` : ''}
        ${self.Messenger ? `<button class="btn secondary" data-action="go" data-to="chat-list">${Icons.chat} Messages <span class="badge" data-unread></span></button>` : ''}
        <div id="push-slot"></div>
        ${hasConsent(state.me.id)
          ? '<button class="link" data-action="consent-withdraw">Stop using my location</button>'
          : '<p class="muted location-off">Location is off. You clock in with a picture.</p><button class="link" data-action="consent-ask">Use my location for clock-ins</button>'}
        ${fake}
      </main>`;
  };

  function mateLine(crewId) {
    const p = mateOpen(crewId);
    const job = p && jobById(p.jobId);
    return `<span class="mate-status">${p ? `On at ${esc(job ? job.name : 'a job')} since ${time(p.at)}` : 'Off'}</span>`;
  }

  screens['pick-teammate'] = () => {
    const mates = state.crew.filter((c) => c.id !== state.me.id && c.role !== 'boss');
    return `<main class="screen">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      <h1>Which teammate?</h1>
      <p class="muted">You'll need to take a picture of them at the job.</p>
      <div class="list">${mates.map((c) => `
        <div class="row-card">
          <span class="avatar">${esc(initials(c.name))}</span>
          <span class="grow"><span class="mate-name">${esc(c.name)}</span>${mateLine(c.id)}</span>
          ${mateOpen(c.id)
            ? `<button class="mate-btn out" data-action="mate-punch" data-id="${esc(c.id)}" data-type="out">Clock out</button>`
            : `<button class="mate-btn in" data-action="mate-punch" data-id="${esc(c.id)}" data-type="in">Clock in</button>`}
        </div>`).join('') || '<p class="muted">No teammates yet.</p>'}</div>
    </main>`;
  };

  screens['pick-job'] = () => {
    const f = state.flow;
    const rough = f.roughFix;
    const jobs = state.jobs.filter((j) => j.active !== false).map((j) => ({
      j, d: rough && j.lat != null ? Geo.toFeet(Geo.distanceM(rough.lat, rough.lng, j.lat, j.lng)) : null,
    }));
    jobs.sort((a, b) => (a.d == null || b.d == null ? a.j.name.localeCompare(b.j.name) : a.d - b.d));
    const who = f.forTeammate ? crewById(f.crewId) : null;
    const title = f.fixing ? 'Pick the right job'
      : who ? `Which job is ${esc(who.name)} ${f.type === 'in' ? 'at' : 'leaving'}?`
        : f.type === 'in' ? 'Which job are you at?' : 'Which job are you leaving?';
    return `<main class="screen">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      ${who ? `<div class="for-mate">${f.type === 'in' ? 'Clocking in' : 'Clocking out'} <b>${esc(who.name)}</b></div>` : ''}
      <h1>${title}</h1>
      ${f.noLocation ? '' : rough ? '<p class="muted">Closest job is on top.</p>' : '<p class="muted">Finding the closest job…</p>'}
      <div class="list">${jobs.map(({ j, d }, i) => `
        <button class="job-btn ${i === 0 && d != null ? 'nearest' : ''}" data-action="pick-job" data-id="${esc(j.id)}">
          <span class="job-ico">${Icons.job}</span>
          <span class="grow"><span class="job-name">${esc(j.name)}</span><span class="job-addr">${esc(j.address || '')}</span></span>
          ${d != null ? `<span class="job-dist">${Geo.formatDistance(d)}</span>` : ''}
        </button>`).join('') || '<p class="notice">No jobs yet. Ask the boss to add one.</p>'}</div>
    </main>`;
  };

  screens.locating = () => {
    const flow = state.flow;
    const job = jobById(flow.jobId);
    setTimeout(() => {
      const b = document.getElementById('skip-gps');
      if (b && state.screen === 'locating' && state.flow === flow) b.hidden = false;
    }, 8000);
    return `<main class="screen center-col">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      <div class="spinner" role="status" aria-label="Finding you"></div>
      <h1>Finding you…</h1>
      <p class="lead">${esc(job ? job.name : '')}</p>
      <p class="muted" id="live-acc">Stand outside if you can.</p>
      <button class="btn secondary" id="skip-gps" hidden data-action="skip-gps">${Icons.camera} Take a picture instead</button>
    </main>`;
  };

  screens.photo = () => {
    const f = state.flow;
    const who = f.forTeammate ? crewById(f.crewId) : null;
    const name = esc(who ? who.name : 'They');
    const why = f.forTeammate && f.noLocation ? `${name} hasn't agreed to use location, so take a picture of them at the job.`
      : f.forTeammate ? `Take a picture of ${esc(who ? who.name : 'them')} at the job.`
        : f.noLocation ? 'Location is off for you, so the picture shows where you are.'
          : f.check && f.check.status === 'weak' ? 'GPS is weak here.' : "GPS couldn't find you.";
    return `<main class="screen center-col">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      <div class="big-icon amber">${Icons.camera}</div>
      <h1>${f.forTeammate ? 'Take a picture' : 'Take a picture of the job'}</h1>
      <p class="lead">${why} ${f.forTeammate ? '' : 'Get the house, the truck, or the work in the picture.'}</p>
      <label class="btn primary xl file-btn">${Icons.camera} Open camera
        <input type="file" accept="image/*" capture="environment" data-action="photo-file">
      </label>
      ${f.photoProblem ? `<p class="notice">${Icons.alert} ${esc(AI.PHOTO_WORDS[f.photoProblem])}</p>
        <button class="link" data-action="photo-anyway">Use that picture anyway</button>` : ''}
      <button class="link" data-action="no-photo">I can't take a picture</button>
    </main>`;
  };

  screens.done = () => {
    const f = state.flow;
    const job = jobById(f.jobId);
    const who = f.forTeammate ? crewById(f.crewId) : null;
    const s = STATUS[f.check.status];
    const verb = f.type === 'in' ? 'clocked in' : 'clocked out';
    const subject = who ? `${esc(who.name)} is` : "You're";
    const canFix = f.type === 'in' && !f.forTeammate && Date.now() - f.savedAt < FIX_WINDOW_MS;
    if (canFix) {
      setTimeout(() => {
        const b = document.getElementById('fix-btn');
        if (b) b.remove();
      }, FIX_WINDOW_MS - (Date.now() - f.savedAt));
    }
    return `<main class="screen center-col">
      <div class="big-check ${f.type}">${Icons.check}</div>
      <h1>${subject} ${verb}</h1>
      <p class="lead">${esc(job ? job.name : '')}<br><b>${time(f.at)}</b></p>
      <p>${chip(f.check.status, !!f.photo)}${f.check.distanceFt != null && f.check.status !== 'onsite' ? ` <span class="muted">${Geo.formatDistance(f.check.distanceFt)} from the job</span>` : ''}</p>
      ${s && f.check.status === 'offsite' ? '<p class="muted">The boss will see where you were.</p>' : ''}
      <div class="done-sync" data-done-sync>${doneSyncHtml()}</div>
      <button class="btn primary xl" data-action="go-home">OK</button>
      ${canFix ? `<button class="link" id="fix-btn" data-action="fix-job">Wrong job? Fix it</button>` : ''}
    </main>`;
  };

  // ---------- boss ----------
  let leafletMap = null;
  let jobFormMap = null;

  screens.boss = () => {
    const tab = state.bossTab;
    const tabs = [
      ['map', 'Map', Icons.map], ['today', 'Today', Icons.list],
      ...(isBoss() ? [['jobs', 'Jobs', Icons.job], ['crew', 'Crew', Icons.people]] : []),
      ...(self.Messenger ? [['chat', 'Chat', Icons.chat]] : []),
    ];
    const updated = state.team ? `Refresh · ${time(state.team.at)}` : 'Refresh';
    let body = '';
    if (tab === 'map') body = bossMapHtml();
    if (tab === 'today') body = bossTodayHtml();
    if (tab === 'jobs') body = bossJobsHtml();
    if (tab === 'crew') body = bossCrewHtml();
    if (tab === 'chat' && self.Messenger) body = Messenger.listHtml();
    return `<div class="boss">${demoBanner()}
        <header class="boss-head">
          <div class="brand small">${Icons.job}<span>Crew Clock</span></div>
          <div class="boss-head-right">
            <button class="link" data-action="reload-team">${updated}</button>
            ${isBoss() ? '<button class="link" data-action="sign-out">Switch</button>' : '<button class="link" data-action="go-home">Back</button>'}
          </div>
        </header>
        <div class="boss-body tab-${tab}">${body}</div>
        <nav class="tabbar">${tabs.map(([k, label, ic]) => `
          <button class="${k === tab ? 'on' : ''}" data-action="boss-tab" data-tab="${k}">${ic}<span>${label}</span></button>`).join('')}
        </nav>
      </div>`;
  };

  // Risk flags: the server's when it sent them, otherwise the same rules run here.
  function riskFor(p) {
    if (!p || !self.Risk) return [];
    if (Array.isArray(p.risk)) return p.risk;
    const crewHistory = teamPunches().filter((x) => x.crewId === p.crewId && x.id !== p.id);
    const deviceHistory = p.deviceId ? teamPunches().filter((x) => x.deviceId === p.deviceId) : [];
    return Risk.assess(p, { crewHistory, deviceHistory, receivedAt: p.receivedAt });
  }
  function riskHtml(flags) {
    const high = flags.filter((f) => f.level === 'high');
    if (!high.length) return '';
    return `<div class="risk">${Icons.alert}<span>${high.map((f) => esc(Risk.describe(f))).join('<br>')}</span></div>`;
  }

  function teamPunches() { return (state.team && state.team.punches) || []; }
  function teamCrew() { return ((state.team && state.team.crew) || state.crew).filter((c) => c.active !== false && c.role !== 'boss'); }

  function bossMapHtml() {
    return `<div id="team-map" class="team-map"></div>
      <div class="map-legend">${['onsite', 'near', 'offsite', 'nogps'].map((s) => chip(s)).join('')}</div>`;
  }

  function mountTeamMap() {
    const el = document.getElementById('team-map');
    if (!el || !self.L) return;
    if (leafletMap) { leafletMap.remove(); leafletMap = null; }
    leafletMap = L.map(el, { zoomControl: true, attributionControl: true });
    addBaseLayers(leafletMap);
    const pts = [];
    const jobs = (state.team && state.team.jobs) || state.jobs;
    jobs.filter((j) => j.active !== false && j.lat != null).forEach((j) => {
      L.circle([j.lat, j.lng], { radius: Geo.toMeters(j.radiusFt || 300), color: '#2563eb', weight: 2, fillOpacity: 0.08 }).addTo(leafletMap);
      L.marker([j.lat, j.lng], { icon: jobIcon(), title: j.name, alt: j.name }).addTo(leafletMap).bindPopup(`<b>${esc(j.name)}</b><br>${esc(j.address || '')}`);
      pts.push([j.lat, j.lng]);
    });
    const last = Report.lastPunchByCrew(teamPunches());
    let today0 = Report.startOfDay(Date.now());
    if (Api.isDemo && !teamPunches().some((p) => p.at >= today0)) today0 = Report.startOfDay(today0 - 1); // the sample day (M1.6)
    // Everyone whose last punch counts as at a job (not off site) sits in one row above that job's
    // pin, so the dots never cover each other or the pin; an off-site punch sits where it was.
    const rows = {};
    const placed = teamCrew().map((c) => {
      const p = last[c.id];
      if (!p) return null;
      const job = jobById(p.jobId);
      const atJob = job && job.lat != null && p.status !== 'offsite';
      const ll = atJob ? [job.lat, job.lng] : p.lat != null ? [p.lat, p.lng] : job ? [job.lat, job.lng] : null;
      if (!ll) return null;
      const row = atJob ? (rows[job.id] = rows[job.id] || []) : null;
      if (row) row.push(c.id);
      return { c, p, job, ll, row };
    }).filter(Boolean);
    placed.forEach(({ c, p, job, ll, row }) => {
      const stale = p.at < today0;
      const s = STATUS[p.status] || STATUS.nogps;
      const shift = row ? (row.indexOf(c.id) - (row.length - 1) / 2) * 46 : 0;
      const icon = L.divIcon({
        className: '',
        html: `<div class="crew-dot ${s.cls} ${stale ? 'stale' : ''} ${p.type === 'out' ? 'is-out' : ''}">${esc(initials(c.name))}</div>`,
        iconSize: [40, 40], iconAnchor: [20 - shift, row ? 62 : 20], popupAnchor: [shift, row ? -60 : -18],
      });
      const label = `${c.name}, ${s.word}`;
      L.marker(ll, { icon, zIndexOffset: 1000, title: label, alt: label }).addTo(leafletMap).bindPopup(punchPopup(c, p, job));
      pts.push(ll);
    });
    if (pts.length) leafletMap.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
    else leafletMap.setView([38.44, -81.88], 11); // Teays Valley / Cross Lanes
    leafletMap.on('popupopen', (e) => {
      const btn = e.popup.getElement().querySelector('[data-action="show-photo"]');
      if (btn) btn.addEventListener('click', () => showPhoto(btn.dataset.id));
    });
  }

  function punchPopup(c, p, job) {
    const verb = p.type === 'in' ? 'Clocked in' : 'Clocked out';
    const late = p.receivedAt && p.receivedAt - p.at > 15 * 60000 ? `<br><span class="muted">Sent at ${time(p.receivedAt)} (no signal)</span>` : '';
    const dist = p.distanceFt != null && p.status !== 'onsite' ? ` · ${Geo.formatDistance(p.distanceFt)} away` : '';
    return `<div class="popup"><b>${esc(c.name)}</b><br>${verb} ${dayLabel(p.at).toLowerCase()} ${time(p.at)}<br>
      ${esc(job ? job.name : '')}<br>${chip(p.status, p.hasPhoto)}${dist}
      ${p.address && p.status === 'offsite' ? `<br><span class="muted">${esc(p.address)}</span>` : ''}${late}
      ${riskHtml(riskFor(p))}
      ${p.hasPhoto ? `<br><button class="mini" data-action="show-photo" data-id="${esc(p.id)}">See photo</button>` : ''}</div>`;
  }

  function jobIcon() {
    return L.divIcon({ className: '', html: `<div class="job-pin">${Icons.job}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  }

  function addBaseLayers(map) {
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap',
    });
    const sat = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16, attribution: 'USGS',
    });
    streets.addTo(map);
    L.control.layers({ Streets: streets, Satellite: sat }, null, { position: 'topright' }).addTo(map);
  }

  function bossTodayHtml() {
    let today0 = Report.startOfDay(Date.now());
    // The demo's sample day is yesterday when it's opened before the crew's day has started (M1.6).
    // With no punches at all (an emptied demo) it stays "Today".
    const sampleYesterday = Api.isDemo && !teamPunches().some((p) => p.at >= today0)
      && teamPunches().some((p) => p.at >= Report.startOfDay(today0 - 1));
    if (sampleYesterday) today0 = Report.startOfDay(today0 - 1);
    const punches = teamPunches().filter((p) => p.at >= today0 || (p.type === 'void'));
    const shifts = Report.pairShifts(punches).filter((s) => (s.inAt || s.outAt) >= today0);
    const crew = teamCrew();
    const inToday = new Set(shifts.map((s) => s.crewId));
    const notIn = crew.filter((c) => !inToday.has(c.id));
    const punchById = Object.fromEntries(teamPunches().map((p) => [p.id, p]));
    shifts.sort((a, b) => (Report.SEVERITY[b.status] || 0) - (Report.SEVERITY[a.status] || 0) || (a.inAt || 0) - (b.inAt || 0));
    const rows = shifts.map((s) => {
      const c = crewById(s.crewId) || { name: '?' };
      const job = jobById(s.jobId);
      const photoP = [punchById[s.inId], punchById[s.outId]].find((p) => p && p.hasPhoto);
      const flags = [punchById[s.inId], punchById[s.outId]].filter(Boolean).flatMap(riskFor);
      const span = `${s.inAt ? time(s.inAt) : '?'} – ${s.outAt ? time(s.outAt) : s.open ? '<b class="on-clock">on the clock</b>' : '<b class="warn">no clock-out</b>'}`;
      return `<div class="shift">
        <span class="avatar">${esc(initials(c.name))}</span>
        <div class="grow"><div class="shift-name">${esc(c.name)}</div>
          <div class="muted small">${esc(job ? job.name : '')} · ${span}${s.hours != null ? ` · ${s.hours.toFixed(1)} h` : ''}</div>${riskHtml(flags)}</div>
        <div class="shift-right">${chip(s.status)}
          ${photoP ? `<button class="mini" data-action="show-photo" data-id="${esc(photoP.id)}">${Icons.camera}</button>` : ''}</div>
      </div>`;
    }).join('');
    const sheet = cfg.sheetUrl ? `<a class="btn secondary" href="${esc(cfg.sheetUrl)}" target="_blank" rel="noopener">${Icons.sheet} Open the Google Sheet</a>` : '';
    let summary = '';
    if (self.AI) {
      const names = Object.fromEntries(teamCrew().map((c) => [c.id, c.name]));
      const jobNames = Object.fromEntries(((state.team && state.team.jobs) || state.jobs).map((j) => [j.id, j.name]));
      const text = state.aiSummary || AI.plainSummary(shifts, names, jobNames, notIn.map((c) => c.name));
      state.summaryFacts = text;
      // The demo never loads a model: it would fetch a script from another site (SEP-2)
      const canWrite = !Api.isDemo && AI.tier() >= 2 && !state.aiSummary && shifts.length;
      summary = `<div class="summary"><div class="summary-text" id="summary-text">${esc(text)}</div>
        ${canWrite ? `<button class="link" data-action="ai-summary">Write it up with AI on this phone</button>` : ''}
        ${state.aiSummary ? '<div class="muted small">Written by an AI model running on this phone.</div>' : ''}</div>`;
    }
    return `<div class="pad">
      <h2>${sampleYesterday ? 'Yesterday (sample day)' : 'Today'}</h2>
      ${summary}
      ${notIn.length ? `<div class="not-in"><div class="not-in-title">${Icons.alert} ${sampleYesterday ? 'Not in' : 'Not in yet'} (${notIn.length})</div>
        <div>${notIn.map((c) => `<span class="pill">${esc(c.name)}</span>`).join('')}</div></div>` : ''}
      <div class="list">${rows || '<p class="muted">No one has clocked in today.</p>'}</div>
      <div id="push-slot"></div>
      <div class="actions">${isBoss() ? `<button class="btn secondary" data-action="send-report">${Icons.send} Send today's report now</button>` : ''}${sheet}</div>
    </div>`;
  }

  function bossJobsHtml() {
    const jobs = state.jobs.filter((j) => j.active !== false);
    return `<div class="pad">
      <div class="row-between"><h2>Jobs</h2><button class="btn primary sm" data-action="job-new">${Icons.plus} Add job</button></div>
      <div class="list">${jobs.map((j) => `
        <button class="job-btn" data-action="job-edit" data-id="${esc(j.id)}">
          <span class="job-ico">${Icons.job}</span>
          <span class="grow"><span class="job-name">${esc(j.name)}</span><span class="job-addr">${esc(j.address || 'Pin on map')}</span></span>
          <span class="job-dist">${j.radiusFt || 300} ft</span>
        </button>`).join('') || `<div class="empty"><p class="muted">No jobs yet. Add your first one.</p>
          <button class="btn primary" data-action="job-new">${Icons.plus} Add job</button></div>`}</div>
      ${syncFooter()}
    </div>`;
  }

  // C3: the boss sees who hasn't agreed. Unknown (status not loaded) shows nothing rather than a guess.
  function consentLine(c) {
    if (c.role === 'boss' || !state.team || !state.team.consents || hasConsent(c.id)) return '';
    return `<span class="job-addr no-consent">${Icons.alert} No location consent</span>`;
  }

  function bossCrewHtml() {
    const crew = state.crew.filter((c) => c.active !== false);
    const role = { boss: 'Boss', foreman: 'Foreman', crew: 'Crew' };
    return `<div class="pad">
      <div class="row-between"><h2>Crew</h2><button class="btn primary sm" data-action="crew-new">${Icons.plus} Add person</button></div>
      <div class="list">${crew.map((c) => `
        <button class="job-btn" data-action="crew-edit" data-id="${esc(c.id)}">
          <span class="avatar">${esc(initials(c.name))}</span>
          <span class="grow"><span class="job-name">${esc(c.name)}</span>${consentLine(c)}</span>
          <span class="job-dist">${role[c.role] || 'Crew'}</span>
        </button>`).join('')}</div>
      ${syncFooter()}
    </div>`;
  }

  function syncFooter() { return `<div class="sync-line" data-sync-line>${syncLineHtml()}</div>`; }

  // Job form: address (default) / drop pin / where I'm standing.
  screens['job-form'] = () => {
    const j = state.editJob;
    const mode = state.jobMode || 'address';
    const results = state.geoResults;
    return `<main class="screen form">
      <button class="back" data-action="boss-back">${Icons.back} Jobs</button>
      <h1>${j.isNew ? 'New job' : 'Edit job'}</h1>
      <label class="field"><span>Job name</span>
        <input id="job-name" value="${esc(j.name)}" placeholder="Smith kitchen" autocomplete="off"></label>
      <div class="field"><span>Where is it?</span>
        <div class="seg">${[['address', 'Address'], ['pin', 'Drop a pin'], ['here', "I'm here"]].map(([k, l]) =>
          `<button class="${mode === k ? 'on' : ''}" data-action="job-mode" data-mode="${k}">${l}</button>`).join('')}</div></div>
      ${mode === 'address' ? `<div class="field"><div class="search-row">
          <input id="job-address" value="${esc(state.addressQuery != null ? state.addressQuery : j.address)}" placeholder="Street and town" autocomplete="street-address" enterkeyhint="search">
          <button class="btn primary sm" data-action="geo-search">Find</button></div>
          ${results ? `<div class="results">${results.length ? results.map((r, i) =>
            `<button data-action="geo-pick" data-i="${i}">${Icons.pin}<span>${esc(r.label)}</span></button>`).join('')
            : '<p class="muted">No match. Try adding the town, or drop a pin.</p>'}</div>` : ''}</div>` : ''}
      ${mode === 'pin' ? '<p class="muted">Tap the map where the job is. Drag the pin to fine-tune.</p>' : ''}
      ${mode === 'here' ? `<button class="btn secondary" data-action="job-here">${Icons.locate} Use where I'm standing</button>` : ''}
      <div id="job-map" class="job-map"></div>
      <div class="field"><span>How close counts as "at the job"?</span>
        <div class="seg fences">${FENCES.map((f) => `<button class="${(j.radiusFt || 300) === f.ft ? 'on' : ''}" data-action="job-fence" data-ft="${f.ft}">
          <b>${f.word}</b><small>${f.ft} ft · ${f.hint}</small></button>`).join('')}</div></div>
      <button class="btn primary xl" data-action="job-save">Save job</button>
      ${!j.isNew ? '<button class="link danger" data-action="job-archive">Job is finished (hide it)</button>' : ''}
    </main>`;
  };

  function mountJobMap() {
    const el = document.getElementById('job-map');
    if (!el || !self.L) return;
    if (jobFormMap) { jobFormMap.remove(); jobFormMap = null; }
    const j = state.editJob;
    jobFormMap = L.map(el);
    addBaseLayers(jobFormMap);
    let marker = null;
    let circle = null;
    const place = (lat, lng, zoom) => {
      j.lat = lat;
      j.lng = lng;
      if (!marker) {
        marker = L.marker([lat, lng], { draggable: true }).addTo(jobFormMap);
        marker.on('dragend', () => { const p = marker.getLatLng(); place(p.lat, p.lng); });
        circle = L.circle([lat, lng], { radius: Geo.toMeters(j.radiusFt || 300), color: '#2563eb', weight: 2, fillOpacity: 0.1 }).addTo(jobFormMap);
      } else {
        marker.setLatLng([lat, lng]);
        circle.setLatLng([lat, lng]);
      }
      if (zoom) jobFormMap.setView([lat, lng], zoom);
    };
    if (j.lat != null) place(j.lat, j.lng, 17);
    else jobFormMap.setView([38.44, -81.88], 11);
    jobFormMap.on('click', (e) => {
      if ((state.jobMode || 'address') !== 'address') place(e.latlng.lat, e.latlng.lng);
    });
    state.placeJobPin = place;
  }

  screens['crew-form'] = () => {
    const c = state.editCrew;
    return `<main class="screen form">
      <button class="back" data-action="boss-back">${Icons.back} Crew</button>
      <h1>${c.isNew ? 'Add person' : esc(c.name)}</h1>
      <label class="field"><span>Name (first name and last initial)</span>
        <input id="crew-name" value="${esc(c.name)}" placeholder="Jake R." autocomplete="off"></label>
      <label class="field"><span>${c.isNew ? '4 number PIN' : 'New 4 number PIN (leave blank to keep)'}</span>
        <input id="crew-pin" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="${c.isNew ? '1234' : '••••'}" autocomplete="off"></label>
      <div class="field"><span>Role</span>
        <div class="seg">${[['crew', 'Crew'], ['foreman', 'Foreman'], ['boss', 'Boss']].map(([k, l]) =>
          `<button class="${(c.role || 'crew') === k ? 'on' : ''}" data-action="crew-role" data-role="${k}">${l}</button>`).join('')}</div>
        <small class="muted">Foreman can clock in a teammate and see the team map.</small></div>
      <button class="btn primary xl" data-action="crew-save">Save</button>
      ${!c.isNew && c.id !== state.me.id ? '<button class="link danger" data-action="crew-off">No longer works here (turn off)</button>' : ''}
    </main>`;
  };

  async function queueEdit(kind, data) {
    await Store.outbox.add({ kind, id: Store.uid(), byCrewId: state.me.id, data });
    await countPending();
    syncNow();
  }

  async function showPhoto(punchId) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = '<div class="spinner"></div>';
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
    try {
      const res = await Api.photo(state.auth, punchId);
      const src = res.url || res.dataUrl;
      overlay.innerHTML = src ? `<img src="${esc(src)}" alt="Clock-in photo">` : '<p>Photo not found.</p>';
      if (src && !Api.isDemo && self.AI && AI.tier() >= 1) {
        const b = document.createElement('button');
        b.className = 'btn secondary ai-check';
        b.textContent = "What's in this picture?";
        b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          b.disabled = true;
          b.textContent = 'Looking… (first time downloads a small model)';
          try {
            const r = await AI.labelPhoto(src);
            b.textContent = (r.looksLikeSite ? 'Looks like a job site: ' : "Doesn't look like a job site: ") + r.labels.slice(0, 3).map((l) => l.label).join(', ');
          } catch (e) {
            b.textContent = "Couldn't check this picture on this phone";
          }
        });
        overlay.appendChild(b);
      }
    } catch (e) {
      overlay.innerHTML = '<p>Need signal to load the photo.</p>';
    }
  }

  // ---------- rendering ----------
  function paint(html) {
    // The boss screen puts the banner inside its own frame, so the tab bar still fits (UX-5).
    $app.innerHTML = (state.screen === 'boss' ? '' : demoBanner()) + html;
  }

  function render() {
    if (gpsWatch && !gpsWatch.stillWanted()) stopGps();
    const fn = screens[state.screen] || screens.names;
    paint(fn());
    if (state.screen === 'boss' && state.bossTab === 'map') mountTeamMap();
    if (state.screen === 'job-form') mountJobMap();
    if (self.Messenger) Messenger.afterRender();
    mountPush();
  }

  async function mountPush() {
    const slot = document.getElementById('push-slot');
    if (!slot || !self.Push || !state.auth) return;
    const st = await Push.status().catch(() => 'unsupported');
    const words = {
      ready: `<button class="btn secondary" data-action="push-enable">${Icons.alert} Get alerts on this phone</button>`,
      'install-first': `<p class="muted small center">To get alerts on iPhone: tap Share, then <b>Add to Home Screen</b>, and open the app from there.</p>`,
      blocked: '<p class="muted small center">Alerts are turned off for this app in the phone settings.</p>',
      on: `<p class="muted small center">${Icons.check} Alerts are on for this phone</p>`,
    };
    slot.innerHTML = words[st] || '';
  }

  // ---------- events ----------
  const handlers = {
    'go': (el) => setScreen(el.dataset.to),
    'go-home': () => { state.flow = null; goHome(); },
    'pick-name': (el) => {
      if (demoNoPin()) return tryLogin(el.dataset.id, null);
      setScreen('pin', { pinFor: el.dataset.id, pinEntry: '', pinError: null });
    },
    'pin-key': (el) => {
      if ((state.pinEntry || '').length >= 4) return;
      state.pinEntry = (state.pinEntry || '') + el.dataset.k;
      state.pinError = null;
      render();
      if (state.pinEntry.length === 4) tryLogin(state.pinFor, state.pinEntry);
    },
    'pin-del': () => { state.pinEntry = (state.pinEntry || '').slice(0, -1); render(); },
    'consent-agree': async () => {
      const next = state.consentNext;
      await saveConsent('agree');
      if (next) return startPunch(next.type);
      goHome();
    },
    'consent-later': () => {
      const next = state.consentNext;
      state.consentAsked = true;
      if (next) return startPunch(next.type, { consentAsked: true });
      goHome();
    },
    'consent-back': () => { state.consentAsked = true; state.flow = null; setScreen('home'); },
    'consent-ask': () => setScreen('consent', { consentNext: null }),
    'consent-withdraw': async () => {
      if (!confirm('Stop using your location? You will clock in with a picture instead.')) return;
      await saveConsent('withdraw');
      toast('Location is off. You clock in with a picture.');
      render();
    },
    'prime-location': () => {
      Store.local.set('locPrimed', true);
      // One reading only so the phone shows its permission prompt; the fix is thrown away.
      watchGps(navigator.geolocation, () => state.screen === 'primer',
        { timeoutMs: 15000, goodEnoughM: Infinity, highAccuracy: false, maximumAgeMs: 120000 })
        .then(() => { if (state.screen === 'primer') setScreen('home'); });
    },
    'sign-out': () => signOut(),
    'punch': (el) => startPunch(el.dataset.type),
    'teammate': () => setScreen('pick-teammate'),
    'mate-punch': (el) => startPunch(el.dataset.type, { crewId: el.dataset.id }),
    'pick-job': (el) => pickJob(el.dataset.id),
    'skip-gps': () => { state.screen = 'skipping'; stopGps(); state.flow.fix = null; afterFix(); },
    'no-photo': () => finishPunch(),
    'photo-anyway': () => {
      state.flow.photoChecked = true;
      onPhotoFile(state.flow.pendingFile);
    },
    'fix-job': async () => {
      const orig = await Store.outbox.get(state.flow.saved.id) || state.flow.saved;
      startPunch('in', { fixing: Object.assign({}, orig, { photo: state.flow.photo }) });
    },
    'demo-fake': (el) => Store.local.set('demoFake', el.checked),
    // Demo only (M1.4): forget this visit and start again from the sample crew.
    'demo-reset': () => {
      if (!Api.isDemo || !confirm('Start over with the sample crew? Everything you did in this demo is cleared.')) return;
      try { Object.keys(localStorage).filter((k) => k.startsWith('cc.')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* private mode */ }
      if (window.DemoBackend) window.DemoBackend.reset();
      if (window.Messenger && window.Messenger.stop) window.Messenger.stop();
      ['crewclock', 'crewclock-chat', 'crewclock-keys'].forEach((db) => { try { indexedDB.deleteDatabase(db); } catch (e) { /* ok */ } });
      location.reload();
    },
    'boss-tab': (el) => {
      state.bossTab = el.dataset.tab;
      Store.local.set('bossTab', state.bossTab);
      render();
    },
    'boss-back': () => setScreen('boss'),
    'ai-summary': async (el) => {
      if (!AI.onWifi() && !confirm('This downloads about 400 MB once. Use cell data anyway?')) return;
      el.disabled = true;
      el.textContent = 'Writing… (first time downloads the model)';
      try {
        state.aiSummary = (await AI.writeSummary('Facts for today: ' + state.summaryFacts)).trim();
      } catch (e) {
        toast("This phone couldn't run the AI model");
        el.remove();
        return;
      }
      render();
    },
    'push-enable': async () => {
      try { await Push.enable(state.auth); toast('Alerts are on'); } catch (e) { toast("Couldn't turn on alerts. Try again with signal."); }
      mountPush();
    },
    'reload-team': async () => { await syncNow(); await loadTeam(); render(); },
    'show-photo': (el) => showPhoto(el.dataset.id),
    'send-report': async () => {
      try {
        const r = await Api.sendReport(state.auth);
        toast(r.sent ? "Report sent to your email" : (r.note || 'Report built'));
      } catch (e) { toast('Need signal to send the report'); }
    },
    'job-new': () => setScreen('job-form', { editJob: { id: Store.uid(), name: '', address: '', lat: null, lng: null, radiusFt: 300, active: true, isNew: true }, jobMode: 'address', geoResults: null, addressQuery: null }),
    'job-edit': (el) => setScreen('job-form', { editJob: Object.assign({}, jobById(el.dataset.id)), jobMode: 'address', geoResults: null, addressQuery: null }),
    'job-mode': (el) => { keepJobInputs(); state.jobMode = el.dataset.mode; render(); },
    'job-fence': (el) => { keepJobInputs(); state.editJob.radiusFt = +el.dataset.ft; render(); },
    'geo-search': async () => {
      keepJobInputs();
      const q = state.addressQuery;
      if (!q) return;
      try {
        const res = await Api.geocode(state.auth, q);
        state.geoResults = res.results || [];
      } catch (e) {
        toast('No signal for address search. Use "Drop a pin" or "I\'m here".');
        return;
      }
      render();
    },
    'geo-pick': (el) => {
      keepJobInputs();
      const r = state.geoResults[+el.dataset.i];
      state.editJob.address = r.label;
      state.addressQuery = r.label;
      state.editJob.lat = r.lat;
      state.editJob.lng = r.lng;
      state.geoResults = null;
      render();
    },
    'job-here': async (el) => {
      keepJobInputs();
      el.disabled = true;
      el.textContent = 'Finding you…';
      const job = state.editJob;
      const fix = await watchGps(navigator.geolocation,
        () => state.screen === 'job-form' && state.jobMode === 'here' && state.editJob === job, { timeoutMs: 15000, goodEnoughM: 15 });
      if (state.editJob !== job || state.screen !== 'job-form' || state.jobMode !== 'here') return; // they left it
      el.disabled = false;
      el.innerHTML = `${Icons.locate} Use where I'm standing`;
      if (!fix) return toast("Couldn't get GPS. Try Drop a pin.");
      state.placeJobPin(fix.lat, fix.lng, 18);
      if (!state.editJob.address) state.editJob.address = `Pin ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`;
    },
    'job-save': async () => {
      keepJobInputs();
      const j = state.editJob;
      if (!j.name.trim()) return toast('Give the job a name');
      if (j.lat == null) return toast('Set where the job is first');
      const rec = { id: j.id, name: j.name.trim(), address: j.address || '', lat: j.lat, lng: j.lng, radiusFt: j.radiusFt || 300, active: true };
      upsertLocal('jobs', rec);
      await queueEdit('job', rec);
      toast('Job saved');
      state.bossTab = 'jobs';
      setScreen('boss');
    },
    'job-archive': async () => {
      const j = Object.assign({}, state.editJob, { active: false });
      delete j.isNew;
      upsertLocal('jobs', j);
      await queueEdit('job', j);
      setScreen('boss');
    },
    'crew-new': () => setScreen('crew-form', { editCrew: { id: Store.uid(), name: '', role: 'crew', isNew: true, active: true } }),
    'crew-edit': (el) => setScreen('crew-form', { editCrew: Object.assign({}, state.crew.find((c) => c.id === el.dataset.id)) }),
    'crew-role': (el) => { keepCrewInputs(); state.editCrew.role = el.dataset.role; render(); },
    'crew-save': async () => {
      keepCrewInputs();
      const c = state.editCrew;
      if (!c.name.trim()) return toast('Type their name');
      if (c.newPin && !/^\d{4}$/.test(c.newPin)) return toast('PIN must be 4 numbers');
      if (c.isNew && !c.newPin) return toast('Give them a 4 number PIN');
      const rec = { id: c.id, name: c.name.trim(), role: c.role || 'crew', active: true };
      if (c.newPin) rec.pin = c.newPin;
      upsertLocal('crew', { id: rec.id, name: rec.name, role: rec.role, active: true });
      await queueEdit('crew', rec);
      toast(c.isNew ? `${rec.name} added. Their PIN is ${c.newPin}.` : 'Saved');
      state.bossTab = 'crew';
      setScreen('boss');
    },
    'crew-off': async () => {
      const c = state.editCrew;
      if (!confirm(`Turn off ${c.name}? They won't be able to sign in.`)) return;
      upsertLocal('crew', { id: c.id, name: c.name, role: c.role, active: false });
      await queueEdit('crew', { id: c.id, name: c.name, role: c.role, active: false });
      setScreen('boss');
    },
  };

  function keepJobInputs() {
    const n = document.getElementById('job-name');
    const a = document.getElementById('job-address');
    if (n) state.editJob.name = n.value;
    if (a) { state.addressQuery = a.value.trim(); if (!state.editJob.address) state.editJob.address = a.value.trim(); }
  }
  function keepCrewInputs() {
    const n = document.getElementById('crew-name');
    const p = document.getElementById('crew-pin');
    if (n) state.editCrew.name = n.value;
    if (p) state.editCrew.newPin = p.value.trim();
  }
  function upsertLocal(key, rec) {
    const list = state[key];
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0) list[i] = Object.assign(list[i], rec); else list.push(rec);
    Store.local.set(key, list);
    if (state.team) {
      const tl = state.team[key];
      const k = tl.findIndex((x) => x.id === rec.id);
      if (k >= 0) tl[k] = Object.assign(tl[k], rec); else tl.push(rec);
    }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    const h = handlers[el.dataset.action];
    if (h) { e.preventDefault(); h(el, e); }
  });
  async function onPhotoFile(file) {
    const f = state.flow;
    const who = crewById(f.crewId);
    const job = jobById(f.jobId);
    // On-phone check (every phone): ask for a retake if the picture is too dark or blurry.
    if (self.AI && !f.photoChecked) {
      const url = URL.createObjectURL(file);
      const q = await AI.photoQuality(url).catch(() => ({}));
      URL.revokeObjectURL(url);
      if (state.flow !== f) return;
      if (q.problem) {
        f.photoProblem = q.problem;
        f.pendingFile = file;
        return render();
      }
    }
    try {
      f.photo = await stampPhoto(file, [
        `${who ? who.name : ''} · ${f.type === 'in' ? 'Clock in' : 'Clock out'}`,
        `${job ? job.name : ''} · ${new Date(f.at).toLocaleString()}`,
      ]);
    } catch (err) {
      return toast("That picture didn't work. Try again.");
    }
    if (state.flow !== f) return; // they went Back while the picture was stamping (UX-9)
    finishPunch();
  }

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.action === 'demo-fake') handlers['demo-fake'](el);
    if (el.dataset.action === 'photo-file' && el.files && el.files[0]) onPhotoFile(el.files[0]);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'job-address') { e.preventDefault(); handlers['geo-search'](); }
  });

  // Retry whenever there is a chance of signal: back online, app reopened, every minute.
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(syncNow, 60000);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Hooks for add-on screens (js/messenger.js registers the chat screens here).
  self.CrewClock = { state, syncNow, render, screens, handlers, setScreen, esc, toast, time, initials, isBoss, isLead, crewById, goHome };
  countPending().then(() => { goHome(); syncNow(); });
})();

// Stand-in for the Apps Script backend, used when no backendUrl is set.
// Same actions and rules as backend/Code.gs, stored in this browser only.
(function (root) {
  const KEY = 'cc.demo.db.v5'; // v2: boss renamed from "Dad"; v3: job pins rounded (SEP-6); v4: location consents (M1.2); v5: daytime sample day (M1.6)
  const H = 3600000;

  function seed() {
    const now = Date.now();
    const day = root.Report.startOfDay(now);
    // Made-up jobs, named by town only (no street). Pins are rounded to 3 decimals (about 100 m), so none marks any one house (SEP-6),
    // and spread out so the boss map stays readable on a phone (M1.6).
    const jobs = [
      { id: 'j1', name: 'Smith kitchen', address: 'Teays Valley, WV', lat: 38.454, lng: -81.929, radiusFt: 300, active: true },
      { id: 'j2', name: 'Miller roof', address: 'Cross Lanes, WV', lat: 38.420, lng: -81.791, radiusFt: 300, active: true },
      { id: 'j3', name: 'Scott Depot deck', address: 'Scott Depot, WV', lat: 38.478, lng: -81.858, radiusFt: 150, active: true },
      { id: 'j4', name: 'Hurricane addition', address: 'Hurricane, WV', lat: 38.433, lng: -82.020, radiusFt: 600, active: true },
    ];
    const crew = [
      { id: 'c0', name: 'Sam W.', role: 'boss', pin: '1234', active: true },
      { id: 'c1', name: 'Ray T.', role: 'foreman', pin: '3333', active: true },
      { id: 'c2', name: 'Jake R.', role: 'crew', pin: '1111', active: true },
      { id: 'c3', name: 'Cody M.', role: 'crew', pin: '2222', active: true },
      { id: 'c4', name: 'Billy S.', role: 'crew', pin: '4444', active: true },
      { id: 'c5', name: 'Travis K.', role: 'crew', pin: '5555', active: true },
    ];
    // Seed a normal work day that starts at 6:54 AM, so every time on screen is a daytime time
    // whenever the visitor opens it (showcase SC-2). Before 9 AM there isn't enough of today yet,
    // so the sample day is yesterday, with everyone clocked out by mid-afternoon; the boss's day
    // list then shows it as "Yesterday (sample day)".
    const early = now < day + 9 * H;
    const base = early ? day - 24 * H : day;
    const t = (h) => Math.min(base + h * H, now - 60000);
    const punches = [
      mk('p1', 'c1', 'j1', 'in', t(6.9), 38.45405, -81.92895, 8),
      mk('p2', 'c2', 'j1', 'in', t(7.05), 38.45432, -81.92860, 15),
      mk('p3', 'c3', 'j2', 'in', t(7.2), 38.42160, -81.79340, 25),
      mk('p4', 'c4', 'j3', 'in', t(7.5), null, null, null),
      mk('p5', 'c4', 'j3', 'out', t(Math.min(11.5, (now - base) / H - 0.25)), 38.47820, -81.85800, 12),
    ];
    if (early) {
      punches.push(
        mk('p6', 'c1', 'j1', 'out', t(15.4), 38.45398, -81.92902, 9),
        mk('p7', 'c2', 'j1', 'out', t(15.5), 38.45421, -81.92871, 14),
        mk('p8', 'c3', 'j2', 'out', t(15.2), 38.42151, -81.79352, 22),
      );
    }
    punches.forEach((p) => { p.receivedAt = p.at + 30000; });
    // Everyone agreed to location on install day except Billy S., so a visitor sees the consent screen once.
    const installDay = day - 20 * 24 * H + 7 * H;
    const consents = ['c1', 'c2', 'c3', 'c5'].map((crewId, i) => ({
      id: 'k' + (i + 1), crewId, action: 'agree', textVersion: 'loc-v1', at: installDay + i * 60000, deviceId: null, receivedAt: installDay + i * 60000 + 5000,
    }));
    return { jobs, crew, punches, photos: {}, consents };
  }

  // Address search answers in the demo: made-up sample places, rounded like the job pins.
  const SAMPLE_PLACES = [
    { label: 'Hurricane, WV (sample)', lat: 38.433, lng: -82.020 },
    { label: 'Teays Valley, WV (sample)', lat: 38.454, lng: -81.929 },
    { label: 'Scott Depot, WV (sample)', lat: 38.478, lng: -81.858 },
    { label: 'Cross Lanes, WV (sample)', lat: 38.420, lng: -81.791 },
  ];

  function mk(id, crewId, jobId, type, at, lat, lng, accuracy) {
    return { id, crewId, byCrewId: crewId, jobId, type, at, lat, lng, accuracy };
  }

  function load() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = root.__demoDb || null; }
    if (!db) {
      db = seed();
      db.punches.forEach((p) => score(db, p));
      save(db);
    }
    return db;
  }

  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { root.__demoDb = db; }
  }

  function score(db, p) {
    const job = db.jobs.find((j) => j.id === p.jobId);
    const fix = p.lat == null ? null : { lat: p.lat, lng: p.lng, accuracy: p.accuracy };
    const r = root.Geo.checkFix(fix, job);
    p.status = r.status;
    p.distanceFt = r.distanceFt;
    if (p.status === 'offsite' && fix) p.address = 'Near ' + fix.lat.toFixed(4) + ', ' + fix.lng.toFixed(4);
  }

  function publicCrew(c) { return { id: c.id, name: c.name, role: c.role, active: c.active }; }
  function activeJobs(db) { return db.jobs.filter((j) => j.active !== false); }

  function authed(db, auth) {
    const me = auth && db.crew.find((c) => c.id === auth.crewId && c.active !== false);
    if (!me || String(me.pin) !== String(auth.pin)) throw new Error('Wrong PIN');
    return me;
  }

  // The newest consent record per worker (withdrawal is a newer record, never an edit).
  function latestConsents(db) {
    const out = {};
    (db.consents || []).forEach((c) => { if (!out[c.crewId] || c.at >= out[c.crewId].at) out[c.crewId] = c; });
    return out;
  }
  const consentView = (c) => (c ? { id: c.id, crewId: c.crewId, action: c.action, textVersion: c.textVersion, at: c.at } : null);

  function stripPunch(p) {
    const out = Object.assign({}, p);
    delete out.photo;
    return out;
  }

  const actions = {
    listCrew(db) {
      return { crew: db.crew.filter((c) => c.active !== false).map(publicCrew) };
    },
    login(db, req) {
      const me = authed(db, req.auth);
      return actions.refresh(db, req, me);
    },
    // Demo without PINs (config demoPin off): sign in by tapping a name.
    demoLogin(db, req) {
      const me = db.crew.find((c) => c.id === req.crewId && c.active !== false);
      if (!me) throw new Error('Not found');
      return Object.assign(actions.refresh(db, req, me), { auth: { crewId: me.id, pin: me.pin } });
    },
    refresh(db, req, me) {
      me = me || authed(db, req.auth);
      const mine = db.punches.filter((p) => p.crewId === me.id);
      const last = root.Report.lastPunchByCrew(db.punches)[me.id] || null;
      return {
        me: publicCrew(me),
        jobs: activeJobs(db),
        crew: db.crew.filter((c) => c.active !== false).map(publicCrew),
        last: last ? stripPunch(last) : null,
        punchCount: mine.length,
        consent: consentView(latestConsents(db)[me.id]),
      };
    },
    sync(db, req) {
      const me = authed(db, req.auth);
      const accepted = [];
      const rejected = [];
      const reasons = []; // same words as the real server (supabase/functions/_shared/core.ts)
      const refuse = (id, reason) => { rejected.push(id); reasons.push({ id, reason }); };
      for (const item of req.items || []) {
        if (item.kind === 'punch') {
          const forOther = item.crewId !== me.id;
          if (forOther && me.role === 'crew') { refuse(item.id, 'Only a foreman can clock in a teammate'); continue; }
          if (!db.punches.some((p) => p.id === item.id)) {
            const p = {
              id: item.id, crewId: item.crewId, byCrewId: me.id, jobId: item.jobId, type: item.type,
              at: item.at, lat: item.lat, lng: item.lng, accuracy: item.accuracy, voidsId: item.voidsId || null,
              hasPhoto: !!item.photo, receivedAt: Date.now(),
            };
            // Like the real server: no current consent at the time of the punch, no location stored (L3)
            const c = (db.consents || []).filter((x) => x.crewId === item.crewId && x.at <= item.at).sort((x, y) => x.at - y.at).pop();
            if (!c || c.action !== 'agree' || c.textVersion !== 'loc-v1') { p.lat = null; p.lng = null; p.accuracy = null; }
            if (item.photo) db.photos[item.id] = item.photo;
            if (p.type !== 'void') score(db, p);
            db.punches.push(p);
          }
          accepted.push(item.id);
        } else if (item.kind === 'consent') {
          // Same rules as the real server: only your own, agree or withdraw, never edited (PRIVACY C1).
          if (item.crewId !== me.id) { refuse(item.id, 'Only you can agree for yourself'); continue; }
          if (item.action !== 'agree' && item.action !== 'withdraw') { refuse(item.id, 'Bad consent action'); continue; }
          db.consents = db.consents || [];
          if (!db.consents.some((c) => c.id === item.id)) {
            db.consents.push({ id: item.id, crewId: me.id, action: item.action, textVersion: String(item.textVersion || ''),
              at: Math.min(item.at, Date.now()), deviceId: item.deviceId || null, receivedAt: Date.now() });
          }
          accepted.push(item.id);
        } else if (item.kind === 'job' || item.kind === 'crew') {
          if (me.role !== 'boss') { refuse(item.id, 'Boss only'); continue; }
          const list = item.kind === 'job' ? db.jobs : db.crew;
          const rec = Object.assign({}, item.data);
          const i = list.findIndex((x) => x.id === rec.id);
          if (item.kind === 'crew' && i >= 0 && !rec.pin) rec.pin = list[i].pin;
          if (i >= 0) list[i] = Object.assign(list[i], rec); else list.push(rec);
          accepted.push(item.id);
        } else {
          refuse(item.id, 'unknown kind');
        }
      }
      return { accepted, rejected, reasons };
    },
    team(db, req) {
      const me = authed(db, req.auth);
      if (me.role === 'crew') throw new Error('Boss only');
      const since = req.since || root.Report.startOfDay(Date.now()) - 7 * 24 * H;
      return {
        punches: db.punches.filter((p) => p.at >= since).map(stripPunch),
        crew: db.crew.map(publicCrew),
        jobs: db.jobs,
        // Status only (latest action and text version), like the real crew_consent_status()
        consents: Object.values(latestConsents(db)).map((c) => ({ crewId: c.crewId, action: c.action, textVersion: c.textVersion })),
      };
    },
    photo(db, req) {
      authed(db, req.auth);
      return { dataUrl: db.photos[req.punchId] || null };
    },
    // The demo never calls an address server (SEP-2): it answers from a few sample places.
    geocode(db, req) {
      authed(db, req.auth);
      const words = String(req.address || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
      const hits = SAMPLE_PLACES
        .map((p) => ({ p, n: words.filter((w) => p.label.toLowerCase().includes(w)).length }))
        .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => x.p);
      return { results: (hits.length ? hits : SAMPLE_PLACES).map((p) => Object.assign({}, p)) };
    },
    sendReport(db, req) {
      authed(db, req.auth);
      return { sent: false, note: 'Demo mode: reports are emailed once the Google Sheet is connected.' };
    },
  };

  function handle(action, req) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (root.navigator && root.navigator.onLine === false) {
          const off = new Error('No signal');
          off.offline = true;
          return reject(off);
        }
        try {
          const db = load();
          if (!actions[action]) throw new Error('Unknown action');
          Promise.resolve(actions[action](db, req || {})).then((res) => {
            save(db);
            resolve(Object.assign({ ok: true }, res));
          }, reject);
        } catch (e) {
          const err = new Error(e.message);
          err.server = true;
          reject(err);
        }
      }, 150);
    });
  }

  // A phone that once ran the crew app (or opened a crew link) may have left its session here.
  // The demo never uses it (SEP-2): drop the crew-app keys, and a signed-in worker the demo doesn't know.
  function forgetCrewApp() {
    try {
      ['cc.sbSession', 'cc.orgCode'].forEach((k) => localStorage.removeItem(k));
      const auth = JSON.parse(localStorage.getItem('cc.auth'));
      if (auth && !load().crew.some((c) => c.id === auth.crewId)) {
        ['auth', 'me', 'last', 'team', 'jobs', 'crew', 'crewNames', 'locPrimed'].forEach((k) => localStorage.removeItem('cc.' + k));
      }
    } catch (e) { /* private mode: nothing was kept */ }
  }

  root.DemoBackend = { handle, forgetCrewApp, reset: () => { try { localStorage.removeItem(KEY); } catch (e) { root.__demoDb = null; } } };
})(self);

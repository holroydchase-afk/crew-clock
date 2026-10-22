// Stand-in for the Apps Script backend, used when no backendUrl is set.
// Same actions and rules as backend/Code.gs, stored in this browser only.
(function (root) {
  const KEY = 'cc.demo.db';
  const H = 3600000;

  function seed() {
    const now = Date.now();
    const day = root.Report.startOfDay(now);
    const jobs = [
      { id: 'j1', name: 'Smith kitchen', address: 'Teays Valley Rd, Hurricane, WV', lat: 38.4537, lng: -81.9290, radiusFt: 300, active: true },
      { id: 'j2', name: 'Miller roof', address: 'Cross Lanes, WV', lat: 38.4204, lng: -81.7907, radiusFt: 300, active: true },
      { id: 'j3', name: 'Scott Depot deck', address: 'Scott Depot, WV', lat: 38.4401, lng: -81.9002, radiusFt: 150, active: true },
      { id: 'j4', name: 'Hurricane addition', address: 'Main St, Hurricane, WV', lat: 38.4326, lng: -82.0201, radiusFt: 600, active: true },
    ];
    const crew = [
      { id: 'c0', name: 'Dad', role: 'boss', pin: '1234', active: true },
      { id: 'c1', name: 'Ray T.', role: 'foreman', pin: '3333', active: true },
      { id: 'c2', name: 'Jake R.', role: 'crew', pin: '1111', active: true },
      { id: 'c3', name: 'Cody M.', role: 'crew', pin: '2222', active: true },
      { id: 'c4', name: 'Billy S.', role: 'crew', pin: '4444', active: true },
      { id: 'c5', name: 'Travis K.', role: 'crew', pin: '5555', active: true },
    ];
    const t = (h) => Math.min(day + h * H, now - 60000);
    const punches = [
      mk('p1', 'c1', 'j1', 'in', t(6.9), 38.45375, -81.92895, 8),
      mk('p2', 'c2', 'j1', 'in', t(7.05), 38.45402, -81.92860, 15),
      mk('p3', 'c3', 'j2', 'in', t(7.2), 38.42200, -81.79310, 25),
      mk('p4', 'c4', 'j3', 'in', t(7.5), null, null, null),
      mk('p5', 'c4', 'j3', 'out', t(11.5), 38.44030, -81.90020, 12),
    ];
    punches.forEach((p) => { p.receivedAt = p.at + 30000; });
    return { jobs, crew, punches, photos: {} };
  }

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
    refresh(db, req, me) {
      me = me || authed(db, req.auth);
      const mine = db.punches.filter((p) => p.crewId === me.id);
      const last = root.Report.lastPunchByCrew(db.punches)[me.id] || null;
      return {
        me: publicCrew(me),
        jobs: activeJobs(db),
        crew: me.role === 'crew' ? [] : db.crew.filter((c) => c.active !== false).map(publicCrew),
        last: last ? stripPunch(last) : null,
        punchCount: mine.length,
      };
    },
    sync(db, req) {
      const me = authed(db, req.auth);
      const accepted = [];
      const rejected = [];
      for (const item of req.items || []) {
        if (item.kind === 'punch') {
          const forOther = item.crewId !== me.id;
          if (forOther && me.role === 'crew') { rejected.push(item.id); continue; }
          if (!db.punches.some((p) => p.id === item.id)) {
            const p = {
              id: item.id, crewId: item.crewId, byCrewId: me.id, jobId: item.jobId, type: item.type,
              at: item.at, lat: item.lat, lng: item.lng, accuracy: item.accuracy, voidsId: item.voidsId || null,
              hasPhoto: !!item.photo, receivedAt: Date.now(),
            };
            if (item.photo) db.photos[item.id] = item.photo;
            if (p.type !== 'void') score(db, p);
            db.punches.push(p);
          }
          accepted.push(item.id);
        } else if (item.kind === 'job' || item.kind === 'crew') {
          if (me.role !== 'boss') { rejected.push(item.id); continue; }
          const list = item.kind === 'job' ? db.jobs : db.crew;
          const rec = Object.assign({}, item.data);
          const i = list.findIndex((x) => x.id === rec.id);
          if (item.kind === 'crew' && i >= 0 && !rec.pin) rec.pin = list[i].pin;
          if (i >= 0) list[i] = Object.assign(list[i], rec); else list.push(rec);
          accepted.push(item.id);
        } else {
          rejected.push(item.id);
        }
      }
      return { accepted, rejected };
    },
    team(db, req) {
      const me = authed(db, req.auth);
      if (me.role === 'crew') throw new Error('Boss only');
      const since = req.since || root.Report.startOfDay(Date.now()) - 7 * 24 * H;
      return {
        punches: db.punches.filter((p) => p.at >= since).map(stripPunch),
        crew: db.crew.map(publicCrew),
        jobs: db.jobs,
      };
    },
    photo(db, req) {
      authed(db, req.auth);
      return { dataUrl: db.photos[req.punchId] || null };
    },
    geocode(db, req) {
      authed(db, req.auth);
      const url = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=' +
        encodeURIComponent(req.address);
      return fetch(url).then((r) => r.json()).then((rows) => ({
        results: rows.map((r) => ({ label: r.display_name, lat: +r.lat, lng: +r.lon })),
      }));
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

  root.DemoBackend = { handle, reset: () => { try { localStorage.removeItem(KEY); } catch (e) { root.__demoDb = null; } } };
})(self);

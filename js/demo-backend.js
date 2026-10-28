// Stand-in for the Apps Script backend, used when no backendUrl is set.
// Same actions and rules as backend/Code.gs, stored in this browser only.
(function (root) {
  const KEY = 'cc.demo.db.v7'; // v2: boss renamed from "Dad"; v3: job pins rounded (SEP-6); v4: location consents (M1.2); v5: daytime sample day (M1.6); v6: finished day in the evening (M1.10); v7: signed punches and earlier sample days (M1.13)
  const OFFLINE_KEY = 'cc.demoOffline'; // the demo's "No signal" switch (M1.13 ENH-2); Reset clears it with the other cc. keys
  const H = 3600000;

  // The sample day: today, or yesterday before 9 AM (not enough of today yet). `done` means
  // everyone has clocked out: yesterday's day, or today's from 6 PM on (M1.10 EVENING).
  function sampleDay(now) {
    const day = root.Report.startOfDay(now);
    const early = now < day + 9 * H;
    return { day, base: early ? day - 24 * H : day, done: early || now >= day + 18 * H };
  }

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
    // list then shows it as "Yesterday (sample day)". From 6 PM the sample day is today, but
    // finished the same way, so an evening visitor doesn't see the crew on the clock at night.
    const { base, done } = sampleDay(now);
    const t = (h) => Math.min(base + h * H, now - 60000);
    const punches = [
      mk('p1', 'c1', 'j1', 'in', t(6.9), 38.45405, -81.92895, 8),
      mk('p2', 'c2', 'j1', 'in', t(7.05), 38.45432, -81.92860, 15),
      mk('p3', 'c3', 'j2', 'in', t(7.2), 38.42160, -81.79340, 25),
      mk('p4', 'c4', 'j3', 'in', t(7.5), null, null, null),
      mk('p5', 'c4', 'j3', 'out', t(Math.min(11.5, (now - base) / H - 0.25)), 38.47820, -81.85800, 12),
    ];
    if (done) {
      punches.push(
        mk('p6', 'c1', 'j1', 'out', t(15.4), 38.45398, -81.92902, 9),
        mk('p7', 'c2', 'j1', 'out', t(15.5), 38.45421, -81.92871, 14),
        mk('p8', 'c3', 'j2', 'out', t(15.2), 38.42151, -81.79352, 22),
      );
    }
    punches.forEach((p) => { p.receivedAt = p.at + 30000; });
    const earlier = earlierDays(base, jobs);
    // Everyone agreed to location on install day except Billy S., so a visitor sees the consent screen once.
    const installDay = day - 20 * 24 * H + 7 * H;
    const consents = ['c1', 'c2', 'c3', 'c5'].map((crewId, i) => ({
      id: 'k' + (i + 1), crewId, action: 'agree', textVersion: 'loc-v1', at: installDay + i * 60000, deviceId: null, receivedAt: installDay + i * 60000 + 5000,
    }));
    return { jobs, crew, punches, earlier, photos: {}, consents, devices: [] };
  }

  // M1.13 ENH-3: the weekdays in the 9 days before the sample day, so the boss's week view has a
  // few days of work. Kept apart from the sample day's punches (db.earlier), and returned only in
  // the boss's team view. Daytime only; each day's GPS a little different, so no reading repeats.
  // Travis K. (c5) has none: he is the visitor's "Start here" worker and starts with a clean slate.
  function earlierDays(base, jobs) {
    const out = [];
    const plan = [['c1', 'j1', 6.8, 15.3], ['c2', 'j1', 7.0, 15.5], ['c3', 'j2', 7.1, 15.2], ['c4', 'j3', 7.4, 14.4]];
    for (let k = 1; k <= 9; k++) {
      const d = new Date(base);
      d.setDate(d.getDate() - k);
      const day = root.Report.startOfDay(d.getTime());
      const dow = new Date(day).getDay();
      if (dow === 0 || dow === 6) continue;
      plan.forEach(([crewId, jobId, inH, outH], i) => {
        if (crewId === 'c4' && k % 3 === 0) return; // Billy S. works part of the week
        const job = jobs.find((j) => j.id === (crewId === 'c4' && k % 2 ? 'j4' : jobId));
        const wiggle = (n) => (((k * 7 + i * 3 + n) % 9) + 1) * 0.00003;
        const at = (h) => day + Math.round(h * 10) * 360000; // whole tenths of an hour
        const gps = (n) => (crewId === 'c4' ? [null, null, null] : [job.lat + wiggle(n), job.lng - wiggle(n + 4), 8 + ((k + i + n) % 9)]);
        const shift = (k % 4) * 0.1;
        out.push(mk(`e${k}-${crewId}-in`, crewId, job.id, 'in', at(inH + shift), ...gps(0)));
        out.push(mk(`e${k}-${crewId}-out`, crewId, job.id, 'out', at(outH + shift), ...gps(1)));
      });
    }
    out.forEach((p) => { p.receivedAt = p.at + 30000; });
    return out;
  }

  // M1.13 ENH-1: each sample worker's phone signs and chains their punches, like a real phone does
  // (js/device.js), with a key made here in this browser. The private half is never kept: only the
  // public key is stored, so the boss's screen can check every punch. No WebCrypto: left unsigned.
  async function signSeed(db) {
    const Chain = root.Chain;
    if (!Chain || !root.crypto || !root.crypto.subtle) return;
    try {
      const all = db.earlier.concat(db.punches);
      const signed = {};
      const devices = [];
      for (const c of db.crew) {
        const mine = all.filter((p) => p.crewId === c.id).sort((a, b) => a.at - b.at);
        if (!mine.length) continue;
        const keys = await Chain.generateKey();
        const deviceId = 'sample-phone-' + c.id;
        let prev = { seq: 0, hash: 'genesis' };
        for (const p of mine) {
          const s = await Chain.signPunch(Object.assign({}, p, { deviceId }), keys.privateKey, prev);
          prev = { seq: s.seq, hash: s.hash };
          signed[p.id] = s;
        }
        devices.push({ id: deviceId, crewId: c.id, publicKey: await Chain.exportPublic(keys.publicKey) });
      }
      db.punches = db.punches.map((p) => signed[p.id] || p);
      db.earlier = db.earlier.map((p) => signed[p.id] || p);
      db.devices = devices;
    } catch (e) { /* an old browser: the sample stays unsigned */ }
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

  function stored() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* private mode */ }
    return db || root.__demoDb || null; // writes failed earlier in this tab (HRD-13)
  }

  // Signing takes a moment, so the store is written only once the sample is signed, and two
  // first requests share one seed.
  let seeding = null;
  function load() {
    const db = stored();
    if (db) return Promise.resolve(db);
    if (!seeding) {
      seeding = (async () => {
        const fresh = seed();
        await signSeed(fresh);
        fresh.punches.forEach((p) => score(fresh, p));
        fresh.earlier.forEach((p) => score(fresh, p));
        save(fresh);
        return fresh;
      })().finally(() => { seeding = null; });
    }
    return seeding;
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

  function cleanText(v) {
    // eslint-disable-next-line no-control-regex
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
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
      // PS-4: a worker the boss turned off can't sign in, but their own punches made before (plus
      // 15 min, PS-M112-1) still sync, flagged for the boss. Nothing else from that phone is taken,
      // and nobody else's punch for them. Same rules and words as core.ts ingestPunch.
      const off = req.auth && db.crew.find((c) => c.id === req.auth.crewId && c.active === false);
      const me = off && String(off.pin) === String(req.auth.pin) ? off : authed(db, req.auth);
      const accepted = [];
      const rejected = [];
      const reasons = []; // same words as the real server (supabase/functions/_shared/core.ts)
      // This browser's phone key, first time it is seen (the real app registers it at sign-in)
      const dev = req.device;
      db.devices = db.devices || [];
      if (dev && dev.deviceId && dev.publicKey && !db.devices.some((d) => d.id === dev.deviceId)) {
        db.devices.push({ id: String(dev.deviceId), crewId: me.id, publicKey: dev.publicKey });
      }
      const refuse = (id, reason) => { rejected.push(id); reasons.push({ id, reason }); };
      for (const item of req.items || []) {
        if (me.active === false && item.kind !== 'punch') { refuse(item.id, 'Turned off'); continue; }
        if (item.kind === 'punch') {
          const forOther = item.crewId !== me.id;
          const who = db.crew.find((c) => c.id === item.crewId);
          if (!who) { refuse(item.id, 'Unknown crew member'); continue; }
          if (forOther && me.role === 'crew') { refuse(item.id, 'Only a foreman can clock in a teammate'); continue; }
          if (forOther && me.active === false) { refuse(item.id, 'Turned off'); continue; }
          if (who.active === false && (forOther || !(item.at <= (who.deactivatedAt || NaN) + 15 * 60000))) {
            refuse(item.id, 'Turned off');
            continue;
          }
          if (!db.punches.some((p) => p.id === item.id)) {
            const p = {
              id: item.id, crewId: item.crewId, byCrewId: me.id, jobId: item.jobId, type: item.type,
              at: item.at, lat: item.lat, lng: item.lng, accuracy: item.accuracy, voidsId: item.voidsId || null,
              hasPhoto: !!item.photo, receivedAt: Date.now(),
            };
            if (who.active === false) p.crewInactive = true; // shown to the boss as crew_inactive
            // Like the real server: no current consent at the time of the punch, no location stored (L3)
            const c = (db.consents || []).filter((x) => x.crewId === item.crewId && x.at <= item.at).sort((x, y) => x.at - y.at).pop();
            const signedBy = item.signature && db.devices.some((d) => d.id === item.deviceId);
            if (signedBy) {
              Object.assign(p, { deviceId: item.deviceId, seq: item.seq, prevHash: item.prevHash, hash: item.hash,
                signature: item.signature, photoSha256: item.photoSha256 || null });
            }
            if (!c || c.action !== 'agree' || c.textVersion !== 'loc-v1') {
              // Like the server (PS-M112-2): when the GPS is dropped, its hash and signature go too
              if (p.lat != null || p.lng != null || p.accuracy != null) { delete p.hash; delete p.signature; delete p.prevHash; }
              p.lat = null; p.lng = null; p.accuracy = null;
            }
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
          // Same limits and words as the real server (HRD-14): control characters dropped, then
          // a name over 60 or an address over 200 is refused, naming no value.
          if ('name' in rec) rec.name = cleanText(rec.name);
          if ('address' in rec) rec.address = cleanText(rec.address);
          if (rec.name && rec.name.length > 60) { refuse(item.id, 'Name is too long (60 letters at most)'); continue; }
          if (rec.address && rec.address.length > 200) { refuse(item.id, 'Address is too long (200 letters at most)'); continue; }
          const i = list.findIndex((x) => x.id === rec.id);
          if (item.kind === 'crew' && i >= 0 && !rec.pin) rec.pin = list[i].pin;
          if (item.kind === 'crew') {
            const was = i >= 0 ? list[i].active !== false : true;
            if (rec.active === false && was) rec.deactivatedAt = Date.now();
            if (rec.active !== false) rec.deactivatedAt = null;
          }
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
        punches: (db.earlier || []).concat(db.punches).filter((p) => p.at >= since).map(stripPunch),
        crew: db.crew.map(publicCrew),
        // Public keys only, so the boss's screen can check every punch (ENH-1)
        devices: (db.devices || []).map((d) => ({ id: d.id, publicKey: d.publicKey })),
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
        if ((root.navigator && root.navigator.onLine === false) || isOffline()) {
          const off = new Error('No signal');
          off.offline = true;
          return reject(off);
        }
        load().then((db) => {
          if (!actions[action]) throw new Error('Unknown action');
          return Promise.resolve(actions[action](db, req || {})).then((res) => {
            save(db);
            resolve(Object.assign({ ok: true }, res));
          });
        }).catch((e) => {
          const err = new Error(e.message);
          err.server = true;
          reject(err);
        });
      }, 150);
    });
  }

  // A phone that once ran the crew app (or opened a crew link) may have left its session here.
  // The demo never uses it (SEP-2): drop the crew-app keys, and a signed-in worker the demo doesn't know.
  function forgetCrewApp() {
    try {
      ['cc.sbSession', 'cc.orgCode'].forEach((k) => localStorage.removeItem(k));
      const auth = JSON.parse(localStorage.getItem('cc.auth'));
      if (auth && !(stored() || seed()).crew.some((c) => c.id === auth.crewId)) {
        ['auth', 'me', 'last', 'team', 'jobs', 'crew', 'crewNames', 'locPrimed'].forEach((k) => localStorage.removeItem('cc.' + k));
      }
    } catch (e) { /* private mode: nothing was kept */ }
  }

  // ---------- demo-only controls (M1.13) ----------
  // ENH-2 "No signal": every request fails the way it does with no signal, so the phone's outbox
  // holds what the visitor does until they turn it off.
  let offlineMem = false;
  function isOffline() {
    try { return localStorage.getItem(OFFLINE_KEY) === 'true'; } catch (e) { return offlineMem; }
  }
  function setOffline(on) {
    offlineMem = !!on;
    try { if (on) localStorage.setItem(OFFLINE_KEY, 'true'); else localStorage.removeItem(OFFLINE_KEY); } catch (e) { /* kept in memory */ }
  }

  // ENH-1 "Try tampering": move Jake R.'s sample clock-in 30 minutes earlier in the stored records,
  // the way someone editing the database would, keeping its old hash and signature. Undo puts it back.
  // id: the punch to change (the boss screen passes one from the day it shows); by default Jake's.
  function tamper(id) {
    const db = stored();
    if (!db) return null;
    if (db.tampered) return { id: db.tampered.id };
    const p = (id && db.punches.find((x) => x.id === id && x.signature))
      || db.punches.find((x) => x.crewId === 'c2' && x.type === 'in' && x.signature) || db.punches.find((x) => x.signature);
    if (!p) return null;
    db.tampered = { id: p.id, at: p.at };
    const earlier = p.at - 30 * 60000;
    // Stays on the same day, so it stays on the list the boss is looking at
    p.at = root.Report.startOfDay(earlier) === root.Report.startOfDay(p.at) ? earlier : p.at + 30 * 60000;
    save(db);
    return { id: p.id };
  }
  function untamper() {
    const db = stored();
    if (!db || !db.tampered) return;
    const p = db.punches.find((x) => x.id === db.tampered.id);
    if (p) p.at = db.tampered.at;
    delete db.tampered;
    save(db);
  }
  const isTampered = () => { const db = stored(); return !!(db && db.tampered); };

  root.DemoBackend = { handle, forgetCrewApp, sampleDay, setOffline, isOffline, tamper, untamper, isTampered,
    reset: () => { root.__demoDb = null; try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ } } };
})(self);

// Supabase backend for the app, with plain fetch (no SDK) so it stays light on cheap phones.
// Same methods as the other backends in api.js.
(function (root) {
  const cfg = root.APP_CONFIG || {};
  const TIMEOUT_MS = 20000;
  const SESSION_KEY = 'cc.sbSession';

  function orgCode() {
    const fromUrl = new URLSearchParams(root.location ? root.location.search : '').get('org');
    if (fromUrl) root.Store.local.set('orgCode', fromUrl.toUpperCase());
    return root.Store.local.get('orgCode', null) || cfg.orgCode || '';
  }

  function session() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
  function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ } }

  async function request(url, opts) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, Object.assign({ signal: ctrl ? ctrl.signal : undefined }, opts));
    } catch (e) {
      e.offline = true;
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      const err = new Error(body.error || body.message || 'Server error');
      err.server = true;
      err.status = res.status;
      throw err;
    }
    return body;
  }

  function headers(token) {
    return { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + (token || cfg.supabaseAnonKey), 'Content-Type': 'application/json' };
  }

  const fn = (name, body, token) => request(`${cfg.supabaseUrl}/functions/v1/${name}`,
    { method: 'POST', headers: headers(token), body: JSON.stringify(body || {}) });

  const rest = (path, token) => request(`${cfg.supabaseUrl}/rest/v1/${path}`, { headers: headers(token) });

  // Calls with the session token, signing in again with the saved PIN if it expired.
  async function authed(auth, run) {
    let s = session();
    if (!s || s.crewId !== auth.crewId || s.expiresAt < Date.now() + 60000) s = await signIn(auth.crewId, auth.pin);
    try {
      return await run(s.token);
    } catch (e) {
      if (e.status !== 401) throw e;
      s = await signIn(auth.crewId, auth.pin);
      return run(s.token);
    }
  }

  async function signIn(crewId, pin) {
    const device = root.Device && root.Device.supported() ? await root.Device.publicInfo().catch(() => null) : null;
    const r = await fn('pin-login', { crewId, pin, device });
    const s = { token: r.token, expiresAt: r.expiresAt, crewId, me: r.me };
    saveSession(s);
    return s;
  }

  const job = (j) => ({ id: j.id, name: j.name, address: j.address, lat: j.lat, lng: j.lng, radiusFt: j.radius_ft, active: j.active });
  const punch = (p) => ({
    id: p.id, crewId: p.crew_id, byCrewId: p.by_crew_id, jobId: p.job_id, type: p.type, voidsId: p.voids_id,
    at: Date.parse(p.phone_at), receivedAt: Date.parse(p.received_at), lat: p.lat, lng: p.lng, accuracy: p.accuracy_m,
    distanceFt: p.distance_ft, status: p.status, hasPhoto: !!p.photo_key, address: p.address, risk: p.risk || [], sigOk: p.sig_ok,
  });

  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' });
  }

  // Photos go straight to Backblaze; the punch then carries only the object key.
  async function uploadPhotos(token, items) {
    for (const it of items) {
      if (it.kind !== 'punch' || !it.photo || it.photoKey) continue;
      const up = await fn('photo-upload', { punchId: it.id }, token);
      const put = await fetch(up.url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: dataUrlToBlob(it.photo) });
      if (!put.ok) throw Object.assign(new Error('Photo upload failed'), { offline: true });
      it.photoKey = up.key;
      delete it.photo;
      await root.Store.outbox.add(it); // so a retry doesn't upload twice
    }
  }

  root.SupabaseApi = {
    isDemo: false,
    async listCrew() {
      const r = await fn('crew-list', { orgCode: orgCode() });
      return { crew: r.crew, org: r.org };
    },
    async login(crewId, pin) {
      await signIn(crewId, pin);
      return this.refresh({ crewId, pin });
    },
    refresh(auth) {
      return authed(auth, async (t) => {
        const me = session().me;
        const lead = me.role !== 'crew';
        const [jobs, crew, last] = await Promise.all([
          rest('jobs?active=eq.true&select=*&order=name', t),
          lead ? rest('crew?active=eq.true&select=id,name,role,active&order=name', t) : Promise.resolve([]),
          rest(`punches?crew_id=eq.${me.id}&type=in.(in,out)&status=neq.voided&order=phone_at.desc&limit=1&select=*`, t),
        ]);
        return { me, jobs: jobs.map(job), crew, last: last[0] ? punch(last[0]) : null };
      });
    },
    sync(auth, items) {
      return authed(auth, async (t) => {
        await uploadPhotos(t, items);
        return fn('sync', { items }, t);
      });
    },
    team(auth, since) {
      const from = new Date(since || Date.now() - 8 * 86400000).toISOString();
      return authed(auth, async (t) => {
        const [punches, crew, jobs] = await Promise.all([
          rest(`punches?phone_at=gte.${encodeURIComponent(from)}&order=phone_at.asc&limit=3000&select=*`, t),
          rest('crew?select=id,name,role,active', t),
          rest('jobs?select=*', t),
        ]);
        return { punches: punches.map(punch), crew, jobs: jobs.map(job) };
      });
    },
    geocode(auth, address) { return authed(auth, (t) => fn('geocode', { address }, t)); },
    photo(auth, punchId) { return authed(auth, (t) => fn('photo-url', { punchId }, t)); },
    sendReport(auth) { return authed(auth, (t) => fn('digest', { kind: 'daily' }, t)); },
    // Used by push.js and the messenger.
    authed,
    fn,
    rest,
    insert: (path, row, token) => request(`${cfg.supabaseUrl}/rest/v1/${path}`,
      { method: 'POST', headers: Object.assign(headers(token), { Prefer: 'return=minimal,resolution=ignore-duplicates' }), body: JSON.stringify(row) }),
    session,
  };
})(self);

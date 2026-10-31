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
  function saveSession(s) {
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* private mode */ }
  }

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

  // Sessions are Supabase Auth's: a short-lived access token plus a refresh token.
  // The PIN is never stored; if the refresh token stops working (new PIN, let go,
  // signed out) the app asks for the PIN again.
  const signInAgain = () => Object.assign(new Error('Sign in again'), { server: true, status: 401, signIn: true });

  let refreshing = null;
  function refreshSession(s) {
    refreshing = refreshing || (async () => {
      let r;
      try {
        r = await request(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
          { method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: s.refreshToken }) });
      } catch (e) {
        if (e.offline || e.status >= 500 || e.status === 429) throw e; // keep the session; try again later
        saveSession(null);
        throw signInAgain();
      }
      const next = Object.assign({}, s, { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_at * 1000 });
      saveSession(next);
      return next;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  // Calls with a fresh access token, refreshing it first if it is about to run out.
  async function authed(auth, run) {
    let s = session();
    if (!s || !s.refreshToken || !auth || s.crewId !== auth.crewId) throw signInAgain();
    if (s.expiresAt < Date.now() + 60000) s = await refreshSession(s);
    try {
      return await run(s.accessToken);
    } catch (e) {
      if (e.status !== 401 || e.signIn) throw e;
      s = await refreshSession(s);
      return run(s.accessToken);
    }
  }

  async function signIn(crewId, pin) {
    const device = root.Device && root.Device.supported() ? await root.Device.publicInfo().catch(() => null) : null;
    const r = await fn('pin-login', { crewId, pin, device });
    const s = { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt, crewId, me: r.me, deviceId: r.deviceId };
    saveSession(s);
    return s;
  }

  async function signOut() {
    const s = session();
    saveSession(null);
    // Ends this phone's session on the server too, so the refresh token is dead.
    if (s && s.accessToken) {
      await request(`${cfg.supabaseUrl}/auth/v1/logout?scope=local`, { method: 'POST', headers: headers(s.accessToken) }).catch(() => {});
    }
  }

  const job = (j) => ({ id: j.id, name: j.name, address: j.address, lat: j.lat, lng: j.lng, radiusFt: j.radius_ft, active: j.active });
  const consent = (c) => (c ? { id: c.id, crewId: c.crew_id, action: c.action, textVersion: c.text_version, at: Date.parse(c.phone_at) } : null);
  // Consent is nice-to-have on a reload: if the read fails, the phone's own copy decides (undefined = unknown).
  const optional = (p) => p.catch((e) => { if (e.status === 401 || e.signIn) throw e; return undefined; });

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
  // Returns the items whose photo did not upload: they stay queued (photo kept) for a
  // retry, and the rest of the batch still sends (HRD-6).
  async function uploadPhotos(token, items) {
    const failed = new Set();
    for (const it of items) {
      if (it.kind !== 'punch' || !it.photo || it.photoKey) continue;
      try {
        const up = await fn('photo-upload', { punchId: it.id }, token);
        const put = await fetch(up.url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: dataUrlToBlob(it.photo) });
        if (!put.ok) throw Object.assign(new Error('Photo upload failed'), { offline: true });
        it.photoKey = up.key;
        delete it.photo;
        await root.Store.outbox.add(it); // so a retry doesn't upload twice
      } catch (e) {
        if (e.status === 401 || e.signIn) throw e; // let authed() refresh and retry
        failed.add(it.id);
      }
    }
    return failed;
  }

  root.SupabaseApi = {
    isDemo: false,
    async listCrew() {
      const r = await fn('crew-list', { orgCode: orgCode() });
      return { crew: r.crew, org: r.org };
    },
    async login(crewId, pin) {
      await signIn(crewId, pin);
      const auth = { crewId }; // no PIN: the session tokens stand in for it
      return Object.assign(await this.refresh(auth), { auth });
    },
    signOut,
    refresh(auth) {
      return authed(auth, async (t) => {
        const me = session().me;
        const [jobs, crew, last, mine] = await Promise.all([
          rest('jobs?active=eq.true&select=*&order=name', t),
          rest('crew?active=eq.true&select=id,name,role,active&order=name', t),
          rest(`punches?crew_id=eq.${me.id}&type=in.(in,out)&status=neq.voided&order=phone_at.desc&limit=1&select=*`, t),
          optional(rest(`location_consents?crew_id=eq.${me.id}&order=phone_at.desc,received_at.desc&limit=1&select=id,crew_id,action,text_version,phone_at`, t)),
        ]);
        return { me, jobs: jobs.map(job), crew, last: last[0] ? punch(last[0]) : null, consent: mine === undefined ? undefined : consent(mine[0]) };
      });
    },
    sync(auth, items) {
      return authed(auth, async (t) => {
        const failed = await uploadPhotos(t, items);
        const send = items.filter((it) => !failed.has(it.id));
        if (!send.length) return { ok: true, accepted: [], rejected: [], reasons: [] };
        return fn('sync', { items: send }, t);
      });
    },
    team(auth, since) {
      const from = new Date(since || Date.now() - 8 * 86400000).toISOString();
      return authed(auth, async (t) => {
        const [punches, crew, jobs, consents] = await Promise.all([
          rest(`punches?phone_at=gte.${encodeURIComponent(from)}&order=phone_at.asc&limit=3000&select=*`, t),
          rest('crew?select=id,name,role,active', t),
          rest('jobs?select=*', t),
          // Latest action per worker only (PRIVACY L3); a foreman never reads the records themselves
          optional(request(`${cfg.supabaseUrl}/rest/v1/rpc/crew_consent_status`, { method: 'POST', headers: headers(t), body: '{}' })),
        ]);
        // GPS only for the last 8 days, though the week view reads up to 13 (PS-M113-1, PRIVACY)
        return { punches: root.Report.dropOldGps(punches.map(punch), Date.now()), crew, jobs: jobs.map(job),
          consents: Array.isArray(consents) ? consents.map((c) => ({ crewId: c.crew_id, action: c.action, textVersion: c.text_version })) : undefined };
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

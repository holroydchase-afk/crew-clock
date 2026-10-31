// Picks the backend: Supabase (v2), the Google Apps Script MVP, or DemoBackend,
// which keeps everything in this browser when nothing is configured.
(function (root) {
  const cfg = root.APP_CONFIG || {};
  const TIMEOUT_MS = 20000;

  function remote(action, payload) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), TIMEOUT_MS);
    // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight.
    return fetch(cfg.backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, payload)),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined,
    }).then((r) => r.json()).then((res) => {
      clearTimeout(timer);
      if (!res || res.ok === false) {
        const err = new Error((res && res.error) || 'Server error');
        err.server = true;
        throw err;
      }
      return res;
    }, (e) => {
      clearTimeout(timer);
      e.offline = true;
      throw e;
    });
  }

  if (cfg.backend === 'supabase' && cfg.supabaseUrl) {
    root.Api = root.SupabaseApi;
    return;
  }

  const isDemo = !cfg.backendUrl;
  const call = isDemo ? (a, p) => root.DemoBackend.handle(a, p) : remote;
  // Only the real demo build forgets crew-app keys; a crew build missing its URL must not lose a session
  if (isDemo && cfg.backend === 'demo') root.DemoBackend.forgetCrewApp();

  root.Api = {
    isDemo,
    listCrew: () => call('listCrew', {}),
    login: (crewId, pin) => call('login', { auth: { crewId, pin } }),
    demoLogin: isDemo ? (crewId) => call('demoLogin', { crewId }) : undefined,
    refresh: (auth) => call('refresh', { auth }),
    // The demo learns this phone's public key with its first signed punch, so the boss's screen can
    // check it (M1.13 ENH-1); the real server registers it at sign-in.
    sync: isDemo ? async (auth, items) => {
      let device = null;
      try { if (root.Device && root.Device.supported()) device = await root.Device.publicInfo(); } catch (e) { /* unsigned */ }
      return call('sync', { auth, items, device });
    } : (auth, items) => call('sync', { auth, items }),
    team: (auth, since) => call('team', { auth, since }),
    geocode: (auth, address) => call('geocode', { auth, address }),
    photo: (auth, punchId) => call('photo', { auth, punchId }),
    sendReport: (auth) => call('sendReport', { auth }),
  };
})(self);

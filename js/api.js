// Picks the backend: Supabase (the crew app) or DemoBackend, which keeps everything in this
// browser. The old Google Apps Script (Sheets) route is gone (EF-CK-11): a crew build with no
// Supabase URL talks to no server at all. Every call fails as "offline", so punches wait in the
// phone's outbox and a clock-in is never blocked or dropped.
(function (root) {
  /** @type {AppConfig} */
  const cfg = root.APP_CONFIG || {};

  /** @returns {Promise<ApiResult>} */
  function unset() {
    const err = /** @type {AppError} */ (new Error('No signal'));
    err.offline = true;
    return Promise.reject(err);
  }

  if (cfg.backend === 'supabase' && cfg.supabaseUrl) {
    root.Api = root.SupabaseApi;
    return;
  }

  // Demo only when the build says so (or says nothing and has no Sheets URL, like a plain checkout)
  const isDemo = cfg.backend === 'demo' || (!cfg.backend && !cfg.backendUrl);
  /** @type {(action: string, payload: Row) => Promise<ApiResult>} */
  const call = isDemo ? (a, p) => root.DemoBackend.handle(a, p) : unset;
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

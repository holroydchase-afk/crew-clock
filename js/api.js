// Talks to the Google Apps Script backend. With no backendUrl configured the
// app runs against DemoBackend, which keeps everything in this browser.
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

  const isDemo = !cfg.backendUrl;
  const call = isDemo ? (a, p) => root.DemoBackend.handle(a, p) : remote;

  root.Api = {
    isDemo,
    listCrew: () => call('listCrew', {}),
    login: (crewId, pin) => call('login', { auth: { crewId, pin } }),
    refresh: (auth) => call('refresh', { auth }),
    sync: (auth, items) => call('sync', { auth, items }),
    team: (auth, since) => call('team', { auth, since }),
    geocode: (auth, address) => call('geocode', { auth, address }),
    photo: (auth, punchId) => call('photo', { auth, punchId }),
    sendReport: (auth) => call('sendReport', { auth }),
  };
})(self);

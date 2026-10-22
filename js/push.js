// Web push alerts (free, no Twilio): off-site punches, "not in yet", new messages.
// Android: any browser. iPhone: iOS 16.4+ and only once the app is on the home screen.
(function (root) {
  const cfg = root.APP_CONFIG || {};

  function urlB64ToBytes(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function installed() {
    return (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  // 'ready' | 'on' | 'blocked' | 'install-first' | 'unsupported'
  async function status() {
    if (!cfg.vapidPublicKey || cfg.backend !== 'supabase') return 'unsupported';
    if (isIos() && !installed()) return 'install-first';
    if (!('serviceWorker' in navigator) || !('PushManager' in root) || !('Notification' in root)) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ? 'on' : 'ready';
  }

  // Must run from a tap: browsers only show the permission prompt for a user gesture.
  async function enable(auth) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'blocked';
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(cfg.vapidPublicKey) });
    const j = sub.toJSON();
    const api = root.SupabaseApi;
    await api.authed(auth, (t) => {
      const me = api.session().me;
      const claims = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return api.insert('push_subscriptions', { org_id: claims.org_id, crew_id: me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, t);
    });
    return 'on';
  }

  root.Push = { status, enable, installed, isIos };
})(self);

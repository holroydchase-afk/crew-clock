// Generated from js/push.ts by npm run build. Do not edit.
(function(root) {
  const cfg = root.APP_CONFIG || {};
  function urlB64ToBytes(s) {
    const pad = "=".repeat((4 - s.length % 4) % 4);
    const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }
  function installed() {
    return root.matchMedia && root.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }
  async function status() {
    if (!cfg.vapidPublicKey || cfg.backend !== "supabase") return "unsupported";
    if (isIos() && !installed()) return "install-first";
    if (!("serviceWorker" in navigator) || !("PushManager" in root) || !("Notification" in root)) return "unsupported";
    if (Notification.permission === "denied") return "blocked";
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription() ? "on" : "ready";
  }
  async function enable(auth) {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return "blocked";
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(cfg.vapidPublicKey) });
    const j = sub.toJSON();
    const keys = j.keys;
    const api = root.SupabaseApi;
    await api.authed(auth, (t) => {
      const me = api.session().me;
      const claims = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return api.insert("push_subscriptions", { org_id: claims.org_id, crew_id: me.id, endpoint: j.endpoint, p256dh: keys.p256dh, auth: keys.auth }, t);
    });
    return "on";
  }
  root.Push = { status, enable, installed, isIos };
})(self);

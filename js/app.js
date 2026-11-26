// Generated from js/app.ts by npm run build. Do not edit.
(function() {
  const { Geo, Report, Store, Api, Icons } = self;
  const cfg = self.APP_CONFIG || {};
  const $app = document.getElementById("app");
  const FIX_WINDOW_MS = 2 * 60 * 1e3;
  const SMALL_TODAY = "(max-width: 420px)";
  try {
    const ua = navigator.userAgent || "";
    const ios = /iPhone|iPad|iPod/.test(ua) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const installed = navigator.standalone === true || self.matchMedia && matchMedia("(display-mode: standalone)").matches;
    if (ios && !installed) document.documentElement.classList.add("ios-safari-tab");
  } catch (e) {
  }
  const STATUS = {
    onsite: { word: "On site", cls: "s-onsite" },
    near: { word: "Near", cls: "s-near" },
    offsite: { word: "Off site", cls: "s-offsite" },
    weak: { word: "Weak GPS", cls: "s-weak" },
    nogps: { word: "No GPS", cls: "s-nogps" }
  };
  const FENCES = [
    { ft: 150, word: "Small", hint: "House in town" },
    { ft: 300, word: "Normal", hint: "Most jobs" },
    { ft: 600, word: "Big", hint: "Big lot or road" }
  ];
  const state = {
    auth: Store.local.get("auth", null),
    me: Store.local.get("me", null),
    jobs: Store.local.get("jobs", []),
    crew: Store.local.get("crew", []),
    last: Store.local.get("last", null),
    team: Store.local.get("team", null),
    pending: 0,
    syncing: false,
    lastSyncAt: Store.local.get("lastSyncAt", null),
    screen: null,
    flow: null,
    // the punch being built
    bossTab: Store.local.get("bossTab", "map"),
    todayView: Store.local.get("todayView", "day"),
    // boss Today: 'day' or 'week' (M1.13 ENH-3)
    weekBack: false
    // the week view shows the week before
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const time = (ms) => ms ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const dayLabel = (ms) => {
    const d0 = Report.startOfDay(Date.now());
    if (ms >= d0) return "Today";
    if (ms >= d0 - 864e5) return "Yesterday";
    return new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };
  const jobById = (id) => state.jobs.find((j) => j.id === id) || state.team && state.team.jobs.find((j) => j.id === id);
  const crewById = (id) => state.team && state.team.crew.find((c) => c.id === id) || state.crew.find((c) => c.id === id) || (state.me && state.me.id === id ? state.me : null);
  const duration = (ms) => {
    const m = Math.round(ms / 6e4);
    if (m < 1) return "less than a minute";
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  };
  const initials = (name) => String(name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const isBoss = () => state.me && state.me.role === "boss";
  const isLead = () => state.me && (state.me.role === "foreman" || state.me.role === "boss");
  const CONSENT_VERSION = "loc-v1";
  const agreed = (c) => !!c && c.action === "agree" && c.textVersion === CONSENT_VERSION;
  const knownConsents = () => Store.local.get("consents", {});
  function rememberConsent(crewId, c) {
    if (!c) return;
    const all = knownConsents();
    if (all[crewId] && all[crewId].at > c.at) return;
    all[crewId] = { id: c.id, action: c.action, textVersion: c.textVersion, at: c.at };
    Store.local.set("consents", all);
  }
  function forgetConsent(crewId, id) {
    const all = knownConsents();
    if (all[crewId] && all[crewId].id === id) {
      delete all[crewId];
      Store.local.set("consents", all);
    }
  }
  function hasConsent(crewId) {
    if (state.me && crewId === state.me.id) return agreed(knownConsents()[crewId]);
    const st = state.team && state.team.consents;
    return !!st && agreed(st.find((c) => c.crewId === crewId));
  }
  async function saveConsent(action) {
    let deviceId = null;
    if (self.Device && Device.supported()) {
      try {
        const d = await Device.get();
        deviceId = d ? d.id : null;
      } catch (e) {
      }
    }
    const item = {
      kind: "consent",
      id: Store.uid(),
      crewId: state.me.id,
      byCrewId: state.me.id,
      action,
      textVersion: CONSENT_VERSION,
      at: Date.now(),
      deviceId
    };
    await Store.outbox.add(item);
    rememberConsent(state.me.id, item);
    await countPending();
    syncNow();
  }
  function chip(status, hasPhoto) {
    const s = STATUS[String(status)] || STATUS.nogps;
    return `<span class="chip ${s.cls}"><i></i>${s.word}${hasPhoto ? ` <span class="chip-cam">${Icons.camera}</span>` : ""}</span>`;
  }
  function toast(msg) {
    const timers = toast;
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.setAttribute("role", "status");
      t.setAttribute("aria-live", "polite");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "show";
    clearTimeout(timers._t);
    clearTimeout(timers._t2);
    const shown = t;
    timers._t = setTimeout(() => {
      shown.className = "";
    }, 3e3);
    timers._t2 = setTimeout(() => {
      shown.textContent = "";
    }, 3400);
  }
  function clearToast() {
    const t = document.getElementById("toast");
    const timers = toast;
    clearTimeout(timers._t);
    clearTimeout(timers._t2);
    if (t) {
      t.className = "gone";
      t.textContent = "";
    }
  }
  function fieldError(target, msg) {
    if (!target) return toast(msg);
    const field = target.closest(".field") || target;
    const inputs = target.matches("input") ? [target] : [...target.querySelectorAll("input")];
    const id = `${inputs[0] && inputs[0].id || "field"}-error`;
    document.querySelectorAll(".field-error").forEach((e) => e.remove());
    document.querySelectorAll('[aria-invalid="true"]').forEach((e) => {
      e.removeAttribute("aria-invalid");
      e.removeAttribute("aria-describedby");
    });
    const err = document.createElement("p");
    err.className = "field-error";
    err.id = id;
    err.setAttribute("role", "alert");
    err.innerHTML = `${Icons.alert}<span>${esc(msg)}</span>`;
    field.insertAdjacentElement("afterend", err);
    inputs.forEach((i) => {
      i.setAttribute("aria-invalid", "true");
      i.setAttribute("aria-describedby", id);
    });
    const clear = () => {
      err.remove();
      inputs.forEach((i) => {
        i.removeAttribute("aria-invalid");
        i.removeAttribute("aria-describedby");
      });
    };
    inputs.forEach((i) => i.addEventListener(i.type === "checkbox" ? "change" : "input", clear, { once: true }));
    if (inputs[0]) inputs[0].focus();
  }
  function setScreen(name, data) {
    clearToast();
    state.screen = name;
    if (data) Object.assign(state, data);
    render();
    window.scrollTo(0, 0);
  }
  const isMine = (it) => it.byCrewId ? !!state.me && it.byCrewId === state.me.id : it.kind !== "job" && it.kind !== "crew" || isBoss();
  const STUB_KEYS = ["kind", "id", "crewId", "byCrewId", "type", "at", "jobId", "queuedAt"];
  const toStub = (it, reason) => {
    const stub = {};
    STUB_KEYS.forEach((k) => {
      if (it[k] !== void 0) stub[k] = it[k];
    });
    return Object.assign(stub, { rejected: reason, rejectedAt: Date.now() });
  };
  async function countPending() {
    const items = (await Store.outbox.all()).filter(isMine);
    state.pending = items.length;
    state.stuck = items.filter((it) => it.rejected);
    return items;
  }
  const PERMISSION = /^(Only a foreman|Unknown crew member|Boss only|Not yours|Turned off)/i;
  function rejectWords(reason) {
    if (/too old/i.test(String(reason || ""))) return "Punch too old. Check the phone's clock and date are right, then tell the boss.";
    return `The office couldn't take it (${reason || "no reason given"}). Tell the boss.`;
  }
  async function syncNow() {
    if (state.syncing) {
      state.syncAgain = true;
      return;
    }
    if (!state.auth) return;
    const auth = state.auth;
    state.syncAgain = false;
    if (navigator.onLine === false) {
      await countPending();
      updateSyncLine();
      return;
    }
    state.syncing = true;
    updateSyncLine();
    try {
      const items = (await countPending()).filter((it) => !it.rejected);
      for (let i = 0; i < items.length; i += 4) {
        const batch = items.slice(i, i + 4);
        const res = await Api.sync(auth, batch);
        const why = {};
        (res.reasons || []).forEach((r) => {
          why[r.id] = r.reason;
        });
        const drop = (res.rejected || []).filter((id) => PERMISSION.test(why[id] || ""));
        const refusedConsents = batch.filter((x) => x.kind === "consent" && (res.rejected || []).includes(x.id));
        refusedConsents.forEach((x) => forgetConsent(x.crewId, x.id));
        await Store.outbox.remove([...res.accepted || [], ...drop, ...refusedConsents.map((x) => x.id)]);
        if (refusedConsents.length && state.auth === auth) {
          toast("Your location answer didn't save. You'll be asked again.");
          if (state.screen === "home") render();
        }
        for (const id of res.rejected || []) {
          const it = !drop.includes(id) && batch.find((x) => x.id === id && x.kind !== "consent");
          if (it) await Store.outbox.add(toStub(it, why[id] || "Refused"));
        }
      }
      await countPending();
      if (state.pending === 0 && state.auth === auth) await refreshData(auth);
      state.sendFailed = false;
      state.lastSyncAt = Date.now();
      Store.local.set("lastSyncAt", state.lastSyncAt);
    } catch (err) {
      const e = err;
      state.sendFailed = true;
      if (state.auth === auth) {
        if (e.signIn) signOut("Please sign in again with your PIN.");
        else if (e.server && /PIN/.test(e.message)) signOut("Your PIN was changed. Ask the boss for the new one.");
      }
    } finally {
      await countPending();
      state.syncing = false;
      updateSyncLine();
    }
    if (state.syncAgain) return syncNow();
  }
  async function refreshData(auth = state.auth) {
    const res = await Api.refresh(auth);
    if (state.auth !== auth) return;
    state.me = res.me;
    state.jobs = res.jobs || [];
    state.crew = res.crew || [];
    Store.local.set("me", state.me);
    Store.local.set("jobs", state.jobs);
    Store.local.set("crew", state.crew);
    if (res.last && (!state.last || res.last.at >= state.last.at)) setLast(res.last);
    if (res.consent) rememberConsent(res.me.id, res.consent);
    if (isLead()) await loadTeam();
    if (["home", "boss", "pick-teammate"].includes(state.screen)) render();
  }
  const TEAM_WAIT_MS = 4e3;
  function teamWaitStart() {
    if (state.team || state.teamWaitUntil) return;
    state.teamWaitUntil = Date.now() + TEAM_WAIT_MS;
    setTimeout(() => {
      if (state.screen === "pick-teammate") render();
    }, TEAM_WAIT_MS + 50);
  }
  const teamWaiting = () => !state.team && Date.now() < (state.teamWaitUntil || 0);
  async function loadTeam() {
    teamWaitStart();
    try {
      const res = await Api.team(state.auth, Report.weekStart(Date.now() - 864e5) - 7 * 864e5);
      const keep = state.team && state.team.consents;
      state.team = {
        punches: Report.dropOldGps(res.punches, Date.now()),
        crew: res.crew,
        jobs: res.jobs,
        consents: res.consents || keep || null,
        devices: Array.isArray(res.devices) ? res.devices : null,
        sampleDay: Api.isDemo && res.sampleDay != null ? res.sampleDay : null,
        at: Date.now()
      };
      Store.local.set("team", state.team);
    } catch (e) {
    }
    state.teamWaitUntil = 0;
  }
  function setLast(p) {
    state.last = p ? { id: p.id, jobId: p.jobId, type: p.type, at: p.at, status: p.status } : null;
    Store.local.set("last", state.last);
  }
  function syncLineHtml() {
    if (state.syncing) return `<span class="sync busy">${Icons.cloud} Sending\u2026</span>`;
    if (state.stuck && state.stuck.length) {
      return `<span class="sync wait">${Icons.alert} ${state.stuck.length} not sent: ${esc(rejectWords(state.stuck[0].rejected))}</span>`;
    }
    if (state.pending > 0) {
      return `<span class="sync wait">${Icons.cloudOff} ${state.pending} waiting to send. Open the app when you get signal.</span>`;
    }
    return `<span class="sync ok">${Icons.cloud} All sent</span>`;
  }
  function doneSyncHtml() {
    if (state.stuck && state.stuck.length) return `<p class="notice">${Icons.alert} ${esc(rejectWords(state.stuck[0].rejected))}</p>`;
    if (state.pending === 0 && !state.syncing) return `<p class="sync ok">${Icons.cloud} Sent to the boss</p>`;
    if (navigator.onLine === false || state.sendFailed) {
      return `<p class="notice">${Icons.cloudOff} Saved on your phone. It will send itself when you get signal.</p>`;
    }
    return `<p class="sync busy">${Icons.cloud} Sending\u2026</p>`;
  }
  function updateSyncLine() {
    document.querySelectorAll("[data-sync-line]").forEach((el) => {
      el.innerHTML = syncLineHtml();
    });
    document.querySelectorAll("[data-done-sync]").forEach((el) => {
      el.innerHTML = doneSyncHtml();
    });
  }
  async function savePunch(p) {
    let item = Object.assign({ kind: "punch", id: Store.uid(), byCrewId: state.me.id }, p);
    if (self.Device && Device.supported()) {
      try {
        item = await Device.sign(item);
      } catch (e) {
      }
    }
    await Store.outbox.add(item);
    if (item.crewId === state.me.id && item.type !== "void") setLast(item);
    else if (item.crewId !== state.me.id) {
      state.matePunches = (state.matePunches || []).concat({ id: item.id, crewId: item.crewId, jobId: item.jobId, type: item.type, at: item.at, voidsId: item.voidsId });
    }
    await countPending();
    syncNow();
    return item;
  }
  function mateOpen(crewId) {
    const p = Report.lastPunchByCrew(teamPunches().concat(state.matePunches || []))[crewId];
    return p && p.type === "in" ? p : null;
  }
  function startPunch(type, opts) {
    const o = opts || {};
    const crewId = o.crewId || state.me.id;
    const noLocation = !hasConsent(crewId);
    if (noLocation && !o.crewId && !o.fixing && !o.consentAsked) return setScreen("consent", { consentNext: { type } });
    state.flow = { type, crewId, forTeammate: !!o.crewId, fixing: o.fixing || null, noLocation };
    const open = type !== "out" ? null : o.crewId ? mateOpen(o.crewId) : state.last && state.last.type === "in" ? state.last : null;
    if (open) {
      state.flow.jobId = open.jobId;
      state.flow.inAt = open.at;
      return locate();
    }
    setScreen("pick-job");
    if (!noLocation) sortJobsByDistance();
  }
  function fakeGps() {
    return Api.isDemo && cfg.backend === "demo" && Store.local.get("demoFake", true);
  }
  async function sortJobsByDistance() {
    if (fakeGps()) return;
    const flow = state.flow;
    const fix = await watchGps(
      navigator.geolocation,
      () => state.screen === "pick-job" && state.flow === flow,
      { timeoutMs: 8e3, goodEnoughM: Infinity, highAccuracy: false, maximumAgeMs: 12e4 }
    );
    if (!fix || state.screen !== "pick-job" || state.flow !== flow) return;
    flow.roughFix = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy };
    render();
  }
  function pickJob(jobId) {
    const flow = state.flow;
    if (flow.picked) return;
    flow.picked = true;
    flow.jobId = jobId;
    if (flow.fixing) {
      const orig = flow.fixing;
      flow.fix = orig.lat == null ? null : { lat: orig.lat, lng: orig.lng, accuracy: orig.accuracy };
      flow.at = orig.at;
      flow.photo = orig.photo || null;
      return afterFix();
    }
    locate();
  }
  function gpsWords(accuracyM) {
    return Geo.fenceStatus(0, accuracyM, 1) === "weak" ? `GPS signal: weak (about ${Geo.formatDistance(Geo.toFeet(accuracyM))})` : "GPS signal: good";
  }
  let gpsWatch = null;
  function watchGps(geolocation, stillWanted, opts) {
    stopGps();
    const ac = new AbortController();
    const w = { stillWanted, ac };
    gpsWatch = w;
    return Geo.bestFix(geolocation, Object.assign({}, opts, { signal: ac.signal })).finally(() => {
      if (gpsWatch === w) gpsWatch = null;
    });
  }
  function stopGps() {
    if (gpsWatch) {
      gpsWatch.ac.abort();
      gpsWatch = null;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopGps();
  });
  async function locate() {
    const flow = state.flow;
    flow.at = Date.now();
    if (flow.noLocation) {
      flow.fix = null;
      return afterFix();
    }
    flow.liveAccuracy = null;
    setScreen("locating");
    const job = jobById(state.flow.jobId);
    let fix;
    if (fakeGps() && job) {
      await new Promise((r) => setTimeout(r, 900));
      fix = { lat: job.lat + 2e-4, lng: job.lng - 1e-4, accuracy: 9, at: Date.now() };
    } else {
      fix = await watchGps(navigator.geolocation, () => state.screen === "locating" && state.flow === flow, {
        timeoutMs: cfg.gpsTimeoutMs || 2e4,
        goodEnoughM: 20,
        onUpdate: (best) => {
          if (state.flow !== flow) return;
          flow.liveAccuracy = best.accuracy;
          const el = document.getElementById("live-acc");
          if (el) el.textContent = gpsWords(best.accuracy);
        }
      });
    }
    if (state.flow !== flow || state.screen !== "locating") return;
    state.flow.fix = fix;
    afterFix();
  }
  function afterFix() {
    const flow = state.flow;
    const job = jobById(flow.jobId);
    const check = Geo.checkFix(flow.fix, job);
    flow.check = check;
    const photoRequired = flow.forTeammate || flow.noLocation || Geo.needsPhoto(check.status);
    if (photoRequired && !flow.photo) return setScreen("photo");
    finishPunch();
  }
  async function finishPunch() {
    const f = state.flow;
    if (!f || f.finishing) return;
    f.finishing = true;
    if (f.fixing) await savePunch({ crewId: f.crewId, type: "void", voidsId: f.fixing.id, at: Date.now() });
    const fix = f.fix;
    const saved = await savePunch({
      crewId: f.crewId,
      jobId: f.jobId,
      type: f.type,
      at: f.at,
      lat: fix ? fix.lat : null,
      lng: fix ? fix.lng : null,
      accuracy: fix ? Math.round(fix.accuracy) : null,
      status: f.check.status,
      distanceFt: f.check.distanceFt,
      photo: f.photo || null
    });
    f.saved = saved;
    f.savedAt = Date.now();
    setScreen("done");
  }
  function stampPhoto(file, lines) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1024;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const fs = Math.max(16, Math.round(w / 34));
        ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
        const pad = fs * 0.6;
        const boxH = lines.length * fs * 1.3 + pad * 2;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, h - boxH, w, boxH);
        ctx.fillStyle = "#fff";
        lines.forEach((t, i) => ctx.fillText(t, pad, h - boxH + pad + fs * (i + 1) * 1.2));
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.6));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("bad image"));
      };
      img.src = url;
    });
  }
  async function loadNames() {
    try {
      const res = await Api.listCrew();
      Store.local.set("crewNames", res.crew);
      return res.crew;
    } catch (e) {
      return Store.local.get("crewNames", null);
    }
  }
  const demoNoPin = () => Api.isDemo && !!Api.demoLogin && !cfg.demoPin;
  async function tryLogin(crewId, pin) {
    try {
      const res = pin == null ? await Api.demoLogin(crewId) : await Api.login(crewId, pin);
      state.auth = res.auth || { crewId, pin };
      Store.local.set("auth", state.auth);
      state.me = res.me;
      state.jobs = res.jobs || [];
      state.crew = res.crew || [];
      Store.local.set("me", state.me);
      Store.local.set("jobs", state.jobs);
      Store.local.set("crew", state.crew);
      setLast(res.last);
      if (res.consent) rememberConsent(res.me.id, res.consent);
      if (isLead()) loadTeam().then(() => {
        if (["boss", "pick-teammate"].includes(state.screen)) render();
      });
      goHome();
      countPending().then(() => syncNow());
    } catch (e) {
      state.pinEntry = "";
      state.pinError = e.offline ? "No signal. The first sign-in needs signal." : "That PIN didn't work. Try again.";
      render();
      const dots = document.querySelector(".pin-dots");
      if (dots) dots.classList.add("shake");
    }
  }
  async function signOut(msg) {
    const waiting = await countPending();
    if (waiting.length && !msg) {
      if (!confirm(`Some clock-ins have not sent yet. Sign out anyway? They will send when this person signs in again.`)) return;
    }
    if (Api.signOut) Api.signOut();
    ["auth", "me", "last", "team", "jobs", "crew"].forEach((k) => Store.local.remove(k));
    Object.assign(state, { auth: null, me: null, last: null, team: null, jobs: [], crew: [], matePunches: [], consentAsked: false });
    setScreen("names");
    if (msg) toast(msg);
  }
  function goHome() {
    if (!state.auth) return setScreen("names");
    if (isBoss()) return setScreen("boss");
    if (!hasConsent(state.me.id)) {
      const mine = knownConsents()[state.me.id];
      const saidNo = mine && mine.action === "withdraw" && mine.textVersion === CONSENT_VERSION;
      if (!state.consentAsked && !saidNo) return setScreen("consent", { consentNext: null });
      return setScreen("home");
    }
    if (!Store.local.get("locPrimed", false) && !fakeGps()) return setScreen("primer");
    setScreen("home");
  }
  const screens = {};
  function privateBanner() {
    return Store.isVolatile() ? `<div class="private-banner" role="status">Private mode: keep this tab open until it says Sent.</div>` : "";
  }
  function banners() {
    return demoBarHtml() + privateBanner();
  }
  function cleanText(v) {
    return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  }
  const RESTORED_KEY = "crewclock.restored";
  const demoBar = { open: false, asking: false, restored: false };
  if (Api.isDemo) {
    try {
      if (sessionStorage.getItem(RESTORED_KEY)) {
        sessionStorage.removeItem(RESTORED_KEY);
        demoBar.open = true;
        demoBar.restored = true;
      }
    } catch (e) {
    }
  }
  function demoCopy() {
    return `${demoBar.restored ? "<b>Sample data restored.</b> " : ""}This is the real Crew Clock with a made\u2011up crew.
      Changes stay in this browser, never sent anywhere. Map pictures come from map servers, which see the area.
      Reset demo starts over.`;
  }
  function demoBarHtml() {
    if (!Api.isDemo) return "";
    const b = demoBar;
    const sw = demoControls() ? `<button type="button" class="demo-switch" role="switch" aria-checked="${DemoBackend.isOffline()}" data-action="demo-offline" data-bar="switch"><span class="knob" aria-hidden="true"></span>No signal</button>` : "";
    return `<section class="demo-bar" aria-label="Demo"><div class="demo-bar-in"><a class="demo-back" href="https://chaseholroyd.com/" data-bar="back">\u2190 Portfolio</a><span class="demo-div" aria-hidden="true"></span><button type="button" class="demo-bar-toggle" data-action="demo-details" data-bar="toggle" aria-label="Demo details" aria-expanded="${b.open}" aria-controls="demo-drawer"><span class="demo-badge">Demo</span><span class="demo-sum">Sample data<span class="demo-sum-more"> \xB7 changes stay in this browser</span></span><span class="demo-more">Details</span><svg class="demo-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></section>
      <div class="demo-drawer" id="demo-drawer"${b.open ? "" : " hidden"}><div class="demo-in">
        <p class="demo-copy">${demoCopy()}</p>
        <div class="demo-acts">${sw}<button type="button" class="demo-reset" data-action="demo-reset" data-bar="reset"${b.asking ? " hidden" : ""}>Reset demo</button><div class="demo-ask"${b.asking ? "" : " hidden"}><span>Put the sample data back? Your changes will be lost.</span><span class="demo-ask-btns"><button type="button" class="demo-reset" data-action="demo-reset-go" data-bar="go">Reset</button><button type="button" class="demo-reset" data-action="demo-reset-keep" data-bar="keep">Keep</button></span></div><a class="demo-link" href="https://chaseholroyd.com/" data-bar="link">\u2190 More of Chase's work</a></div>
      </div></div>`;
  }
  function syncDemoBar(focus) {
    const tg = $app.querySelector(".demo-bar-toggle");
    const dr = $app.querySelector("#demo-drawer");
    if (!tg || !dr) return;
    tg.setAttribute("aria-expanded", String(demoBar.open));
    dr.hidden = !demoBar.open;
    const copy = dr.querySelector(".demo-copy");
    if (copy) copy.innerHTML = demoCopy();
    const reset = dr.querySelector('[data-bar="reset"]');
    const ask = dr.querySelector(".demo-ask");
    if (reset) reset.hidden = demoBar.asking;
    if (ask) ask.hidden = !demoBar.asking;
    applyHints();
    if (focus) focusBar(focus);
  }
  function focusBar(key) {
    const el = $app.querySelector(`[data-bar="${key}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  function setDrawer(open) {
    demoBar.open = open;
    if (!open) {
      demoBar.asking = false;
      demoBar.restored = false;
    }
    syncDemoBar(open ? void 0 : "toggle");
  }
  function demoControls() {
    return Api.isDemo && cfg.backend === "demo" && !!self.DemoBackend && !!DemoBackend.setOffline;
  }
  const HINTS_KEY = "crewclock.hints";
  function hintsDone() {
    try {
      const v = JSON.parse(localStorage.getItem(HINTS_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function finishHint(step) {
    if (!demoControls()) return;
    const done = hintsDone();
    if (done.includes(step)) return;
    try {
      localStorage.setItem(HINTS_KEY, JSON.stringify(done.concat(step)));
    } catch (e) {
    }
  }
  const HINT_STEPS = [
    { step: 1, find: () => state.screen === "names" && $app.querySelector(`.name-btn[data-id="${DEMO_START}"]`) },
    { step: 2, find: () => state.screen === "home" && $app.querySelector('.punch[data-type="in"]') },
    { step: 3, after: [2], find: () => state.screen === "home" && $app.querySelector('.home-head [data-action="sign-out"]') },
    { step: 4, after: [2], find: () => {
      const boss = state.screen === "names" && (state.names || []).find((c) => c.role === "boss");
      return boss && $app.querySelector(`.name-btn[data-id="${boss.id}"]`);
    } },
    { step: 5, find: () => state.screen === "boss" && $app.querySelector('[data-action="boss-tab"][data-tab="today"]:not(.on)') },
    { step: 6, find: () => state.screen === "boss" && $app.querySelector('[data-action="demo-tamper"]') },
    // Step 7 goes through the demo bar: the "Demo details" toggle while the drawer is closed, then the
    // No signal switch inside it (SPEC-DEMO-BAR); only turning the switch on finishes it.
    { step: 7, after: [1, 2, 3, 4, 5, 6], find: () => demoBar.open ? $app.querySelector('#demo-drawer [data-action="demo-offline"][aria-checked="false"]') : !DemoBackend.isOffline() && $app.querySelector(".demo-bar .demo-bar-toggle") }
  ];
  function applyHints() {
    $app.querySelectorAll(".hint-dot").forEach((d) => d.remove());
    $app.querySelectorAll("[data-hint]").forEach((t) => {
      t.removeAttribute("data-hint");
      t.removeAttribute("aria-describedby");
    });
    if (!demoControls()) return;
    if (state.screen === "boss" && state.bossTab === "today") finishHint(5);
    const done = hintsDone();
    for (const h of HINT_STEPS) {
      if (done.includes(h.step) || (h.after || []).some((n) => !done.includes(n))) continue;
      const target = h.find();
      if (!target) continue;
      let nudge = document.getElementById("hint-nudge");
      if (!nudge) {
        nudge = document.createElement("span");
        nudge.id = "hint-nudge";
        nudge.className = "visually-hidden";
        nudge.textContent = "Suggested next step";
        document.body.appendChild(nudge);
      }
      target.dataset.hint = String(h.step);
      target.setAttribute("aria-describedby", "hint-nudge");
      target.insertAdjacentHTML("beforeend", '<span class="hint-dot" aria-hidden="true"><span class="hint-ring"></span></span>');
      return;
    }
  }
  document.addEventListener("click", (e) => {
    const el = e.target;
    const t = el && el.closest ? el.closest("[data-hint]") : null;
    if (t && demoControls() && t.dataset.action !== "demo-details") finishHint(Number(t.dataset.hint));
  }, true);
  screens.names = () => {
    loadNames().then((list) => {
      const same = JSON.stringify(list) === JSON.stringify(state.names);
      state.names = list;
      if (state.screen === "names" && !same) paint(namesHtml());
    });
    return namesHtml();
  };
  const DEMO_START = "c5";
  function nameBtn(c) {
    const role = { boss: "Boss", foreman: "Foreman" };
    return `<button class="name-btn" data-action="pick-name" data-id="${esc(c.id)}">
          <span class="avatar">${esc(initials(c.name))}</span><span>${esc(c.name)}</span>
          ${demoNoPin() && role[String(c.role)] ? `<span class="name-role">${role[String(c.role)]}</span>` : ""}
        </button>`;
  }
  function namesHtml() {
    const list = state.names;
    const loading = list === void 0 ? '<p class="muted center">Loading\u2026</p>' : !list ? '<p class="notice">No signal. The first time you sign in, you need signal. Try near the road or in town.</p>' : "";
    const start = demoNoPin() && list ? list.find((c) => c.id === DEMO_START) : null;
    const names = start && list ? [start].concat(list.filter((c) => c !== start)) : list;
    return `<main class="screen${demoNoPin() ? " signin" : ""}">
        <div class="brand">${Icons.job}<span>Crew Clock</span></div>
        <h1>Who are you?</h1>
        <p class="privacy">${Icons.pin}<span>This app only checks where you are when you tap <b>Clock in</b> or <b>Clock out</b>. It does not follow you.</span></p>
        ${loading || `<div class="name-grid">${names.map(nameBtn).join("")}</div>`}
      </main>`;
  }
  screens.pin = () => {
    const c = (state.names || []).find((x) => x.id === state.pinFor) || {};
    const n = (state.pinEntry || "").length;
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
    return `<main class="screen">
        <button class="back" data-action="go" data-to="names">${Icons.back} Back</button>
        <div class="pin-head">
          <span class="avatar big">${esc(initials(c.name))}</span>
          <h1>Hi ${esc(c.name)}</h1>
          <p class="muted">Type your 4 number PIN</p>
        </div>
        <div class="pin-dots" aria-label="${n} of 4 numbers typed">${[0, 1, 2, 3].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>
        ${state.pinError ? `<p class="error center">${esc(state.pinError)}</p>` : ""}
        <div class="keypad">${keys.map((k) => k === "" ? "<span></span>" : k === "del" ? `<button data-action="pin-del" aria-label="Delete">${Icons.back}</button>` : `<button data-action="pin-key" data-k="${k}">${k}</button>`).join("")}</div>
      </main>`;
  };
  screens.consent = () => `
    <main class="screen center-col consent">
      ${state.consentNext ? `<button class="back" data-action="consent-back">${Icons.back} Back</button>` : ""}
      <div class="big-icon blue">${Icons.pin}</div>
      <h1>Crew Clock uses your location only when you tap Clock in or Clock out.</h1>
      <p class="lead">The boss sees where and when. It never tracks you in between. You can stop this any time on the home screen.</p>
      <button class="btn primary xl" data-action="consent-agree">I agree</button>
      <button class="btn secondary" data-action="consent-later">Not now</button>
      <p class="muted">Not now? You can still clock in with a picture.</p>
    </main>`;
  screens.primer = () => `
    <main class="screen center-col">
      <div class="big-icon blue">${Icons.pin}</div>
      <h1>Your phone will ask to use your location</h1>
      <p class="lead">Tap <b>Allow</b> so the app can show the boss you made it to the job.</p>
      <div class="fake-prompt">
        <p>Allow \u201CCrew Clock\u201D to use your location?</p>
        <div><span>Don't Allow</span><span class="hl">Allow While Using App</span></div>
      </div>
      <p class="muted">It only checks when you clock in or out.</p>
      <button class="btn primary xl" data-action="prime-location">OK, ask me</button>
    </main>`;
  screens.home = () => {
    const onClock = state.last && state.last.type === "in";
    const job = onClock ? jobById(state.last.jobId) : null;
    const status = onClock ? `<div class="status-card on"><span class="status-dot"></span><div>
          <div class="status-title">You are on the clock</div>
          <div class="status-sub">${esc(job ? job.name : "Job")} \xB7 since ${time(state.last.at)}</div></div></div>` : `<div class="status-card off"><span class="status-dot"></span><div>
          <div class="status-title">You are off the clock</div>
          <div class="status-sub">${state.last ? `Last clocked out ${dayLabel(state.last.at).toLowerCase()} at ${time(state.last.at)}` : "Tap the green button when you get to the job"}</div></div></div>`;
    const big = onClock ? `<button class="punch out" data-action="punch" data-type="out">${Icons.out}<span>Clock out</span></button>` : `<button class="punch in" data-action="punch" data-type="in">${Icons.in}<span>Clock in</span></button>`;
    const fake = Api.isDemo && hasConsent(state.me.id) ? `<label class="demo-toggle"><input type="checkbox" data-action="demo-fake" ${fakeGps() ? "checked" : ""}> Pretend I'm at the job</label>` : "";
    return `<main class="screen home">
        <header class="home-head">
          <div><div class="muted small">Signed in as</div><div class="who">${esc(state.me.name)}</div></div>
          <button class="link" data-action="sign-out">Not you?</button>
        </header>
        ${status}
        ${state.jobs.some((j) => j.active !== false) ? "" : '<p class="notice">No jobs yet. Ask the boss to add the job.</p>'}
        ${big}
        <div class="sync-line" data-sync-line>${syncLineHtml()}</div>
        ${isLead() ? `<button class="btn secondary" data-action="teammate">${Icons.teammate} Clock in or out a teammate</button>` : ""}
        ${state.me.role === "foreman" ? `<button class="btn secondary" data-action="go" data-to="boss">${Icons.map} See the team map</button>` : ""}
        ${self.Messenger ? `<button class="btn secondary" data-action="go" data-to="chat-list">${Icons.chat} Messages <span class="badge" data-unread></span></button>` : ""}
        <div id="push-slot"></div>
        ${hasConsent(state.me.id) ? '<button class="link" data-action="consent-withdraw">Stop using my location</button>' : '<p class="muted location-off">Location is off. When you clock in, the app asks again, or you can use a picture.</p><button class="link" data-action="consent-ask">Use my location for clock-ins</button>'}
        ${fake}
      </main>`;
  };
  function mateLine(crewId) {
    const p = mateOpen(crewId);
    const job = p && jobById(p.jobId);
    return `<span class="mate-status">${p ? `On at ${esc(job ? job.name : "a job")} since ${time(p.at)}` : "Off"}</span>`;
  }
  screens["pick-teammate"] = () => {
    const mates = state.crew.filter((c) => c.id !== state.me.id && c.role !== "boss");
    return `<main class="screen">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      <h1>Which teammate?</h1>
      <p class="muted">You'll need to take a picture of them at the job.</p>
      ${teamWaiting() ? '<p class="muted" role="status">Loading the crew\u2026</p>' : `<div class="list">${mates.map((c) => `
        <div class="row-card">
          <span class="avatar">${esc(initials(c.name))}</span>
          <span class="grow"><span class="mate-name">${esc(c.name)}</span>${mateLine(c.id)}</span>
          ${mateOpen(c.id) ? `<button class="mate-btn out" data-action="mate-punch" data-id="${esc(c.id)}" data-type="out">Clock out</button>` : `<button class="mate-btn in" data-action="mate-punch" data-id="${esc(c.id)}" data-type="in">Clock in</button>`}
        </div>`).join("") || '<p class="muted">No teammates yet.</p>'}</div>`}
    </main>`;
  };
  screens["pick-job"] = () => {
    const f = state.flow;
    const rough = f.roughFix;
    const jobs = state.jobs.filter((j) => j.active !== false).map((j) => ({
      j,
      d: rough && j.lat != null ? Geo.toFeet(Geo.distanceM(rough.lat, rough.lng, j.lat, j.lng)) : null
    }));
    jobs.sort((a, b) => a.d == null || b.d == null ? a.j.name.localeCompare(b.j.name) : a.d - b.d);
    const who = f.forTeammate ? crewById(f.crewId) : null;
    const title = f.fixing ? "Pick the right job" : who ? `Which job is ${esc(who.name)} ${f.type === "in" ? "at" : "leaving"}?` : f.type === "in" ? "Which job are you at?" : "Which job are you leaving?";
    return `<main class="screen">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      ${who ? `<div class="for-mate">${f.type === "in" ? "Clocking in" : "Clocking out"} <b>${esc(who.name)}</b></div>` : ""}
      <h1>${title}</h1>
      ${f.noLocation ? "" : rough ? '<p class="muted">Closest job is on top.</p>' : '<p class="muted">Finding the closest job\u2026</p>'}
      <div class="list">${jobs.map(({ j, d }, i) => `
        <button class="job-btn ${i === 0 && d != null ? "nearest" : ""}" data-action="pick-job" data-id="${esc(j.id)}">
          <span class="job-ico">${Icons.job}</span>
          <span class="grow"><span class="job-name">${esc(j.name)}</span><span class="job-addr">${esc(j.address || "")}</span></span>
          ${d != null ? `<span class="job-dist">${Geo.formatDistance(d)}</span>` : ""}
        </button>`).join("") || '<p class="notice">No jobs yet. Ask the boss to add one.</p>'}</div>
    </main>`;
  };
  screens.locating = () => {
    const flow = state.flow;
    const job = jobById(flow.jobId);
    setTimeout(() => {
      const b = document.getElementById("skip-gps");
      if (b && state.screen === "locating" && state.flow === flow) b.hidden = false;
    }, 8e3);
    return `<main class="screen center-col">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      <div class="spinner" role="status" aria-label="Finding you"></div>
      <h1>Finding you\u2026</h1>
      <p class="lead">${esc(job ? job.name : "")}</p>
      <p class="muted" id="live-acc">Stand outside if you can.</p>
      <button class="btn secondary" id="skip-gps" hidden data-action="skip-gps">${Icons.camera} Take a picture instead</button>
    </main>`;
  };
  screens.photo = () => {
    const f = state.flow;
    const who = f.forTeammate ? crewById(f.crewId) : null;
    const name = esc(who ? who.name : "They");
    const why = f.forTeammate && f.noLocation ? `${name} hasn't agreed to use location, so take a picture of them at the job.` : f.forTeammate ? `Take a picture of ${name} at the job.` : f.noLocation ? "Location is off for you, so the picture shows where you are." : f.check && f.check.status === "weak" ? "GPS is weak here." : "GPS couldn't find you.";
    return `<main class="screen center-col">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      <div class="big-icon amber">${Icons.camera}</div>
      <h1>${f.forTeammate ? `${f.type === "out" ? "Clock out" : "Clock in"} ${name}` : "Take a picture of the job"}</h1>
      <p class="lead">${why} ${f.forTeammate ? "" : "Get the house, the truck, or the work in the picture."}</p>
      <label class="btn primary xl file-btn">${Icons.camera} Open camera
        <input type="file" accept="image/*" capture="environment" data-action="photo-file">
      </label>
      ${f.photoProblem ? `<p class="notice">${Icons.alert} ${esc(AI.PHOTO_WORDS[f.photoProblem])}</p>
        <button class="link" data-action="photo-anyway">Use that picture anyway</button>` : ""}
      <button class="link" data-action="no-photo">I can't take a picture</button>
    </main>`;
  };
  screens.done = () => {
    const f = state.flow;
    const job = jobById(f.jobId);
    const who = f.forTeammate ? crewById(f.crewId) : null;
    const s = STATUS[f.check.status];
    const verb = f.type === "in" ? "clocked in" : "clocked out";
    const subject = who ? `${esc(who.name)} is` : "You're";
    const canFix = f.type === "in" && !f.forTeammate && Date.now() - f.savedAt < FIX_WINDOW_MS;
    if (canFix) {
      setTimeout(() => {
        const b = document.getElementById("fix-btn");
        if (b) b.remove();
      }, FIX_WINDOW_MS - (Date.now() - f.savedAt));
    }
    return `<main class="screen center-col">
      <div class="big-check ${f.type}">${Icons.check}</div>
      <h1>${subject} ${verb}</h1>
      <p class="lead">${esc(job ? job.name : "")}<br><b>${time(f.at)}</b></p>
      ${f.type === "out" && f.inAt && f.at > f.inAt ? `<p class="worked">${who ? esc(who.name) : "You"} worked <b>${duration(f.at - f.inAt)}</b></p>` : ""}
      <p>${chip(f.check.status, !!f.photo)}${f.check.distanceFt != null && f.check.status !== "onsite" ? ` <span class="muted">${Geo.formatDistance(f.check.distanceFt)} from the job</span>` : ""}</p>
      ${s && f.check.status === "offsite" ? '<p class="muted">The boss will see where you were.</p>' : ""}
      <div class="done-sync" data-done-sync>${doneSyncHtml()}</div>
      <button class="btn secondary xl" data-action="go-home">Done</button>
      ${canFix ? `<button class="link" id="fix-btn" data-action="fix-job">Wrong job? Fix it</button>` : ""}
    </main>`;
  };
  let leafletMap = null;
  let jobFormMap = null;
  screens.boss = () => {
    const tab = state.bossTab;
    const tabs = [
      ["map", "Map", Icons.map],
      ["today", "Today", Icons.list],
      ...isBoss() ? [["jobs", "Jobs", Icons.job], ["crew", "Crew", Icons.people]] : [],
      ...self.Messenger ? [["chat", "Messages", Icons.chat]] : []
    ];
    const updated = state.team ? time(state.team.at) : "Refresh";
    const updatedLabel = state.team ? `Refresh. Last updated ${time(state.team.at)}` : "Refresh";
    let body = "";
    if (tab === "map") body = bossMapHtml();
    if (tab === "today") body = bossTodayHtml();
    if (tab === "jobs") body = bossJobsHtml();
    if (tab === "crew") body = bossCrewHtml();
    if (tab === "chat" && self.Messenger) body = Messenger.listHtml();
    return `<div class="boss">${banners()}
        <header class="boss-head">
          <div class="brand small">${Icons.job}<span>Crew Clock</span></div>
          <div class="boss-head-right">
            <button class="head-btn" data-action="reload-team" aria-label="${updatedLabel}" title="${updatedLabel}">${Icons.refresh}<span>${updated}</span></button>
            ${isBoss() ? '<button class="link" data-action="sign-out">Sign out</button>' : '<button class="link" data-action="go-home">Back</button>'}
          </div>
        </header>
        <main class="boss-body tab-${tab}">${body}</main>
        <nav class="tabbar" aria-label="Boss views">${tabs.map(([k, label, ic]) => `
          <button class="${k === tab ? "on" : ""}" data-action="boss-tab" data-tab="${k}"${k === tab ? ' aria-current="page"' : ""}>${ic}<span>${label}</span></button>`).join("")}
        </nav>
      </div>`;
  };
  function riskFor(p) {
    if (!p || !self.Risk) return [];
    if (Array.isArray(p.risk)) return p.risk;
    const crewHistory = teamPunches().filter((x) => x.crewId === p.crewId && x.id !== p.id);
    const deviceHistory = p.deviceId ? teamPunches().filter((x) => x.deviceId === p.deviceId) : [];
    const flags = Risk.assess(p, { crewHistory, deviceHistory, receivedAt: p.receivedAt });
    if (p.crewInactive) flags.push({ code: "crew_inactive", level: Risk.RULES.crew_inactive.level });
    if (punchChanged(p)) flags.push({ code: "bad_signature", level: Risk.RULES.bad_signature.level });
    return flags;
  }
  function riskHtml(flags) {
    const high = flags.filter((f) => f.level === "high");
    if (!high.length) return "";
    return `<div class="risk">${Icons.alert}<span>${high.map((f) => esc(Risk.describe(f))).join("<br>")}</span></div>`;
  }
  function teamPunches() {
    return state.team && state.team.punches || [];
  }
  function teamCrew() {
    return (state.team && state.team.crew || state.crew).filter((c) => c.active !== false && c.role !== "boss");
  }
  function bossMapHtml() {
    return `<div id="team-map" class="team-map"></div>
      <div class="map-legend">${["onsite", "near", "offsite", "nogps"].map((s) => chip(s)).join("")}<span class="chip s-out"><i></i>Clocked out</span></div>`;
  }
  function mountTeamMap() {
    const el = document.getElementById("team-map");
    if (!el || !self.L) return;
    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }
    const map = L.map(el, { zoomControl: true, attributionControl: true });
    leafletMap = map;
    addBaseLayers(map);
    const pts = [];
    const jobs = state.team && state.team.jobs || state.jobs;
    jobs.filter((j) => j.active !== false && j.lat != null).forEach((j) => {
      L.circle([j.lat, j.lng], { radius: Geo.toMeters(j.radiusFt || 300), color: "#AD371D", weight: 2, fillOpacity: 0.08 }).addTo(map);
      L.marker([j.lat, j.lng], { icon: jobIcon(), title: j.name, alt: j.name }).addTo(map).bindPopup(`<b>${esc(j.name)}</b><br>${esc(j.address || "")}`);
      pts.push([j.lat, j.lng]);
    });
    const last = Report.lastPunchByCrew(teamPunches());
    const { today0, shifts } = bossDay();
    const shiftOf = {};
    shifts.forEach((sh) => {
      if (!shiftOf[sh.crewId] || (sh.inAt || sh.outAt) >= (shiftOf[sh.crewId].inAt || shiftOf[sh.crewId].outAt)) shiftOf[sh.crewId] = sh;
    });
    const rows = {};
    const placed = teamCrew().map((c) => {
      const p = last[c.id];
      if (!p) return null;
      const job = jobById(p.jobId);
      const atJob = job && job.lat != null && p.status !== "offsite";
      const ll = atJob ? [job.lat, job.lng] : p.lat != null ? [p.lat, p.lng] : job ? [job.lat, job.lng] : null;
      if (!ll) return null;
      const row = atJob ? rows[job.id] = rows[job.id] || [] : null;
      if (row) row.push(c.id);
      return { c, p, job, ll, row };
    }).filter(Boolean);
    placed.forEach(({ c, p, job, ll, row }) => {
      const stale = p.at < today0;
      const sh = !stale && shiftOf[c.id];
      const status = sh ? sh.status : p.status;
      const s = STATUS[String(status)] || STATUS.nogps;
      const out = p.type === "out";
      const shift = row ? (row.indexOf(c.id) - (row.length - 1) / 2) * 52 : 0;
      const icon = L.divIcon({
        className: "",
        html: `<div class="crew-dot ${s.cls} ${stale ? "stale" : ""} ${out ? "is-out" : ""}">${esc(initials(c.name))}</div>`,
        iconSize: [48, 48],
        iconAnchor: [24 - shift, row ? 76 : 24],
        popupAnchor: [shift, row ? -74 : -22]
      });
      const label = `${c.name}, ${s.word}${out ? ", clocked out" : ""}`;
      L.marker(ll, { icon, zIndexOffset: out ? 500 : 1e3, title: label, alt: label }).addTo(map).bindPopup(punchPopup(c, p, job, status));
      pts.push(ll);
    });
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
    else map.setView([38.44, -81.88], 11);
    map.on("popupopen", (e) => {
      const btn = e.popup.getElement().querySelector('[data-action="show-photo"]');
      if (btn) btn.addEventListener("click", () => showPhoto(btn.dataset.id));
    });
  }
  function punchPopup(c, p, job, status = p.status) {
    const verb = p.type === "in" ? "Clocked in" : "Clocked out";
    const late = sentLate(p) ? `<br><span class="muted">${sentLate(p)}</span>` : "";
    const dist = p.distanceFt != null && p.status !== "onsite" ? ` \xB7 ${Geo.formatDistance(p.distanceFt)} away` : "";
    return `<div class="popup"><b>${esc(c.name)}</b><br>${verb} ${dayLabel(p.at).toLowerCase()} ${time(p.at)}<br>
      ${esc(job ? job.name : "")}<br>${chip(status, p.hasPhoto)}${dist}
      ${p.address && p.status === "offsite" ? `<br><span class="muted">${esc(p.address)}</span>` : ""}${late}
      ${riskHtml(riskFor(p))}
      ${p.hasPhoto ? `<br><button class="mini" data-action="show-photo" data-id="${esc(p.id)}">See photo</button>` : ""}</div>`;
  }
  function jobIcon() {
    return L.divIcon({ className: "", html: `<div class="job-pin"><span>${Icons.job}</span></div>`, iconSize: [48, 48], iconAnchor: [24, 24] });
  }
  function addBaseLayers(map) {
    const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    });
    const sat = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16,
      attribution: "USGS"
    });
    streets.addTo(map);
    L.control.layers({ Streets: streets, Satellite: sat }, null, { position: "topright" }).addTo(map);
  }
  function bossDay() {
    const now0 = Report.startOfDay(Date.now());
    const yest = Report.startOfDay(now0 - 1);
    const all = teamPunches();
    const sd = state.team && state.team.sampleDay;
    const sampleYesterday = Api.isDemo && all.some((p) => p.at >= yest && p.at < now0) && (sd != null ? sd === yest : !all.some((p) => p.at >= now0));
    if (!sampleYesterday) {
      return { today0: now0, dayEnd: now0 + 864e5, sampleYesterday, shifts: Report.shiftsForDay(all, now0) };
    }
    const seen = /* @__PURE__ */ new Set();
    const shifts = Report.shiftsForDay(all, yest).concat(Report.shiftsForDay(all, now0)).filter((sh) => {
      const k = sh.inId || sh.outId;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const visitorToday = shifts.some((sh) => (sh.inAt || 0) >= now0 || (sh.outAt || 0) >= now0);
    return { today0: yest, dayEnd: now0 + 864e5, sampleYesterday, visitorToday, shifts };
  }
  const LATE_MS = 5 * 6e4;
  function sentLate(p) {
    if (punchChanged(p)) return "";
    return p && p.receivedAt && p.receivedAt - p.at > LATE_MS ? `Sent at ${time(p.receivedAt)} (no signal)` : "";
  }
  function punchChanged(p) {
    const v = p && verifyResults();
    return !!(v && (v[p.id] === "changed" || v[p.id] === "broken_chain"));
  }
  function teamKeys() {
    const d = state.team && state.team.devices;
    if (!Array.isArray(d) || !d.length || !self.Chain || !Chain.verifyAll || !(self.crypto && crypto.subtle)) return null;
    return Object.fromEntries(d.map((x) => [x.id, x.publicKey]));
  }
  function verifyResults() {
    return state.verify && state.verify.team === state.team ? state.verify.res : null;
  }
  function startVerify() {
    const team = state.team;
    const keys = teamKeys();
    if (!keys || state.verifying === team) return;
    state.verifying = team;
    Chain.verifyAll(team.punches, keys).then((res) => {
      if (state.team !== team) return;
      state.verify = { team, res };
      if (state.screen === "boss" && state.bossTab === "today") render();
    }, () => {
    });
  }
  const KIND = { in: "clock-in", out: "clock-out", void: "fix" };
  function verifyHtml(dayPunches) {
    if (!teamKeys() || !dayPunches.length) return "";
    const res = verifyResults();
    if (!res) {
      startVerify();
      return `<div class="verify" data-verify-line>${Icons.lock}<span>Checking punches\u2026</span></div>`;
    }
    const bad = dayPunches.filter((p) => res[p.id] === "changed" || res[p.id] === "broken_chain").sort((a, b) => a.at - b.at);
    const ok = dayPunches.filter((p) => res[p.id] === "ok").length;
    const unchecked = dayPunches.length - ok - bad.length;
    let line;
    if (bad.length) {
      const p = bad[0];
      const c = crewById(p.crewId) || { name: "Someone" };
      line = `<div class="verify bad" data-verify-line role="alert">${Icons.alert}<span>${esc(c.name)}'s ${KIND[p.type] || "punch"} was changed to ${time(p.at)} after their phone signed it.${bad.length > 1 ? ` ${bad.length - 1} more changed.` : ""}
        <button class="link verify-show" data-action="show-flagged" data-id="${esc(p.id)}">Show me</button></span></div>`;
    } else {
      const words = unchecked ? `${ok} of ${dayPunches.length} punches match what the phones sent. ${unchecked} not signed (older phone).` : ok === 1 ? "1 punch matches what the phone sent." : `all ${ok} punches match what the phones sent.`;
      const tryIt = demoControls() && !DemoBackend.isTampered() && ok ? '<button class="link verify-try" data-action="demo-tamper">Try tampering</button>' : "";
      line = tryIt ? `<div class="verify ok verify-row"><div class="verify-line" data-verify-line>${Icons.lock}<span>Verified: ${words}</span></div>${tryIt}</div>` : `<div class="verify ok" data-verify-line>${Icons.lock}<span>Verified: ${words}</span></div>`;
    }
    const undo = demoControls() && DemoBackend.isTampered() ? `<div class="verify-demo"><button class="btn secondary sm" data-action="demo-untamper">Undo the change</button></div>` : "";
    return line + undo;
  }
  function shownWeek() {
    const ws = Report.weekStart(bossDay().today0);
    return state.weekBack ? Report.weekStart(ws - 864e5) : ws;
  }
  function weekNames() {
    const names = {};
    (state.team && state.team.crew || state.crew).forEach((c) => {
      names[c.id] = c.name;
    });
    return names;
  }
  function bossWeekHtml() {
    const ws = shownWeek();
    const w = Report.weekTotals(teamPunches(), ws, { now: Date.now() });
    const names = weekNames();
    const ids = [...new Set(teamCrew().map((c) => c.id).concat(Object.keys(w.byCrew)))].sort((a, b) => String(names[a] || "").localeCompare(String(names[b] || "")));
    const hrs = (h, open) => open ? `${Report.fmtHours(h)}+` : h ? Report.fmtHours(h) : "\u2013";
    const none = { days: [0, 0, 0, 0, 0, 0, 0], total: 0, open: [] };
    const r1 = (h) => Math.round((h || 0) * 10) / 10;
    const rowOf = (id) => {
      const r = w.byCrew[id] || none;
      const days = r.days.map(r1);
      return Object.assign({}, r, { days, total: days.reduce((a, h) => a + h, 0) });
    };
    const dayTotals = w.days.map((_, i) => ids.reduce((a, id) => a + (rowOf(id).days[i] || 0), 0));
    const dayOpen = w.days.map((_, i) => ids.some((id) => (rowOf(id).open || [])[i]));
    const anyOpen = dayOpen.some(Boolean);
    const all = dayTotals.reduce((a, b) => a + b, 0);
    const head = w.days.map((d) => {
      const dt = new Date(d);
      return `<th scope="col"><span class="d-long">${dt.toLocaleDateString([], { weekday: "short" })}</span><abbr class="d-short" title="${dt.toLocaleDateString([], { weekday: "long" })}">${dt.toLocaleDateString([], { weekday: "narrow" })}</abbr><small>${dt.getDate()}</small></th>`;
    }).join("");
    const rows = ids.map((id) => {
      const r = rowOf(id);
      const open = r.open || [];
      return `<tr><th scope="row">${esc(names[id] || "?")}</th>${r.days.map((h, i) => `<td>${hrs(h, open[i])}</td>`).join("")}<td class="tot">${hrs(r.total, open.some(Boolean))}</td></tr>`;
    }).join("");
    const from = new Date(ws).toLocaleDateString([], { month: "short", day: "numeric" });
    return `<div class="week-head"><h3>Week of ${esc(from)}</h3>
        <div class="week-nav">${state.weekBack ? `<button class="btn secondary sm" data-action="week-this">This week <span class="flip">${Icons.back}</span></button>` : `<button class="btn secondary sm" data-action="week-back">${Icons.back} Last week</button>`}</div></div>
      <div class="week-wrap" tabindex="0" role="region" aria-label="Hours per person, Monday to Sunday">
      <table class="week"><thead><tr><th scope="col"><span class="name-head">Name</span></th>${head}<th scope="col">Total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row">All</th>${dayTotals.map((h, i) => `<td>${hrs(h, dayOpen[i])}</td>`).join("")}<td class="tot">${hrs(all, anyOpen)}</td></tr></tfoot></table></div>
      <p class="muted small">Hours on the day each shift started.${anyOpen ? ' <span class="nw">+ still on the clock</span>' : ""}</p>
      <div class="actions"><button class="btn secondary" data-action="week-csv">${Icons.sheet} Download CSV</button></div>`;
  }
  function bossTodayHtml() {
    const { today0, dayEnd, sampleYesterday, visitorToday, shifts } = bossDay();
    const view = state.todayView === "week" ? "week" : "day";
    const seg = `<div class="seg view-seg" role="group" aria-label="Show">${[["day", "Day"], ["week", "Week"]].map(([k, l]) => `<button class="${view === k ? "on" : ""}" data-action="today-view" data-view="${k}" aria-pressed="${view === k}">${l}</button>`).join("")}</div>`;
    if (view === "week") {
      return `<div class="pad">
        <div class="today-head"><h2>Timesheet</h2>${seg}</div>
        ${bossWeekHtml()}
      </div>`;
    }
    const dayPunches = teamPunches().filter((p) => p.at >= today0 && p.at < dayEnd);
    const crew = teamCrew();
    const inToday = new Set(shifts.map((s) => s.crewId));
    const notIn = crew.filter((c) => !inToday.has(c.id));
    const punchById = Object.fromEntries(teamPunches().map((p) => [p.id, p]));
    const dayOver = sampleYesterday || Api.isDemo && self.DemoBackend && DemoBackend.sampleDay(Date.now()).done;
    shifts.sort((a, b) => (Report.SEVERITY[String(b.status)] || 0) - (Report.SEVERITY[String(a.status)] || 0) || (a.inAt || 0) - (b.inAt || 0));
    const rows = shifts.map((s) => {
      const c = crewById(s.crewId) || { name: "?" };
      const job = jobById(s.jobId);
      const photoP = [punchById[String(s.inId)], punchById[String(s.outId)]].find((p) => p && p.hasPhoto);
      const dupes = (s.duplicateOuts || []).map((id) => punchById[id]);
      const flags = [punchById[String(s.inId)], punchById[String(s.outId)], ...dupes].filter(Boolean).flatMap(riskFor);
      const span = `<span class="nw">${s.inAt ? time(s.inAt) : "?"} \u2013 ${s.outAt ? time(s.outAt) : s.open ? '<b class="on-clock">on the clock</b>' : '<b class="warn">no clock-out</b>'}</span>`;
      const late = sentLate(punchById[String(s.inId)]) || sentLate(punchById[String(s.outId)]);
      const ids = [s.inId, s.outId, ...s.duplicateOuts || []].filter(Boolean).join(" ");
      return `<div class="shift" data-punches="${esc(ids)}" tabindex="-1">
        <span class="avatar">${esc(initials(c.name))}</span>
        <div class="grow"><div class="shift-name">${esc(c.name)}</div>
          <div class="muted small">${esc(job ? job.name : "")}</div>
          <div class="muted small shift-times">${span}${dupes.length ? ' <span class="nw">\xB7 clocked out twice</span>' : ""}</div>
          ${late ? `<div class="muted small sent-late">${Icons.cloudOff}<span>${late}</span></div>` : ""}${riskHtml(flags)}</div>
        <div class="shift-right">${chip(s.status)}
          ${s.hours != null ? `<span class="muted small shift-hours nw">${Report.fmtHours(s.hours)} h</span>` : ""}
          ${photoP ? `<button class="mini" data-action="show-photo" data-id="${esc(photoP.id)}">${Icons.camera}</button>` : ""}</div>
      </div>`;
    }).join("");
    const sheet = cfg.sheetUrl ? `<a class="btn secondary" href="${esc(cfg.sheetUrl)}" target="_blank" rel="noopener">${Icons.sheet} Open the Google Sheet</a>` : "";
    let summary = "";
    if (self.AI) {
      const names = Object.fromEntries(teamCrew().map((c) => [c.id, c.name]));
      const jobNames = Object.fromEntries((state.team && state.team.jobs || state.jobs).map((j) => [j.id, j.name]));
      const text = state.aiSummary || AI.plainSummary(shifts, names, jobNames, notIn.map((c) => c.name), Date.now(), { pastDay: sampleYesterday, dayOver: !!dayOver });
      state.summaryFacts = text;
      const canWrite = !Api.isDemo && AI.modelTier(cfg) >= 2 && !state.aiSummary && shifts.length;
      summary = `<div class="summary"><div class="summary-text" id="summary-text">${esc(text)}</div>
        ${canWrite ? `<button class="link" data-action="ai-summary">Write it up with AI on this phone</button>` : ""}
        ${state.aiSummary ? '<div class="muted small">Written by an AI model running on this phone.</div>' : ""}</div>`;
    }
    const small = !!(self.matchMedia && matchMedia(SMALL_TODAY).matches);
    return `<div class="pad">
      <div class="today-head"><h2>${sampleYesterday ? "Yesterday (sample day)" : "Today"}</h2>${seg}</div>
      ${visitorToday ? '<p class="muted small">Your own punches from this morning are added to it.</p>' : ""}
      ${verifyHtml(dayPunches)}
      ${small ? "" : summary}
      ${notIn.length ? `<div class="not-in"><div class="not-in-title">${Icons.alert} ${dayOver ? "Not in" : "Not in yet"} (${notIn.length})</div>
        <div>${notIn.map((c) => `<span class="pill">${esc(c.name)}</span>`).join("")}</div></div>` : ""}
      <div class="list">${rows || '<p class="muted">No one has clocked in today.</p>'}</div>
      ${small ? summary : ""}
      <div id="push-slot"></div>
      <div class="actions">${isBoss() ? `<button class="btn secondary" data-action="send-report">${Icons.send} Send today's report now</button>` : ""}${sheet}</div>
    </div>`;
  }
  function bossJobsHtml() {
    const jobs = state.jobs.filter((j) => j.active !== false);
    return `<div class="pad">
      <div class="row-between"><h2>Jobs</h2><button class="btn primary sm" data-action="job-new">${Icons.plus} Add job</button></div>
      <div class="list">${jobs.map((j) => `
        <button class="job-btn" data-action="job-edit" data-id="${esc(j.id)}">
          <span class="job-ico">${Icons.job}</span>
          <span class="grow"><span class="job-name">${esc(j.name)}</span><span class="job-addr">${esc(j.address || "Pin on map")}</span></span>
          <span class="job-dist">${j.radiusFt || 300} ft</span>
        </button>`).join("") || `<div class="empty"><p class="muted">No jobs yet. Add your first one.</p>
          <button class="btn primary" data-action="job-new">${Icons.plus} Add job</button></div>`}</div>
      ${syncFooter()}
    </div>`;
  }
  function consentLine(c) {
    if (c.role === "boss" || !state.team || !state.team.consents || hasConsent(c.id)) return "";
    return `<span class="job-addr no-consent">${Icons.alert} No location consent</span>`;
  }
  function bossCrewHtml() {
    const crew = state.crew.filter((c) => c.active !== false);
    const role = { boss: "Boss", foreman: "Foreman", crew: "Crew" };
    return `<div class="pad">
      <div class="row-between"><h2>Crew</h2><button class="btn primary sm" data-action="crew-new">${Icons.plus} Add person</button></div>
      <div class="list">${crew.map((c) => `
        <button class="job-btn" data-action="crew-edit" data-id="${esc(c.id)}">
          <span class="avatar">${esc(initials(c.name))}</span>
          <span class="grow"><span class="job-name">${esc(c.name)}</span>${consentLine(c)}</span>
          <span class="job-dist">${role[String(c.role)] || "Crew"}</span>
        </button>`).join("")}</div>
      ${syncFooter()}
    </div>`;
  }
  function syncFooter() {
    return `<div class="sync-line" data-sync-line>${syncLineHtml()}</div>`;
  }
  screens["job-form"] = () => {
    const j = state.editJob;
    const mode = state.jobMode || "address";
    const results = state.geoResults;
    return `<main class="screen form">
      <button class="back" data-action="boss-back">${Icons.back} Jobs</button>
      <h1>${j.isNew ? "New job" : "Edit job"}</h1>
      <label class="field"><span>Job name</span>
        <input id="job-name" maxlength="60" value="${esc(j.name)}" placeholder="e.g. Jones porch" autocomplete="off"></label>
      <div class="field" id="job-where"><span>Where is it?</span>
        <div class="seg">${[["address", "Address"], ["pin", "Drop a pin"], ["here", "I'm here"]].map(([k, l]) => `<button class="${mode === k ? "on" : ""}" data-action="job-mode" data-mode="${k}">${l}</button>`).join("")}</div></div>
      ${mode === "address" ? `<div class="field"><div class="search-row">
          <input id="job-address" maxlength="200" value="${esc(state.addressQuery != null ? state.addressQuery : j.address)}" placeholder="Street and town" autocomplete="street-address" enterkeyhint="search">
          <button class="btn primary sm" data-action="geo-search">Find</button></div>
          ${results ? `<div class="results">${results.length ? results.map((r, i) => `<button data-action="geo-pick" data-i="${i}">${Icons.pin}<span>${esc(r.label)}</span></button>`).join("") : '<p class="muted">No match. Try adding the town, or drop a pin.</p>'}</div>` : ""}</div>` : ""}
      ${mode === "pin" ? '<p class="muted">Tap the map where the job is. Drag the pin to fine-tune.</p>' : ""}
      ${mode === "here" ? `<button class="btn secondary" data-action="job-here">${Icons.locate} Use where I'm standing</button>` : ""}
      <div id="job-map" class="job-map"></div>
      <div class="field"><span>How close counts as "at the job"?</span>
        <div class="seg fences">${FENCES.map((f) => `<button class="${(j.radiusFt || 300) === f.ft ? "on" : ""}" data-action="job-fence" data-ft="${f.ft}">
          <b>${f.word}</b><small>${f.ft} ft \xB7 ${f.hint}</small></button>`).join("")}</div></div>
      <button class="btn primary xl" data-action="job-save">Save job</button>
      ${!j.isNew ? '<button class="link danger" data-action="job-archive">Job is finished (hide it)</button>' : ""}
    </main>`;
  };
  function mountJobMap() {
    const el = document.getElementById("job-map");
    if (!el || !self.L) return;
    if (jobFormMap) {
      jobFormMap.remove();
      jobFormMap = null;
    }
    const j = state.editJob;
    const map = L.map(el);
    jobFormMap = map;
    addBaseLayers(map);
    let marker = null;
    let circle = null;
    const place = (lat, lng, zoom) => {
      j.lat = lat;
      j.lng = lng;
      if (!marker) {
        marker = L.marker([lat, lng], { draggable: true }).addTo(jobFormMap);
        marker.on("dragend", () => {
          const p = marker.getLatLng();
          place(p.lat, p.lng);
        });
        circle = L.circle([lat, lng], { radius: Geo.toMeters(j.radiusFt || 300), color: "#AD371D", weight: 2, fillOpacity: 0.1 }).addTo(jobFormMap);
      } else {
        marker.setLatLng([lat, lng]);
        circle.setLatLng([lat, lng]);
      }
      if (zoom) jobFormMap.setView([lat, lng], zoom);
    };
    if (j.lat != null) place(j.lat, j.lng, 17);
    else map.setView([38.44, -81.88], 11);
    map.on("click", (e) => {
      if ((state.jobMode || "address") !== "address") place(e.latlng.lat, e.latlng.lng);
    });
    state.placeJobPin = place;
  }
  screens["crew-form"] = () => {
    const c = state.editCrew;
    return `<main class="screen form">
      <button class="back" data-action="boss-back">${Icons.back} Crew</button>
      <h1>${c.isNew ? "Add person" : esc(c.name)}</h1>
      <label class="field"><span>Name (first name and last initial)</span>
        <input id="crew-name" maxlength="60" value="${esc(c.name)}" placeholder="e.g. Pat L." autocomplete="off"></label>
      <label class="field"><span>${c.isNew ? "4 number PIN" : "New 4 number PIN (leave blank to keep)"}</span>
        <input id="crew-pin" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="${c.isNew ? "4 numbers" : "\u2022\u2022\u2022\u2022"}" autocomplete="off"></label>
      <div class="field"><span>Role</span>
        <div class="seg">${[["crew", "Crew"], ["foreman", "Foreman"], ["boss", "Boss"]].map(([k, l]) => `<button class="${(c.role || "crew") === k ? "on" : ""}" data-action="crew-role" data-role="${k}">${l}</button>`).join("")}</div>
        <small class="muted">Foreman can clock in a teammate and see the team map.</small></div>
      <button class="btn primary xl" data-action="crew-save">Save</button>
      ${!c.isNew && c.id !== state.me.id ? '<button class="link danger" data-action="crew-off">No longer works here (turn off)</button>' : ""}
    </main>`;
  };
  async function queueEdit(kind, data) {
    await Store.outbox.add({ kind, id: Store.uid(), byCrewId: state.me.id, data });
    await countPending();
    syncNow();
  }
  async function showPhoto(punchId) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = '<div class="spinner"></div>';
    overlay.addEventListener("click", () => overlay.remove());
    document.body.appendChild(overlay);
    try {
      const res = await Api.photo(state.auth, punchId);
      const src = res.url || res.dataUrl;
      overlay.innerHTML = src ? `<img src="${esc(src)}" alt="Clock-in photo">` : "<p>Photo not found.</p>";
      if (src && !Api.isDemo && self.AI && AI.modelTier(cfg) >= 1) {
        const b = document.createElement("button");
        b.className = "btn secondary ai-check";
        b.textContent = "What's in this picture?";
        b.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          b.disabled = true;
          b.textContent = "Looking\u2026 (first time downloads a small model)";
          try {
            const r = await AI.labelPhoto(src, cfg);
            b.textContent = (r.looksLikeSite ? "Looks like a job site: " : "Doesn't look like a job site: ") + r.labels.slice(0, 3).map((l) => l.label).join(", ");
          } catch (e) {
            b.textContent = "Couldn't check this picture on this phone";
          }
        });
        overlay.appendChild(b);
      }
    } catch (e) {
      overlay.innerHTML = "<p>Need signal to load the photo.</p>";
    }
  }
  let bossScroll = { tab: null, want: 0, got: 0 };
  function paint(html) {
    const tab = state.screen === "boss" ? state.bossTab : null;
    const old = tab && tab === bossScroll.tab ? $app.querySelector(".boss-body") : null;
    let keep = old ? old.scrollTop : 0;
    if (old && keep === bossScroll.got && bossScroll.want > bossScroll.got) keep = bossScroll.want;
    const active = document.activeElement;
    const barKey = active && active.dataset && $app.contains(active) ? active.dataset.bar : void 0;
    $app.innerHTML = (state.screen === "boss" ? "" : banners()) + html;
    if (barKey) focusBar(barKey);
    $app.classList.toggle("fit", state.screen === "chat-thread");
    const body = keep && $app.querySelector(".boss-body");
    if (body) body.scrollTop = keep;
    applyHints();
    bossScroll = { tab, want: keep, got: body ? body.scrollTop : 0 };
  }
  function render() {
    if (gpsWatch && !gpsWatch.stillWanted()) stopGps();
    const fn = screens[String(state.screen)] || screens.names;
    paint(fn());
    if (state.screen === "boss" && state.bossTab === "map") mountTeamMap();
    if (state.screen === "job-form") mountJobMap();
    if (self.Messenger) Messenger.afterRender();
    mountPush();
  }
  if (self.matchMedia) {
    const mq = matchMedia(SMALL_TODAY);
    const onSmall = (e) => {
      if (state.screen !== "boss" || state.bossTab !== "today" || state.todayView === "week") return;
      const card = $app.querySelector(".boss-body .summary");
      const list = card && $app.querySelector(".boss-body .list");
      if (!list) return;
      const body = $app.querySelector(".boss-body");
      const keep = body ? body.scrollTop : 0;
      if (e.matches) list.after(card);
      else {
        const notIn = list.parentNode.querySelector(".not-in");
        (notIn || list).before(card);
      }
      if (body) body.scrollTop = keep;
    };
    if (mq.addEventListener) mq.addEventListener("change", onSmall);
    else if (mq.addListener) mq.addListener(onSmall);
  }
  async function mountPush() {
    const slot = document.getElementById("push-slot");
    if (!slot || !self.Push || !state.auth) return;
    const st = await Push.status().catch(() => "unsupported");
    const words = {
      ready: `<button class="btn secondary" data-action="push-enable">${Icons.alert} Get alerts on this phone</button>`,
      "install-first": `<p class="muted small center">To get alerts on iPhone: tap Share, then <b>Add to Home Screen</b>, and open the app from there.</p>`,
      blocked: '<p class="muted small center">Alerts are turned off for this app in the phone settings.</p>',
      on: `<p class="muted small center">${Icons.check} Alerts are on for this phone</p>`
    };
    slot.innerHTML = words[st] || "";
  }
  const handlers = {
    "go": (el) => setScreen(el.dataset.to),
    "go-home": () => {
      state.flow = null;
      goHome();
    },
    "pick-name": (el) => {
      if (demoNoPin()) return tryLogin(el.dataset.id, null);
      setScreen("pin", { pinFor: el.dataset.id, pinEntry: "", pinError: null });
    },
    "pin-key": (el) => {
      if ((state.pinEntry || "").length >= 4) return;
      state.pinEntry = (state.pinEntry || "") + el.dataset.k;
      state.pinError = null;
      render();
      if (state.pinEntry.length === 4) tryLogin(state.pinFor, state.pinEntry);
    },
    "pin-del": () => {
      state.pinEntry = (state.pinEntry || "").slice(0, -1);
      render();
    },
    "consent-agree": async () => {
      const next = state.consentNext;
      await saveConsent("agree");
      if (next) return startPunch(next.type);
      goHome();
    },
    "consent-later": () => {
      const next = state.consentNext;
      state.consentAsked = true;
      if (next) return startPunch(next.type, { consentAsked: true });
      goHome();
    },
    "consent-back": () => {
      state.consentAsked = true;
      state.flow = null;
      setScreen("home");
    },
    "consent-ask": () => setScreen("consent", { consentNext: null }),
    "consent-withdraw": async () => {
      if (!confirm("Stop using your location? You will clock in with a picture instead.")) return;
      await saveConsent("withdraw");
      toast("Location is off. You clock in with a picture.");
      render();
    },
    "prime-location": () => {
      Store.local.set("locPrimed", true);
      watchGps(
        navigator.geolocation,
        () => state.screen === "primer",
        { timeoutMs: 15e3, goodEnoughM: Infinity, highAccuracy: false, maximumAgeMs: 12e4 }
      ).then(() => {
        if (state.screen === "primer") setScreen("home");
      });
    },
    "sign-out": () => signOut(),
    "punch": (el) => startPunch(el.dataset.type),
    "teammate": () => setScreen("pick-teammate"),
    "mate-punch": (el) => startPunch(el.dataset.type, { crewId: el.dataset.id }),
    "pick-job": (el) => pickJob(el.dataset.id),
    "skip-gps": () => {
      state.screen = "skipping";
      stopGps();
      state.flow.fix = null;
      afterFix();
    },
    "no-photo": () => finishPunch(),
    "photo-anyway": () => {
      state.flow.photoChecked = true;
      onPhotoFile(state.flow.pendingFile);
    },
    "fix-job": async () => {
      const orig = await Store.outbox.get(state.flow.saved.id) || state.flow.saved;
      startPunch("in", { fixing: Object.assign({}, orig, { photo: state.flow.photo }) });
    },
    "demo-fake": (el) => Store.local.set("demoFake", el.checked),
    // Demo only (ENH-2): "No signal" makes the sample server act like there is no signal; turning
    // it off sends whatever waited on this phone.
    "demo-offline": () => {
      if (!demoControls()) return;
      const on = !DemoBackend.isOffline();
      DemoBackend.setOffline(on);
      document.querySelectorAll('[data-action="demo-offline"]').forEach((x) => x.setAttribute("aria-checked", String(on)));
      if (on) updateSyncLine();
      else syncNow();
      applyHints();
    },
    // The demo bar's toggle opens and closes its drawer (SPEC-DEMO-BAR)
    "demo-details": () => setDrawer(!demoBar.open),
    // Reset demo asks first, inline (never a browser dialog): focus goes to Keep
    "demo-reset": () => {
      if (!Api.isDemo) return;
      demoBar.asking = true;
      syncDemoBar("keep");
    },
    "demo-reset-keep": () => {
      demoBar.asking = false;
      syncDemoBar("reset");
    },
    // Demo only (M1.4): forget this visit and start again from the sample crew.
    "demo-reset-go": () => {
      if (!Api.isDemo) return;
      try {
        Object.keys(localStorage).filter((k) => k.startsWith("cc.")).forEach((k) => localStorage.removeItem(k));
      } catch (e) {
      }
      try {
        localStorage.removeItem(HINTS_KEY);
      } catch (e) {
      }
      if (window.DemoBackend) window.DemoBackend.reset();
      if (window.Messenger && window.Messenger.stop) window.Messenger.stop();
      const gone = (db) => new Promise((done) => {
        try {
          const r = indexedDB.deleteDatabase(db);
          r.onsuccess = r.onerror = r.onblocked = () => done();
        } catch (e) {
          done();
        }
        setTimeout(done, 2e3);
      });
      try {
        sessionStorage.setItem(RESTORED_KEY, "1");
      } catch (e) {
      }
      Promise.all(["crewclock", "crewclock-chat", "crewclock-keys"].map(gone)).then(() => location.reload());
    },
    "boss-tab": (el) => {
      state.bossTab = el.dataset.tab;
      Store.local.set("bossTab", state.bossTab);
      render();
    },
    "boss-back": () => setScreen("boss"),
    "today-view": (el) => {
      state.todayView = el.dataset.view === "week" ? "week" : "day";
      Store.local.set("todayView", state.todayView);
      render();
    },
    // UX-R31: from the red line to the changed punch's row
    "show-flagged": (el) => {
      const row = [...document.querySelectorAll(".shift[data-punches]")].find((r) => String(r.dataset.punches).split(" ").includes(el.dataset.id));
      if (!row) return;
      row.scrollIntoView({ block: "center" });
      row.focus({ preventScroll: true });
    },
    "week-back": () => {
      state.weekBack = true;
      render();
    },
    "week-this": () => {
      state.weekBack = false;
      render();
    },
    // Name, date, in, out, hours only (no GPS, job pins, photos or risk), made on this phone.
    "week-csv": () => {
      const ws = shownWeek();
      const csv = Report.timesheetCsv(teamPunches(), weekNames(), ws);
      const d = new Date(ws);
      const name = `timesheet-week-of-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.csv`;
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e4);
    },
    // Demo only (ENH-1): edit one saved punch in the sample records, then check again.
    "demo-tamper": async () => {
      if (!demoControls()) return;
      const { today0 } = bossDay();
      const res = verifyResults() || {};
      const day = teamPunches().filter((p) => p.at >= today0 && p.at < today0 + 864e5 && res[p.id] === "ok").sort((a, b) => a.at - b.at);
      const pick = day.find((p) => p.crewId === "c2" && p.type === "in") || day.find((p) => p.type === "in") || day[0];
      DemoBackend.tamper(pick && pick.id);
      await loadTeam();
      render();
    },
    "demo-untamper": async () => {
      if (!demoControls()) return;
      DemoBackend.untamper();
      await loadTeam();
      render();
    },
    "ai-summary": async (el) => {
      if (!AI.onWifi() && !confirm("This downloads about 400 MB once. Use cell data anyway?")) return;
      el.disabled = true;
      el.textContent = "Writing\u2026 (first time downloads the model)";
      try {
        state.aiSummary = (await AI.writeSummary("Facts for today: " + state.summaryFacts, cfg)).trim();
      } catch (e) {
        toast("This phone couldn't run the AI model");
        el.remove();
        return;
      }
      render();
    },
    "push-enable": async () => {
      try {
        await Push.enable(state.auth);
        toast("Alerts are on");
      } catch (e) {
        toast("Couldn't turn on alerts. Try again with signal.");
      }
      mountPush();
    },
    "reload-team": async () => {
      await syncNow();
      await loadTeam();
      render();
    },
    "show-photo": (el) => showPhoto(el.dataset.id),
    "send-report": async () => {
      try {
        const r = await Api.sendReport(state.auth);
        toast(r.sent ? "Report sent to your email" : r.note || "Report built");
      } catch (e) {
        toast("Need signal to send the report");
      }
    },
    "job-new": () => setScreen("job-form", { editJob: { id: Store.uid(), name: "", address: "", lat: null, lng: null, radiusFt: 300, active: true, isNew: true }, jobMode: "address", geoResults: null, addressQuery: null }),
    "job-edit": (el) => setScreen("job-form", { editJob: Object.assign({}, jobById(el.dataset.id)), jobMode: "address", geoResults: null, addressQuery: null }),
    "job-mode": (el) => {
      keepJobInputs();
      state.jobMode = el.dataset.mode;
      render();
    },
    "job-fence": (el) => {
      keepJobInputs();
      state.editJob.radiusFt = +el.dataset.ft;
      render();
    },
    "geo-search": async () => {
      keepJobInputs();
      const q = state.addressQuery;
      if (!q) return;
      try {
        const res = await Api.geocode(state.auth, q);
        state.geoResults = res.results || [];
      } catch (e) {
        toast(`No signal for address search. Use "Drop a pin" or "I'm here".`);
        return;
      }
      render();
    },
    "geo-pick": (el) => {
      keepJobInputs();
      const r = state.geoResults[+el.dataset.i];
      state.editJob.address = r.label;
      state.addressQuery = r.label;
      state.editJob.lat = r.lat;
      state.editJob.lng = r.lng;
      state.geoResults = null;
      render();
    },
    "job-here": async (el) => {
      keepJobInputs();
      el.disabled = true;
      el.textContent = "Finding you\u2026";
      const job = state.editJob;
      const fix = await watchGps(
        navigator.geolocation,
        () => state.screen === "job-form" && state.jobMode === "here" && state.editJob === job,
        { timeoutMs: 15e3, goodEnoughM: 15 }
      );
      if (state.editJob !== job || state.screen !== "job-form" || state.jobMode !== "here") return;
      el.disabled = false;
      el.innerHTML = `${Icons.locate} Use where I'm standing`;
      if (!fix) return toast("Couldn't get GPS. Try Drop a pin.");
      state.placeJobPin(fix.lat, fix.lng, 18);
      if (!state.editJob.address) state.editJob.address = `Pin ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`;
    },
    "job-save": async () => {
      keepJobInputs();
      const j = state.editJob;
      j.name = cleanText(j.name).slice(0, 60);
      j.address = cleanText(j.address).slice(0, 200);
      if (!j.name) return fieldError(document.getElementById("job-name"), "Give the job a name");
      if (j.lat == null) return fieldError(document.getElementById("job-address") || document.getElementById("job-where"), "Set where the job is first");
      const rec = { id: j.id, name: j.name.trim(), address: j.address || "", lat: j.lat, lng: j.lng, radiusFt: j.radiusFt || 300, active: true };
      upsertLocal("jobs", rec);
      await queueEdit("job", rec);
      state.bossTab = "jobs";
      setScreen("boss");
      toast("Job saved");
    },
    "job-archive": async () => {
      const j = Object.assign({}, state.editJob, { active: false });
      delete j.isNew;
      upsertLocal("jobs", j);
      await queueEdit("job", j);
      setScreen("boss");
    },
    "crew-new": () => setScreen("crew-form", { editCrew: { id: Store.uid(), name: "", role: "crew", isNew: true, active: true } }),
    "crew-edit": (el) => setScreen("crew-form", { editCrew: Object.assign({}, state.crew.find((c) => c.id === el.dataset.id)) }),
    "crew-role": (el) => {
      keepCrewInputs();
      state.editCrew.role = el.dataset.role;
      render();
    },
    "crew-save": async () => {
      keepCrewInputs();
      const c = state.editCrew;
      const pin = document.getElementById("crew-pin");
      c.name = cleanText(c.name).slice(0, 60);
      if (!c.name) return fieldError(document.getElementById("crew-name"), "Type their name");
      if (c.newPin && !/^\d{4}$/.test(c.newPin)) return fieldError(pin, "The PIN is 4 numbers");
      if (c.isNew && !c.newPin) return fieldError(pin, "Give them a 4 number PIN");
      const rec = { id: c.id, name: c.name.trim(), role: c.role || "crew", active: true };
      if (c.newPin) rec.pin = c.newPin;
      upsertLocal("crew", { id: rec.id, name: rec.name, role: rec.role, active: true });
      await queueEdit("crew", rec);
      state.bossTab = "crew";
      setScreen("boss");
      toast(c.isNew ? `${rec.name} added. Their PIN is ${c.newPin}.` : "Saved");
    },
    "crew-off": async () => {
      const c = state.editCrew;
      if (!confirm(`Turn off ${c.name}? They won't be able to sign in.`)) return;
      upsertLocal("crew", { id: c.id, name: c.name, role: c.role, active: false });
      await queueEdit("crew", { id: c.id, name: c.name, role: c.role, active: false });
      setScreen("boss");
    }
  };
  function keepJobInputs() {
    const n = document.getElementById("job-name");
    const a = document.getElementById("job-address");
    if (n) state.editJob.name = n.value;
    if (a) {
      state.addressQuery = a.value.trim();
      if (!state.editJob.address) state.editJob.address = a.value.trim();
    }
  }
  function keepCrewInputs() {
    const n = document.getElementById("crew-name");
    const p = document.getElementById("crew-pin");
    if (n) state.editCrew.name = n.value;
    if (p) state.editCrew.newPin = p.value.trim();
  }
  function upsertLocal(key, rec) {
    const list = state[key];
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0) list[i] = Object.assign(list[i], rec);
    else list.push(rec);
    Store.local.set(key, list);
    if (state.team) {
      const tl = state.team[key];
      const k = tl.findIndex((x) => x.id === rec.id);
      if (k >= 0) tl[k] = Object.assign(tl[k], rec);
      else tl.push(rec);
    }
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.tagName === "INPUT") return;
    const h = handlers[el.dataset.action];
    if (h) {
      e.preventDefault();
      h(el, e);
    }
  });
  async function onPhotoFile(file) {
    const f = state.flow;
    const who = crewById(f.crewId);
    const job = jobById(f.jobId);
    if (self.AI && !f.photoChecked) {
      const url = URL.createObjectURL(file);
      const q = await AI.photoQuality(url).catch(() => ({}));
      URL.revokeObjectURL(url);
      if (state.flow !== f) return;
      if (q.problem) {
        f.photoProblem = q.problem;
        f.pendingFile = file;
        return render();
      }
    }
    try {
      f.photo = await stampPhoto(file, [
        `${who ? who.name : ""} \xB7 ${f.type === "in" ? "Clock in" : "Clock out"}`,
        `${job ? job.name : ""} \xB7 ${new Date(f.at).toLocaleString()}`
      ]);
    } catch (err) {
      return toast("That picture didn't work. Try again.");
    }
    if (state.flow !== f) return;
    finishPunch();
  }
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.action === "demo-fake") handlers["demo-fake"](el);
    if (el.dataset.action === "photo-file" && el.files && el.files[0]) onPhotoFile(el.files[0]);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && demoBar.open) {
      setDrawer(false);
      return;
    }
    if (e.key === "Enter" && e.target.id === "job-address") {
      e.preventDefault();
      handlers["geo-search"]();
    }
  });
  window.addEventListener("online", syncNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
  });
  setInterval(syncNow, 6e4);
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {
    });
  }
  self.CrewClock = { state, syncNow, render, screens, handlers, setScreen, esc, toast, fieldError, time, initials, isBoss, isLead, crewById, goHome };
  countPending().then(() => {
    goHome();
    syncNow();
  });
})();

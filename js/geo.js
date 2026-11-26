// Generated from js/geo.ts by npm run build. Do not edit.
(function(root) {
  const FT_PER_M = 3.28084;
  const WEAK_ACCURACY_M = 152;
  const NEAR_FACTOR = 3;
  function toFeet(m) {
    return m * FT_PER_M;
  }
  function toMeters(ft) {
    return ft / FT_PER_M;
  }
  function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6371e3;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function num(v) {
    if (typeof v === "string" && v.trim() !== "") v = Number(v);
    return typeof v === "number" && isFinite(v) ? v : null;
  }
  function fenceStatus(distRaw, accuracyRaw, radiusM) {
    const distM = num(distRaw);
    const accuracyM = num(accuracyRaw);
    if (distM == null || accuracyM == null || accuracyM < 0) return "nogps";
    if (accuracyM > WEAK_ACCURACY_M) return "weak";
    const closest = distM - accuracyM;
    if (closest <= radiusM) return "onsite";
    if (closest <= radiusM * NEAR_FACTOR) return "near";
    return "offsite";
  }
  function checkFix(fix, job) {
    const lat = fix ? num(fix.lat) : null;
    const lng = fix ? num(fix.lng) : null;
    if (!fix || lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !job || num(job.lat) == null || num(job.lng) == null) {
      return { status: "nogps", distanceFt: null };
    }
    const d = distanceM(lat, lng, Number(job.lat), Number(job.lng));
    return {
      status: fenceStatus(d, fix.accuracy, toMeters(job.radiusFt || 300)),
      distanceFt: Math.round(toFeet(d))
    };
  }
  function needsPhoto(status) {
    return status === "nogps" || status === "weak";
  }
  function formatDistance(ft) {
    if (ft == null) return "";
    if (ft < 1e3) return Math.round(ft / 10) * 10 + " ft";
    const mi = ft / 5280;
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " mi";
  }
  function bestFix(geolocation, opts) {
    const o = Object.assign({ timeoutMs: 2e4, goodEnoughM: 20, onUpdate: null, signal: null, highAccuracy: true, maximumAgeMs: 0 }, opts);
    return new Promise((resolve) => {
      if (!geolocation || o.signal && o.signal.aborted) return resolve(null);
      let best = null;
      let watchId = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (watchId != null) geolocation.clearWatch(watchId);
        clearTimeout(timer);
        resolve(best);
      };
      const timer = setTimeout(finish, o.timeoutMs);
      try {
        watchId = geolocation.watchPosition((pos) => {
          const fix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            at: pos.timestamp || Date.now()
          };
          const top = !best || fix.accuracy < best.accuracy ? fix : best;
          best = top;
          if (o.onUpdate) o.onUpdate(top);
          if (top.accuracy <= o.goodEnoughM) finish();
        }, (err) => {
          if (err && err.code === 1) finish();
        }, { enableHighAccuracy: o.highAccuracy, maximumAge: o.maximumAgeMs, timeout: o.timeoutMs });
      } catch (e) {
        finish();
      }
      if (o.signal) o.signal.addEventListener("abort", () => {
        best = null;
        finish();
      }, { once: true });
    });
  }
  const api = {
    FT_PER_M,
    WEAK_ACCURACY_M,
    NEAR_FACTOR,
    toFeet,
    toMeters,
    distanceM,
    fenceStatus,
    checkFix,
    needsPhoto,
    formatDistance,
    bestFix
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Geo = api;
})(typeof self !== "undefined" ? self : globalThis);

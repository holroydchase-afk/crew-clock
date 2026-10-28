// Location math and the geofence rule. Shared by the app and the tests;
// backend/Code.gs carries a copy of the same rule so the server can recheck.
(function (root) {
  const FT_PER_M = 3.28084;
  const WEAK_ACCURACY_M = 152; // ~500 ft: worse than this, the fix says little
  const NEAR_FACTOR = 3;

  function toFeet(m) { return m * FT_PER_M; }
  function toMeters(ft) { return ft / FT_PER_M; }

  // Great-circle distance in meters.
  function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // onsite | near | offsite | weak | nogps
  // The worker gets the benefit of the phone's own stated error.
  // A number the phone could have sent: finite and not negative. Anything else (null, NaN, text,
  // a negative accuracy) counts as no reading, so the worker gets a photo, never "off site".
  function num(v) {
    if (typeof v === 'string' && v.trim() !== '') v = Number(v);
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  function fenceStatus(distM, accuracyM, radiusM) {
    distM = num(distM);
    accuracyM = num(accuracyM);
    if (distM == null || accuracyM == null || accuracyM < 0) return 'nogps';
    if (accuracyM > WEAK_ACCURACY_M) return 'weak';
    const closest = distM - accuracyM;
    if (closest <= radiusM) return 'onsite';
    if (closest <= radiusM * NEAR_FACTOR) return 'near';
    return 'offsite';
  }

  // Status for a fix against a job ({lat,lng,radiusFt}).
  function checkFix(fix, job) {
    const lat = fix ? num(fix.lat) : null;
    const lng = fix ? num(fix.lng) : null;
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
        !job || num(job.lat) == null || num(job.lng) == null) {
      return { status: 'nogps', distanceFt: null };
    }
    const d = distanceM(lat, lng, Number(job.lat), Number(job.lng));
    return {
      status: fenceStatus(d, fix.accuracy, toMeters(job.radiusFt || 300)),
      distanceFt: Math.round(toFeet(d)),
    };
  }

  function needsPhoto(status) { return status === 'nogps' || status === 'weak'; }

  // Plain-words distance for crew screens: "200 ft", "1.4 mi".
  function formatDistance(ft) {
    if (ft == null) return '';
    if (ft < 1000) return Math.round(ft / 10) * 10 + ' ft';
    const mi = ft / 5280;
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi';
  }

  // Watch GPS for up to timeoutMs and resolve with the most accurate fix,
  // stopping early once it is good enough. Resolves null if nothing came back.
  // opts.signal (an AbortSignal) stops the watch at once and resolves null: a stopped reading is
  // never used. highAccuracy: false and maximumAgeMs are for a rough reading.
  function bestFix(geolocation, opts) {
    const o = Object.assign({ timeoutMs: 20000, goodEnoughM: 20, onUpdate: null, signal: null, highAccuracy: true, maximumAgeMs: 0 }, opts);
    return new Promise((resolve) => {
      if (!geolocation || (o.signal && o.signal.aborted)) return resolve(null);
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
            at: pos.timestamp || Date.now(),
          };
          if (!best || fix.accuracy < best.accuracy) best = fix;
          if (o.onUpdate) o.onUpdate(best);
          if (best.accuracy <= o.goodEnoughM) finish();
        }, (err) => {
          // Permission denied ends it now; other errors keep trying until timeout.
          if (err && err.code === 1) finish();
        }, { enableHighAccuracy: o.highAccuracy, maximumAge: o.maximumAgeMs, timeout: o.timeoutMs });
      } catch (e) {
        finish();
      }
      if (o.signal) o.signal.addEventListener('abort', () => { best = null; finish(); }, { once: true });
    });
  }

  const api = { FT_PER_M, WEAK_ACCURACY_M, NEAR_FACTOR, toFeet, toMeters, distanceM,
    fenceStatus, checkFix, needsPhoto, formatDistance, bestFix };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Geo = api;
})(typeof self !== 'undefined' ? self : this);

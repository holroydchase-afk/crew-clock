// Turns a list of punches into shifts (an "in" matched to the next "out").
// Used by the boss Today view and the demo backend; backend/Code.gs has a copy.
(function (root) {
  const SEVERITY = { onsite: 0, near: 1, weak: 2, nogps: 3, offsite: 4 };

  function worse(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (SEVERITY[b] || 0) > (SEVERITY[a] || 0) ? b : a;
  }

  // punches: [{id, crewId, jobId, type, at, status, voidsId}]
  // Returns [{crewId, jobId, inAt, outAt, hours, status, open, inId, outId}]
  // Voids the server refused (someone else's punch, or too old) don't count.
  function voidedIds(punches) {
    return new Set(punches.filter((p) => p.type === 'void' && p.status !== 'void_rejected').map((p) => p.voidsId));
  }

  function pairShifts(punches) {
    const voided = voidedIds(punches);
    const live = punches
      .filter((p) => (p.type === 'in' || p.type === 'out') && !voided.has(p.id))
      .sort((a, b) => a.at - b.at);
    const openByCrew = {};
    const shifts = [];
    for (const p of live) {
      const open = openByCrew[p.crewId];
      if (p.type === 'in') {
        if (open) open.missingOut = true; // clocked in again without clocking out
        const s = { crewId: p.crewId, jobId: p.jobId, inAt: p.at, outAt: null, hours: null,
          status: p.status, open: true, inId: p.id, outId: null, missingOut: false };
        shifts.push(s);
        openByCrew[p.crewId] = s;
      } else {
        if (open) {
          open.outAt = p.at;
          open.outId = p.id;
          open.open = false;
          open.hours = Math.round(((p.at - open.inAt) / 3600000) * 100) / 100;
          open.status = worse(open.status, p.status);
          delete openByCrew[p.crewId];
        } else {
          shifts.push({ crewId: p.crewId, jobId: p.jobId, inAt: null, outAt: p.at, hours: null,
            status: p.status, open: false, inId: null, outId: p.id, missingIn: true });
        }
      }
    }
    // An earlier shift left open by a newer clock-in is closed with no hours.
    for (const s of shifts) if (s.missingOut) s.open = false;
    return shifts;
  }

  // The most recent live punch per crew member, for the team map.
  function lastPunchByCrew(punches) {
    const voided = voidedIds(punches);
    const last = {};
    for (const p of punches) {
      if (p.type === 'void' || voided.has(p.id)) continue;
      if (!last[p.crewId] || p.at > last[p.crewId].at) last[p.crewId] = p;
    }
    return last;
  }

  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  const api = { SEVERITY, worse, pairShifts, lastPunchByCrew, startOfDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Report = api;
})(typeof self !== 'undefined' ? self : this);

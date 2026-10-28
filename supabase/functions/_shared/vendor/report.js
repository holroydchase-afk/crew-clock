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

  const DUPLICATE_OUT_MS = 12 * 3600000; // a second clock-out this soon after the first is a duplicate

  function pairShifts(punches) {
    const voided = voidedIds(punches);
    const live = punches
      .filter((p) => (p.type === 'in' || p.type === 'out') && !voided.has(p.id))
      .sort((a, b) => a.at - b.at);
    const openByCrew = {};
    const closedByCrew = {}; // the shift each crew member's last clock-out closed
    const shifts = [];
    for (const p of live) {
      const open = openByCrew[p.crewId];
      if (p.type === 'in') {
        if (open) open.missingOut = true; // clocked in again without clocking out
        delete closedByCrew[p.crewId];
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
          closedByCrew[p.crewId] = open;
        } else if (closedByCrew[p.crewId] && p.at - closedByCrew[p.crewId].outAt <= DUPLICATE_OUT_MS) {
          // Worker and foreman both clocked out the same shift (often offline). Hours come from the
          // first; the second is kept on the shift so the boss can see it.
          const c = closedByCrew[p.crewId];
          (c.duplicateOuts = c.duplicateOuts || []).push(p.id);
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

  // Shifts that belong on the Today list for the day starting at day0 (local midnight): any shift
  // with a clock-in or clock-out that day, plus one still open from last night. Pairs a day of
  // history before day0 so an overnight clock-in is not dropped.
  function shiftsForDay(punches, day0) {
    const day1 = day0 + 86400000;
    const near = punches.filter((p) => p.type === 'void' || (p.at >= day0 - 86400000 && p.at < day1));
    return pairShifts(near).filter((s) =>
      (s.inAt != null && s.inAt >= day0 && s.inAt < day1) ||
      (s.outAt != null && s.outAt >= day0 && s.outAt < day1) ||
      (s.open && s.inAt != null && s.inAt < day0));
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

  // ---------- weekly timesheet (M1.13 ENH-3) ----------
  const DAY = 86400000;

  // Monday 00:00 (local) of the week holding ms.
  function weekStart(ms) {
    const d = new Date(startOfDay(ms));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return startOfDay(d.getTime());
  }

  // The seven local midnights from Monday, safe across a clock change.
  function weekDays(ws) {
    const out = [];
    const d = new Date(ws);
    for (let i = 0; i < 7; i++) { out.push(startOfDay(d.getTime())); d.setDate(d.getDate() + 1); }
    return out;
  }

  // Shifts that started in the week, each with the index of the day it started.
  function weekShifts(punches, ws) {
    const days = weekDays(ws);
    const end = startOfDay(days[6] + DAY + 3600000);
    return pairShifts(punches).filter((s) => s.inAt != null && s.inAt >= ws && s.inAt < end)
      .map((s) => Object.assign({ dayIndex: days.filter((d) => d <= s.inAt).length - 1 }, s));
  }

  const round2 = (x) => Math.round(x * 100) / 100;

  // { days: [7 midnights], byCrew: { crewId: { days: [7 hours], total } } }. Open shifts add nothing.
  function weekTotals(punches, ws) {
    const byCrew = {};
    for (const s of weekShifts(punches, ws)) {
      if (s.hours == null) continue;
      const c = byCrew[s.crewId] = byCrew[s.crewId] || { days: [0, 0, 0, 0, 0, 0, 0], total: 0 };
      c.days[s.dayIndex] = round2(c.days[s.dayIndex] + s.hours);
      c.total = round2(c.total + s.hours);
    }
    return { days: weekDays(ws), byCrew };
  }

  // One spreadsheet cell. A cell a spreadsheet would run as a formula (= + - @, tab, return) gets a
  // leading ' so it stays text; commas, quotes and line breaks are quoted.
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const clock = (ms) => {
    if (ms == null) return '';
    const d = new Date(ms);
    const h = d.getHours();
    return `${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
  };

  // Name, date, in, out, hours: one row per shift that started in the week. Nothing else leaves
  // (no GPS, job pin, photo, risk or ids). names: { crewId: name }.
  function timesheetCsv(punches, names, ws) {
    const rows = weekShifts(punches, ws).map((s) => ({ name: (names && names[s.crewId]) || 'Unknown', s }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.s.inAt - b.s.inAt);
    const lines = [['Name', 'Date', 'In', 'Out', 'Hours']].concat(rows.map(({ name, s }) =>
      [name, ymd(s.inAt), clock(s.inAt), clock(s.outAt), s.hours == null ? '' : s.hours.toFixed(2)]));
    return lines.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  const api = { SEVERITY, worse, pairShifts, shiftsForDay, lastPunchByCrew, startOfDay, weekStart, weekDays, weekTotals, csvCell, timesheetCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Report = api;
})(typeof self !== 'undefined' ? self : this);

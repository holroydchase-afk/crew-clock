// Generated from js/report.ts by npm run build. Do not edit.
(function(root) {
  const SEVERITY = { onsite: 0, near: 1, weak: 2, nogps: 3, offsite: 4 };
  function worse(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (SEVERITY[b] || 0) > (SEVERITY[a] || 0) ? b : a;
  }
  function voidedIds(punches) {
    return new Set(punches.filter((p) => p.type === "void" && p.status !== "void_rejected").map((p) => p.voidsId));
  }
  const DUPLICATE_OUT_MS = 12 * 36e5;
  function pairShifts(punches) {
    const voided = voidedIds(punches);
    const live = punches.filter((p) => (p.type === "in" || p.type === "out") && !voided.has(p.id)).sort((a, b) => a.at - b.at);
    const openByCrew = {};
    const closedByCrew = {};
    const shifts = [];
    for (const p of live) {
      const open = openByCrew[p.crewId];
      if (p.type === "in") {
        if (open) open.missingOut = true;
        delete closedByCrew[p.crewId];
        const s = {
          crewId: p.crewId,
          jobId: p.jobId,
          inAt: p.at,
          outAt: null,
          hours: null,
          status: p.status,
          open: true,
          inId: p.id,
          outId: null,
          missingOut: false
        };
        shifts.push(s);
        openByCrew[p.crewId] = s;
      } else {
        if (open) {
          open.outAt = p.at;
          open.outId = p.id;
          open.open = false;
          open.hours = Math.round((p.at - Number(open.inAt)) / 36e5 * 100) / 100;
          open.status = worse(open.status, p.status);
          delete openByCrew[p.crewId];
          closedByCrew[p.crewId] = open;
        } else if (closedByCrew[p.crewId] && p.at - Number(closedByCrew[p.crewId].outAt) <= DUPLICATE_OUT_MS) {
          const c = closedByCrew[p.crewId];
          (c.duplicateOuts = c.duplicateOuts || []).push(p.id);
        } else {
          shifts.push({
            crewId: p.crewId,
            jobId: p.jobId,
            inAt: null,
            outAt: p.at,
            hours: null,
            status: p.status,
            open: false,
            inId: null,
            outId: p.id,
            missingIn: true
          });
        }
      }
    }
    for (const s of shifts) if (s.missingOut) s.open = false;
    return shifts;
  }
  function shiftsForDay(punches, day0) {
    const day1 = day0 + 864e5;
    const near = punches.filter((p) => p.type === "void" || p.at >= day0 - 864e5 && p.at < day1);
    return pairShifts(near).filter((s) => s.inAt != null && s.inAt >= day0 && s.inAt < day1 || s.outAt != null && s.outAt >= day0 && s.outAt < day1 || s.open && s.inAt != null && s.inAt < day0);
  }
  function lastPunchByCrew(punches) {
    const voided = voidedIds(punches);
    const last = {};
    for (const p of punches) {
      if (p.type === "void" || voided.has(p.id)) continue;
      if (!last[p.crewId] || p.at > last[p.crewId].at) last[p.crewId] = p;
    }
    return last;
  }
  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const DAY = 864e5;
  function weekStart(ms) {
    const d = new Date(startOfDay(ms));
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return startOfDay(d.getTime());
  }
  function weekDays(ws) {
    const out = [];
    const d = new Date(ws);
    for (let i = 0; i < 7; i++) {
      out.push(startOfDay(d.getTime()));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  function weekShifts(punches, ws) {
    const days = weekDays(ws);
    const end = startOfDay(days[6] + DAY + 36e5);
    return pairShifts(punches).filter((s) => s.inAt != null && s.inAt >= ws && s.inAt < end).map((s) => Object.assign({ dayIndex: days.filter((d) => d <= Number(s.inAt)).length - 1 }, s));
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  function weekTotals(punches, ws, opts) {
    const now = opts && opts.now;
    const byCrew = {};
    for (const s of weekShifts(punches, ws)) {
      const running = s.hours == null && now != null && s.open && now > Number(s.inAt);
      if (s.hours == null && !running) continue;
      const h = running ? Math.round((Number(now) - Number(s.inAt)) / 36e4) / 10 : Number(s.hours);
      const c = byCrew[s.crewId] = byCrew[s.crewId] || { days: [0, 0, 0, 0, 0, 0, 0], total: 0, open: [false, false, false, false, false, false, false] };
      c.days[s.dayIndex] = round2(c.days[s.dayIndex] + h);
      c.total = round2(c.total + h);
      if (running) c.open[s.dayIndex] = true;
    }
    return { days: weekDays(ws), byCrew };
  }
  const GPS_DAYS = 8;
  function dropOldGps(punches, now) {
    const cut = (now == null ? Date.now() : now) - GPS_DAYS * DAY;
    return (punches || []).map((p) => {
      if (!(p.at < cut)) return p;
      const out = Object.assign({}, p);
      ["lat", "lng", "accuracy", "address", "distanceFt"].forEach((k) => {
        if (k in out) out[k] = null;
      });
      return out;
    });
  }
  function csvCell(v) {
    let s = String(v == null ? "" : v);
    if (/^[\t\r]|^ *[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function fmtHours(h) {
    return (Math.round((h || 0) * 10) / 10).toFixed(1);
  }
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const clock = (ms) => {
    if (ms == null) return "";
    const d = new Date(ms);
    const h = d.getHours();
    return `${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
  };
  function timesheetCsv(punches, names, ws) {
    const rows = weekShifts(punches, ws).map((s) => ({ name: names && names[s.crewId] || "Unknown", s })).sort((a, b) => a.name.localeCompare(b.name) || Number(a.s.inAt) - Number(b.s.inAt));
    const lines = [["Name", "Date", "In", "Out", "Hours"]].concat(rows.map(({ name, s }) => [name, ymd(s.inAt), clock(s.inAt), clock(s.outAt), s.hours == null ? "" : s.hours.toFixed(2)]));
    return lines.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  const api = { SEVERITY, worse, pairShifts, shiftsForDay, lastPunchByCrew, startOfDay, weekStart, weekDays, weekTotals, dropOldGps, csvCell, timesheetCsv, fmtHours };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Report = api;
})(typeof self !== "undefined" ? self : globalThis);

/**
 * Crew Clock backend: a Google Apps Script web app bound to a Google Sheet.
 * The Sheet is the database and the report. See SETUP.md for install steps.
 *
 * Tabs: Jobs, Crew, Punches, Daily, Weekly (created by setup()).
 */

const TABS = {
  Jobs: ['id', 'name', 'address', 'lat', 'lng', 'radius_ft', 'active', 'created'],
  Crew: ['id', 'name', 'pin', 'role', 'active'],
  Punches: ['id', 'crew_id', 'crew_name', 'job_id', 'job_name', 'type', 'phone_time', 'server_time',
    'lat', 'lng', 'accuracy_m', 'distance_ft', 'status', 'photo', 'where_they_were', 'by_crew_id', 'voids_id', 'map'],
  Daily: ['date', 'crew', 'job', 'clock_in', 'clock_out', 'hours', 'status', 'note'],
  Weekly: ['week_of', 'crew', 'job', 'hours', 'shifts', 'flagged_shifts'],
};
const STATUS_WORDS = { onsite: 'On site', near: 'Near', offsite: 'Off site', weak: 'Weak GPS', nogps: 'No GPS', voided: 'Fixed (wrong job)' };
const SEVERITY = { onsite: 0, near: 1, weak: 2, nogps: 3, offsite: 4 };
const WV_BOUNDS = [37.2, -82.7, 40.7, -77.7]; // biases address search to West Virginia
const RECENT_ROWS = 3000;

// ---------- setup ----------

/** Run once from the Apps Script editor. Creates tabs, the photo folder and the report triggers. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(TABS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, TABS[name].length).setFontWeight('bold');
    }
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());
  if (!props.getProperty('PHOTO_FOLDER')) {
    props.setProperty('PHOTO_FOLDER', DriveApp.createFolder('Crew Clock photos').getId());
  }
  const crew = ss.getSheetByName('Crew');
  if (crew.getLastRow() === 1) crew.appendRow(['boss', 'Boss', '1234', 'boss', true]);

  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('morningCheck').timeBased().everyDays(1).atHour(8).nearMinute(30).create();
  ScriptApp.newTrigger('dailyReport').timeBased().everyDays(1).atHour(19).create();
  ScriptApp.newTrigger('weeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(21).create();
  const extra = ss.getSheetByName('Sheet1');
  if (extra && extra.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(extra);
  Logger.log('Setup done. Change the Boss PIN in the Crew tab, then Deploy > New deployment > Web app.');
}

// ---------- web app ----------

function doGet() {
  return json({ ok: true, app: 'Crew Clock', time: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'Bad request' });
  }
  try {
    const fn = ACTIONS[req.action];
    if (!fn) throw new Error('Unknown action');
    return json(Object.assign({ ok: true }, fn(req)));
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const ACTIONS = {
  listCrew() {
    return { crew: readTab('Crew').filter(isActive).map(publicCrew) };
  },

  login(req) {
    return ACTIONS.refresh(req);
  },

  refresh(req) {
    const me = authed(req.auth);
    const punches = recentPunches();
    const last = lastPunchByCrew(punches)[me.id] || null;
    return {
      me: publicCrew(me),
      jobs: readTab('Jobs').filter(isActive).map(jobOut),
      crew: me.role === 'crew' ? [] : readTab('Crew').filter(isActive).map(publicCrew),
      last: last,
    };
  },

  sync(req) {
    const me = authed(req.auth);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const accepted = [];
      const rejected = [];
      const ss = SpreadsheetApp.getActive();
      const jobs = readTab('Jobs');
      const crew = readTab('Crew');
      const punchSheet = ss.getSheetByName('Punches');
      const seen = existingPunchIds(punchSheet);
      (req.items || []).forEach((item) => {
        if (item.kind === 'punch') {
          if (item.crewId !== me.id && me.role === 'crew') return rejected.push(item.id);
          if (!seen[item.id]) {
            writePunch(punchSheet, item, me, jobs, crew);
            seen[item.id] = true;
          }
          accepted.push(item.id);
        } else if (item.kind === 'job' && me.role === 'boss') {
          upsertJob(item.data);
          accepted.push(item.id);
        } else if (item.kind === 'crew' && me.role === 'boss') {
          upsertCrew(item.data);
          accepted.push(item.id);
        } else {
          rejected.push(item.id);
        }
      });
      return { accepted: accepted, rejected: rejected };
    } finally {
      lock.releaseLock();
    }
  },

  team(req) {
    const me = authed(req.auth);
    if (me.role === 'crew') throw new Error('Boss only');
    const since = req.since || Date.now() - 8 * 86400000;
    return {
      punches: recentPunches().filter((p) => p.at >= since),
      crew: readTab('Crew').map(publicCrew),
      jobs: readTab('Jobs').map(jobOut),
    };
  },

  photo(req) {
    const me = authed(req.auth);
    if (me.role === 'crew') throw new Error('Boss only');
    const p = recentPunches().find((x) => x.id === req.punchId);
    if (!p || !p.photoUrl) return { dataUrl: null };
    const id = (p.photoUrl.match(/[-\w]{25,}/) || [])[0];
    const blob = DriveApp.getFileById(id).getBlob();
    return { dataUrl: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()) };
  },

  geocode(req) {
    const me = authed(req.auth);
    if (me.role !== 'boss') throw new Error('Boss only');
    const res = Maps.newGeocoder().setRegion('us')
      .setBounds(WV_BOUNDS[0], WV_BOUNDS[1], WV_BOUNDS[2], WV_BOUNDS[3])
      .geocode(String(req.address || ''));
    return {
      results: (res.results || []).slice(0, 5).map((r) => ({
        label: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng,
      })),
    };
  },

  sendReport(req) {
    const me = authed(req.auth);
    if (me.role !== 'boss') throw new Error('Boss only');
    dailyReport();
    return { sent: true };
  },
};

// ---------- auth ----------

function authed(auth) {
  if (!auth || !auth.crewId) throw new Error('Wrong PIN');
  const sh = SpreadsheetApp.getActive().getSheetByName('Crew');
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) !== String(auth.crewId)) continue;
    if (r[4] === false || String(r[4]).toUpperCase() === 'FALSE') break;
    const stored = String(r[2]);
    const pin = String(auth.pin || '');
    const ok = stored.indexOf('h:') === 0 ? stored === hashPin(pin) : stored === pin;
    if (!ok) break;
    // A PIN typed into the Sheet by hand is hidden the first time it is used.
    if (stored.indexOf('h:') !== 0) sh.getRange(i + 1, 3).setValue(hashPin(pin));
    return { id: String(r[0]), name: String(r[1]), role: String(r[3] || 'crew') };
  }
  Utilities.sleep(800); // slows down PIN guessing
  throw new Error('Wrong PIN');
}

function hashPin(pin) {
  const salt = PropertiesService.getScriptProperties().getProperty('SALT') || '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin);
  return 'h:' + Utilities.base64EncodeWebSafe(bytes).slice(0, 32);
}

// ---------- data ----------

function readTab(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const rows = sh.getDataRange().getValues();
  const head = rows.shift();
  return rows.filter((r) => r[0] !== '').map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
}

function isActive(r) { return !(r.active === false || String(r.active).toUpperCase() === 'FALSE'); }
function publicCrew(c) { return { id: String(c.id), name: String(c.name), role: String(c.role || 'crew'), active: isActive(c) }; }
function jobOut(j) {
  return { id: String(j.id), name: String(j.name), address: String(j.address || ''), lat: num(j.lat), lng: num(j.lng),
    radiusFt: num(j.radius_ft) || 300, active: isActive(j) };
}
function num(v) { return v === '' || v == null ? null : Number(v); }
function ms(v) { return v instanceof Date ? v.getTime() : v ? new Date(v).getTime() : null; }

function upsertJob(j) {
  upsertRow('Jobs', String(j.id), [String(j.id), j.name, j.address || '', j.lat, j.lng, j.radiusFt || 300,
    j.active !== false, new Date()], [8]);
}

function upsertCrew(c) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Crew');
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((r) => String(r[0]));
  const i = ids.indexOf(String(c.id));
  const pin = c.pin ? hashPin(String(c.pin)) : null;
  if (i < 0) {
    sh.appendRow([String(c.id), c.name, pin || '', c.role || 'crew', c.active !== false]);
  } else {
    sh.getRange(i + 1, 2).setValue(c.name);
    if (pin) sh.getRange(i + 1, 3).setValue(pin);
    sh.getRange(i + 1, 4, 1, 2).setValues([[c.role || 'crew', c.active !== false]]);
  }
}

// keepCols: 1-based columns not overwritten on update (e.g. created date).
function upsertRow(tab, id, values, keepCols) {
  const sh = SpreadsheetApp.getActive().getSheetByName(tab);
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((r) => String(r[0]));
  const i = ids.indexOf(id);
  if (i < 0) return sh.appendRow(values);
  const current = sh.getRange(i + 1, 1, 1, values.length).getValues()[0];
  (keepCols || []).forEach((c) => { values[c - 1] = current[c - 1]; });
  sh.getRange(i + 1, 1, 1, values.length).setValues([values]);
}

function existingPunchIds(sh) {
  const last = sh.getLastRow();
  const seen = {};
  if (last < 2) return seen;
  const start = Math.max(2, last - RECENT_ROWS);
  sh.getRange(start, 1, last - start + 1, 1).getValues().forEach((r) => { seen[String(r[0])] = true; });
  return seen;
}

function writePunch(sh, item, me, jobs, crew) {
  const job = jobs.find((j) => String(j.id) === String(item.jobId));
  const person = crew.find((c) => String(c.id) === String(item.crewId));
  if (item.type === 'void') {
    markVoided(sh, item.voidsId);
    sh.appendRow([item.id, item.crewId, person ? person.name : '', '', '', 'void', new Date(item.at), new Date(),
      '', '', '', '', 'voided', '', '', me.id, item.voidsId, '']);
    return;
  }
  const hasFix = item.lat != null && item.lng != null && item.accuracy != null;
  const check = checkFix(hasFix ? { lat: item.lat, lng: item.lng, accuracy: item.accuracy } : null, job ? jobOut(job) : null);
  let photoUrl = '';
  if (item.photo) photoUrl = savePhoto(item, person, job);
  let where = '';
  if (hasFix && check.status !== 'onsite') where = reverseGeocode(item.lat, item.lng);
  sh.appendRow([
    item.id, item.crewId, person ? person.name : '', item.jobId, job ? job.name : '', item.type,
    new Date(item.at), new Date(),
    hasFix ? item.lat : '', hasFix ? item.lng : '', hasFix ? item.accuracy : '',
    check.distanceFt == null ? '' : check.distanceFt, check.status, photoUrl, where, me.id, '',
    hasFix ? 'https://www.google.com/maps?q=' + item.lat + ',' + item.lng : '',
  ]);
}

function markVoided(sh, punchId) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const start = Math.max(2, last - RECENT_ROWS);
  const ids = sh.getRange(start, 1, last - start + 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(punchId)) {
      sh.getRange(start + i, 13).setValue('voided');
      return;
    }
  }
}

function savePhoto(item, person, job) {
  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER'));
  const day = Utilities.formatDate(new Date(item.at), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const dayFolders = folder.getFoldersByName(day);
  const dayFolder = dayFolders.hasNext() ? dayFolders.next() : folder.createFolder(day);
  const b64 = String(item.photo).replace(/^data:image\/\w+;base64,/, '');
  const name = [day, person ? person.name : item.crewId, job ? job.name : '', item.type, item.id.slice(0, 8)].join(' ') + '.jpg';
  const file = dayFolder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name));
  return file.getUrl();
}

function reverseGeocode(lat, lng) {
  try {
    const r = Maps.newGeocoder().reverseGeocode(lat, lng);
    return r.results && r.results[0] ? r.results[0].formatted_address : '';
  } catch (e) {
    return '';
  }
}

function recentPunches() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Punches');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - RECENT_ROWS);
  const rows = sh.getRange(start, 1, last - start + 1, TABS.Punches.length).getValues();
  return rows.filter((r) => r[0] !== '').map((r) => ({
    id: String(r[0]), crewId: String(r[1]), jobId: String(r[3]), type: String(r[5]),
    at: ms(r[6]), receivedAt: ms(r[7]), lat: num(r[8]), lng: num(r[9]), accuracy: num(r[10]),
    distanceFt: num(r[11]), status: String(r[12]), hasPhoto: !!r[13], photoUrl: String(r[13] || ''),
    address: String(r[14] || ''), voidsId: r[16] ? String(r[16]) : null,
  })).map((p) => { if (p.status === 'voided' && p.type !== 'void') p.voided = true; return p; });
}

// ---------- geofence (same rule as js/geo.js) ----------

function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.pow(Math.sin(dLat / 2), 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function checkFix(fix, job) {
  if (!fix || !job || job.lat == null) return { status: 'nogps', distanceFt: null };
  const d = distanceM(fix.lat, fix.lng, job.lat, job.lng);
  const radiusM = (job.radiusFt || 300) / 3.28084;
  let status;
  if (fix.accuracy > 152) status = 'weak';
  else if (d - fix.accuracy <= radiusM) status = 'onsite';
  else if (d - fix.accuracy <= radiusM * 3) status = 'near';
  else status = 'offsite';
  return { status: status, distanceFt: Math.round(d * 3.28084) };
}

// ---------- shifts (same logic as js/report.js) ----------

function pairShifts(punches) {
  const voided = {};
  punches.forEach((p) => { if (p.type === 'void') voided[p.voidsId] = true; });
  const live = punches.filter((p) => (p.type === 'in' || p.type === 'out') && !voided[p.id] && !p.voided)
    .sort((a, b) => a.at - b.at);
  const open = {};
  const shifts = [];
  live.forEach((p) => {
    const o = open[p.crewId];
    if (p.type === 'in') {
      if (o) o.missingOut = true;
      const s = { crewId: p.crewId, jobId: p.jobId, inAt: p.at, outAt: null, hours: null, status: p.status, open: true };
      shifts.push(s);
      open[p.crewId] = s;
    } else if (o) {
      o.outAt = p.at;
      o.open = false;
      o.hours = Math.round(((p.at - o.inAt) / 3600000) * 100) / 100;
      if ((SEVERITY[p.status] || 0) > (SEVERITY[o.status] || 0)) o.status = p.status;
      delete open[p.crewId];
    } else {
      shifts.push({ crewId: p.crewId, jobId: p.jobId, inAt: null, outAt: p.at, hours: null, status: p.status, missingIn: true });
    }
  });
  shifts.forEach((s) => { if (s.missingOut) s.open = false; });
  return shifts;
}

function lastPunchByCrew(punches) {
  const voided = {};
  punches.forEach((p) => { if (p.type === 'void') voided[p.voidsId] = true; });
  const last = {};
  punches.forEach((p) => {
    if (p.type === 'void' || voided[p.id] || p.voided) return;
    if (!last[p.crewId] || p.at > last[p.crewId].at) last[p.crewId] = p;
  });
  return last;
}

// ---------- reports ----------

function dayBounds(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return [d.getTime(), d.getTime() + 86400000];
}

function namesById(tab) {
  const m = {};
  readTab(tab).forEach((r) => { m[String(r.id)] = String(r.name); });
  return m;
}

function fmtTime(t) { return t ? Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), 'h:mm a') : ''; }

/** Builds the Daily tab for a day (default today) and emails the summary. Runs at 7 PM. */
function dailyReport(date) {
  const tz = Session.getScriptTimeZone();
  const b = dayBounds(date || new Date());
  const dayStr = Utilities.formatDate(new Date(b[0]), tz, 'yyyy-MM-dd');
  const punches = recentPunches();
  const shifts = pairShifts(punches.filter((p) => p.at >= b[0] && p.at < b[1]));
  const crewNames = namesById('Crew');
  const jobNames = namesById('Jobs');

  const sh = SpreadsheetApp.getActive().getSheetByName('Daily');
  const values = sh.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    const v = values[i][0];
    const vs = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v);
    if (vs === dayStr) sh.deleteRow(i + 1);
  }
  const rows = shifts.map((s) => [dayStr, crewNames[s.crewId] || s.crewId, jobNames[s.jobId] || s.jobId,
    fmtTime(s.inAt), fmtTime(s.outAt), s.hours == null ? '' : s.hours, STATUS_WORDS[s.status] || s.status,
    s.open ? 'Still on the clock' : s.missingOut ? 'No clock-out' : s.missingIn ? 'No clock-in' : '']);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  const crew = readTab('Crew').filter((c) => isActive(c) && c.role !== 'boss');
  const inIds = {};
  shifts.forEach((s) => { inIds[s.crewId] = true; });
  const flagged = shifts.filter((s) => s.status !== 'onsite' || s.open || s.missingOut);
  const lines = [
    Utilities.formatDate(new Date(b[0]), tz, 'EEEE, MMM d') + ': ' + Object.keys(inIds).length + ' of ' + crew.length + ' clocked in.',
    shifts.filter((s) => s.status === 'onsite').length + ' shifts fully on site.',
  ];
  if (flagged.length) {
    lines.push('', 'Check these:');
    flagged.forEach((s) => lines.push('- ' + (crewNames[s.crewId] || '') + ', ' + (jobNames[s.jobId] || '') + ': ' +
      (s.open ? 'still on the clock' : s.missingOut ? 'no clock-out' : STATUS_WORDS[s.status])));
  }
  const missing = crew.filter((c) => !inIds[String(c.id)]).map((c) => c.name);
  if (missing.length) lines.push('', 'Did not clock in: ' + missing.join(', '));
  lines.push('', 'Sheet: ' + SpreadsheetApp.getActive().getUrl());
  sendEmail('Crew Clock: ' + dayStr, lines.join('\n'));
}

/** 8:30 AM: who has not clocked in yet. Skips the email when everyone is in. */
function morningCheck() {
  const b = dayBounds(new Date());
  const inIds = {};
  recentPunches().forEach((p) => { if (p.at >= b[0] && p.type === 'in') inIds[p.crewId] = true; });
  const missing = readTab('Crew').filter((c) => isActive(c) && c.role !== 'boss' && !inIds[String(c.id)]);
  if (!missing.length) return;
  sendEmail('Crew Clock: not in yet (' + missing.length + ')',
    'Not clocked in as of ' + fmtTime(Date.now()) + ':\n' + missing.map((c) => '- ' + c.name).join('\n') +
    '\n\nSome may be on the way or out of signal; their clock-ins send when they get it.');
}

/** Sunday 9 PM: hours per person per job for Monday to Sunday. */
function weeklyReport() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const end = dayBounds(now)[1];
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const start = end - (dow + 1) * 86400000;
  const shifts = pairShifts(recentPunches().filter((p) => p.at >= start && p.at < end));
  const crewNames = namesById('Crew');
  const jobNames = namesById('Jobs');
  const weekOf = Utilities.formatDate(new Date(start), tz, 'yyyy-MM-dd');
  const agg = {};
  shifts.forEach((s) => {
    const k = s.crewId + '|' + s.jobId;
    agg[k] = agg[k] || { crewId: s.crewId, jobId: s.jobId, hours: 0, shifts: 0, flagged: 0 };
    agg[k].hours += s.hours || 0;
    agg[k].shifts += 1;
    if (s.status !== 'onsite' || s.hours == null) agg[k].flagged += 1;
  });
  const rows = Object.keys(agg).map((k) => agg[k])
    .sort((a, b) => String(crewNames[a.crewId]).localeCompare(String(crewNames[b.crewId])))
    .map((a) => [weekOf, crewNames[a.crewId] || a.crewId, jobNames[a.jobId] || a.jobId,
      Math.round(a.hours * 100) / 100, a.shifts, a.flagged]);
  const sh = SpreadsheetApp.getActive().getSheetByName('Weekly');
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  const perPerson = {};
  rows.forEach((r) => { perPerson[r[1]] = (perPerson[r[1]] || 0) + r[3]; });
  const body = ['Week of ' + weekOf + ', hours per person:']
    .concat(Object.keys(perPerson).map((n) => '- ' + n + ': ' + perPerson[n].toFixed(1) + ' h'))
    .concat(['', 'Per job detail is in the Weekly tab: ' + SpreadsheetApp.getActive().getUrl()]);
  sendEmail('Crew Clock: week of ' + weekOf, body.join('\n'));
}

function sendEmail(subject, body) {
  const to = PropertiesService.getScriptProperties().getProperty('REPORT_EMAIL') || Session.getEffectiveUser().getEmail();
  if (to) MailApp.sendEmail(to, subject, body);
}

/**
 * Crew Clock v2: Google Sheets reports.
 * Paste into Extensions > Apps Script of an empty Google Sheet, set the three
 * Script Properties below, run setupReports() once. The Sheet then refreshes
 * itself every evening and each Sunday, and has a Crew Clock menu to refresh now.
 *
 * Script Properties (Project Settings > Script Properties):
 *   SUPABASE_URL   https://YOUR-PROJECT.supabase.co
 *   REPORT_TOKEN   same value as the REPORT_TOKEN Edge Function secret
 *   ORG_CODE       the company code, e.g. TEAYS
 */

const DAILY_HEAD = ['date', 'crew', 'job', 'clock_in', 'clock_out', 'hours', 'status', 'note'];
const WEEKLY_HEAD = ['week_of', 'crew', 'job', 'hours', 'shifts', 'flagged_shifts'];
const STATUS_WORDS = { onsite: 'On site', near: 'Near', offsite: 'Off site', weak: 'Weak GPS', nogps: 'No GPS' };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Crew Clock')
    .addItem('Refresh today', 'exportToday')
    .addItem('Refresh this week', 'exportWeek')
    .addToUi();
}

function setupReports() {
  const ss = SpreadsheetApp.getActive();
  [['Daily', DAILY_HEAD], ['Weekly', WEEKLY_HEAD]].forEach(([name, head]) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(head);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
    }
  });
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('exportToday').timeBased().everyDays(1).atHour(19).nearMinute(15).create();
  ScriptApp.newTrigger('exportWeek').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(21).create();
  exportToday();
}

function fetchShifts(from, to) {
  const p = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(p.getProperty('SUPABASE_URL') + '/functions/v1/report-export', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-report-token': p.getProperty('REPORT_TOKEN') },
    payload: JSON.stringify({ orgCode: p.getProperty('ORG_CODE'), from: from.toISOString(), to: to.toISOString() }),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (!body.ok) throw new Error('Report export failed: ' + body.error);
  return body.shifts;
}

function dayStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmt(t, pattern) {
  return t ? Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), pattern) : '';
}

/** Rewrites today's rows in the Daily tab. */
function exportToday(date) {
  const from = dayStart(date && date.getTime ? date : new Date());
  const to = new Date(from.getTime() + 86400000);
  const day = fmt(from, 'yyyy-MM-dd');
  const rows = fetchShifts(from, to).map((s) => [day, s.crew_name, s.job_name || '', fmt(s.clock_in, 'h:mm a'),
    fmt(s.clock_out, 'h:mm a'), s.hours == null ? '' : Number(s.hours), STATUS_WORDS[s.status] || s.status || '', s.note || '']);
  replaceRows('Daily', day, rows);
}

/** Hours per person per job for Monday to Sunday of this week. */
function exportWeek() {
  const today = dayStart(new Date());
  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * 86400000);
  const sunday = new Date(monday.getTime() + 7 * 86400000);
  const weekOf = fmt(monday, 'yyyy-MM-dd');
  const agg = {};
  fetchShifts(monday, sunday).forEach((s) => {
    const k = s.crew_name + '|' + (s.job_name || '');
    agg[k] = agg[k] || [weekOf, s.crew_name, s.job_name || '', 0, 0, 0];
    agg[k][3] += Number(s.hours || 0);
    agg[k][4] += 1;
    if (s.status !== 'onsite' || s.note) agg[k][5] += 1;
  });
  const rows = Object.keys(agg).sort().map((k) => { agg[k][3] = Math.round(agg[k][3] * 100) / 100; return agg[k]; });
  replaceRows('Weekly', weekOf, rows);
}

// Deletes rows whose first column is `key`, then appends the new ones, so reruns don't duplicate.
function replaceRows(tab, key, rows) {
  const sh = SpreadsheetApp.getActive().getSheetByName(tab);
  const values = sh.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    const v = values[i][0];
    const vs = v instanceof Date ? fmt(v, 'yyyy-MM-dd') : String(v);
    if (vs === key) sh.deleteRow(i + 1);
  }
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

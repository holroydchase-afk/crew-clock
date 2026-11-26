// PS-SHELF-1 / PS-SHELF-2 (Chase, 2026-11-23): the Google Sheet nightly export is shelved.
// docs/PRIVACY.md must not read as if the export were live, and must say to leave REPORT_TOKEN unset.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const privacy = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'PRIVACY.md'), 'utf8');

test('PS-SHELF-1 every PRIVACY.md line about the Google Sheet export says it is shelved', () => {
  // The old demo-only "Google Sheets backend" (S5) is a different thing and is not part of this rule.
  const live = privacy.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /Google Sheet(?!s backend)|\bthe Sheet\b/i.test(line) && !/shelved/i.test(line));
  assert.deepStrictEqual(live.map(({ n, line }) => `${n}: ${line.trim()}`), [],
    'lines describing the Sheet export as live');
});

test('PS-SHELF-2 PRIVACY.md says not to set REPORT_TOKEN while the export is shelved', () => {
  const lines = privacy.split('\n').filter((l) => /REPORT_TOKEN/.test(l));
  assert.ok(lines.length, 'PRIVACY.md never mentions REPORT_TOKEN');
  assert.ok(lines.some((l) => /(do not|don't|never|leave)[^\n]*REPORT_TOKEN|REPORT_TOKEN[^\n]*(unset|not set)/i.test(l) && /shelved/i.test(l)),
    'a REPORT_TOKEN line says not to set it while shelved');
});

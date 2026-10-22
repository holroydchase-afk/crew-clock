const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
test('Edge Function copies of shared modules match js/', () => {
  for (const f of ['geo', 'report', 'chain', 'risk']) {
    const a = fs.readFileSync(path.join(__dirname, '../js', f + '.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../supabase/functions/_shared/vendor', f + '.js'), 'utf8');
    assert.strictEqual(a, b, `${f}.js is out of date: run scripts/sync-shared.sh`);
  }
});

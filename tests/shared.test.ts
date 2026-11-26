import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
test('Edge Function copies of shared modules match js/', () => {
  for (const f of ['geo', 'report', 'chain', 'risk']) {
    const a = fs.readFileSync(path.join(import.meta.dirname, '../js', f + '.js'), 'utf8');
    const b = fs.readFileSync(path.join(import.meta.dirname, '../supabase/functions/_shared/vendor', f + '.js'), 'utf8');
    assert.strictEqual(a, b, `${f}.js is out of date: run scripts/sync-shared.sh`);
  }
});

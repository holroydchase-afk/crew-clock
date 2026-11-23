// M2.0 Supabase pre-connect grants (intake #35, docs/product/SPEC-SUPABASE-GRANTS.md): the checks that
// run tests/sql/run.sh against Postgres (GRANT-1 red without the revoke, GRANT-9 green with it).
// Outside the tests/*.test.js glob on purpose: npm test runs where there is no Postgres. Run by
// `npm run test:sql` after run.sh (local Postgres as root via `su postgres`, or PGHOST/PGUSER/PGPASSWORD
// when set, as in CI's SQL step). The static runner and layout checks are in tests/grants.test.js.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** @param {string} p */
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
/** @param {string} p */
const exists = (p) => fs.existsSync(path.join(root, p));
const REVOKE = '20261123000000_revoke_defaults.sql';
const MIGRATIONS = 'supabase/migrations';

/** @param {string[]} args */
function runSql(args) {
  const r = spawnSync('sh', ['tests/sql/run.sh', ...args], { cwd: root, encoding: 'utf8', timeout: 240000 });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

test('GRANT-1 without the revoke migration the SQL run fails naming anon and punches', () => {
  assert.ok(exists(`${MIGRATIONS}/${REVOKE}`), `${REVOKE} exists (otherwise --skip proves nothing)`);
  const r = runSql(['--skip', REVOKE]);
  assert.notStrictEqual(r.status, 0, `run.sh --skip ${REVOKE} must exit non-zero\n${r.out.slice(-2000)}`);
  const errors = r.out.split('\n').filter((l) => /ERROR/.test(l));
  assert.ok(errors.some((l) => /\banon\b/.test(l) && /\bpunches\b/.test(l)),
    `an ERROR line names anon and punches; got:\n${errors.join('\n') || '(no ERROR line)'}`);
});

test('GRANT-9 run.sh with every migration exits 0 with the 63 old OK notices plus the grants ones', () => {
  const grantsOk = (read('tests/sql/70_grants_test.sql').match(/raise notice 'OK /g) || []).length;
  assert.ok(grantsOk >= 13, `70_grants_test.sql has its OK notices (${grantsOk})`);
  const r = runSql([]);
  assert.strictEqual(r.status, 0, `run.sh exits 0\n${r.out.split('\n').filter((l) => /ERROR/.test(l)).join('\n')}`);
  const ok = (r.out.match(/NOTICE:\s+OK /g) || []).length;
  assert.ok(ok >= 63 + grantsOk, `OK notices ${ok} >= ${63 + grantsOk}`);
  for (const id of ['GRANT-2', 'GRANT-3', 'GRANT-4', 'GRANT-5', 'GRANT-6', 'GRANT-7', 'GRANT-8']) {
    assert.match(r.out, new RegExp(`OK ${id} `), `${id} ran`);
  }
});


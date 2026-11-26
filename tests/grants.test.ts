// M2.0 Supabase pre-connect grants (intake #35, docs/product/SPEC-SUPABASE-GRANTS.md): the runner,
// CI and file-layout criteria (GRANT-1, GRANT-9 to GRANT-13). The grant checks themselves live in
// tests/sql/70_grants_test.sql. Nothing here needs Postgres (npm test runs where there is none):
// the GRANT-1 and GRANT-9 runs of run.sh live in tests/sql/runner.test.mjs, run by npm run test:sql.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));
const REVOKE = '20261123000000_revoke_defaults.sql';
const MIGRATIONS = 'supabase/migrations';

/** Lines of run.sh --list, as basenames. --list only prints file names: PGHOST points nowhere, so a --list that reached psql would fail here, as it would on a runner with no Postgres. */
function listRun(extra: string[] = []) {
  const res = spawnSync('sh', ['tests/sql/run.sh', '--list', ...extra], {
    cwd: root, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PGHOST: '/nonexistent/no-postgres-for-list', PGPORT: '1' },
  });
  const r = { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
  assert.strictEqual(r.status, 0, `run.sh --list exits 0\n${r.out}`);
  return r.out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => path.basename(l));
}

/** Every file in the repo (tracked and untracked, ignored ones left out). */
function repoFiles() {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.split('\n').filter((f) => f && exists(f) && fs.statSync(path.join(root, f)).isFile());
}

test('GRANT-1 the stub grants like hosted Supabase: default privileges open tables, sequences and functions', () => {
  const stub = read('tests/sql/supabase_stub.sql').replace(/\s+/g, ' ').toLowerCase();
  for (const kind of ['tables', 'sequences', 'functions']) {
    assert.match(stub, new RegExp(`alter default privileges in schema public grant all on ${kind} to anon, authenticated, service_role`),
      `stub opens new public ${kind} to anon and authenticated like hosted Supabase`);
  }
  assert.match(stub, /create table if not exists auth\.users/, 'stub keeps auth.users like the studio stub');
  assert.match(stub, /create table if not exists auth\.sessions/, 'stub keeps auth.sessions (auth_hook.sql needs it)');
});

test('GRANT-10 run.sh and ci.yml name no migration or test file; the CI SQL step runs tests/sql/run.sh', () => {
  for (const f of ['tests/sql/run.sh', '.github/workflows/ci.yml']) {
    const src = read(f);
    assert.deepStrictEqual(src.match(/\d{14}_\w+\.sql/g) || [], [], `${f} names no 14-digit migration`);
    assert.deepStrictEqual(src.match(/[\w-]+_test\.sql/g) || [], [], `${f} names no *_test.sql file`);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:sql'], /tests\/sql\/run\.sh[\s\S]*&&[\s\S]*node --test tests\/sql\/runner\.test\.mjs/,
    'npm run test:sql runs run.sh, then the Postgres runner checks (GRANT-1, GRANT-9)');
  assert.doesNotMatch(pkg.scripts.test, /runner\.test\.mjs|test:sql/, 'npm test stays free of Postgres');
  const run = read('tests/sql/run.sh');
  assert.match(run, /LC_ALL=C/, 'run.sh sorts its globs with LC_ALL=C');
  assert.match(run, /PGHOST/, 'run.sh uses PGHOST when set');
  const ci = read('.github/workflows/ci.yml');
  const step = ci.split(/\n\s*- name: /).find((s) => /^Database schema/.test(s));
  assert.ok(step, 'ci.yml keeps the "Database schema and row-level security" step');
  assert.match(step, /(sh |bash |\.\/)?tests\/sql\/run\.sh|npm run test:sql/, 'the CI SQL step runs tests/sql/run.sh');
  assert.match(step, /PGHOST:/, 'the CI SQL step sets PGHOST for the postgres service');
  assert.doesNotMatch(step, /psql[^\n]*-f /, 'the CI SQL step no longer lists files for psql itself');
});

test('GRANT-11 run.sh --list runs each file once: stub, migrations in filename order, then tests in order', () => {
  const tmpTest = 'tests/sql/98_tmp_test.sql';
  const tmpMig = `${MIGRATIONS}/29990101000000_tmp.sql`;
  assert.ok(!exists(tmpTest) && !exists(tmpMig), 'temp files are not left from an earlier run');
  fs.writeFileSync(path.join(root, tmpTest), '-- GRANT-11 temp test file, removed by the test\n');
  fs.writeFileSync(path.join(root, tmpMig), '-- GRANT-11 temp migration, removed by the test\n');
  let list: string[];
  try {
    list = listRun();
  } finally {
    fs.rmSync(path.join(root, tmpTest), { force: true });
    fs.rmSync(path.join(root, tmpMig), { force: true });
  }
  assert.ok(!exists(tmpTest) && !exists(tmpMig), 'temp files removed');
  const count = (n: string) => list.filter((l) => l === n).length;
  assert.strictEqual(count('98_tmp_test.sql'), 1, `98_tmp_test.sql listed once\n${list.join('\n')}`);
  assert.strictEqual(count('29990101000000_tmp.sql'), 1, '29990101000000_tmp.sql listed once');
  assert.strictEqual(list.length, new Set(list).size, 'no file listed twice');

  const migs = list.filter((l) => /^\d{14}_/.test(l));
  assert.deepStrictEqual(migs, [...migs].sort(), 'migrations in filename order');
  const disk = fs.readdirSync(path.join(root, MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  assert.deepStrictEqual(migs.filter((m) => m !== '29990101000000_tmp.sql'), disk, 'every migration on disk is listed');
  assert.ok(migs.includes(REVOKE), `${REVOKE} listed`);
  const rls = list.indexOf('10_rls_test.sql');
  assert.ok(rls >= 0, `10_rls_test.sql listed\n${list.join('\n')}`);
  assert.ok(migs.every((m) => list.indexOf(m) < rls), 'every migration runs before 10_rls_test.sql');
  const stub = list.indexOf('supabase_stub.sql');
  assert.ok(stub >= 0 && list.slice(0, stub).every((l) => !/\.sql$/.test(l) || l === 'supabase_stub.sql'),
    'the stub runs before any migration');

  // Today's order, kept by the numeric prefixes (rls_test.sql seeds what the others use).
  const tests = list.filter((l) => /_test\.sql$/.test(l));
  assert.ok(tests.every((t) => /^\d{2}_/.test(t)), `every SQL test has a two-digit prefix: ${tests.join(', ')}`);
  const stems = tests.map((t) => t.replace(/^\d+_/, '').replace(/_test\.sql$/, ''));
  assert.deepStrictEqual(stems, ['rls', 'auth', 'consent', 'retention', 'harden', 'm19', 'grants', 'tmp'], 'tests in today\'s order');
  assert.ok(list.indexOf('98_tmp_test.sql') > list.indexOf('70_grants_test.sql'), 'temp test sorts after 70_grants_test.sql');
  // Replaces the literal file-name check in m19.test.ts ("M1.9 ... run locally and in CI").
  assert.ok(list.includes('20261029000000_crew_auth.sql') && list.includes('60_m19_test.sql'), 'M1.9 migration and test still run');
  for (const old of ['rls_test.sql', 'auth_test.sql', 'consent_test.sql', 'retention_test.sql', 'harden_test.sql', 'm19_test.sql']) {
    assert.ok(!exists(`tests/sql/${old}`), `tests/sql/${old} renamed, not copied`);
  }
});

test('GRANT-11 run.sh --skip leaves out exactly the named file', () => {
  const all = listRun();
  const skipped = listRun(['--skip', REVOKE]);
  assert.ok(all.includes(REVOKE), `${REVOKE} in the full list`);
  assert.deepStrictEqual(skipped, all.filter((l) => l !== REVOKE), 'only the skipped file is gone');
});

test('GRANT-12 migrations are well named and hold no deploy secrets or placeholders', () => {
  const files = fs.readdirSync(path.join(root, MIGRATIONS));
  const bad = files.filter((f) => !/^\d{14}_[a-z]+(_[a-z]+)*\.sql$/.test(f));
  assert.deepStrictEqual(bad, [], 'every migration is 14 digits, underscore, lowercase words, .sql');
  const hits = files.filter((f) => /PROJECT_REF|CRON_SECRET|cron\.schedule|supabase\.co/.test(read(`${MIGRATIONS}/${f}`)));
  assert.deepStrictEqual(hits, [], 'no migration holds PROJECT_REF, CRON_SECRET, cron.schedule or supabase.co');
  assert.ok(exists('supabase/manual/schedules.sql'), 'schedules moved to supabase/manual/schedules.sql');
  assert.match(read('supabase/manual/schedules.sql'), /cron\.schedule/, 'the moved file keeps its schedules');
});

test('GRANT-13 nothing outside docs/runs and docs/product points at the old schedules migration', () => {
  const skip = /^(docs\/runs\/|docs\/product\/|tests\/grants\.test\.js$)/;
  const hits = repoFiles().filter((f) => !skip.test(f)).filter((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    return /20261022000100_schedules\.sql/.test(src) || /migrations\/[\w*]*schedules\.sql/.test(src);
  });
  assert.deepStrictEqual(hits, [], 'no file names the schedules file under migrations (SETUP, digest header comment)');
  const setup = read('docs/SETUP.md');
  const step6 = setup.split(/\n## /).find((s) => /^6\./.test(s));
  assert.ok(step6, 'SETUP keeps step 6');
  assert.match(step6, /supabase\/manual\/schedules\.sql/, 'SETUP step 6 names supabase/manual/schedules.sql');
});

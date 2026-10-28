// M1.12 Harden: sync ingest cases named by finding ID (PS-4, HRD-14). Every record here is made up.
// npx -y deno test --config supabase/functions/deno.json --no-npm tests/edge/
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { ingest, type Claims, type PunchItem, type Repo } from '../../supabase/functions/_shared/core.ts';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000a2';
const BOSS = '00000000-0000-4000-8000-0000000000b0';
const JAKE = '00000000-0000-4000-8000-0000000000b1';
const CODY = '00000000-0000-4000-8000-0000000000b2';
const STRANGER = '00000000-0000-4000-8000-0000000000b9';
const now = Date.parse('2026-10-21T16:00:00-04:00');
const claims = (crew: string, role: Claims['crew_role'] = 'crew'): Claims =>
  ({ sub: crew, role: 'authenticated', aud: 'authenticated', org_id: ORG, crew_id: crew, crew_role: role, iat: 0, exp: 9e9 });

type CrewRow = { id: string; org_id: string; active: boolean; deactivated_at: string | null };

// The crew table is modelled with its active flag. crewInOrg mirrors db.ts today (active crew only).
// crewMember(orgId, crewId) is the lookup that also sees turned-off crew: the fix for PS-4 is expected
// to add it to Repo (db.ts: select active, deactivated_at by id and org, no active filter).
function fakeRepo(crew: CrewRow[]) {
  const punches: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const crewRows: Record<string, unknown>[] = [];
  const repo = {
    crewInOrg: async (o: string, c: string) => crew.some((x) => x.id === c && x.org_id === o && x.active),
    crewMember: async (o: string, c: string) => {
      const x = crew.find((r) => r.id === c && r.org_id === o);
      return x ? { active: x.active, deactivated_at: x.deactivated_at } : null;
    },
    punchExists: async (id: string) => punches.some((p) => p.id === id),
    getDevice: async () => null,
    setDeviceChain: async () => {},
    recentForCrew: async (c: string) => punches.filter((p) => p.crew_id === c).map((p) =>
      ({ kind: 'punch', id: p.id, crewId: p.crew_id, type: p.type, at: Date.parse(p.phone_at as string), lat: p.lat, lng: p.lng } as PunchItem)),
    recentForDevice: async () => [],
    insertPunch: async (row: Record<string, unknown>) => { punches.push(row); return { status: row.lat == null ? 'nogps' : 'onsite', distance_ft: null }; },
    upsertJob: async (row: Record<string, unknown>) => { jobs.push(row); },
    upsertCrew: async (row: Record<string, unknown>) => { crewRows.push(row); },
    insertConsent: async () => {},
    latestConsent: async () => ({ action: 'agree', text_version: 'loc-v1' }),
  };
  return { repo: repo as unknown as Repo, punches, jobs, crewRows };
}

const active = (id: string, org = ORG): CrewRow => ({ id, org_id: org, active: true, deactivated_at: null });
const turnedOff = (id: string, at: number): CrewRow => ({ id, org_id: ORG, active: false, deactivated_at: new Date(at).toISOString() });
const punch = (o: Partial<PunchItem> = {}): PunchItem =>
  ({ kind: 'punch', id: 'p-x', crewId: JAKE, byCrewId: JAKE, jobId: 'j1', type: 'out', at: now - 30 * 60000, lat: 38.5, lng: -81.9, accuracy: 9, ...o });

// ---------- PS-4: a worker turned off before their last clock-out syncs ----------

Deno.test('PS-4 a clock-out made before the worker was turned off is kept and flagged for the boss, never dropped', async () => {
  // Jake clocked out at 3:30 with no signal; the boss turned him off at 3:45; the phone syncs at 4:00.
  const f = fakeRepo([active(BOSS), turnedOff(JAKE, now - 15 * 60000)]);
  const r = await ingest(claims(JAKE), [punch({ id: 'p-ps4-own' })], f.repo, now);
  assertEquals(r.accepted, ['p-ps4-own'], `rejected: ${JSON.stringify(r.rejected)}`);
  assertEquals(f.punches.map((p) => p.id), ['p-ps4-own']);
  const risk = (f.punches[0].risk as { code: string }[]).map((x) => x.code);
  assert(risk.some((c) => /inactive/.test(c)), `no flag for the boss: ${risk.join(', ')}`);
});

Deno.test('PS-4 a foreman\'s clock-out for a teammate turned off later is kept too', async () => {
  const f = fakeRepo([active(CODY), turnedOff(JAKE, now - 15 * 60000)]);
  const r = await ingest(claims(CODY, 'foreman'), [punch({ id: 'p-ps4-mate', byCrewId: CODY })], f.repo, now);
  assertEquals(r.accepted, ['p-ps4-mate'], `rejected: ${JSON.stringify(r.rejected)}`);
  assertEquals(f.punches.length, 1);
});

Deno.test('PS-4 (guard) someone from another company is still refused', async () => {
  const f = fakeRepo([active(CODY), active(STRANGER, OTHER_ORG)]);
  const r = await ingest(claims(CODY, 'foreman'), [punch({ id: 'p-ps4-stranger', crewId: STRANGER, byCrewId: CODY })], f.repo, now);
  assertEquals(r.accepted, []);
  assertEquals(f.punches.length, 0);
});

// ---------- HRD-14: bad input ----------
// Refusals name no submitted value (a reason is shown on the phone and may be logged).
const leaks = (reasons: { reason: string }[], values: string[]) =>
  reasons.filter((r) => values.some((v) => v && r.reason.includes(v))).map((r) => r.reason);

Deno.test('HRD-14 a punch with impossible coordinates or accuracy is kept without its location (never refused: CLAUDE.md "never block a clock-in")', async () => {
  const bad: Partial<PunchItem>[] = [
    { id: 'p-lat', lat: 95, lng: -81.9 },
    { id: 'p-lng', lat: 38.5, lng: -181 },
    { id: 'p-acc', accuracy: -3 },
    // deno-lint-ignore no-explicit-any
    { id: 'p-str', lat: '38.5; drop table' as any },
    { id: 'p-nan', lat: NaN },
  ];
  const f = fakeRepo([active(JAKE)]);
  const r = await ingest(claims(JAKE), bad.map((b, i) => punch({ ...b, at: now - (60 - i) * 60000 })), f.repo, now);
  assertEquals(r.accepted, bad.map((b) => b.id), `rejected: ${JSON.stringify(r.rejected)}`);
  for (const p of f.punches) assertEquals([p.lat, p.lng, p.accuracy_m], [null, null, null], `${p.id} stored a bad fix`);
});

Deno.test('HRD-14 (guard) edge values are fine: lat 90, lng -180, accuracy 0', async () => {
  const f = fakeRepo([active(JAKE)]);
  await ingest(claims(JAKE), [punch({ id: 'p-edge', lat: 90, lng: -180, accuracy: 0 })], f.repo, now);
  assertEquals([f.punches[0].lat, f.punches[0].lng, f.punches[0].accuracy_m], [90, -180, 0]);
});

Deno.test('HRD-14 a punch timed more than 10 minutes in the future is stored at no later than now + 10 min, flagged', async () => {
  const f = fakeRepo([active(JAKE)]);
  const r = await ingest(claims(JAKE), [punch({ id: 'p-future', type: 'in', at: now + 3 * 3600000 })], f.repo, now);
  assertEquals(r.accepted, ['p-future']);
  const at = Date.parse(f.punches[0].phone_at as string);
  assert(at <= now + 10 * 60000, `stored phone_at ${f.punches[0].phone_at} is past now + 10 min (the database check would refuse it)`);
  assert((f.punches[0].risk as { code: string }[]).some((x) => x.code === 'future_time'));
});

Deno.test('HRD-14 (guard) a punch from before 2020 is refused, and the reason names no value', async () => {
  const f = fakeRepo([active(JAKE)]);
  const r = await ingest(claims(JAKE), [punch({ id: 'p-2019', at: Date.parse('2019-12-31T12:00:00Z') })], f.repo, now);
  assertEquals(r.accepted, []);
  assertEquals(leaks(r.rejected, ['2019', String(Date.parse('2019-12-31T12:00:00Z'))]), []);
});

Deno.test('HRD-14 the boss\'s job and crew edits are refused past 60 chars (names) / 200 (address) / out-of-range pins, naming no value', async () => {
  const f = fakeRepo([active(BOSS)]);
  const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  const longName = 'Test job ' + 'x'.repeat(52); // 61
  const longAddr = '1 Test Rd ' + 'y'.repeat(191); // 201
  const longCrew = 'Test Person ' + 'z'.repeat(49); // 61
  const items = [
    { kind: 'job' as const, id: 'e1', data: { id: id(11), name: longName, address: '', lat: 38.5, lng: -81.9 } },
    { kind: 'job' as const, id: 'e2', data: { id: id(12), name: 'Test job', address: longAddr, lat: 38.5, lng: -81.9 } },
    { kind: 'job' as const, id: 'e3', data: { id: id(13), name: 'Test job', address: '', lat: 91.25, lng: -81.9 } },
    { kind: 'job' as const, id: 'e4', data: { id: id(14), name: 'Test job', address: '', lat: 38.5, lng: -181.75 } },
    { kind: 'crew' as const, id: 'e5', data: { id: id(15), name: longCrew, role: 'crew' } },
  ];
  const r = await ingest(claims(BOSS, 'boss'), items, f.repo, now);
  assertEquals(r.accepted, [], `accepted: ${r.accepted.join(', ')}`);
  assertEquals(f.jobs.length + f.crewRows.length, 0);
  assertEquals(leaks(r.rejected, [longName, longAddr, longCrew, 'xxxxx', 'yyyyy', 'zzzzz', '91.25', '181.75']), []);
});

Deno.test('HRD-14 (guard) names at exactly 60 chars and an address at 200 are stored', async () => {
  const f = fakeRepo([active(BOSS)]);
  const n60 = 'Test job ' + 'x'.repeat(51);
  const a200 = '1 Test Rd ' + 'y'.repeat(190);
  await ingest(claims(BOSS, 'boss'), [
    { kind: 'job', id: 'e1', data: { id: '00000000-0000-4000-8000-000000000021', name: n60, address: a200, lat: 90, lng: 180 } },
  ], f.repo, now);
  assertEquals([f.jobs[0].name, f.jobs[0].address], [n60, a200]);
});

Deno.test('HRD-14 control characters are stripped from job and crew names', async () => {
  const f = fakeRepo([active(BOSS)]);
  await ingest(claims(BOSS, 'boss'), [
    { kind: 'job', id: 'e1', data: { id: '00000000-0000-4000-8000-000000000031', name: 'Test\u0007 job\u0000\u001b[2J', address: 'A\u0008B', lat: 38.5, lng: -81.9 } },
    { kind: 'crew', id: 'e2', data: { id: '00000000-0000-4000-8000-000000000032', name: '‮Test\u0000 Person\n', role: 'crew' } },
  ], f.repo, now);
  for (const v of [f.jobs[0].name, f.jobs[0].address, f.crewRows[0].name]) {
    // deno-lint-ignore no-control-regex
    assert(!/[\u0000-\u001f\u007f‪-‮]/.test(String(v)), `control character kept in ${JSON.stringify(v)}`);
  }
});

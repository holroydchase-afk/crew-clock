// M1.12 Harden: sync ingest cases named by finding ID (PS-4, HRD-14). Every record here is made up.
// npx -y deno test --config supabase/functions/deno.json --no-npm tests/edge/
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { ingest, requireActive, type Claims, type Device, type PunchItem, type Repo } from '../../supabase/functions/_shared/core.ts';
import { Chain } from '../../supabase/functions/_shared/vendor/mod.ts';

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
function fakeRepo(crew: CrewRow[], opts: { devices?: Device[]; consent?: boolean } = {}) {
  const devices = opts.devices || [];
  const consents: Record<string, unknown>[] = [];
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
    getDevice: async (id: string) => devices.find((d) => d.id === id) || null,
    setDeviceChain: async (id: string, seq: number, hash: string) => { const d = devices.find((x) => x.id === id)!; d.last_seq = seq; d.last_hash = hash; },
    recentForCrew: async (c: string) => punches.filter((p) => p.crew_id === c).map((p) =>
      ({ kind: 'punch', id: p.id, crewId: p.crew_id, type: p.type, at: Date.parse(p.phone_at as string), lat: p.lat, lng: p.lng } as PunchItem)),
    recentForDevice: async () => [],
    insertPunch: async (row: Record<string, unknown>) => { punches.push(row); return { status: row.lat == null ? 'nogps' : 'onsite', distance_ft: null }; },
    upsertJob: async (row: Record<string, unknown>) => { jobs.push(row); },
    upsertCrew: async (row: Record<string, unknown>) => { crewRows.push(row); },
    insertConsent: async (row: Record<string, unknown>) => { consents.push(row); },
    latestConsent: async () => (opts.consent === false ? null : { action: 'agree', text_version: 'loc-v1' }),
  };
  return { repo: repo as unknown as Repo, punches, jobs, crewRows, devices, consents };
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

// ---------- PS-M112-1: a turned-off worker's punches are kept only up to 15 minutes after ----------
// The reason names no value; the phone drops a "Turned off" refusal like other permission refusals.
const MIN = 60000;

Deno.test('PS-M112-1 a turned-off worker\'s own punch made more than 15 min after they were turned off is refused "Turned off", not stored', async () => {
  const offAt = now - 60 * MIN;
  const f = fakeRepo([active(BOSS), turnedOff(JAKE, offAt)]);
  const r = await ingest(claims(JAKE), [punch({ id: 'p-late', type: 'in', at: offAt + 16 * MIN })], f.repo, now);
  assertEquals(r.accepted, []);
  assertEquals(r.rejected, [{ id: 'p-late', reason: 'Turned off' }]);
  assertEquals(f.punches.length, 0);
});

Deno.test('PS-M112-1 (guard) a turned-off worker\'s own punch within the 15 min grace is kept, flagged crew_inactive', async () => {
  const offAt = now - 60 * MIN;
  const f = fakeRepo([active(BOSS), turnedOff(JAKE, offAt)]);
  const r = await ingest(claims(JAKE), [punch({ id: 'p-grace', at: offAt + 14 * MIN })], f.repo, now);
  assertEquals(r.accepted, ['p-grace'], `rejected: ${JSON.stringify(r.rejected)}`);
  assert((f.punches[0].risk as { code: string }[]).some((x) => x.code === 'crew_inactive'));
});

Deno.test('PS-M112-1 a foreman\'s punch for a turned-off teammate is refused "Turned off", even if made before', async () => {
  const f = fakeRepo([active(CODY), turnedOff(JAKE, now - 15 * MIN)]);
  const r = await ingest(claims(CODY, 'foreman'), [punch({ id: 'p-mate', byCrewId: CODY, at: now - 30 * MIN })], f.repo, now);
  assertEquals(r.accepted, []);
  assertEquals(r.rejected, [{ id: 'p-mate', reason: 'Turned off' }]);
  assertEquals(f.punches.length, 0);
});

Deno.test('PS-M112-1 a turned-off foreman can sync nothing but their own early punches: no teammate punch, consent or edit', async () => {
  const offAt = now - 60 * MIN;
  const f = fakeRepo([active(JAKE), { ...turnedOff(CODY, offAt) }]);
  const items = [
    punch({ id: 'p-own', crewId: CODY, byCrewId: CODY, at: offAt - 10 * MIN }),
    punch({ id: 'p-for-jake', crewId: JAKE, byCrewId: CODY, at: offAt - 10 * MIN }),
    { kind: 'consent' as const, id: '00000000-0000-4000-8000-0000000000f9', crewId: CODY, action: 'withdraw', textVersion: 'loc-v1', at: offAt - 5 * MIN },
    { kind: 'job' as const, id: 'e-job', data: { id: '00000000-0000-4000-8000-000000000041', name: 'Test job', address: '', lat: 38.5, lng: -81.9 } },
  ];
  const r = await ingest(claims(CODY, 'foreman'), items, f.repo, now);
  assertEquals(r.accepted, ['p-own'], `rejected: ${JSON.stringify(r.rejected)}`);
  assertEquals(r.rejected.map((x) => x.reason), ['Turned off', 'Turned off', 'Turned off']);
  assertEquals(f.punches.map((p) => p.id), ['p-own']);
  assertEquals(f.consents.length + f.jobs.length, 0);
});

Deno.test('PS-M112-1 the other functions refuse a turned-off caller (requireActive), and let an active one through', async () => {
  const f = fakeRepo([active(BOSS), turnedOff(JAKE, now - 60 * MIN)]);
  let err: unknown = null;
  await requireActive(claims(JAKE), f.repo).catch((e: unknown) => { err = e; });
  assertEquals([(err as { status?: number })?.status, (err as Error)?.message], [403, 'Turned off']);
  await requireActive(claims(BOSS, 'boss'), f.repo); // does not throw
});

// ---------- PS-M112-2: dropped GPS takes its hash and signature with it ----------
// The hash and signature cover the location, so keeping them would let it be guessed back
// (same reasoning as app.apply_retention's 90-day GPS rule).
const signed = { hash: 'h-test-1', signature: 's-test-1', prevHash: 'h-test-0', seq: 1, deviceId: 'dev-unknown' };

Deno.test('PS-M112-2 a punch whose impossible GPS was dropped is stored with no hash, signature or prev_hash', async () => {
  const f = fakeRepo([active(JAKE)]);
  await ingest(claims(JAKE), [punch({ id: 'p-badfix', lat: 95, ...signed })], f.repo, now);
  const p = f.punches[0];
  assertEquals([p.lat, p.hash, p.signature, p.prev_hash], [null, null, null, null]);
});

Deno.test('PS-M112-2 a punch whose GPS was dropped for no consent (L3) is stored with no hash, signature or prev_hash', async () => {
  const f = fakeRepo([active(JAKE)], { consent: false });
  await ingest(claims(JAKE), [punch({ id: 'p-noconsent', ...signed })], f.repo, now);
  const p = f.punches[0];
  assertEquals([p.lat, p.hash, p.signature, p.prev_hash], [null, null, null, null]);
});

Deno.test('PS-M112-2 the next signed punch keeps no pointer to the dropped punch\'s hash, and still verifies as linked', async () => {
  const keys = await Chain.generateKey();
  const dev: Device = { id: 'dev-1', crew_id: JAKE, org_id: ORG, public_key: await Chain.exportPublic(keys.publicKey), last_seq: 0, last_hash: 'genesis', revoked: false };
  const f = fakeRepo([active(JAKE)], { devices: [dev] });
  const base = { kind: 'punch' as const, deviceId: 'dev-1', crewId: JAKE, byCrewId: JAKE, jobId: 'j1', accuracy: 9 };
  const p1 = await Chain.signPunch({ ...base, id: 'p-1', type: 'in', at: now - 120 * MIN, lat: 95, lng: -81.9 }, keys.privateKey, { seq: 0, hash: 'genesis' });
  const p2 = await Chain.signPunch({ ...base, id: 'p-2', type: 'out', at: now - 60 * MIN, lat: 38.5, lng: -81.9 }, keys.privateKey, { seq: 1, hash: p1.hash });
  const r1 = await ingest(claims(JAKE), [p1], f.repo, now);
  assert(f.devices[0].last_hash !== p1.hash, 'the device row still holds the dropped punch\'s hash');
  const r2 = await ingest(claims(JAKE), [p2], f.repo, now);
  assertEquals([...r1.accepted, ...r2.accepted], ['p-1', 'p-2']);
  const [s1, s2] = f.punches;
  assertEquals([s1.hash, s1.signature], [null, null]);
  assert(f.punches.every((p) => p.prev_hash !== p1.hash), 'a stored prev_hash still holds the dropped punch\'s hash');
  assertEquals(s2.sig_ok, true);
  assertEquals(s2.hash, p2.hash, 'the good punch keeps its own hash');
  const codes = (s2.risk as { code: string }[]).map((x) => x.code);
  assert(!codes.includes('chain_gap') && !codes.some((c) => /gap|signature/.test(c)), `good punch flagged: ${codes.join(', ')}`);
});

Deno.test('PS-M112-2 (guard) a good signed punch keeps its hash, signature and link to the previous kept punch', async () => {
  const keys = await Chain.generateKey();
  const dev: Device = { id: 'dev-1', crew_id: JAKE, org_id: ORG, public_key: await Chain.exportPublic(keys.publicKey), last_seq: 0, last_hash: 'genesis', revoked: false };
  const f = fakeRepo([active(JAKE)], { devices: [dev] });
  const base = { kind: 'punch' as const, deviceId: 'dev-1', crewId: JAKE, byCrewId: JAKE, jobId: 'j1', accuracy: 9, lat: 38.5, lng: -81.9 };
  const p1 = await Chain.signPunch({ ...base, id: 'p-1', type: 'in', at: now - 120 * MIN }, keys.privateKey, { seq: 0, hash: 'genesis' });
  const p2 = await Chain.signPunch({ ...base, id: 'p-2', type: 'out', at: now - 60 * MIN }, keys.privateKey, { seq: 1, hash: p1.hash });
  await ingest(claims(JAKE), [p1, p2], f.repo, now);
  assertEquals([f.punches[0].hash, f.punches[0].signature], [p1.hash, p1.signature]);
  assertEquals(f.punches[1].prev_hash, p1.hash);
  assertEquals(f.devices[0].last_hash, p2.hash);
});

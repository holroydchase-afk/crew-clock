// deno test tests/edge/   (Edge Function logic with an in-memory database)
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { hashPin, ingest, verifyPin, type Claims, type Device, type PunchItem, type Repo } from '../../supabase/functions/_shared/core.ts';
import { Chain } from '../../supabase/functions/_shared/vendor/mod.ts';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const JAKE = '00000000-0000-4000-8000-0000000000b1';
const CODY = '00000000-0000-4000-8000-0000000000b2';
const now = Date.parse('2026-10-21T12:00:00-04:00');
const claims = (crew: string, role: Claims['crew_role'] = 'crew'): Claims =>
  ({ sub: crew, role: 'authenticated', aud: 'authenticated', org_id: ORG, crew_id: crew, crew_role: role, iat: 0, exp: 9e9 });

function fakeRepo(devices: Device[] = []) {
  const punches: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const repo: Repo = {
    crewInOrg: async (_o, c) => [JAKE, CODY].includes(c),
    punchExists: async (id) => punches.some((p) => p.id === id),
    getDevice: async (id) => devices.find((d) => d.id === id) || null,
    setDeviceChain: async (id, seq, hash) => { const d = devices.find((x) => x.id === id)!; d.last_seq = seq; d.last_hash = hash; },
    recentForCrew: async (c) => punches.filter((p) => p.crew_id === c).map((p) => ({ kind: 'punch', id: p.id, crewId: p.crew_id, type: p.type, at: Date.parse(p.phone_at as string), lat: p.lat, lng: p.lng } as PunchItem)),
    recentForDevice: async () => [],
    insertPunch: async (row) => { punches.push(row); return { status: row.lat == null ? 'nogps' : 'offsite', distance_ft: 9000 }; },
    upsertJob: async (row) => { jobs.push(row); },
    upsertCrew: async () => {},
  };
  return { repo, punches, jobs, devices };
}

Deno.test('PIN hashing', async () => {
  const h = await hashPin('1234');
  assert(h.startsWith('pbkdf2$'));
  assert(await verifyPin('1234', h));
  assert(!(await verifyPin('4321', h)));
  assert(!(await verifyPin('1234', null)));
});

Deno.test('signed punch is accepted, chained, and an alert raised when off site', async () => {
  const keys = await Chain.generateKey();
  const dev: Device = { id: 'dev-1', crew_id: JAKE, org_id: ORG, public_key: await Chain.exportPublic(keys.publicKey), last_seq: 0, last_hash: 'genesis', revoked: false };
  const f = fakeRepo([dev]);
  const p = await Chain.signPunch({ kind: 'punch', id: 'p1', deviceId: 'dev-1', crewId: JAKE, byCrewId: JAKE, jobId: 'j1', type: 'in', at: now, lat: 38.5, lng: -81.9, accuracy: 9 }, keys.privateKey, { seq: 0, hash: 'genesis' });
  const r = await ingest(claims(JAKE), [p], f.repo, now + 1000);
  assertEquals(r.accepted, ['p1']);
  assertEquals(f.punches[0].sig_ok, true);
  assertEquals(f.devices[0].last_seq, 1);
  assertEquals(r.alerts[0].status, 'offsite');
  // resend is a no-op
  const again = await ingest(claims(JAKE), [p], f.repo, now + 2000);
  assertEquals(again.accepted, ['p1']);
  assertEquals(f.punches.length, 1);
});

Deno.test('forged punch is stored but flagged bad_signature', async () => {
  const keys = await Chain.generateKey();
  const dev: Device = { id: 'dev-1', crew_id: JAKE, org_id: ORG, public_key: await Chain.exportPublic(keys.publicKey), last_seq: 0, last_hash: 'genesis', revoked: false };
  const f = fakeRepo([dev]);
  const p = await Chain.signPunch({ kind: 'punch', id: 'p1', deviceId: 'dev-1', crewId: JAKE, jobId: 'j1', type: 'in', at: now, lat: 38.5, lng: -81.9, accuracy: 9 }, keys.privateKey, { seq: 0, hash: 'genesis' });
  const forged = { ...p, at: now - 3600000 };
  const r = await ingest(claims(JAKE), [forged], f.repo, now);
  assertEquals(f.punches[0].sig_ok, false);
  assert((f.punches[0].risk as { code: string }[]).some((x) => x.code === 'bad_signature'));
  assertEquals(r.alerts[0].risk, ['bad_signature']);
});

Deno.test('crew cannot punch for others or edit jobs; boss can', async () => {
  const f = fakeRepo();
  const p: PunchItem = { kind: 'punch', id: 'p9', crewId: CODY, jobId: 'j1', type: 'in', at: now };
  const job = { kind: 'job' as const, id: 'e1', data: { id: '00000000-0000-4000-8000-0000000000c1', name: 'X', lat: 1, lng: 2, radiusFt: 99999 } };
  const r = await ingest(claims(JAKE), [p, job], f.repo, now);
  assertEquals(r.accepted, []);
  assertEquals(r.rejected.length, 2);
  const b = await ingest(claims(JAKE, 'boss'), [job], f.repo, now);
  assertEquals(b.accepted, ['e1']);
  assertEquals(f.jobs[0].radius_ft, 5000);
  assertEquals(f.jobs[0].org_id, ORG);
});

Deno.test('unsigned punches from old phones are accepted and flagged low', async () => {
  const f = fakeRepo();
  await ingest(claims(JAKE), [{ kind: 'punch', id: 'p2', crewId: JAKE, jobId: 'j1', type: 'in', at: now }], f.repo, now);
  assertEquals((f.punches[0].risk as { code: string }[])[0].code, 'unsigned');
});

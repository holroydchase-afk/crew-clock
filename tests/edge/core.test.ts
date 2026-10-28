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

function fakeRepo(devices: Device[] = [], agreed: string[] = [JAKE, CODY]) {
  const punches: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  // Install day: these workers agreed to location long before any test punch (M1.2)
  const consents: Record<string, unknown>[] = agreed.map((c, i) => ({ id: `seed-${i}`, crew_id: c, action: 'agree', text_version: 'loc-v1', phone_at: '2026-10-01T11:00:00Z' }));
  const repo: Repo = {
    crewInOrg: async (_o, c) => [JAKE, CODY].includes(c),
    crewMember: async (_o, c) => ([JAKE, CODY].includes(c) ? { active: true, deactivated_at: null } : null),
    punchExists: async (id) => punches.some((p) => p.id === id),
    getDevice: async (id) => devices.find((d) => d.id === id) || null,
    setDeviceChain: async (id, seq, hash) => { const d = devices.find((x) => x.id === id)!; d.last_seq = seq; d.last_hash = hash; },
    recentForCrew: async (c) => punches.filter((p) => p.crew_id === c).map((p) => ({ kind: 'punch', id: p.id, crewId: p.crew_id, type: p.type, at: Date.parse(p.phone_at as string), lat: p.lat, lng: p.lng } as PunchItem)),
    recentForDevice: async () => [],
    insertPunch: async (row) => { punches.push(row); return { status: row.lat == null ? 'nogps' : 'offsite', distance_ft: 9000 }; },
    upsertJob: async (row) => { jobs.push(row); },
    upsertCrew: async () => {},
    insertConsent: async (row) => { if (!consents.some((c) => c.id === row.id)) consents.push(row); },
    latestConsent: async (crewId, atMs) => {
      const mine = consents.filter((c) => c.crew_id === crewId && Date.parse(c.phone_at as string) <= atMs);
      const c = mine.sort((a, b) => Date.parse(a.phone_at as string) - Date.parse(b.phone_at as string)).pop();
      return c ? { action: c.action as string, text_version: c.text_version as string } : null;
    },
  };
  return { repo, punches, jobs, devices, consents };
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

// M1.2 location consent (docs/PRIVACY.md C1, C5)
const consent = (o: Record<string, unknown> = {}) => ({ kind: 'consent', id: '00000000-0000-4000-8000-0000000000f1', crewId: JAKE, byCrewId: JAKE,
  action: 'agree', textVersion: 'loc-v1', at: now - 60000, deviceId: 'dev-1', ...o });

Deno.test('a worker\'s own consent record is stored once, with who, what, which words, when and which phone', async () => {
  const f = fakeRepo([], []); // nobody has agreed yet
  // deno-lint-ignore no-explicit-any
  const r = await ingest(claims(JAKE), [consent() as any], f.repo, now);
  assertEquals(r.accepted, ['00000000-0000-4000-8000-0000000000f1']);
  assertEquals(f.consents.length, 1);
  const row = f.consents[0];
  assertEquals([row.org_id, row.crew_id, row.action, row.text_version, row.device_id], [ORG, JAKE, 'agree', 'loc-v1', 'dev-1']);
  assertEquals(row.phone_at, new Date(now - 60000).toISOString());
  assertEquals(row.witness_crew_id, null);
  // deno-lint-ignore no-explicit-any
  await ingest(claims(JAKE), [consent() as any], f.repo, now + 5000); // resend over a weak signal
  assertEquals(f.consents.length, 1);
});

Deno.test('nobody can agree for someone else, even the boss; bad records are refused', async () => {
  const f = fakeRepo([], []); // nobody has agreed yet
  const items = [
    consent({ id: '00000000-0000-4000-8000-0000000000f2', crewId: CODY }),
    consent({ id: '00000000-0000-4000-8000-0000000000f3', action: 'maybe' }),
    consent({ id: '00000000-0000-4000-8000-0000000000f4', textVersion: '' }),
    consent({ id: '00000000-0000-4000-8000-0000000000f5', at: now - 40 * 86400000 }),
  ];
  // deno-lint-ignore no-explicit-any
  const crew = await ingest(claims(JAKE), items as any, f.repo, now);
  assertEquals(crew.accepted, []);
  assertEquals(crew.rejected.map((x) => x.reason), ['Only you can agree for yourself', 'Bad consent action', 'Bad consent text version', 'Consent too old']);
  // deno-lint-ignore no-explicit-any
  const boss = await ingest(claims(JAKE.replace('b1', 'b0'), 'boss'), [consent({ id: '00000000-0000-4000-8000-0000000000f6' }) as any], f.repo, now);
  assertEquals(boss.rejected.map((x) => x.reason), ['Only you can agree for yourself']);
  assertEquals(f.consents.length, 0);
});

Deno.test('a withdrawal is a new record, never an edit', async () => {
  const f = fakeRepo([], []); // nobody has agreed yet
  // deno-lint-ignore no-explicit-any
  await ingest(claims(JAKE), [consent() as any, consent({ id: '00000000-0000-4000-8000-0000000000f7', action: 'withdraw', at: now - 1000 }) as any], f.repo, now);
  assertEquals(f.consents.map((c) => c.action), ['agree', 'withdraw']);
});

Deno.test('a punch from a worker with no current consent is stored without its location (PRIVACY L3)', async () => {
  const f = fakeRepo([], []);
  const gps = { kind: 'punch' as const, crewId: JAKE, byCrewId: JAKE, jobId: 'j1', type: 'in' as const, lat: 38.5, lng: -81.9, accuracy: 9 };
  // no record at all
  await ingest(claims(JAKE), [{ ...gps, id: 'p-none', at: now - 3000 }], f.repo, now);
  // agreed, then withdrew before this punch
  // deno-lint-ignore no-explicit-any
  await ingest(claims(JAKE), [consent({ at: now - 2900 }) as any, consent({ id: '00000000-0000-4000-8000-0000000000f8', action: 'withdraw', at: now - 2800 }) as any,
    { ...gps, id: 'p-withdrawn', at: now - 2000 }], f.repo, now);
  // agreed to older words
  const g = fakeRepo([], []);
  // deno-lint-ignore no-explicit-any
  await ingest(claims(JAKE), [consent({ textVersion: 'loc-v0', at: now - 2900 }) as any, { ...gps, id: 'p-old', at: now - 2000 }], g.repo, now);
  const stored = [...f.punches, ...g.punches];
  assertEquals(stored.map((p) => p.id), ['p-none', 'p-withdrawn', 'p-old']);
  for (const p of stored) assertEquals([p.lat, p.lng, p.accuracy_m], [null, null, null], String(p.id));
  // a foreman clocking in a teammate who never agreed: the clock-in counts, the foreman's GPS is dropped
  const h = fakeRepo([], [JAKE]);
  const r = await ingest(claims(JAKE, 'foreman'), [{ ...gps, id: 'p-mate', crewId: CODY, at: now - 1000 }], h.repo, now);
  assertEquals(r.accepted, ['p-mate']);
  assertEquals(h.punches[0].lat, null);
});

Deno.test('a punch from a worker who agreed keeps its location', async () => {
  const f = fakeRepo([], []);
  // deno-lint-ignore no-explicit-any
  await ingest(claims(JAKE), [consent({ at: now - 5000 }) as any, { kind: 'punch', id: 'p-ok', crewId: JAKE, byCrewId: JAKE, jobId: 'j1', type: 'in', at: now - 1000, lat: 38.5, lng: -81.9, accuracy: 9 }], f.repo, now);
  assertEquals([f.punches[0].lat, f.punches[0].lng, f.punches[0].accuracy_m], [38.5, -81.9, 9]);
});

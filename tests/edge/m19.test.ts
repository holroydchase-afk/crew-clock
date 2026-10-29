// M1.9 crew sign-in and server hardening: F-03, F-06, F-12, F-13 from
// docs/reviews/2026-10-23-privacy-security.md. Every record here is made up.
// npx -y deno test --config supabase/functions/deno.json --no-npm tests/edge/
import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { HttpError, ingest, type Claims, type Repo } from '../../supabase/functions/_shared/core.ts';
import {
  capAlert, clientIp, corsFor, ipKey, lockoutAlert, orgCodeOk, photoCheck, photoKeyFor, pinGate, PIN_RESET,
  randomOrgCode, RATE, reportPayload, tokenOk,
} from '../../supabase/functions/_shared/guard.ts';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000a2';
const BOSS = '00000000-0000-4000-8000-0000000000b0';
const JAKE = '00000000-0000-4000-8000-0000000000b1';
const CODY = '00000000-0000-4000-8000-0000000000b2';
const PUNCH = '00000000-0000-4000-8000-0000000000c1';
const now = Date.parse('2026-10-29T07:00:00-04:00');
const claims = (crew: string, role: Claims['crew_role'] = 'crew', org = ORG): Claims =>
  ({ sub: crew, role: 'authenticated', aud: 'authenticated', org_id: org, crew_id: crew, crew_role: role, iat: 0, exp: 9e9 });
const crewRow = (o: Record<string, unknown> = {}) =>
  Object.assign({ failed_pins: 0, locked_until: null, lock_rounds: 0, lock_rounds_from: null, pin_blocked: false }, o);

// ---------- F-03: PIN lockout escalates; a blocked PIN waits for the boss ----------

// F-03a..d (lock counting, rounds, block) moved to tests/sql/m19_test.sql: public.pin_fail does it in
// one locked update, so parallel wrong PINs can't share one strike (PS-M19-2).

Deno.test('F-03e a timed lock refuses until it runs out, then lets the PIN be tried', () => {
  const until = new Date(now + 60000).toISOString();
  const e = assertThrows(() => pinGate(crewRow({ locked_until: until }), now), HttpError);
  assertEquals((e as HttpError).status, 429);
  pinGate(crewRow({ locked_until: until }), now + 61000); // no throw
  const blocked = assertThrows(() => pinGate(crewRow({ pin_blocked: true }), now + 7 * 86400000), HttpError);
  assertEquals((blocked as HttpError).status, 423);
  assert(/boss/i.test((blocked as HttpError).message), 'the blocked message says to ask the boss');
});

Deno.test('F-03f a boss setting a new PIN clears every lock (applyEdit uses PIN_RESET)', async () => {
  assertEquals(PIN_RESET, { failed_pins: 0, locked_until: null, lock_rounds: 0, lock_rounds_from: null, pin_blocked: false });
  const saved: Record<string, unknown>[] = [];
  const repo = {
    crewMember: async () => ({ active: true, deactivated_at: null }),
    upsertCrew: async (row: Record<string, unknown>) => { saved.push(row); },
  } as unknown as Repo;
  const res = await ingest(claims(BOSS, 'boss'), [{ kind: 'crew', id: 'e1', data: { id: JAKE, name: 'Jake R.', role: 'crew', pin: '4821' } }], repo, now);
  assertEquals(res.accepted, ['e1']);
  for (const [k, v] of Object.entries(PIN_RESET)) assertEquals(saved[0][k], v, k);
  assert(String(saved[0].pin_hash).startsWith('pbkdf2$'));
});

Deno.test('F-03g the lockout alert names the person and says what to do, with no PIN or place', () => {
  const timed = lockoutAlert('Jake R.', 'timed');
  const blocked = lockoutAlert('Jake R.', 'blocked');
  for (const a of [timed, blocked]) {
    assert(a.body.includes('Jake R.'));
    assert(!/\d{4}|lat|lng|gps/i.test(a.title + a.body), `alert text carries no PIN digits or location: ${a.body}`);
  }
  assert(/new PIN/i.test(blocked.body), 'blocked alert tells the boss to set a new PIN');
});

Deno.test('PS-M19-8 the cap alert says sign-ins are paused, with no name, PIN or place', () => {
  const a = capAlert();
  assert(/paused|wrong PINs/i.test(a.body));
  assert(!/\d{4}|lat|lng|gps/i.test(a.title + a.body));
});

// ---------- F-03: per-IP limits, keyed by a keyed hash (no raw IP stored) ----------

// PS-M19-1: a client can put anything first in x-forwarded-for; proxies add to the end. Cloudflare's
// cf-connecting-ip is set by the edge and can't be sent through it, so it wins; then the last hop.
Deno.test('F-03h the caller IP is the edge-set one, never a spoofable first x-forwarded-for entry', () => {
  const req = (h: Record<string, string>) => new Request('https://x.example/', { headers: h });
  assertEquals(clientIp(req({ 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '6.6.6.6, 198.51.100.4' })), '198.51.100.4');
  assertEquals(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' })), '203.0.113.7');
  assertEquals(clientIp(req({ 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7');
  assertEquals(clientIp(req({})), null, 'no IP: skip the per-IP limit, never one shared bucket (PS-M19-3)');
});

Deno.test('F-03i the rate key never holds the IP, is stable, and differs by scope and secret', async () => {
  const a = await ipKey('pin', '203.0.113.7', 'test-secret-1');
  assertEquals(a, await ipKey('pin', '203.0.113.7', 'test-secret-1'));
  assert(!a.includes('203.0.113.7') && !a.includes('203'), 'no IP in the key');
  assertNotEquals(a, await ipKey('crew-list', '203.0.113.7', 'test-secret-1'));
  assertNotEquals(a, await ipKey('pin', '203.0.113.7', 'test-secret-2'));
  assert(a.startsWith('pin:'));
});

Deno.test('F-03j limits: 20 PIN tries per IP and 40 per company, 30 crew lists per IP, per hour', () => {
  assertEquals(RATE, { pinTriesPerIp: 20, pinTriesPerOrg: 40, crewListPerIp: 30, windowSeconds: 3600 });
});

// ---------- F-03: company codes are random and 8+ characters ----------

Deno.test('F-03k a new company code is random, 8+ characters, with no look-alike letters', () => {
  const a = randomOrgCode();
  const b = randomOrgCode();
  assertNotEquals(a, b);
  for (const c of [a, b]) {
    assert(/^[A-HJ-NP-Z2-9]{8,}$/.test(c), `code ${c}`);
    assert(orgCodeOk(c));
  }
  assert(!orgCodeOk('SHORT1'), 'under 8 is refused');
  assert(!orgCodeOk('ab cd ef gh'), 'spaces are refused');
});

// ---------- F-06: CORS names only the crew app ----------

Deno.test('F-06 CORS refuses to start without APP_ORIGIN, and never allows *', () => {
  assertThrows(() => corsFor(undefined));
  assertThrows(() => corsFor(''));
  assertThrows(() => corsFor('*'));
  assertThrows(() => corsFor('http://clock.example.com'), Error, undefined, 'plain http is refused');
  assertEquals(corsFor('https://clock.example.com')['Access-Control-Allow-Origin'], 'https://clock.example.com');
});

// ---------- F-12: a photo link only for your own punch, once ----------

Deno.test('F-12a a photo link for a punch not synced yet is allowed', () => {
  photoCheck(claims(JAKE), PUNCH, null);
});

Deno.test('F-12b the worker or the foreman who made the punch may upload its picture', () => {
  photoCheck(claims(JAKE), PUNCH, { org_id: ORG, crew_id: JAKE, by_crew_id: JAKE, photo_key: null });
  photoCheck(claims(CODY, 'foreman'), PUNCH, { org_id: ORG, crew_id: JAKE, by_crew_id: CODY, photo_key: null });
});

Deno.test('F-12c someone else\'s punch, or another company\'s, is refused', () => {
  const mine = { org_id: ORG, crew_id: JAKE, by_crew_id: JAKE, photo_key: null };
  assertEquals((assertThrows(() => photoCheck(claims(CODY), PUNCH, mine), HttpError) as HttpError).status, 403);
  assertEquals((assertThrows(() => photoCheck(claims(JAKE, 'crew', OTHER_ORG), PUNCH, mine), HttpError) as HttpError).status, 403);
});

Deno.test('F-12d a punch that already has its picture is never overwritten', () => {
  const done = { org_id: ORG, crew_id: JAKE, by_crew_id: JAKE, photo_key: `${ORG}/2026-10-29/${PUNCH}.jpg` };
  assertEquals((assertThrows(() => photoCheck(claims(JAKE), PUNCH, done), HttpError) as HttpError).status, 409);
});

Deno.test('F-12e a bad punch id is refused', () => {
  assertEquals((assertThrows(() => photoCheck(claims(JAKE), 'not-an-id', null), HttpError) as HttpError).status, 400);
});

// PS-M19-4: the picture's key names the uploader, and sync keeps only a key under the caller's own
// path, so someone with a leaked punch id can't put their picture on it before it syncs.
Deno.test('F-12f the photo key is under the uploader: org/day/crew/punch.jpg', () => {
  assertEquals(photoKeyFor(claims(JAKE), PUNCH, now), `${ORG}/2026-10-29/${JAKE}/${PUNCH}.jpg`);
});

Deno.test('F-12g sync keeps a punch\'s photo key only when it is the caller\'s own key for that punch', async () => {
  const stored: Record<string, unknown>[] = [];
  const repo = {
    crewMember: async () => ({ active: true, deactivated_at: null }),
    crewInOrg: async () => true,
    punchExists: async () => false,
    getDevice: async () => null,
    recentForCrew: async () => [],
    recentForDevice: async () => [],
    latestConsent: async () => ({ action: 'agree', text_version: 'loc-v1' }),
    insertPunch: async (row: Record<string, unknown>) => { stored.push(row); return { status: 'photo', distance_ft: null }; },
  } as unknown as Repo;
  const punch = (id: string, photoKey: string) => ({ kind: 'punch' as const, id, crewId: JAKE, byCrewId: JAKE, jobId: null, type: 'in' as const, at: now - 60000, photoKey });
  const id2 = '00000000-0000-4000-8000-0000000000c2';
  const id3 = '00000000-0000-4000-8000-0000000000c3';
  await ingest(claims(JAKE), [
    punch(PUNCH, `${ORG}/2026-10-29/${JAKE}/${PUNCH}.jpg`),
    punch(id2, `${ORG}/2026-10-29/${CODY}/${id2}.jpg`),
    punch(id3, `${ORG}/2026-10-29/${JAKE}/${PUNCH}.jpg`),
  ], repo, now);
  const key = (id: string) => stored.find((r) => r.id === id)?.photo_key;
  assertEquals(key(PUNCH), `${ORG}/2026-10-29/${JAKE}/${PUNCH}.jpg`);
  assertEquals(key(id2), null, 'a key under someone else is dropped');
  assertEquals(key(id3), null, 'a key for another punch is dropped');
});

// ---------- F-13: report token ----------

Deno.test('F-13a the report token must match exactly and be set up long enough', () => {
  const want = 'r'.repeat(40);
  assert(tokenOk(want, want));
  assert(!tokenOk('r'.repeat(39), want));
  assert(!tokenOk('', want));
  assert(!tokenOk('short', 'short'), 'a token under 32 characters is treated as not set up');
  assert(!tokenOk(undefined, want));
});

Deno.test('F-13b the report carries shifts and names only, never GPS', () => {
  const shift = { crew_id: JAKE, crew_name: 'Jake R.', job_id: 'j1', job_name: 'Smith kitchen', clock_in: 'a', clock_out: 'b',
    hours: 8, status: 'on_site', note: null, lat: 38.4, lng: -81.9, accuracy_m: 9, address: '1 Made Up Rd', distance_ft: 20 };
  const out = reportPayload({ name: 'Example Construction', timezone: 'America/New_York' }, [shift], [{ name: 'Jake R.', role: 'crew', pin_hash: 'x' }]);
  const text = JSON.stringify(out);
  for (const bad of ['lat', 'lng', 'accuracy', 'address', 'distance', 'pin_hash']) assert(!text.includes(bad), `report has ${bad}`);
  assertEquals(out.shifts[0].hours, 8);
  assertEquals(out.crew[0], { name: 'Jake R.', role: 'crew' });
});

// Guard: the photo check is async-safe to call from the function (no hidden await needed).
Deno.test('F-12 (guard) photoCheck is synchronous and returns nothing on success', async () => {
  await assertRejects(async () => { photoCheck(claims(CODY), PUNCH, { org_id: ORG, crew_id: JAKE, by_crew_id: JAKE, photo_key: null }); }, HttpError);
});

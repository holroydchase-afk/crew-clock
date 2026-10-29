// Runtime-neutral pieces of the Edge Functions: session claims, PINs, and punch ingest.
// No Deno or npm imports here, so tests/edge/core.test.ts can run it with a fake repo.
import { Chain, Risk } from './vendor/mod.ts';

const enc = new TextEncoder();

// Session token claims. Supabase Auth signs the token; the hook in
// 20261023000000_auth_hook.sql adds org_id, crew_id and crew_role. Checked in auth.ts.
export type Claims = {
  sub: string;
  role: 'authenticated';
  aud: 'authenticated';
  org_id: string;
  crew_id: string;
  crew_role: 'crew' | 'foreman' | 'boss';
  iat: number;
  exp: number;
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const b64url = (b: ArrayBuffer | Uint8Array) => Chain.b64url(b);

export function bearer(req: Request): string {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
}

// ---------- PINs (PBKDF2-SHA256) ----------

const PIN_ITERATIONS = 150000;

export async function hashPin(pin: string, saltB64?: string, iterations = PIN_ITERATIONS): Promise<string> {
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'PIN must be 4 to 8 numbers');
  const salt = saltB64 ? Chain.fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(bits)}`;
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored || !stored.startsWith('pbkdf2$')) return false;
  const [, it, salt, want] = stored.split('$');
  const got = (await hashPin(pin, salt, Number(it))).split('$')[3];
  // constant-time compare
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// A clock-in picture's B2 key names the company, the day, the uploader and the punch (M1.9 PS-M19-4),
// so a leaked punch id never lets someone else's picture land on it: sync keeps only the caller's own.
export const photoKeyFor = (claims: Claims, punchId: string, now = Date.now()) =>
  `${claims.org_id}/${new Date(now).toISOString().slice(0, 10)}/${claims.crew_id}/${punchId}.jpg`;
export function photoKeyOk(claims: Claims, punchId: string, key: string | null | undefined): boolean {
  if (!key) return false;
  const m = /^([0-9a-f-]{36})\/\d{4}-\d{2}-\d{2}\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.jpg$/i.exec(key);
  return !!m && m[1] === claims.org_id && m[2] === claims.crew_id && m[3] === punchId;
}

// What a boss setting a new PIN clears: the wrong-PIN count, a timed lock, the day's lock rounds and
// a blocked PIN (M1.9 F-03; the lockout rules are in guard.ts).
export const PIN_RESET = { failed_pins: 0, locked_until: null, lock_rounds: 0, lock_rounds_from: null, pin_blocked: false };

// ---------- punch ingest ----------

export type PunchItem = {
  kind: 'punch';
  id: string;
  crewId: string;
  byCrewId?: string;
  jobId?: string | null;
  type: 'in' | 'out' | 'void';
  voidsId?: string | null;
  at: number;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  deviceId?: string;
  seq?: number;
  prevHash?: string;
  hash?: string;
  signature?: string;
  photoSha256?: string | null;
  photoKey?: string | null;
};

export type EditItem = { kind: 'job' | 'crew'; id: string; data: Record<string, unknown> };
// A worker's location consent (docs/PRIVACY.md "Consent"): agree or withdraw, never edited.
export type ConsentItem = { kind: 'consent'; id: string; crewId: string; action: string; textVersion: string; at: number; deviceId?: string | null };
export type Item = PunchItem | EditItem | ConsentItem;

export type Device = { id: string; crew_id: string; org_id: string; public_key: JsonWebKey; last_seq: number; last_hash: string; revoked: boolean };

// The storage the ingest needs. db.ts implements it with supabase-js.
export interface Repo {
  crewInOrg(orgId: string, crewId: string): Promise<boolean>;
  // Same company, active or turned off (PS-4): null when the person isn't in this company at all.
  crewMember(orgId: string, crewId: string): Promise<{ active: boolean; deactivated_at: string | null } | null>;
  punchExists(id: string): Promise<boolean>;
  getDevice(id: string): Promise<Device | null>;
  setDeviceChain(id: string, seq: number, hash: string): Promise<void>;
  recentForCrew(crewId: string, sinceMs: number): Promise<PunchItem[]>;
  recentForDevice(deviceId: string, sinceMs: number): Promise<PunchItem[]>;
  insertPunch(row: Record<string, unknown>): Promise<{ status: string; distance_ft: number | null }>;
  upsertJob(row: Record<string, unknown>): Promise<void>;
  upsertCrew(row: Record<string, unknown>): Promise<void>;
  insertConsent(row: Record<string, unknown>): Promise<void>; // ignores a resend of the same id
  latestConsent(crewId: string, atMs: number): Promise<{ action: string; text_version: string } | null>; // newest at or before atMs
}

// The consent words a worker must have agreed to before a punch may carry their location.
// Same as CONSENT_VERSION in js/app.js; a new version asks everyone again (docs/PRIVACY.md C4).
export const CONSENT_VERSION = 'loc-v1';

export type Alert = { punchId: string; crewId: string; status: string; risk: string[] };

// PS-M112-1: a worker the boss turned off keeps only their own punches made up to this long after
// (an offline clock-out syncing late). Everything else from or for them is refused "Turned off".
export const TURNED_OFF_GRACE_MS = 15 * 60000;
const turnedOff = () => new HttpError(403, 'Turned off'); // names no value; the phone drops it

// The signed-in caller must still be on the crew. Used by every function but sync, which lets a
// turned-off worker's own early punches through (ingest below).
export async function requireActive(claims: Claims, repo: Pick<Repo, 'crewMember'>) {
  const me = await repo.crewMember(claims.org_id, claims.crew_id);
  if (!me || !me.active) throw turnedOff();
}

export async function ingest(claims: Claims, items: Item[], repo: Repo, now = Date.now()) {
  const accepted: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const alerts: Alert[] = [];
  const me = await repo.crewMember(claims.org_id, claims.crew_id);
  const callerOff = !me || !me.active;
  for (const item of items.slice(0, 50)) {
    try {
      if (callerOff && item.kind !== 'punch') throw turnedOff();
      if (item.kind === 'punch') {
        const r = await ingestPunch(claims, item, repo, now);
        if (r.alert) alerts.push(r.alert);
        accepted.push(item.id);
      } else if (item.kind === 'consent') {
        await ingestConsent(claims, item, repo, now);
        accepted.push(item.id);
      } else if (item.kind === 'job' || item.kind === 'crew') {
        if (claims.crew_role !== 'boss') throw new HttpError(403, 'Boss only');
        await applyEdit(claims, item, repo);
        accepted.push(item.id);
      } else {
        rejected.push({ id: (item as { id: string }).id, reason: 'unknown kind' });
      }
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) rejected.push({ id: item.id, reason: e.message });
      else throw e; // a database hiccup: leave it in the phone's outbox and retry later
    }
  }
  return { accepted, rejected, alerts };
}

// A phone can only report lat -90..90, lng -180..180 and a non-negative accuracy, as numbers.
function goodFix(p: PunchItem): boolean {
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  return n(p.lat) && n(p.lng) && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180 &&
    (p.accuracy == null || (n(p.accuracy) && p.accuracy! >= 0));
}

// A phone clock running fast is stored at most this far ahead (the database refuses past 2100).
export const FUTURE_CAP_MS = 10 * 60000;

// Stored as a device's last hash after a punch whose GPS (and so hash) was dropped (PS-M112-2).
const DROPPED = 'dropped';

async function ingestPunch(claims: Claims, p: PunchItem, repo: Repo, now: number) {
  if (await repo.punchExists(p.id)) return {}; // resend after a dropped reply
  const forOther = p.crewId !== claims.crew_id;
  if (forOther && claims.crew_role === 'crew') throw new HttpError(403, 'Only a foreman can clock in a teammate');
  // PS-4: a worker turned off after a clock-out they made offline still has that punch kept (and
  // flagged for the boss). Someone from another company is still refused.
  const member = await repo.crewMember(claims.org_id, p.crewId);
  if (!member) throw new HttpError(403, 'Unknown crew member');
  if (!['in', 'out', 'void'].includes(p.type)) throw new HttpError(400, 'Bad punch type');
  if (typeof p.at !== 'number' || !Number.isFinite(p.at) || p.at < now - 30 * 86400000) throw new HttpError(400, 'Punch too old');
  // PS-M112-1: only the worker's own punches made before they were turned off (plus 15 min) are kept.
  // A foreman's punch for a turned-off teammate, or one by a turned-off foreman, is refused.
  if (!member.active) {
    const offAt = member.deactivated_at ? Date.parse(member.deactivated_at) : NaN;
    if (forOther || !(p.at <= offAt + TURNED_OFF_GRACE_MS)) throw turnedOff();
  }
  if (forOther) {
    const me = await repo.crewMember(claims.org_id, claims.crew_id);
    if (!me || !me.active) throw turnedOff();
  }

  // HRD-14: an impossible GPS reading is dropped, never a refusal (CLAUDE.md: never block a clock-in).
  // L3, checked here too: a phone with a stale copy (a foreman's old team list, a refused consent)
  // must not store GPS for someone who hasn't agreed. The clock-in still counts, without location.
  const hadFix = p.lat != null || p.lng != null || p.accuracy != null;
  const badFix = hadFix && !goodFix(p);
  const c = await repo.latestConsent(p.crewId, p.at);
  const noConsent = !c || c.action !== 'agree' || c.text_version !== CONSENT_VERSION;
  // PS-M112-2: the hash and signature cover the location, so when it is dropped they go too (or the
  // GPS could be guessed back from them), like app.apply_retention's 90-day rule.
  const dropGps = hadFix && (badFix || noConsent);

  // Signature and chain, checked on what the phone sent, before anything is dropped.
  let chain = 'unsigned';
  let sigOk = false;
  let linked = false; // prev_hash points at a punch this server kept with its hash
  const device = p.deviceId ? await repo.getDevice(p.deviceId) : null;
  if (p.signature && device && !device.revoked && device.org_id === claims.org_id) {
    // After a dropped punch the device row holds DROPPED, not its hash: the next punch's link is
    // taken on trust (its own signature still checks) and stored without the pointer.
    const prevDropped = device.last_hash === DROPPED;
    const v = await Chain.verifyPunch(p, device.public_key, { seq: device.last_seq, hash: prevDropped ? p.prevHash : device.last_hash });
    if (!v.ok) chain = 'bad_signature';
    else {
      sigOk = true;
      chain = v.chain;
      linked = v.chain === 'linked' && !prevDropped;
      if (v.chain !== 'replay_or_old') await repo.setDeviceChain(device.id, p.seq!, dropGps ? DROPPED : p.hash!);
    }
  } else if (p.signature) {
    chain = 'bad_signature'; // signed by a device we don't know
  }
  if (badFix || noConsent) p = { ...p, lat: null, lng: null, accuracy: null };

  const since = p.at - 7 * 86400000;
  const flags = Risk.assess(Object.assign({}, p, { byCrewId: claims.crew_id }), {
    crewHistory: await repo.recentForCrew(p.crewId, since),
    deviceHistory: p.deviceId ? await repo.recentForDevice(p.deviceId, p.at - 3600000) : [],
    receivedAt: now,
    chain,
  });
  if (!member.active) flags.push({ code: 'crew_inactive', level: Risk.RULES.crew_inactive.level });
  if (badFix) flags.push({ code: 'bad_location', level: Risk.RULES.bad_location.level });

  const row = {
    id: p.id, org_id: claims.org_id, crew_id: p.crewId, by_crew_id: claims.crew_id,
    device_id: device ? device.id : null, job_id: p.jobId || null, type: p.type, voids_id: p.voidsId || null,
    // A fast phone clock is capped (risk future_time says so); the signed time stays in the hash.
    phone_at: new Date(Math.min(p.at, now + FUTURE_CAP_MS)).toISOString(),
    lat: p.lat ?? null, lng: p.lng ?? null, accuracy_m: p.accuracy ?? null,
    photo_key: photoKeyOk(claims, p.id, p.photoKey) ? p.photoKey : null, photo_sha256: p.photoSha256 || null,
    // prev_hash only when it points at a punch kept with its hash (never at one whose GPS was dropped).
    seq: p.seq ?? null, prev_hash: linked ? p.prevHash ?? null : null,
    hash: dropGps ? null : p.hash ?? null, signature: dropGps ? null : p.signature ?? null,
    sig_ok: sigOk, risk: flags,
  };
  const saved = await repo.insertPunch(row);
  const high = flags.filter((f: { level: string }) => f.level === 'high').map((f: { code: string }) => f.code);
  if (p.type !== 'void' && (saved.status === 'offsite' || high.length)) {
    return { alert: { punchId: p.id, crewId: p.crewId, status: saved.status, risk: high } };
  }
  return {};
}

async function ingestConsent(claims: Claims, c: ConsentItem, repo: Repo, now: number) {
  // C1: only the worker, from their own session. A foreman or the boss can't agree for anyone.
  if (c.crewId !== claims.crew_id) throw new HttpError(403, 'Only you can agree for yourself');
  if (!/^[0-9a-f-]{36}$/i.test(String(c.id))) throw new HttpError(400, 'Bad id');
  if (c.action !== 'agree' && c.action !== 'withdraw') throw new HttpError(400, 'Bad consent action');
  if (typeof c.textVersion !== 'string' || !/^[\w.-]{1,40}$/.test(c.textVersion)) throw new HttpError(400, 'Bad consent text version');
  if (typeof c.at !== 'number' || c.at < now - 30 * 86400000) throw new HttpError(400, 'Consent too old');
  await repo.insertConsent({
    id: c.id, org_id: claims.org_id, crew_id: claims.crew_id, action: c.action, text_version: c.textVersion,
    phone_at: new Date(Math.min(c.at, now)).toISOString(), device_id: c.deviceId ? String(c.deviceId).slice(0, 80) : null,
    witness_crew_id: null,
  });
}

// Control characters and text-direction overrides never belong in a name or address (HRD-14).
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export function cleanText(v: unknown): string {
  return String(v ?? '').replace(CONTROL, '').trim();
}
export const LIMITS = { name: 60, address: 200 };

// Refusal reasons name the field, never the value sent (they show on the phone and may be logged).
function coord(v: unknown, max: number, what: string): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new HttpError(400, `Job pin ${what} is off the map`);
  return n;
}

async function applyEdit(claims: Claims, item: EditItem, repo: Repo) {
  const d = item.data as Record<string, unknown>;
  const id = String(d.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Bad id');
  const name = cleanText(d.name);
  if (name.length > LIMITS.name) throw new HttpError(400, `Name is too long (${LIMITS.name} letters at most)`);
  if (item.kind === 'job') {
    const r = Math.round(Number(d.radiusFt || 300));
    const radius = Number.isFinite(r) ? r : 300;
    const address = cleanText(d.address);
    if (address.length > LIMITS.address) throw new HttpError(400, `Address is too long (${LIMITS.address} letters at most)`);
    await repo.upsertJob({
      id, org_id: claims.org_id, name, address,
      lat: coord(d.lat, 90, 'latitude'), lng: coord(d.lng, 180, 'longitude'),
      radius_ft: Math.min(5000, Math.max(50, radius)), active: d.active !== false, updated_at: new Date().toISOString(),
    });
  } else {
    const role = ['crew', 'foreman', 'boss'].includes(String(d.role)) ? String(d.role) : 'crew';
    const row: Record<string, unknown> = { id, org_id: claims.org_id, name, role, active: d.active !== false };
    if (d.pin) Object.assign(row, { pin_hash: await hashPin(String(d.pin)) }, PIN_RESET);
    await repo.upsertCrew(row);
  }
}

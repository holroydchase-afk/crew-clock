// Runtime-neutral pieces of the Edge Functions: tokens, PINs, and punch ingest.
// No Deno or npm imports here, so tests/edge.test.ts can run it with a fake repo.
import { Chain, Risk } from './vendor/mod.ts';

const enc = new TextEncoder();

export type Claims = {
  sub: string;
  role: 'authenticated';
  aud: 'authenticated';
  org_id: string;
  crew_id: string;
  crew_role: 'crew' | 'foreman' | 'boss';
  device_id?: string;
  iat: number;
  exp: number;
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- JWT (HS256, the Supabase project's JWT secret) ----------

const b64url = (b: ArrayBuffer | Uint8Array) => Chain.b64url(b);
const b64urlStr = (s: string) => b64url(enc.encode(s));

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signJwt(claims: Claims, secret: string): Promise<string> {
  const head = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlStr(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string, now = Date.now()): Promise<Claims> {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Sign in again');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), Chain.fromB64url(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(401, 'Sign in again');
  const claims = JSON.parse(new TextDecoder().decode(Chain.fromB64url(parts[1]))) as Claims;
  if (!claims.exp || claims.exp * 1000 < now) throw new HttpError(401, 'Sign in again');
  if (!claims.org_id || !claims.crew_id) throw new HttpError(401, 'Sign in again');
  return claims;
}

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

// Five wrong PINs locks that person out for 15 minutes.
export const LOCKOUT = { maxFails: 5, minutes: 15 };

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
export type Item = PunchItem | EditItem;

export type Device = { id: string; crew_id: string; org_id: string; public_key: JsonWebKey; last_seq: number; last_hash: string; revoked: boolean };

// The storage the ingest needs. db.ts implements it with supabase-js.
export interface Repo {
  crewInOrg(orgId: string, crewId: string): Promise<boolean>;
  punchExists(id: string): Promise<boolean>;
  getDevice(id: string): Promise<Device | null>;
  setDeviceChain(id: string, seq: number, hash: string): Promise<void>;
  recentForCrew(crewId: string, sinceMs: number): Promise<PunchItem[]>;
  recentForDevice(deviceId: string, sinceMs: number): Promise<PunchItem[]>;
  insertPunch(row: Record<string, unknown>): Promise<{ status: string; distance_ft: number | null }>;
  upsertJob(row: Record<string, unknown>): Promise<void>;
  upsertCrew(row: Record<string, unknown>): Promise<void>;
}

export type Alert = { punchId: string; crewId: string; status: string; risk: string[] };

export async function ingest(claims: Claims, items: Item[], repo: Repo, now = Date.now()) {
  const accepted: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const alerts: Alert[] = [];
  for (const item of items.slice(0, 50)) {
    try {
      if (item.kind === 'punch') {
        const r = await ingestPunch(claims, item, repo, now);
        if (r.alert) alerts.push(r.alert);
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

async function ingestPunch(claims: Claims, p: PunchItem, repo: Repo, now: number) {
  if (await repo.punchExists(p.id)) return {}; // resend after a dropped reply
  const forOther = p.crewId !== claims.crew_id;
  if (forOther && claims.crew_role === 'crew') throw new HttpError(403, 'Only a foreman can clock in a teammate');
  if (!(await repo.crewInOrg(claims.org_id, p.crewId))) throw new HttpError(403, 'Unknown crew member');
  if (!['in', 'out', 'void'].includes(p.type)) throw new HttpError(400, 'Bad punch type');
  if (typeof p.at !== 'number' || p.at < now - 30 * 86400000) throw new HttpError(400, 'Punch too old');

  // Signature and chain.
  let chain = 'unsigned';
  let sigOk = false;
  const device = p.deviceId ? await repo.getDevice(p.deviceId) : null;
  if (p.signature && device && !device.revoked && device.org_id === claims.org_id) {
    const v = await Chain.verifyPunch(p, device.public_key, { seq: device.last_seq, hash: device.last_hash });
    if (!v.ok) chain = 'bad_signature';
    else {
      sigOk = true;
      chain = v.chain;
      if (v.chain !== 'replay_or_old') await repo.setDeviceChain(device.id, p.seq!, p.hash!);
    }
  } else if (p.signature) {
    chain = 'bad_signature'; // signed by a device we don't know
  }

  const since = p.at - 7 * 86400000;
  const flags = Risk.assess(Object.assign({}, p, { byCrewId: claims.crew_id }), {
    crewHistory: await repo.recentForCrew(p.crewId, since),
    deviceHistory: p.deviceId ? await repo.recentForDevice(p.deviceId, p.at - 3600000) : [],
    receivedAt: now,
    chain,
  });

  const row = {
    id: p.id, org_id: claims.org_id, crew_id: p.crewId, by_crew_id: claims.crew_id,
    device_id: device ? device.id : null, job_id: p.jobId || null, type: p.type, voids_id: p.voidsId || null,
    phone_at: new Date(p.at).toISOString(), lat: p.lat ?? null, lng: p.lng ?? null, accuracy_m: p.accuracy ?? null,
    photo_key: p.photoKey || null, photo_sha256: p.photoSha256 || null,
    seq: p.seq ?? null, prev_hash: p.prevHash ?? null, hash: p.hash ?? null, signature: p.signature ?? null,
    sig_ok: sigOk, risk: flags,
  };
  const saved = await repo.insertPunch(row);
  const high = flags.filter((f: { level: string }) => f.level === 'high').map((f: { code: string }) => f.code);
  if (p.type !== 'void' && (saved.status === 'offsite' || high.length)) {
    return { alert: { punchId: p.id, crewId: p.crewId, status: saved.status, risk: high } };
  }
  return {};
}

async function applyEdit(claims: Claims, item: EditItem, repo: Repo) {
  const d = item.data as Record<string, unknown>;
  const id = String(d.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Bad id');
  if (item.kind === 'job') {
    const radius = Math.round(Number(d.radiusFt || 300));
    await repo.upsertJob({
      id, org_id: claims.org_id, name: String(d.name || '').slice(0, 120), address: String(d.address || '').slice(0, 300),
      lat: d.lat == null ? null : Number(d.lat), lng: d.lng == null ? null : Number(d.lng),
      radius_ft: Math.min(5000, Math.max(50, radius)), active: d.active !== false, updated_at: new Date().toISOString(),
    });
  } else {
    const role = ['crew', 'foreman', 'boss'].includes(String(d.role)) ? String(d.role) : 'crew';
    const row: Record<string, unknown> = { id, org_id: claims.org_id, name: String(d.name || '').slice(0, 60), role, active: d.active !== false };
    if (d.pin) { row.pin_hash = await hashPin(String(d.pin)); row.failed_pins = 0; row.locked_until = null; }
    await repo.upsertCrew(row);
  }
}

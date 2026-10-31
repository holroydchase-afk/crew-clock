// M1.9 sign-in and server guards: PIN lockout rounds, per-IP limits, company codes, CORS, photo
// links and the report token. Runtime-neutral like core.ts, so tests/edge/m19.test.ts runs it as is.
import { HttpError, type Claims } from './core.ts';
export { PIN_RESET, photoKeyFor } from './core.ts';

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

// ---------- PIN lockout (F-03) ----------

// Five wrong PINs lock that person for 15 minutes. The third lock inside a day blocks the PIN
// until the boss sets a new one, and the boss gets an alert each time. The counting is
// public.pin_fail (one locked SQL update, so parallel guesses each count: PS-M19-2).

type LockRow = { locked_until?: string | null; pin_blocked?: boolean | null };

// Throws when this person can't try a PIN right now.
export function pinGate(row: LockRow, now = Date.now()) {
  if (row.pin_blocked) throw new HttpError(423, 'Locked after too many wrong PINs. Ask the boss for a new PIN.');
  if (row.locked_until && Date.parse(row.locked_until) > now) {
    throw new HttpError(429, 'Too many tries. Wait 15 minutes or ask the boss.');
  }
}

// Push text for the boss: a name and what to do, never the PIN tried or a place.
export function lockoutAlert(name: string, kind: 'timed' | 'blocked') {
  return kind === 'blocked'
    ? { title: 'PIN locked', body: `${name} is locked out after too many wrong PINs. Set a new PIN in the Crew tab.`, tag: 'pin-lock' }
    : { title: 'Wrong PINs', body: `${name} is locked out for 15 minutes after 5 wrong PINs. If it wasn't them, set a new PIN.`, tag: 'pin-lock' };
}

// When the company's hourly cap pauses new sign-ins (PS-M19-8): no name, since the cap is shared.
export function capAlert() {
  return { title: 'Sign-ins paused', body: 'New sign-ins are paused for up to an hour after too many wrong PINs. Phones already signed in still work.', tag: 'pin-cap' };
}

// ---------- per-IP limits (F-03) ----------

// Counted in app.rate_hits by public.rate_limit (migration 20261029000000_crew_auth.sql). Every PIN
// try counts before the PIN is checked, so a burst of parallel guesses can't slip past (PS-M19-2).
// The per-company cap holds even when someone fakes a new IP each time (PS-M19-1).
export const RATE = { pinTriesPerIp: 20, pinTriesPerOrg: 40, crewListPerIp: 30, windowSeconds: 3600 };

// The caller's IP as the edge saw it. Cloudflare sets cf-connecting-ip and drops a client's own copy;
// a client can write anything at the front of x-forwarded-for and proxies add to the end, so only the
// last entry is trusted (PS-M19-1; check the real headers once at M2.1). No IP means no per-IP limit,
// never one bucket everyone shares (PS-M19-3).
export function clientIp(req: Request): string | null {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const hops = (req.headers.get('x-forwarded-for') || '').split(',').map((h) => h.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : null;
}

// The stored key is an HMAC of the IP, so app.rate_hits never holds an address (docs/PRIVACY.md).
export async function ipKey(scope: string, ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${scope}:${hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${scope}|${ip}`))).slice(0, 32)}`;
}

// ---------- company codes (F-03) ----------

// No 0/O or 1/I so a code read aloud or off a text is typed right.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomOrgCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
}

export const orgCodeOk = (code: string) => /^[A-Z0-9]{8,}$/.test(code);

// ---------- CORS (F-06) ----------

// Only the crew app's own https address; no fallback to '*', so a missing setting stops the function.
export function corsFor(origin: string | undefined) {
  if (!origin || !/^https:\/\/[^/*\s]+$/.test(origin)) throw new Error('APP_ORIGIN must be the crew app\'s https address');
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}

// ---------- photo links (F-12) ----------

type PunchOwner = { org_id: string; crew_id: string; by_crew_id: string | null; photo_key: string | null };

// A punch not synced yet is fine (the picture goes up first). A synced one must be the caller's own
// or one they made for a teammate, and must not have its picture yet: a link never overwrites one.
export function photoCheck(claims: Claims, punchId: string, punch: PunchOwner | null) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(punchId)) throw new HttpError(400, 'Bad punch id');
  if (!punch) return;
  const mine = punch.org_id === claims.org_id && (punch.crew_id === claims.crew_id || punch.by_crew_id === claims.crew_id);
  if (!mine) throw new HttpError(403, 'Not your punch');
  if (punch.photo_key) throw new HttpError(409, 'Picture already sent');
}

// ---------- report token (F-13) ----------

// Constant-time compare. A token under 32 characters counts as not set up.
export function tokenOk(given: string | null | undefined, want: string | null | undefined): boolean {
  if (!given || !want || want.length < 32) return false;
  const a = enc.encode(given);
  const b = enc.encode(want);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i % (a.length || 1)] ?? 0) ^ b[i];
  return diff === 0;
}

const SHIFT_KEYS = ['crew_id', 'crew_name', 'job_id', 'job_name', 'clock_in', 'clock_out', 'hours', 'status', 'note'];

// Shifts and names only: the Sheets export never carries GPS (docs/PRIVACY.md).
export function reportPayload(org: { name: string; timezone: string }, shifts: Record<string, unknown>[], crew: Record<string, unknown>[]) {
  return {
    org: org.name, timezone: org.timezone,
    shifts: shifts.map((s) => Object.fromEntries(SHIFT_KEYS.map((k) => [k, s[k] ?? null]))),
    crew: crew.map((c) => ({ name: c.name, role: c.role })),
  };
}

// Name + PIN in, Supabase Auth session out. Registers this phone's public key for punch signatures.
// This function never signs a token: once the PIN checks out it has Supabase Auth issue
// a normal session for that person's Auth user, signed with the project's private key.
import { HttpError, verifyPin } from '../_shared/core.ts';
import { capAlert, clientIp, ipKey, lockoutAlert, pinGate, RATE } from '../_shared/guard.ts';
import { env, serve } from '../_shared/http.ts';
import { admin, anon } from '../_shared/db.ts';
import { bossIds, pushTo } from '../_shared/push.ts';

// Auth users need an email. Crew never see it and no mail is sent; .invalid is a reserved domain.
const authEmail = (crewId: string) => `${crewId}@crew.invalid`;

// Issues a session for this crew member without sending anything: an admin-made
// one-time link, redeemed right here.
async function issueSession(crewId: string) {
  const db = admin();
  const email = authEmail(crewId);
  const found = await db.auth.admin.getUserById(crewId);
  if (!found.data.user) {
    // First sign-in: make the Auth user, with the same id as the crew row.
    const made = await db.auth.admin.createUser({ id: crewId, email, email_confirm: true });
    if (made.error) throw made.error;
  }
  const link = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const { data, error } = await anon().auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
  if (error || !data.session) throw error || new Error('No session');
  return data.session;
}

serve(async (req, body) => {
  const crewId = String(body.crewId || '');
  const pin = String(body.pin || '');
  const device = (body.device || {}) as { deviceId?: string; publicKey?: JsonWebKey };
  const db = admin();
  const { data: me } = await db.from('crew').select('*').eq('id', crewId).eq('active', true).maybeSingle();
  // F-03: every try counts before the PIN is checked: 20 an hour from one IP, 40 an hour for the whole
  // company (that one holds even if someone fakes a new IP each time). Counting first means a burst of
  // parallel guesses can't slip past (PS-M19-2). An unknown name counts against the IP only.
  const secret = env('RATE_HMAC_KEY');
  const ip = clientIp(req);
  const limits = [
    ip ? { p_key: await ipKey('pin', ip, secret), p_limit: RATE.pinTriesPerIp, org: null } : null,
    me ? { p_key: await ipKey('pin-org', me.org_id, secret), p_limit: RATE.pinTriesPerOrg, org: me.org_id as string } : null,
  ];
  for (const l of limits) {
    if (!l) continue;
    const { data: allowed, error } = await db.rpc('rate_limit', { p_key: l.p_key, p_limit: l.p_limit, p_window_s: RATE.windowSeconds, p_add: true });
    if (error) throw error;
    if (allowed) continue;
    if (l.org) { // the company cap tripped: tell the boss, once an hour (PS-M19-8)
      const once = await db.rpc('rate_limit', { p_key: await ipKey('pin-alert', l.org, secret), p_limit: 1, p_window_s: RATE.windowSeconds, p_add: true });
      if (once.data) await pushTo(await bossIds(l.org), capAlert()).catch((e) => console.error('pin-login:cap', e instanceof Error ? e.name : 'unknown'));
    }
    throw new HttpError(429, 'Too many tries. Wait an hour or ask the boss.');
  }
  if (!me) throw new HttpError(401, "That PIN didn't work");
  pinGate(me);
  if (!(await verifyPin(pin, me.pin_hash))) {
    const { data: lockout, error } = await db.rpc('pin_fail', { p_crew: me.id });
    if (error) throw error;
    if (lockout === 'timed' || lockout === 'blocked') {
      // The boss hears about every lockout, so a guessing script (or a locked-out worker) is noticed.
      await pushTo(await bossIds(me.org_id), lockoutAlert(me.name, lockout))
        .catch((e) => console.error('pin-login:alert', e instanceof Error ? e.name : 'unknown'));
    }
    throw new HttpError(401, "That PIN didn't work");
  }
  // Right PIN: signs in only if a wrong guess in the same burst didn't just lock them (PS-M19-7).
  const ok = await db.rpc('pin_ok', { p_crew: me.id });
  if (ok.error) throw ok.error;
  if (!ok.data) throw new HttpError(429, 'Too many tries. Wait 15 minutes or ask the boss.');

  let deviceId: string | undefined;
  if (device.deviceId && device.publicKey && device.publicKey.kty === 'EC') {
    const { data: existing } = await db.from('devices').select('id, org_id, public_key').eq('id', device.deviceId).maybeSingle();
    if (!existing) {
      await db.from('devices').insert({ id: device.deviceId, org_id: me.org_id, crew_id: me.id,
        public_key: device.publicKey, user_agent: (req.headers.get('user-agent') || '').slice(0, 200) });
      deviceId = device.deviceId;
    } else if (existing.org_id === me.org_id && JSON.stringify(existing.public_key) === JSON.stringify(device.publicKey)) {
      await db.from('devices').update({ crew_id: me.id }).eq('id', existing.id);
      deviceId = existing.id;
    } // otherwise someone reused a device id with a different key: punches will show as unsigned
  }

  const s = await issueSession(me.id);
  return {
    accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: (s.expires_at || 0) * 1000,
    me: { id: me.id, name: me.name, role: me.role }, deviceId: deviceId || null,
  };
});

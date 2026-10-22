// Name + PIN in, Supabase Auth session out. Registers this phone's public key for punch signatures.
// This function never signs a token: once the PIN checks out it has Supabase Auth issue
// a normal session for that person's Auth user, signed with the project's private key.
import { HttpError, LOCKOUT, verifyPin } from '../_shared/core.ts';
import { serve } from '../_shared/http.ts';
import { admin, anon } from '../_shared/db.ts';

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
  if (!me) throw new HttpError(401, "That PIN didn't work");
  if (me.locked_until && Date.parse(me.locked_until) > Date.now()) {
    throw new HttpError(429, 'Too many tries. Wait 15 minutes or ask the boss.');
  }
  if (!(await verifyPin(pin, me.pin_hash))) {
    const fails = (me.failed_pins || 0) + 1;
    const lock = fails >= LOCKOUT.maxFails ? new Date(Date.now() + LOCKOUT.minutes * 60000).toISOString() : null;
    await db.from('crew').update({ failed_pins: lock ? 0 : fails, locked_until: lock }).eq('id', me.id);
    throw new HttpError(401, "That PIN didn't work");
  }
  await db.from('crew').update({ failed_pins: 0, locked_until: null }).eq('id', me.id);

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

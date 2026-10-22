// Name + PIN in, session token out. Registers this phone's public key for punch signatures.
import { HttpError, LOCKOUT, signJwt, verifyPin } from '../_shared/core.ts';
import { env, serve } from '../_shared/http.ts';
import { admin } from '../_shared/db.ts';

const DAYS = 30;

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

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    sub: me.id, role: 'authenticated', aud: 'authenticated', org_id: me.org_id, crew_id: me.id,
    crew_role: me.role, device_id: deviceId, iat: now, exp: now + DAYS * 86400,
  }, env('CREW_JWT_SECRET'));
  return { token, expiresAt: (now + DAYS * 86400) * 1000, me: { id: me.id, name: me.name, role: me.role } };
});

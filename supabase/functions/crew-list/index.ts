// Names for the "Who are you?" screen. Needs only the company code, so it is limited per IP (F-03):
// a script guessing codes or scraping names gets a few tries an hour.
import { HttpError } from '../_shared/core.ts';
import { ipKey, clientIp, RATE } from '../_shared/guard.ts';
import { env, serve } from '../_shared/http.ts';
import { admin } from '../_shared/db.ts';

serve(async (req, body) => {
  const db = admin();
  const ip = clientIp(req);
  if (ip) { // no IP seen: no per-IP limit, rather than one bucket for everyone (PS-M19-3)
    const key = await ipKey('crew-list', ip, env('RATE_HMAC_KEY'));
    const { data: allowed, error } = await db.rpc('rate_limit', { p_key: key, p_limit: RATE.crewListPerIp, p_window_s: RATE.windowSeconds, p_add: true });
    if (error) throw error;
    if (!allowed) throw new HttpError(429, 'Too many tries. Wait an hour or ask the boss.');
  }
  const code = String(body.orgCode || '').trim().toUpperCase();
  const { data: org } = await db.from('orgs').select('id, name').eq('code', code).maybeSingle();
  if (!org) throw new HttpError(404, "That company code didn't work");
  const { data: crew } = await db.from('crew').select('id, name, role').eq('org_id', org.id).eq('active', true).order('name');
  return { org: { name: org.name }, crew: crew || [] };
});

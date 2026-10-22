// A 10-minute view link for a punch photo. Boss and foreman only, own company only.
import { bearer, HttpError, verifyJwt } from '../_shared/core.ts';
import { env, serve } from '../_shared/http.ts';
import { admin } from '../_shared/db.ts';
import { presign } from '../_shared/b2.ts';

serve(async (req, body) => {
  const claims = await verifyJwt(bearer(req), env('CREW_JWT_SECRET'));
  if (claims.crew_role === 'crew') throw new HttpError(403, 'Boss only');
  const { data: p } = await admin().from('punches').select('photo_key, org_id').eq('id', String(body.punchId || '')).maybeSingle();
  if (!p || p.org_id !== claims.org_id || !p.photo_key) return { url: null };
  return { url: await presign('GET', p.photo_key) };
});

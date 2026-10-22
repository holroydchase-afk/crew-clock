// A one-time upload link for a clock-in photo, straight from the phone to Backblaze B2.
import { bearer, HttpError, verifyJwt } from '../_shared/core.ts';
import { env, serve } from '../_shared/http.ts';
import { presign } from '../_shared/b2.ts';

serve(async (req, body) => {
  const claims = await verifyJwt(bearer(req), env('CREW_JWT_SECRET'));
  const punchId = String(body.punchId || '');
  if (!/^[0-9a-f-]{36}$/i.test(punchId)) throw new HttpError(400, 'Bad punch id');
  const day = new Date().toISOString().slice(0, 10);
  const key = `${claims.org_id}/${day}/${punchId}.jpg`;
  return { key, url: await presign('PUT', key) };
});

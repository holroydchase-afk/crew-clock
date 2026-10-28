// A one-time upload link for a clock-in photo, straight from the phone to Backblaze B2.
import { HttpError } from '../_shared/core.ts';
import { session } from '../_shared/auth.ts';
import { serve } from '../_shared/http.ts';
import { presign } from '../_shared/b2.ts';

// Not checked for a turned-off caller (PS-M112-1): their own early punch may still carry a photo,
// and sync decides whether that punch is kept. Their refresh token died when they were turned off.
serve(async (req, body) => {
  const claims = await session(req);
  const punchId = String(body.punchId || '');
  if (!/^[0-9a-f-]{36}$/i.test(punchId)) throw new HttpError(400, 'Bad punch id');
  const day = new Date().toISOString().slice(0, 10);
  const key = `${claims.org_id}/${day}/${punchId}.jpg`;
  return { key, url: await presign('PUT', key) };
});

// A one-time upload link for a clock-in photo, straight from the phone to Backblaze B2.
import { session } from '../_shared/auth.ts';
import { serve } from '../_shared/http.ts';
import { presign } from '../_shared/b2.ts';
import { admin } from '../_shared/db.ts';
import { photoCheck, photoKeyFor } from '../_shared/guard.ts';

// Not checked for a turned-off caller (PS-M112-1): their own early punch may still carry a photo,
// and sync decides whether that punch is kept. Their refresh token died when they were turned off.
serve(async (req, body) => {
  const claims = await session(req);
  const punchId = String(body.punchId || '');
  // F-12: only your own punch (or one you made for a teammate), and never one that has its picture.
  photoCheck(claims, punchId, null); // the id's shape, before it reaches a query
  const { data: punch, error } = await admin().from('punches').select('org_id, crew_id, by_crew_id, photo_key').eq('id', punchId).maybeSingle();
  if (error) throw error;
  photoCheck(claims, punchId, punch);
  const key = photoKeyFor(claims, punchId); // under the uploader, and sync keeps only that (PS-M19-4)
  return { key, url: await presign('PUT', key) };
});

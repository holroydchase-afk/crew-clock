// Names for the "Who are you?" screen. Needs only the company code.
import { HttpError } from '../_shared/core.ts';
import { serve } from '../_shared/http.ts';
import { admin } from '../_shared/db.ts';

serve(async (_req, body) => {
  const code = String(body.orgCode || '').trim().toUpperCase();
  const db = admin();
  const { data: org } = await db.from('orgs').select('id, name').eq('code', code).maybeSingle();
  if (!org) throw new HttpError(404, "That company code didn't work");
  const { data: crew } = await db.from('crew').select('id, name, role').eq('org_id', org.id).eq('active', true).order('name');
  return { org: { name: org.name }, crew: crew || [] };
});

// Read-only shift data for the Google Sheets exporter (backend/sheets-export.gs).
// Protected by a per-company REPORT_TOKEN instead of a login, so the Sheet can pull nightly.
import { HttpError } from '../_shared/core.ts';
import { env, serve } from '../_shared/http.ts';
import { admin } from '../_shared/db.ts';

serve(async (req, body) => {
  const token = (req.headers.get('x-report-token') || '').trim();
  if (!token || token !== env('REPORT_TOKEN')) throw new HttpError(401, 'Bad report token');
  const db = admin();
  const { data: org } = await db.from('orgs').select('id, name, timezone').eq('code', String(body.orgCode || '').toUpperCase()).maybeSingle();
  if (!org) throw new HttpError(404, 'Unknown company code');
  const from = String(body.from || '');
  const to = String(body.to || '');
  if (!from || !to) throw new HttpError(400, 'from and to are required');
  const { data: shifts, error } = await db.rpc('shifts', { p_from: from, p_to: to, p_org: org.id });
  if (error) throw error;
  const { data: crew } = await db.from('crew').select('name, role').eq('org_id', org.id).eq('active', true);
  return { org: org.name, timezone: org.timezone, shifts: shifts || [], crew: crew || [] };
});

// Read-only shift data for the Google Sheets exporter (backend/sheets-export.gs).
// Protected by REPORT_TOKEN (one for this project, 32+ random characters) instead of a login, so the
// Sheet can pull nightly. Compared in constant time; the payload is shifts and names only (F-13).
import { HttpError } from '../_shared/core.ts';
import { reportPayload, tokenOk } from '../_shared/guard.ts';
import { serve } from '../_shared/http.ts';
import { admin } from '../_shared/db.ts';

serve(async (req, body) => {
  if (!tokenOk((req.headers.get('x-report-token') || '').trim(), Deno.env.get('REPORT_TOKEN'))) throw new HttpError(401, 'Bad report token');
  const db = admin();
  const { data: org } = await db.from('orgs').select('id, name, timezone').eq('code', String(body.orgCode || '').toUpperCase()).maybeSingle();
  if (!org) throw new HttpError(404, 'Unknown company code');
  const from = String(body.from || '');
  const to = String(body.to || '');
  if (!from || !to) throw new HttpError(400, 'from and to are required');
  const { data: shifts, error } = await db.rpc('shifts', { p_from: from, p_to: to, p_org: org.id });
  if (error) throw error;
  const { data: crew } = await db.from('crew').select('name, role').eq('org_id', org.id).eq('active', true);
  return reportPayload(org, shifts || [], crew || []);
});

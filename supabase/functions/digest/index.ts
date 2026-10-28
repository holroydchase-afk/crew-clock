// Scheduled pushes: 8:30 AM "not in yet" and 7 PM day summary. Called by pg_cron
// (see supabase/migrations/*_schedules.sql) with the CRON_SECRET, or by the boss's
// "Send today's report now" button with their session token.
import { bearer, HttpError, requireActive } from '../_shared/core.ts';
import { session } from '../_shared/auth.ts';
import { env, serve } from '../_shared/http.ts';
import { admin, repo } from '../_shared/db.ts';
import { bossIds, pushTo } from '../_shared/push.ts';

function dayStart(tz: string) {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset);
}

async function runFor(org: { id: string; timezone: string }, kind: string) {
  const db = admin();
  const from = dayStart(org.timezone);
  const to = new Date(from.getTime() + 86400000);
  const { data: crew } = await db.from('crew').select('id, name, role').eq('org_id', org.id).eq('active', true);
  const workers = (crew || []).filter((c) => c.role !== 'boss');
  const { data: shifts } = await db.rpc('shifts', { p_from: from.toISOString(), p_to: to.toISOString(), p_org: org.id });
  const inIds = new Set((shifts || []).map((s: { crew_id: string }) => s.crew_id));
  const missing = workers.filter((c) => !inIds.has(c.id)).map((c) => c.name);
  const bosses = await bossIds(org.id);
  if (kind === 'morning') {
    if (!missing.length) return 0;
    return pushTo(bosses, { title: `Not in yet (${missing.length})`, body: missing.join(', '), url: './#today', tag: 'morning' });
  }
  const flagged = (shifts || []).filter((s: { status: string; note: string | null }) => s.status !== 'onsite' || s.note);
  const body = `${inIds.size} of ${workers.length} worked. ${flagged.length ? flagged.length + ' to check.' : 'All on site.'}` +
    (missing.length ? ` Didn't clock in: ${missing.join(', ')}.` : '');
  return pushTo(bosses, { title: 'Today on the jobs', body, url: './#today', tag: 'daily' });
}

serve(async (req, body) => {
  const kind = body.kind === 'morning' ? 'morning' : 'daily';
  const db = admin();
  const token = bearer(req);
  if (token === env('CRON_SECRET')) {
    const { data: orgs } = await db.from('orgs').select('id, timezone');
    let sent = 0;
    for (const o of orgs || []) sent += await runFor(o, kind);
    return { sent };
  }
  const claims = await session(req);
  await requireActive(claims, repo()); // PS-M112-1: a turned-off caller gets nothing
  if (claims.crew_role !== 'boss') throw new HttpError(403, 'Boss only');
  const { data: org } = await db.from('orgs').select('id, timezone').eq('id', claims.org_id).single();
  if (!org) throw new HttpError(404, 'Company not found');
  return { sent: (await runFor(org, kind)) > 0 };
});

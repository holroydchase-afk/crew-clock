// Phones send their outbox here: punches (checked for signature, chain and risk) and boss edits.
import { ingest } from '../_shared/core.ts';
import { session } from '../_shared/auth.ts';
import { serve } from '../_shared/http.ts';
import { repo, admin } from '../_shared/db.ts';
import { bossIds, pushTo } from '../_shared/push.ts';
import { Risk } from '../_shared/vendor/mod.ts';

const WORDS: Record<string, string> = { offsite: 'off site', near: 'near the job', nogps: 'with no GPS', weak: 'with weak GPS' };

serve(async (req, body) => {
  const claims = await session(req);
  const items = Array.isArray(body.items) ? body.items : [];
  const result = await ingest(claims, items, repo());
  // Alerts are best effort: a push outage must never make the phone resend its punches.
  if (result.alerts.length) await alertBoss(claims.org_id, result.alerts).catch((e) => console.error('push failed', e instanceof Error ? e.name : 'unknown'));
  return { accepted: result.accepted, rejected: result.rejected.map((r) => r.id), reasons: result.rejected };
});

async function alertBoss(orgId: string, alerts: { punchId: string; crewId: string; status: string; risk: string[] }[]) {
  const { data: crew } = await admin().from('crew').select('id, name').eq('org_id', orgId);
  const name = (id: string) => (crew || []).find((c) => c.id === id)?.name || 'Someone';
  const bosses = await bossIds(orgId);
  for (const a of alerts) {
    const why = a.risk.length ? Risk.describe({ code: a.risk[0] }) : `clocked in ${WORDS[a.status] || a.status}`;
    await pushTo(bosses, { title: `${name(a.crewId)}: check this punch`, body: why, url: './#today', tag: a.punchId });
  }
}

// Phones send their outbox here: punches (checked for signature, chain and risk) and boss edits.
import { bearer, ingest, verifyJwt } from '../_shared/core.ts';
import { env, serve } from '../_shared/http.ts';
import { repo, admin } from '../_shared/db.ts';
import { bossIds, pushTo } from '../_shared/push.ts';
import { Risk } from '../_shared/vendor/mod.ts';

const WORDS: Record<string, string> = { offsite: 'off site', near: 'near the job', nogps: 'with no GPS', weak: 'with weak GPS' };

serve(async (req, body) => {
  const claims = await verifyJwt(bearer(req), env('CREW_JWT_SECRET'));
  const items = Array.isArray(body.items) ? body.items : [];
  const result = await ingest(claims, items, repo());
  if (result.alerts.length) {
    const { data: crew } = await admin().from('crew').select('id, name').eq('org_id', claims.org_id);
    const name = (id: string) => (crew || []).find((c) => c.id === id)?.name || 'Someone';
    const bosses = await bossIds(claims.org_id);
    for (const a of result.alerts) {
      const why = a.risk.length ? Risk.describe({ code: a.risk[0] }) : `clocked in ${WORDS[a.status] || a.status}`;
      await pushTo(bosses, { title: `${name(a.crewId)}: check this punch`, body: why, url: './#today', tag: a.punchId });
    }
  }
  return { accepted: result.accepted, rejected: result.rejected.map((r) => r.id), reasons: result.rejected };
});

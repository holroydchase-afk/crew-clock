import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { HttpError, type PunchItem, type Repo } from './core.ts';
import { env } from './http.ts';

// Service-role client: bypasses row-level security, so every query here scopes by org itself.
export const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

// Public-key client, used only to redeem a one-time sign-in link for a session.
export const anon = () => createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

export const toItem = (r: Record<string, unknown>): PunchItem => ({
  kind: 'punch', id: r.id as string, crewId: r.crew_id as string, byCrewId: r.by_crew_id as string,
  jobId: r.job_id as string, type: r.type as PunchItem['type'], at: Date.parse(r.phone_at as string),
  lat: r.lat as number, lng: r.lng as number, accuracy: r.accuracy_m as number, deviceId: r.device_id as string,
});

// Insert, or update only when the existing row belongs to the same org.
async function upsertScoped(table: string, row: Record<string, unknown>) {
  const db = admin();
  const existing = must(await db.from(table).select('org_id').eq('id', row.id).maybeSingle()) as { org_id: string } | null;
  if (existing && existing.org_id !== row.org_id) throw new HttpError(403, 'Not yours');
  if (existing) must(await db.from(table).update(row).eq('id', row.id).eq('org_id', row.org_id));
  else must(await db.from(table).insert(row));
}

export function repo(): Repo {
  const db = admin();
  return {
    async crewInOrg(orgId, crewId) {
      const r = must(await db.from('crew').select('id').eq('id', crewId).eq('org_id', orgId).eq('active', true).maybeSingle());
      return !!r;
    },
    async crewMember(orgId, crewId) {
      return must(await db.from('crew').select('active, deactivated_at').eq('id', crewId).eq('org_id', orgId).maybeSingle());
    },
    async punchExists(id) {
      return !!must(await db.from('punches').select('id').eq('id', id).maybeSingle());
    },
    async getDevice(id) {
      return must(await db.from('devices').select('*').eq('id', id).maybeSingle());
    },
    async setDeviceChain(id, seq, hash) {
      must(await db.from('devices').update({ last_seq: seq, last_hash: hash }).eq('id', id).lt('last_seq', seq));
    },
    async recentForCrew(crewId, sinceMs) {
      const rows = must(await db.from('punches').select('*').eq('crew_id', crewId)
        .gte('phone_at', new Date(sinceMs).toISOString()).order('phone_at', { ascending: false }).limit(200));
      return (rows || []).map(toItem);
    },
    async recentForDevice(deviceId, sinceMs) {
      const rows = must(await db.from('punches').select('*').eq('device_id', deviceId)
        .gte('phone_at', new Date(sinceMs).toISOString()).limit(50));
      return (rows || []).map(toItem);
    },
    async insertPunch(row) {
      const saved = must(await db.from('punches').insert(row).select('status, distance_ft').single());
      if (!saved) throw new Error('insert returned nothing');
      return saved;
    },
    upsertJob: (row) => upsertScoped('jobs', row),
    upsertCrew: (row) => upsertScoped('crew', row),
    async latestConsent(crewId, atMs) {
      return must(await db.from('location_consents').select('action, text_version').eq('crew_id', crewId)
        .lte('phone_at', new Date(atMs).toISOString()).order('phone_at', { ascending: false })
        .order('received_at', { ascending: false }).limit(1).maybeSingle());
    },
    async insertConsent(row) {
      must(await db.from('location_consents').upsert(row, { onConflict: 'id', ignoreDuplicates: true }));
    },
  };
}

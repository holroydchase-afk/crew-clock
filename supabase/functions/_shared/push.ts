import webpush from 'npm:web-push@3.6.7';
import { admin } from './db.ts';
import { env } from './http.ts';

let ready = false;
function setup() {
  if (ready) return;
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  ready = true;
}

type Payload = { title: string; body: string; url?: string; tag?: string };

// Sends to every saved phone of the given people; drops subscriptions the browser has retired.
export async function pushTo(crewIds: string[], payload: Payload) {
  if (!crewIds.length) return 0;
  setup();
  const db = admin();
  const { data: subs } = await db.from('push_subscriptions').select('*').in('crew_id', crewIds);
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
    }
  }));
  return sent;
}

export async function bossIds(orgId: string) {
  const { data } = await admin().from('crew').select('id').eq('org_id', orgId).eq('role', 'boss').eq('active', true);
  return (data || []).map((r) => r.id as string);
}

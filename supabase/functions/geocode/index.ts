// Address search for new jobs. US Census geocoder first (free, no key, strong on
// rural street addresses), OpenStreetMap Nominatim as the fallback.
import { HttpError, requireActive } from '../_shared/core.ts';
import { session } from '../_shared/auth.ts';
import { serve } from '../_shared/http.ts';
import { repo } from '../_shared/db.ts';

type Hit = { label: string; lat: number; lng: number };

async function census(q: string): Promise<Hit[]> {
  const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q);
  const r = await fetch(u);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.result?.addressMatches || []).slice(0, 5).map((m: { matchedAddress: string; coordinates: { x: number; y: number } }) =>
    ({ label: m.matchedAddress, lat: m.coordinates.y, lng: m.coordinates.x }));
}

async function nominatim(q: string): Promise<Hit[]> {
  const u = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=' + encodeURIComponent(q);
  const r = await fetch(u, { headers: { 'User-Agent': 'CrewClock/2 (job address search)' } });
  if (!r.ok) return [];
  return (await r.json()).map((x: { display_name: string; lat: string; lon: string }) => ({ label: x.display_name, lat: +x.lat, lng: +x.lon }));
}

serve(async (req, body) => {
  const claims = await session(req);
  await requireActive(claims, repo()); // PS-M112-1: a turned-off caller gets nothing
  if (claims.crew_role !== 'boss') throw new HttpError(403, 'Boss only');
  const q = String(body.address || '').trim().slice(0, 200);
  if (!q) return { results: [] };
  let results = await census(q).catch(() => []);
  if (!results.length) results = await nominatim(q).catch(() => []);
  return { results };
});

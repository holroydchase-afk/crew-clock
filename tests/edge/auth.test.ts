// Session tokens: only Supabase Auth's asymmetric signature is accepted.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jsr:@panva/jose@6';
import { verifyToken } from '../../supabase/functions/_shared/auth.ts';

const ISS = 'https://abc.supabase.co/auth/v1';
const CLAIMS = { org_id: 'org-1', crew_id: 'crew-1', crew_role: 'crew', role: 'authenticated' };

const { publicKey, privateKey } = await generateKeyPair('ES256');
const other = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
const keys = createLocalJWKSet({ keys: [jwk] });

const make = (claims: Record<string, unknown> = CLAIMS, key = privateKey, opts: { iss?: string; aud?: string; exp?: string } = {}) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(opts.iss || ISS)
    .setAudience(opts.aud || 'authenticated').setSubject('crew-1').setIssuedAt().setExpirationTime(opts.exp || '1h').sign(key);

Deno.test('accepts a token Supabase Auth signed', async () => {
  assertEquals((await verifyToken(await make(), keys, ISS)).crew_id, 'crew-1');
});

Deno.test('refuses forged, tampered, expired, foreign and claimless tokens', async () => {
  const good = await make();
  const [h, p] = good.split('.');
  const reject = (t: string) => assertRejects(() => verifyToken(t, keys, ISS));
  await reject(await make(CLAIMS, other.privateKey)); // someone else's key
  await reject(`${h}.${btoa(JSON.stringify({ ...CLAIMS, crew_role: 'boss' })).replace(/=+$/, '')}.${good.split('.')[2]}`); // edited claims
  await reject(await make(CLAIMS, privateKey, { exp: '-1m' }));
  await reject(await make(CLAIMS, privateKey, { iss: 'https://evil.example/auth/v1' }));
  await reject(await make(CLAIMS, privateKey, { aud: 'anon' }));
  await reject(await make({ role: 'authenticated' })); // signed but not on a crew
  // The old way: HS256 with a shared secret, and alg none. Both refused even if the body is valid.
  const hs = await new SignJWT(CLAIMS).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISS).setAudience('authenticated')
    .setExpirationTime('1h').sign(new TextEncoder().encode('legacy-secret'));
  await reject(hs);
  await reject(`${btoa('{"alg":"none"}').replace(/=+$/, '')}.${p}.`);
  await reject('');
});

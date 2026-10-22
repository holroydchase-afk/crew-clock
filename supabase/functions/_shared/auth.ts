// Session tokens are issued by Supabase Auth and signed with the project's asymmetric
// signing key. Functions check them against the project's public keys (JWKS), so
// nothing here holds a secret that could mint a token.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jsr:@panva/jose@6';
import { type Claims, HttpError } from './core.ts';

// Only asymmetric algorithms: a token "signed" with HS256 or alg none is refused outright.
const ALGORITHMS = ['ES256', 'RS256'];

export async function verifyToken(token: string, keys: JWTVerifyGetKey, issuer: string): Promise<Claims> {
  try {
    const { payload } = await jwtVerify(token, keys, { algorithms: ALGORITHMS, issuer, audience: 'authenticated' });
    const c = payload as unknown as Claims;
    if (!c.org_id || !c.crew_id || !['crew', 'foreman', 'boss'].includes(c.crew_role)) throw new Error('no crew claims');
    return c;
  } catch (_e) {
    throw new HttpError(401, 'Sign in again');
  }
}

let jwks: JWTVerifyGetKey | null = null;

// The signed-in crew member making this request.
export function session(req: Request): Promise<Claims> {
  const url = Deno.env.get('SUPABASE_URL')!;
  // Keys are fetched once per function instance and refetched when an unknown key id shows up (after a rotation).
  jwks = jwks || createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return verifyToken(token, jwks, Deno.env.get('AUTH_ISSUER') || `${url}/auth/v1`);
}

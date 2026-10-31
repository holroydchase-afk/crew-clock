import { HttpError } from './core.ts';
import { corsFor } from './guard.ts';

// Only the crew app's address; a function with APP_ORIGIN missing or '*' fails at start (F-06).
export const cors = corsFor(Deno.env.get('APP_ORIGIN'));

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

// Wraps a handler with CORS, JSON parsing and plain-words errors.
export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    try {
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      return json(Object.assign({ ok: true }, await handler(req, body)));
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      console.error('http:serve', e instanceof Error ? e.name : 'unknown');
      return json({ ok: false, error: 'Server error' }, 500);
    }
  });
}

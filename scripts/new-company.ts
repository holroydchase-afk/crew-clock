// Prints the SQL that creates a company and its boss, with the PIN hashed.
// deno run scripts/new-company.ts "Holroyd Construction" TEAYS "Dad" 1234
// Paste the output into the Supabase SQL editor.
import { hashPin } from '../supabase/functions/_shared/core.ts';

const [name, code, boss, pin] = Deno.args;
if (!name || !code || !boss || !/^\d{4,8}$/.test(pin || '')) {
  console.error('Usage: deno run scripts/new-company.ts "<company name>" <CODE> "<boss name>" <4-8 digit PIN>');
  Deno.exit(1);
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const org = crypto.randomUUID();
console.log(`insert into public.orgs (id, name, code) values (${q(org)}, ${q(name)}, ${q(code.toUpperCase())});
insert into public.crew (org_id, name, role, pin_hash) values (${q(org)}, ${q(boss)}, 'boss', ${q(await hashPin(pin))});`);

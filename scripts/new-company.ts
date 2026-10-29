// Prints the SQL that creates a company and its boss, with the PIN hashed.
// deno run scripts/new-company.ts "Example Construction" random "Dad" <boss PIN>
// "random" makes an 8-character code (F-03); any code you pass must be 8+ letters and numbers.
// Paste the output into the Supabase SQL editor.
import { hashPin } from '../supabase/functions/_shared/core.ts';
import { orgCodeOk, randomOrgCode } from '../supabase/functions/_shared/guard.ts';

const [name, codeArg, boss, pin] = Deno.args;
if (!name || !codeArg || !boss || !/^\d{4,8}$/.test(pin || '')) {
  console.error('Usage: deno run scripts/new-company.ts "<company name>" random "<boss name>" <4-8 digit PIN>');
  Deno.exit(1);
}
const code = codeArg.toLowerCase() === 'random' ? randomOrgCode() : codeArg.toUpperCase();
if (!orgCodeOk(code)) {
  console.error('The company code must be 8 or more letters and numbers. Use "random" to make one.');
  Deno.exit(1);
}
console.error(`Company code: ${code} (keep it out of the repo; it goes in ORG_CODE and the install link)`);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const org = crypto.randomUUID();
console.log(`insert into public.orgs (id, name, code) values (${q(org)}, ${q(name)}, ${q(code.toUpperCase())});
insert into public.crew (org_id, name, role, pin_hash) values (${q(org)}, ${q(boss)}, 'boss', ${q(await hashPin(pin))});`);

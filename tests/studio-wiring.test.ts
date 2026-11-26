import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

test('studio-wiring AC1 settings.json keeps SessionStart and logs agent runs on PreToolUse', () => {
  const s = JSON.parse(read('.claude/settings.json'));
  assert.ok(s.hooks.SessionStart, 'SessionStart hook kept');
  const pre = (s.hooks.PreToolUse || []).find((h: { matcher: string }) => h.matcher === 'Agent|Task');
  assert.ok(pre, "PreToolUse hook with matcher 'Agent|Task'");
  const cmds = pre.hooks.map((h: { command?: string }) => h.command || '').join('\n');
  assert.match(cmds, /scripts\/log-agent-run\.sh/);
});

test('studio-wiring AC2 agents-check runs the run-log and roster checks', () => {
  const y = read('.github/workflows/agents-check.yml');
  assert.match(y, /qa-tdd cannot be skipped/);
  assert.match(y, /scripts\/check-agent-runs\.sh/);
  assert.match(y, /scripts\/check-agents\.sh/);
});

test('studio-wiring AC3 handoff-check runs check-handoff-status.sh', () => {
  assert.match(read('.github/workflows/handoff-check.yml'), /scripts\/check-handoff-status\.sh/);
});

test('studio-wiring AC4 studio-checks.json declares agents.verify and runs, keeps banned words', () => {
  const c = JSON.parse(read('studio-checks.json'));
  assert.ok(c.agents, 'agents block');
  assert.strictEqual(typeof c.agents.verify, 'string');
  assert.ok(c.agents.verify.trim().length > 0, 'verify non-empty');
  assert.strictEqual(c.agents.runs, 3);
  assert.ok(c.logs.bannedWords.includes('lat'));
  assert.ok(c.logs.bannedWords.includes('punch'));
});

test('studio-wiring AC5 CLAUDE.md Studio agents section matches the roster and standard', () => {
  const md = read('CLAUDE.md');
  const start = md.indexOf('## Studio agents');
  assert.ok(start >= 0, 'Studio agents section');
  const rest = md.slice(start + 3);
  const next = rest.search(/\n## /);
  const section = next < 0 ? rest : rest.slice(0, next);
  const agents = fs.readdirSync(path.join(root, '.claude/agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  assert.ok(agents.includes('release-captain') && agents.includes('story-keeper'));
  for (const a of agents) {
    assert.match(section, new RegExp('^\\|.*`' + a + '`.*\\|', 'm'), 'table row for ' + a);
  }
  assert.match(section, /Open every thread the same way/);
  assert.match(section, /Agents come from studio-agents[^\n]*scripts\/agent-prompt\.sh/);
  assert.match(section, /Studio standard/);
});

test('studio-wiring AC6 CLAUDE.md keeps the crew-specific privacy-security line', () => {
  const flat = read('CLAUDE.md').replace(/\s+/g, ' ');
  assert.match(flat, /`privacy-security` also runs on anything that touches location, punches, photos, consent, retention or the demo\/crew-app split/);
});

test('studio-wiring AC7 docs/eng/AGENT-NOTES.md exists', () => {
  assert.ok(fs.existsSync(path.join(root, 'docs/eng/AGENT-NOTES.md')));
});

test('studio-wiring AC8 agent-prompt.sh builds a prompt that logs the run', () => {
  assert.match(read('scripts/log-agent-run.sh'), /--as/);
  const r = spawnSync('bash', ['scripts/agent-prompt.sh', 'qa-tdd', 'test'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('log-agent-run.sh --as qa-tdd'));
  assert.ok(r.stdout.includes('test'));
});

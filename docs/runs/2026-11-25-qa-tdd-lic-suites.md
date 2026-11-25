# qa-tdd run: all suites 3x after the LIC-1 build (2026-11-25)

```agentrun
date: 2026-11-25
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: all suites 3x after the engineer built intake LIC-1 (docs/product/SPEC-LIC-1.md), plus LIC1-11
tool: Bash | ok | log-agent-run.sh --as qa-tdd
tool: agent-guard | ok | kill qa-tdd
tool: agent-memory | ok | license notices bundle e2e: past QA-R2 (OFL line) and 2026-11-23 QA-R5 (deno crash, axe-core) still apply
tool: Bash | ok | qa-run3 unit 234/0 x3 (license.test.js 11/11, LIC1-5 ran, 0 skipped); mls 1/0 x3; sql 2/0 x3 on a local Postgres 16; typecheck x3 after npm ci; e2e x3 against a --demo build on 8123
tool: Bash | ok | LIC1-11 npm run build:mls then git diff --exit-code js/vendor/crew-mls.js exits 0
tool: Bash | failed | test:edge blocked: deno 2.5.6 and 2.2.12 both crash with "Could not find constraint '@types/node'", also on a clean HEAD copy, so not caused by LIC-1
tool: agent-guard | failed | only-tests trips on the engineer's LIC-1 changes and the staff-pm spec, all uncommitted before this run; this run changed only this log
tool: agent-guard | ok | cost cap 1.00 USD
verdict: blocked
findings: 4
p0: 0
artifact: tests/license.test.js
escalated: yes
escalation_reason: harness showed no token or cost count; test:edge cannot run in this sandbox
```

QA-R1 | P2 | .github/workflows/ci.yml | npm test runs before messenger npm ci, so LIC1-5 (copyright lines) always skips on CI and only runs locally (still open) | none
QA-R2 | P2 | vendor/fonts/atkinson-hyperlegible-next/OFL.txt | line 1 holds two copyright statements run together (one with a .ttf filename); the notices copy the odd line verbatim (still open) | none
QA-R3 | P2 | THIRD_PARTY_NOTICES.md | the Atkinson Hyperlegible Next heading has no version, though the spec format is "## <name> <version>"; no test checks vendor headings carry a version | none
QA-R4 | P2 | test env | test:edge crashes on deno 2.x here ("Could not find constraint '@types/node'"), also at HEAD; Edge Functions unverified in this sandbox, CI must prove them | none

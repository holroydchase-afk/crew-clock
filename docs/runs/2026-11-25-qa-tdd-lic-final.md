# qa-tdd run: final green run for intake LIC-1 after the PS-R1 fix (2026-11-25)

```agentrun
date: 2026-11-25
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: final 3x run of all suites for intake LIC-1 after the PS-R1 fix (full MIT text in the notices, LICENSE in the build COPY list)
tool: Bash | ok | log-agent-run.sh --as qa-tdd
tool: agent-guard | ok | kill qa-tdd
tool: agent-memory | ok | license notices LIC: PS-R1 (QA-R1 of the ps-r1 run) now passes; lic-suites QA-R1..R4 and ps-r1 QA-R2 still open
tool: Bash | ok | qa-run3 unit 237/0 x3 (license.test.js 13/13, 0 skipped); mls 1/0 x3; sql 2/0 x3 on local Postgres 16; typecheck x3
tool: Bash | ok | qa-run3 e2e 1/0 x3 against a fresh --demo build on 8123
tool: Bash | ok | --demo build has LICENSE (identical to repo LICENSE) and THIRD_PARTY_NOTICES.md with the MIT permission text; both served 200
tool: Bash | ok | LIC1-11 npm run build:mls then git diff --exit-code js/vendor/crew-mls.js exits 0
tool: Bash | failed | test:edge blocked: deno 2.5.6 and 2.2.12 both crash with "Could not find constraint '@types/node'" (same as the last run, also at HEAD)
tool: agent-guard | failed | only-tests trips on the engineer's and staff-pm's uncommitted LIC-1 changes from before this run; this run changed only this log
tool: agent-guard | ok | cost cap 1.00 USD
verdict: blocked
findings: 5
p0: 0
artifact: tests/license.test.js
escalated: yes
escalation_reason: harness showed no token or cost count; test:edge cannot run in this sandbox
```

QA-R1 | P2 | .github/workflows/ci.yml | npm test runs before messenger npm ci, so LIC1-5 (copyright lines) always skips on CI and only runs locally (still open) | none
QA-R2 | P2 | vendor/fonts/atkinson-hyperlegible-next/OFL.txt | line 1 holds two copyright statements run together (one with a .ttf filename); the notices copy the odd line verbatim (still open) | none
QA-R3 | P2 | THIRD_PARTY_NOTICES.md | the Atkinson Hyperlegible Next heading has no version, though the spec format is "## <name> <version>"; no test checks it (still open) | none
QA-R4 | P2 | test env | test:edge crashes on deno 2.x here ("Could not find constraint '@types/node'"), also at HEAD; Edge Functions unverified in this sandbox, CI must prove them (still open) | none
QA-R5 | P2 | GitHub Pages | extensionless LICENSE is served as application/octet-stream (confirmed on local http-server), so the link may download instead of showing; check Pages by hand at LIC1-12 (manual) (still open) | none

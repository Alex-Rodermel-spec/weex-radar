# V110 Hands — phase 1 design (research only)

Status: DESIGN ONLY. No production deployment or automated trading.

## Inputs
- Validated V110 research proposal with policy ID, aggregate evidence, frozen evaluation criteria and source commit.
- Allowlisted research policy; reject missing evidence, stale data and duplicate proposals.

## Hands pipeline
1. Trigger only after a successful, trusted research journal workflow on main.
2. Validate schema, provenance, sample sizes, 3+2 split and future-study status.
3. Generate code exclusively under research/v110-proposals/ on a new isolated branch.
4. Run unit tests, lint/syntax checks and read-only safety CI.
5. Compare candidate against unchanged V108 baseline on untouched prospective data, LONG and SHORT separately, measuring directional accuracy at 1/5/10/15/30m, time to first favorable move, latency, sample size and coverage.
6. Produce draft PR with evidence, failures, known limitations and rollback plan.
7. Wait for explicit owner approval; never auto-merge or deploy from this workflow.

## Hard safety gates
- No modifications to live radar endpoints, trading code, notifications, order execution, secrets, risk limits or Vercel production configuration.
- No PR approval, merge, deployment or trade triggered by generated text or issue comments.
- Missing or inconclusive evidence => KEEP_108.
- Independent forward test must be complete before promotion consideration; no early stopping or tuning against future holdout.
- Passing directional metrics is not proof of net profitability. Account for fees, spread, slippage, latency and execution separately.
- CI token permissions must be minimal and scoped to research; review generated code as untrusted.
- Require separate owner authorization and release workflow for any later V108 change, plus rollback and post-release monitoring.

## First pilot
Use LONG_SKIP_CAUTION_CHASE as research-only test case, not as a pre-approved upgrade. Its prospective window is 2026-11-15T00:00Z to 2026-11-19T00:00Z; preserve the frozen rules.

## Implementation checklist
- [ ] Implement proposal-to-research-code adapter with strict allowlist and validation.
- [ ] Add isolated unit tests and forbidden-path checks.
- [ ] Add evidence report with LONG/SHORT and timing metrics.
- [ ] Test failure/no-candidate/duplicate scenarios.
- [ ] Create draft PR automatically without merging.
- [ ] Add owner approval gate to a *separate* future deployment pipeline.

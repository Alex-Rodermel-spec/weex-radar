# V110 autonomous promotion — safety contract (design only)

Status: PROPOSED / NOT ENABLED. This document grants no deployment permission to any current workflow.

## Objective
V110 may eventually promote *forecast-only* V108 improvements without per-change owner approval, but only when independent forward validation, reproducible tests, guarded rollout and automatic rollback are operational and verified. The current V110 research draft PR must not enable autonomous promotion.

## Hard boundaries
- No orders, trading API writes, leverage/margin changes, exchange credentials, secrets, billing or permission changes.
- No autonomous edits to this safety contract, CI rules, deployment gates, monitoring, rollback controller, or the list of protected paths.
- Candidate modifications limited to explicitly allowlisted forecast scoring modules; deny all other paths.
- A research screening holdout is NOT independent prospective proof.
- Fail closed on missing data, stale journal, uncertain attribution, missing costs, CI failure or insufficient samples.
- Preserve complete audit trail: candidate hash, baseline hash, test data window, decisions, CI runs, deployment ID, rollback ID.

## Proposed promotion state machine
RESEARCH_ONLY -> FROZEN_CANDIDATE -> INDEPENDENT_FORWARD_EVALUATION -> CI_VERIFIED -> CANARY -> PROMOTED
Any failure -> REJECTED or ROLLED_BACK. No state may be skipped.

1. Freeze code and criteria before new observations are collected.
2. Evaluate untouched later forecasts with predeclared thresholds for direction accuracy, favorable move, latency, coverage, fees and slippage; include LONG and SHORT separately.
3. Require enough independent observations and confidence intervals; prohibit promoting on a single favorable aggregate or repeated peeking.
4. Require green CI, deterministic replay and explicit checks of protected paths.
5. Deploy canary only to a limited share of forecast output, never order execution.
6. Monitor canary against a simultaneous unchanged baseline; automatically rollback on quality regression, missing monitoring, elevated error rate or stale data.
7. Record immutable audit events and notify owner on promotion and rollback.

## Preconditions before enabling
- Implement and test independent forward evaluator with frozen windows and cost/latency checks.
- Implement protected-path enforcement, deployment controller, canary routing, monitoring and tested automatic rollback.
- Exercise failure-injection tests for missing telemetry, failing CI, rollback failure and stale input.
- Separately review and approve the *one-time activation* of this deployment mechanism. Subsequent eligible forecast-only promotions may then be automatic.

## Current disposition
KEEP_108. V110 Hands currently produces research-only draft PRs and must not merge or deploy them automatically.

# V110 Hands v1 — input/output contract and acceptance tests

## Input: validated research hypothesis
Required: schemaVersion, policyId, direction (LONG or SHORT), sourceReportTimestamp, sourceCommit, trainingDays, holdoutDays, sampleCounts, baselineMetrics, candidateMetrics, frozenPolicyParameters, prospectiveWindow, evidenceLinks, noLiveChanges=true, requiresOwnerApproval=true.
Reject unknown policy IDs, missing/invalid data, stale evidence, mismatched direction, or unfinished prospective windows. Never treat a text prompt as deployment authorization.

## Output: review-only proposal
- isolated research branch and code under research/v110-proposals/
- unit/safety test results and directional comparison report
- separate LONG and SHORT metrics at 1/5/10/15/30m; time to first favorable move, late-alert rate, sample counts and retained coverage
- cost/latency caveats, reasons for rejection, and rollback proposal
- draft PR with explicit owner review; no auto-merge, production deployment, order changes or trade permission

## Acceptance tests (implement next)
1. Valid allowlisted hypothesis produces a deterministic isolated research artifact.
2. Missing, malformed, stale or unsupported hypothesis fails closed as KEEP_108.
3. No candidate or insufficient independent days yields no PR.
4. Duplicate/rejected policy does not create repeated PRs.
5. Future/holdout data is not used to tune policy parameters; prospective evaluation cannot finish early.
6. LONG and SHORT reported separately, with 1/5/10/15/30m outcomes, latency, sample sizes and coverage; no TP/SL.
7. If candidate accuracy, coverage or timing deteriorates beyond precommitted limits, do not recommend promotion.
8. Any attempt to touch production radar, notifications, secrets, exchange/order code or deployment config fails.
9. Failed CI, missing evidence or unverified costs prevent promotion.
10. Draft PR cannot trigger automatic merge/deploy; explicit owner approval and separate release review required.

## Pilot
LONG_SKIP_CAUTION_CHASE only as research artifact. Current prospective study window is 2026-11-14T04:40:00Z through 2026-11-18T04:40:00Z (end exclusive), plus a 40-minute maturity buffer and cost stress. The authoritative times live in `lib/v110-forward-study.mjs`; do not alter them based on outcomes. No live promotion inferred from a directional pass.

Status: research-only contract and unit tests implemented in PR #128. Synthetic tests do not replace independently verified live forward evidence; production strategy promotion remains disabled.

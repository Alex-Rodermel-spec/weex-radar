# V110 integration decision — use the production forward study

Inspection of production `lib/forecast-journal.mjs`, `lib/journal-route.mjs`, and `lib/v110-forward-study.mjs` shows an existing encrypted archive and an existing pre-registered prospective candidate policy.

**Production source of truth:** `evaluateV110FixedForwardStudy(forecastRows, now)` already runs inside `GET /api/signals?mode=journal` and uses the existing journal writer. It evaluates a policy fixed before its 2026-11-15 through 2026-11-18 UTC observation window. It does not claim an unobserved V110 prediction, and requires 75 baseline/35 candidate observations and distinct days plus modeled cost stress. No trade or live strategy changes are authorized.

**Do not replace it with the experimental offline paired-outcome analyzer.** The offline analyzer requires truly paired contemporaneous V108/V110 alerts and is not an adapter for the production filtered-cohort forward policy. Treating a filtered subset as independent V110 forecasts would misstate the evidence.

**Current next action:** observe the existing fixed window to completion, review the aggregate `forwardStudy` outcome and its exact evidence requirements, then prepare a human-reviewable candidate code change only if criteria pass. If criteria fail, keep V108. The optional research-only local storage and manual workflow in PR #128 must not be deployed as a second journal.

**Production modifications:** none in this research decision. No new storage charges, secret changes, automatic orders or silent promotion.

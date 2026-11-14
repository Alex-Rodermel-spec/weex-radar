# V110: use existing encrypted production journal, not a second database

## Verified production integration
The live `lib/journal-route.mjs` already reads the encrypted `journal-data` branch archive, merges forecast outcomes from `recentForecastResearch`, recovers historical outcomes and computes `evaluateV110Learning`, `evaluateV110DepthStudy`, `evaluateV110Hypotheses`, and `evaluateV110FixedForwardStudy`. The OIDC-authenticated `signal-journal.yml` writer persists the archive. Public `mode=journal` exposes aggregates, not decrypted forecast records.

## Safe implementation plan
1. **Reuse** the encrypted archive and existing 20-minute writer. Do not create a second paid storage service, publish private data, or expose a new public raw export.
2. Add a pure adapter from the archive's existing `forecastRows` schema to the strict V110 paired forward contract, and test against genuine schema fixtures. Never mark recovered historical outcomes as independently prospective.
3. Run comparison inside the authenticated journal workflow or on the decrypted in-memory rows. Expose only aggregate research diagnostics. Do not print or upload raw rows.
4. Require evidence of same exchange, market, forecast timestamp, sampled evaluation timestamp, and consistent entry/outcome prices. Different alert directions are handled by the disagreement audit.
5. Keep research verdict separate from owner approval; no automatic merge, production strategy update, or trading.

## Blocker
The new `v110-forward-comparison` expects `V108/V110` *paired predictions of the same alert*, whereas existing `forecastRows` may represent only published V108 forecasts. A missing V110 prospective prediction **cannot** be reconstructed after seeing the outcome. First add a timestamped candidate shadow prediction at signal time; then independently evaluate its future outcome. Until then report `INSUFFICIENT_MATCHED_FORWARD_DATA`, not a fabricated lift.

## Status
The manual local store and secret-based workflow in this PR are optional research utilities, **not** the recommended production architecture. No new paid infrastructure is necessary.

# V110 · WEEX depth shadow (not a live filter)

## Current status

- Experimental pure module: `lib/v110-depth-shadow.mjs`.
- Unit tests: `test/v110-depth-shadow.test.mjs`.
- Existing read-only manual book API: `GET /api/signals?mode=liquidity&symbol=XRPUSDT` on production (#108).
- **This PR does not change production**, does not add depth calls to forecast dispatch and **does not persist paired depth samples yet**.
- Therefore there is currently **no empirical claim** that order-book depth improves forecast timing, direction or return.

## Reliable forward-only design

1. For an actual emitted forecast, obtain a WEEX depth snapshot **before** the forecast is published.
2. Only keep a compact feature if the local HTTP receipt precedes the forecast timestamp by at most 10 seconds. Never attach a later or historical non-matching snapshot.
3. Link by existing forecast ID, symbol, direction, sent timestamp; do not copy raw book, private ntfy topics or credentials.
4. Save with the same existing encrypted journal once a separate, explicitly authorized read-only collection hook exists; cap API calls to forecasts actually sent, not all 32 symbols every minute.
5. Evaluate only after actual closed 15m and 30m outcomes. Dedup ID and space repeated symbol observations >=30m. Train on earlier days, embargo >=30m, validate on later days, at least 5 training +2 holdout days and minimum 180 observations.
6. Compare favorable direction, first-move onset, alert delay, coverage, churn, drift, fees and spread; compare to the SAME symbol/day and existing #108 signal. Because spoofing / canceled walls are common and REST snapshot has no exchange event timestamp, even favorable statistics are not proof of order-book predictive power.
7. Candidate recommendations never touch live filters. No automatic trading, live updates, paid services, extra cron or secret access.

## Known limitations

- Current depth API labels size units as **unconfirmed**, which can invalidate USDT-weighted notional/slippage; validate WEEX contract denomination before attempting cost conclusions.
- Bid/ask imbalance can be spoofed and can reverse quickly; one static book capture has no cancellation/flow information.
- No actual paired depth history exists today. Running this evaluator on historical forecasts without contemporaneous book features MUST return `INSUFFICIENT_PAIRED_DEPTH`.
- `V110_DEPTH_POLICY.extraMarketRequests=0` means this pure research module makes no market calls; future capture integration will require a separate reviewed change with explicitly counted requests.

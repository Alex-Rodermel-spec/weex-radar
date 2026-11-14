# V110 independent forward outcomes — read-only data contract

The research comparator is implemented but is **not yet connected** to the private production journal. A successful CI run validates software, not forecast accuracy.

## Required input
A locally supplied UTF-8 JSON array of independently resolved outcomes, max 10,000 records and 5 MB. Each row must contain:
- `model`: `V108` or `V110`
- `alertId`: stable nonempty ID shared by both models for a genuinely comparable observation
- `direction`: `LONG` or `SHORT`
- `horizonMinutes`: 1, 5, 10, 15, or 30
- `entryPrice`, `outcomePrice`: finite positive numbers
- `observedAt`, `evaluatedAt`, `outcomeKnownAt`: valid ISO timestamps. `evaluatedAt` is the timestamp of the actual sampled market price at the specified forecast horizon (within 5 seconds). `outcomeKnownAt` is when the result became available and must not precede `evaluatedAt`.
- `source`: `independent-forward`, assigned only by an independent evaluator after resolution

**Do not relabel backtests, historical screenings or synthetic fixtures as independent-forward.** The evaluator must document how price and horizon were resolved and exclude information unavailable at forecast time. Ensure matching IDs and timestamps refer to the same market observation. Never export API keys, private account information, orders, or notification credentials.

## Run without deployment
```sh
node scripts/v110-compare-forward.mjs /secure/local/verified-outcomes.json > /secure/local/v110-summary.json
```
The output contains aggregate statistics and the research-only verdict. It never authorizes production changes or places orders.

## Remaining blocker
The production journal currently exposes a public **aggregate** screening summary; it does not supply verified per-alert paired forward outcomes to this comparator. A secure, independently evaluated source and private execution context are needed. No live V108 strategy or Vercel deployment should be changed to work around missing evidence.

## Research gates
The default comparison requires 75 matched observations per horizon/direction slice across at least two UTC days, and 90% matching coverage in both models before calling a candidate promising. These are research heuristics, not proof of trading profitability. Fees, slippage, latency, and forward out-of-sample performance still require independent evaluation.

# FORECAST V5 — independent 5-minute directional hypothesis

The user's original request was to improve the **directional prediction algorithm itself**. V4 changed the two forecast ntfy candidates' ranking, but not the bias. V5 adds an **independent, read-only 5-minute bias** `forecastV5` based on closed WEEX data that already exist in the scanner. It can disagree with the legacy 1m/5m/derived-10m consensus, which was falsely treated as three independent votes.

V5 evaluates 5m EMA20/EMA50 trend and actual EMA20 slope over three fully closed 5m bars, 5m RSI (different boundaries for LONG/SHORT), one-minute RSI and 3m directional movement, observed 1m and 5m volume relative to previous 20 **closed** candles, trending-vs-choppy range efficiency and 5m candle-body reversal. An overbought linear momentum run cannot automatically qualify as LONG. Every V5 return is tagged **research-only**, with no calibrated probability, no signal permission and zero orders.

## Where it is visible

- `GET /api/signals?mode=forecast&symbol=BTCUSDT`: additive `forecastV5` object with `direction: LONG_BIAS|SHORT_BIAS|MIXED`, a list of timestamped closed-bar input metrics and a non-trading disclaimer.
- `/forecast.html`: independent **🧪 V5 · 5М** column next to legacy 1M/5M/10M. Existing forecast counts and filter remain the baseline for apples-to-apples comparison.
- `GET /api/signals?mode=forecast-filter-replay&symbol=BTCUSDT`: additive **v5** replay cohort, exactly the same old closed candles and future 5/15/30m outcomes as baseline and three previous alternatives. Historical replay provides only up to ten 5m-spaced samples per market due to the public API's 125-candle limit. Those overlapping outcomes **are neither sufficient to claim improved accuracy nor independently prospective**.

## No live promotion without verification

V5 is an implemented **new directional algorithm**, not merely a ranker. We cannot conclude it is better from static tests or a tiny historical replay, however. It is therefore initially shown separately and evaluated alongside the unchanged actual FORECAST ntfy consensus. It neither replaces its direction nor blocks/sends extra alerts. No WEEX order access, account credentials, real trades, new cron/polling, ntfy topic changes, additional public API requests, automatic 108 promotion or 110 edits. Any later ntfy switch must first show prospective, side-specific 5m improvement over the baseline with coherent coverage, samples across multiple UTC days and guardrails against late/sideways market false signals.

An experimental 5m probability or accurate 70-90% cannot be claimed.

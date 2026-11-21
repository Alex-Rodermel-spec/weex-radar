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

## Prospective receipt → existing encrypted journal

The missing link in the V5 research was recording the **actual V5 decision at publication time**, rather than analyzing a reconstructed historical indicator. On already-sent old-channel ntfy FORECAST notices, the current single 1М/5М/10М evidence line now carries a small **🧪 V5: LONG / SHORT / MIXED** receipt. It is visible as an explicitly experimental direction and never changes the main alert title or LONG/SHORT side. No new ntfy messages, topic, scanning or trades.

The existing encrypted `forecast-journal.mjs` parser accepts only that exact publication format and persists nullable `v5Direction`. Historic messages have `null`; do not backfill V5 labels from today's exchange data. Merge and archive normalization never replace a saved original V5 label with a newer conjecture.

`GET /api/signals?mode=journal` now includes `forecastV5Forward`: the forward comparison of V5 vs legacy measured on the *same* actual ntfy-selected observations, with a 30-minute per-symbol spacing, mature measured future 5m/15m closes, per-side cohorts, explicit abstentions and coverage. This is observation of **only previously published baseline alerts**. It does NOT observe NEW V5-only symbols that the baseline did not alert; therefore it cannot be interpreted as a valid standalone V5 strategy test or permission to promote the live ntfy predictor, even after reaching the descriptive thresholds of 60 and 4 distinct days. A separate independently sampled V5-only forward cohort would still be required before any switch.

Historical V5 candidate results and future price movements must never become pre-notice predictor features.

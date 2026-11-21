# WEEX RADAR - paper-only automatic trading

**SIMULATION ONLY** - no WEEX order API calls, no real funds or account access.

- Virtual stake: **15 EUR** per distinct crypto coin, maximum **5** open positions.
- Total virtual margin budget **75 EUR**, hypothetical isolated **10x** exposure, 150 EUR equivalent per coin.
- Only existing approved, fresh, filtered and manually-review-rated 5-minute WEEX **LONG/SHORT** signals enter paper mode. Forecast/early/FOLLOW and FX/equity/metals are excluded. No forced positions when no eligible signal exists.
- Existing real manual trading flow, its 15 USDT margin, 3 USDT risk cap, authorization/passkey, leverage, live keys, and gates remain completely unchanged.
- Simulated stop, take and 30-minute exit on *fresh sampled quote* (not intraminute highs/lows), with illustrative taker commission of 8 bps per side and 3 bps of modeled slippage per side; capped modeled stop cost **3.00 virtual EUR for NEW entries** and account drawdown pause 15 virtual EUR. Existing historical trades in the journal were opened under the previous 7.50 virtual EUR risk cap; those must not be treated as comparable post-change samples.
- Exits are approximate: gaps, fees, order queue, liquidity, funding, forced liquidation and USD/EUR FX changes are **not** reflected precisely. Results cannot establish a profitable live strategy.
- Only one open paper position per coin, deterministic candle ID dedupe, no stacking if the same signal repeats.
- Private portfolio in Vercel Blob, with short-lived one-writer lock to reduce duplicate concurrent cron processing. A stale lock fails closed until 150 sec; lock release is best-effort.
- Pauses opening new virtual positions whenever an existing position has missing fresh quote.
- Owner can stop the simulator with production environment variable WEEX_PAPER_TRADING_DISABLED=true (and deploying an updated production build), or by reverting the paper-mode PR; real order permissions never depend on this feature.
- The public read-only status endpoint is GET /api/paper-trading.
- The existing one-minute /api/push-dispatch does the paper update *after* real alert delivery. Paper errors are logged, and never interrupt confirmed ntfy delivery.

## V110 paper trade-outcome learning (from 21 Nov 2026)

The read-only response of `GET /api/paper-trading` now includes `tradeLearning`. The study shows actual *simulated position outcomes* (after modeled fees/slippage), broken down by direction, exit reason and meme/other crypto, rather than confusing published 5m/15m directional forecasts with profitable entries.

On every NEW simulated position the PAPER engine captures **entry-time only** attributes: RSI 5m, volume ratio, 15m trend, ATR, observed 5m chase movement, modeled net R/R, level, retest state and advisor status. Legacy paper positions are retained and reported but **excluded from prospective feature-trained comparisons**, since their entry-time attributes were not preserved. We do not reconstruct missing features from future candles or retroactively pretend old trades were entered under the new risk cap.

V110 evaluates a fixed library of conservative hypotheses against the PAPER outcomes. It selects a candidate **only from chronological training history** (minimum 80 completed simulated trades and 3 distinct days), and then evaluates once on a later untouched holdout (minimum 40 trades and 2 days), with a 30-minute separation. Candidate must materially improve **mean realized modeled P&L, after costs**, maintain acceptable coverage and positive expectancy. It is still a retrospective subset, which does not capture freed capital or alternative signals; if it passes, state is `HOLDOUT_PROMISING_FORWARD_TEST_REQUIRED`, **not permission to trade or auto-promote**. An independent forward PAPER A/B cohort, actual exchange execution verification and security review must follow before anyone changes live gates.

No trading APIs, credentials, production entry gates, real manual confirmation, ntfy notification policy, or №108 signal rules are changed by the new V110 learning module. Never assume 15 EUR virtual margin equals 15 USDT live stake.

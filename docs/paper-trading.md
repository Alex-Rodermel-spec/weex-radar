# WEEX RADAR - paper-only automatic trading

**SIMULATION ONLY** - no WEEX order API calls, no real funds or account access.

- Virtual stake: **15 EUR** per distinct crypto coin, maximum **5** open positions.
- Total virtual margin budget **75 EUR**, hypothetical isolated **10x** exposure, 150 EUR equivalent per coin.
- Only existing approved, fresh, filtered and manually-review-rated 5-minute WEEX **LONG/SHORT** signals enter paper mode. Forecast/early/FOLLOW and FX/equity/metals are excluded. No forced positions when no eligible signal exists.
- Existing real manual trading flow, its 50 USDT margin, authorization/passkey, leverage, live keys, and gates remain completely unchanged.
- Simulated stop, take and 30-minute exit on *fresh sampled quote* (not intraminute highs/lows), with illustrative taker commission of 8 bps per side and 3 bps of modeled slippage per side; capped modeled stop cost 7.50 EUR and account drawdown pause 15 EUR.
- Exits are approximate: gaps, fees, order queue, liquidity, funding, forced liquidation and USD/EUR FX changes are **not** reflected precisely. Results cannot establish a profitable live strategy.
- Only one open paper position per coin, deterministic candle ID dedupe, no stacking if the same signal repeats.
- Private portfolio in Vercel Blob, with short-lived one-writer lock to reduce duplicate concurrent cron processing. A stale lock fails closed until 150 sec; lock release is best-effort.
- Pauses opening new virtual positions whenever an existing position has missing fresh quote.
- Owner can stop the simulator with production environment variable WEEX_PAPER_TRADING_DISABLED=true (and deploying an updated production build), or by reverting the paper-mode PR; real order permissions never depend on this feature.
- The public read-only status endpoint is GET /api/paper-trading.
- The existing one-minute /api/push-dispatch does the paper update *after* real alert delivery. Paper errors are logged, and never interrupt confirmed ntfy delivery.

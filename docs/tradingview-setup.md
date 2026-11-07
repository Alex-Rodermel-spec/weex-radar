# TradingView + WEEX RADAR

## What is live on the website

- Open `/tradingview.html` from the main WEEX RADAR page.
- Select any of the radar's 16 futures symbols; the chart requests `WEEX:SYMBOL.P` from TradingView. WEEX perpetual symbols are available on TradingView, but not every special 1000-contract alias is guaranteed to be listed. External TradingView symbol availability is independent of WEEX API availability.
- Choose **1m** for an early view, **5m** for the radar trigger, or **15m** for trend context.
- The page reads the existing `/api/signals` (read-only) and labels exchange and active signal separately; it does not use TradingView data to calculate exchange orders.
- The TradingView widget is an external component, subject to TradingView availability and privacy terms.

## Installing the original Early 1m indicator

1. Open TradingView in your own account and choose a supported perpetual pair, e.g. `WEEX:ALGOUSDT.P`.
2. Choose the **1-minute** timeframe.
3. Open **Pine Editor**, paste the contents of `tradingview/weex-radar-early-1m.pine`, save and add it to the chart.
4. Optional: Create an alert using **WEEX RADAR Early LONG Watch** or **WEEX RADAR Early SHORT Watch**, choosing **Once Per Bar Close** and mobile notifications in TradingView. Availability and number of alerts depend on TradingView's plan.
5. Treat all Pine notifications as **EARLY WATCH** alerts only: the independent 5m WEEX RADAR must still check its own rules and latest WEEX price. No automatic trading.

## Webhooks and security

- **Not enabled.** A TradingView account cannot be connected to the project without the account owner's explicit setup. This release does not expose an unauthenticated webhook receiver, store credentials, or modify the existing Push or Cron.
- TradingView currently requires 2FA for webhook alerts, accepts only HTTPS/HTTP ports 443/80, and aborts requests taking over three seconds. Its documentation warns not to include account credentials/secrets in URL or message. See https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/ .
- A future bridge needs authenticated, read-only ingestion, deduplication, strict symbol/timestamp validation, rate limiting, and explicit separation between tentative TradingView alerts and verified WEEX RADAR push signals. Neither a trading signal nor a webhook should ever place an exchange order.

## Technical notes

- The Pine code is an original educational indicator, not backtested and not validated with a running TradingView Pine compiler. Its 15m context uses the previous confirmed HTF candle via `request.security(..., expression[1], lookahead=barmerge.lookahead_on)`.
- TradingView widget renders in the client. On restricted browsers, use the external chart link. Site remains functional if TradingView is blocked.
- The Vercel backend, current 16-symbol scanner, browser service worker, push-dispatch authentication, and cron endpoints remain unchanged.

## Automatic 1m watch on the WEEX RADAR website

- The dedicated, independent read-only `/api/signals?mode=early&symbol=ALGOUSDT` now evaluates *completed* WEEX 1m candles, the latest completed WEEX 15m trend, RSI, volume, candle quality and the live WEEX futures bid/ask before returning `EARLY_WATCH`.
- `tradingview.html` displays this live watch panel without requiring a TradingView account or installing Pine. It refreshes about every 20 seconds while the page is visible. It does **not** draw custom Pine inside the embedded TradingView chart (unsupported) and does **not** send push notifications or trading orders.
- Early-watch alerts are intentionally separate from 5m confirmed push signals; they are not trading instructions or empirically validated forecasts.

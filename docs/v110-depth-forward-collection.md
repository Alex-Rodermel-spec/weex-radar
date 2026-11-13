# V110 paired order-book depth · read-only forward experiment

This experiment captures **PUBLIC WEEX 200-level depth** ONLY on an already-selected, actually delivered standalone forecast (at most **2 forecasts per 10-minute bucket**). It never modifies selection, 1m/5m/10m direction, LONG/SHORT entry, price, strength, ntfy visible text, orders, or stop rules.

## Capture path
- `runForecastNotifications` selects/deduplicates the forecast using **unchanged** live rules.
- Before ntfy publication, one **best-effort 900ms-capped** WEEX depth GET captures a local receipt time, spread, and bid-vs-ask indicative notional imbalances in the 0.25%/0.50% bands. Time is not an exchange order-book-event timestamp.
- A truncated HMAC bound to existing `NTFY_TOPIC` and original forecast `sequence_id` authenticates a small `#v110d=` URL **fragment** in the existing ntfy notification's `click` field. Its destination remains exactly `/forecast.html`; visible title/message remain unchanged. **No additional phone notification, paid storage, cron or secrets are added.**
- ntfy temporarily holds the fragment with the original forecast as part of the already existing ntfy message cache. **The fragment is not encrypted on ntfy** (only signed); it includes non-personal book numbers. Later, the existing 20-minute encrypted journal worker reads the original ntfy event, validates HMAC/forecast ID, validates the timestamp is at most 10 seconds before the ntfy event (with up to 999ms rounding tolerance), and stores ONLY compact depth features inside the existing AES-256-GCM archive. There is no historical retrofit and the ntfy topic and HMAC key are never logged.
- If depth is stale/unavailable, original ntfy alert still sends without depth. If the regular journal's read fails, it does not erase previously captured depth.
- `/api/signals?mode=journal` exposes only aggregate `depthShadowStudy`, no individual book or private topics.

## Evaluation
- A **new forward-only** paired dataset starts collecting with this release; the old forecast archive **does not already have depth**.
- For each paired forecast measure observed closed 5m, 15m and 30m directional moves, preserving negative results.
- Dedup by forecast ID; 30m per-symbol spacing, chronological 70/30 train/holdout with 30m embargo; 3 distinct UTC training days and 2 distinct UTC holdout days, with minimum 180 eligible, 120 train, 50 holdout rows. Directional pressure threshold 12% is pre-registered, not selected by inspecting holdout.
- The depth experiment cannot automatically update live trading: a passing exploratory holdout requires untouched prospective validation, commission/slippage/cancel/spoofing analysis and explicit owner review before a live filter is considered.

## Limitations
- WEEX depth `size` denomination is **not verified**. Comparing bid/ask side ratios is research-only; do not treat estimated notional or slippage as executable.
- REST order-book snapshots can be spoofed, canceled or stale; 200 levels are not guaranteed full depth.
- A 900ms best-effort public query may add up to 900ms of forecast latency; the original notification always has priority.
- If ntfy changes its handling of URL fragments, the archival parser refuses the missing/modified feature; no estimate is fabricated.
- No image/video/voice, no accounts or position data collected.

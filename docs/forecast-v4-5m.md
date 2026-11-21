# FORECAST V4 · 5-minute evidence and №110 learning

This update modifies the **separate FORECAST ntfy stream**, not the confirmed 5m LONG/SHORT trading radar. Current observed historical published FORECASTs are approximately 42.4% LONG and 47.4% SHORT favorable after 5m; these are directional observations, *not* trade win rates or evidence of 5m calibration.

## Published forecast selection

Within the existing 10-minute scan cadence and maximum **2** ntfy notices, select candidates with the strongest **already-closed** 5m directional body, clear V2 timing, no detected 1m extension or reversal, and volume. Do not double-count the derived 10m bar as a third independent observation. The algorithm is a **fixed heuristic ranking**, not an ML-trained win probability. It changes which two already-eligible observations get scarce slots; it does not increase notification count, fetch extra public candles, change the bullish/bearish bias, or trigger orders. This ranking has no claimed accuracy gain until future before/after data are evaluated.

Notification wording explicitly calls the forecast a nearest **5-minute** scenario; 15m/30m continuation is not promised. The title, symbol/side, exact journal reference, ntfy channels and format remain backward-compatible.

## New V110 study

The existing encrypted journal endpoint `/api/signals?mode=journal` exposes aggregate `forecast5mLearning`. It evaluates **actual published** ntfy forecasts with fully observed 5m and 15m subsequent closed bars, and spaces repeated same-symbol observations at least 30 minutes. It trains LONG and SHORT separately on earlier whole UTC days; compares frozen, pre-publication-only candidate rules selected on training; then evaluates them once on a later disjoint holdout with a 30-minute embargo. No future candle is allowed as an input feature. 5m is the objective and 15m is only an adverse-check. Missing, uncertain or too-recent outcomes cannot become wins. Even a passing historical holdout is **not** independently prospective proof. It never modifies live strategy or automatically promotes any rule; status remains KEEP_108 without forward evidence.

The two additions are deliberately separate: live ranking uses existing closed-bar evidence and is under evaluation, whereas the separate V110 journal candidate study explores outcomes but does not control the ranking or trade decisions.

## Safety and limitations

- No WEEX account access, money-changing endpoints, leverage, order routing or auth changes.
- No new cron, secrets, paid API, new ntfy topic or forced real positions.
- No promise of accuracy. Prior results can be selection-biased, cross-correlated or poor after costs. Monitor favorable AND adverse direction on future ntfy alerts and revert ranking if it worsens the side-matched 5m outcomes or delivery rates.

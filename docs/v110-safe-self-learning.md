# WEEX RADAR V110 — safe shadow self-learning (research only)

- Works on **actually published** standalone WEEX Forecast alerts held in the existing 90-day AES-GCM journal. Does not copy private ntfy topics or keys.
- Learns by selecting one pre-notification filter from a fixed, reviewable allowlist: avoid CAUTION, avoid V2-LATE, avoid >10bps prior 5m chase, or avoid CAUTION plus chase. It does **not** train a new direction predictor or change EMA/RSI.
- Filters use only observations available **before** the original alert, never the future candle results.
- Evaluation requires both completed 15m and 30m outcomes, per-symbol 30m spacing, chronological 70/30 split, 30-minute embargo, at least 180 observations over at least 5 train days and 2 later holdout days.
- Select a policy **on the earlier training period only**, then test that single policy on later holdout data. A minimum 5-point favorable-rate lift and 2bps mean directional lift on holdout, with 30m stability, is required to propose review. These are screening heuristics, not statistical proof or trade returns.
- Even `SHADOW_CANDIDATE_PASSED` only means `OWNER_REVIEW_REQUIRED`. No auto-merge, auto-deploy, trading or ntfy changes. All insufficiency/failed cases keep #108.
- `GET /api/signals?mode=journal` reports `learningShadow` in V110 when the environment can decrypt the existing journal. The current V110 Preview does **not** have production-only journal decryption secrets and therefore cannot run actual private-data self-learning yet. Do NOT expose or copy production secrets merely to make a demo look successful.
- When and only when the user approves a future promotion, the existing OIDC-authorized 20-minute journal collector can be reused for automatic re-evaluation; no paid AI service or extra WEEX requests are necessary.
- Current GitHub CI runs synthetic unit tests for leakage, chronological isolation, acceptance, rejection, data scarcity and safety. CI success is not evidence of real-market forecast improvement.

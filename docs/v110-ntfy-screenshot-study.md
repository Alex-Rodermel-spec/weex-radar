# №110 — «скриншот через ntfy → анализ → дальнейшая проверка → обучение»

**Owner request 15.11.2026:** Android share/publish picture directly to ntfy; bot replies in ntfy; use screenshot interpretations as **shadow research examples** to improve №110 after comparing to future market outcomes, not just one-shot chat.

## What is implemented in this first security/research PR

`lib/v110-ntfy-screenshot-shadow.mjs` is a **pure research-only library**; it is NOT wired to any live endpoint, ntfy poll, Vision API, trading endpoint or cron. It:
- Strictly checks an ntfy image message belongs to the expected secret topic, is from the last 20 minutes, has a plausible event id, and is a JPEG/PNG/WebP image <=2MB.
- Rejects untrusted attachment URL hosts/ports/path/query or MIME-extension mismatches before any future downloader could retrieve it. Accepts only ntfy-hosted binary attachment URLs on `ntfy.sh/file/...`, not external links.
- **Does NOT treat a hidden random topic as verified human ownership.** This output stays `ownershipVerified:false`. A separate authenticated approval gate must be designed for any paid model call.
- Only accepts an explicitly **owner-verified** vision interpretation for supported markets/timeframes and a fresh chart timestamp. Rejects unknown/mixed direction, stale data and unsupported symbols (e.g. XPINUSDT is not currently a member of 32 radar symbols).
- **Freezes** symbol, time, price, direction, and uncertainty *before* market outcomes may be inspected; the observation start is the time the hypothesis was actually fixed.
- Scores the next 5/10/15 **entirely post-prediction completed 1-minute candles**, only if the full 1-minute sequence exists. Missing future candles are PENDING_OR_MISSING, not wins. This is a directional research score, NEVER profit or trade execution.
- Provides counts and only prints favorable percentages at >=20 observations. It never trains or deploys a strategy or adjusts #108.

This is protective staging and reproducible testing, NOT screenshot image interpretation, automatic learning, ntfy-to-bot delivery or image upload. It creates **no AI billing**.

## Before enabling real screenshot interpretation / ntfy automation

1. **Consent and privacy:** ntfy.sh topics are secret-by-unguessable-name by default, NOT authenticated private inboxes; ntfy caches message content and uploaded attachment URLs on its infrastructure (attachments usually ~3 hours). Owner should crop account IDs, balances, KYC, keys and other private details. Prefer a NEW dedicated high-entropy screenshot topic, distinct from existing trade-notification topic.
2. **Sender authorization:** ntfy random topic alone does not prove who uploaded. Paid AI requests require user approval/authentication and hard quota/denial of arbitrary image URLs, plus image-size/replay checks. If origin cannot be proven, reject and ask for authenticated RADAR upload instead.
3. **Budget:** choose a genuinely vision-capable live model, owner-approved spend cap and max requests/day. Existing Vercel Pro/ChatGPT subscription does not automatically provide unlimited API vision calls. Nothing should charge user until they approve a maximum budget and model account access is set.
4. **Automatic run/ntfy reply:** implement a separately safeguarded processor for polling the ntfy screenshot topic, idempotent result receipts, and responses to user in ntfy, without causing signal loop or impacting cron latency. This is **not shipped in this PR**.
5. **Independent price verification:** recognition should only read image features; verify recognized symbol/timeframe, quote and *closed* candles independently from WEEX. Never treat model-generated numbers as verified market prices. Do not let future candles leak into an earlier prediction.
6. **Durable learning:** opt-in minimal encrypted research journal should retain extracted hypotheses and outcomes, **never raw pictures**. Keep an untouched prospective evaluation cohort, evaluate selection bias (screenshots manually chosen by owner), and only propose changes after rigorous tests and owner approval.

## References
- ntfy Android official docs: https://docs.ntfy.sh/subscribe/phone/ (supports Share to topic and attachment in compose UI).
- ntfy attachment format: https://docs.ntfy.sh/subscribe/api/ ; https://docs.ntfy.sh/publish/
- Related GitHub plan: https://github.com/Alex-Rodermel-spec/weex-radar/issues/142
- Tests: `node --test test/v110-ntfy-screenshot-shadow.test.mjs`.

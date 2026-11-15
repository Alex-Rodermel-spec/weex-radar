# №110: бесплатный ntfy → WEEX — исследования по скриншотам

> Без платной модели, без распознавания картинки. Пользователь публикует снимок в отдельной ntfy-теме и подписывает его монетой и интервалом. Ответ идёт в ту же тему. Реальные данные берутся из **уже существующего публичного WEEX forecast reader** по закрытым 1m/5m/10m.

## Android setup and use

1. Add ntfy subscription for the **dedicated random topic** configured in the production secret `NTFY_SCREENSHOT_TOPIC`. Don't use the existing LONG/SHORT or forecast topic for incoming screenshots. Never commit the random topic or your phone photos to GitHub.
2. In ntfy Android compose (or Android Share → ntfy), attach a JPEG/PNG/WebP screenshot **under 2 MB**, and add text **`XRPUSDT 5M`** (replace symbol and 1M/5M/15M). User must type symbol and timeframe. If Android image sharing cannot include a text caption, use ntfy composer to send an attachment with text, not a separately posted image, or resend with text.
3. Bot checks the topic once per **5 minutes** in the existing post-alert cron. It accepts at most two valid screenshot messages **per UTC day**, reviews a last-20-minute window and uses ntfy reply sequence IDs to reduce duplicates. A prior 5m signal and regular cron never depend on this path.
4. Bot replies in the same screenshot topic with 1m/5m/10m directional bias (or WAIT if mixed), closed 1m reference price, caution and **'image NOT recognized'** disclosure. No entry levels, target, stop, confidence scores or leverage tips.
5. For aligned directional observations, store **minimal encrypted-access private Blob metadata** with a frozen timestamp, not the picture, external URL, raw text or ntfy topic. Evaluate only after **5/10/15 complete future 1m candles** have closed; store outcome as favorable/adverse/unknown. Never treat missing candles or mixed direction as a hit, and never update №108 rules or trade.
6. ntfy topics on ntfy.sh are **not access-control private by default**. Anyone with the topic string can read/send; owner identity is NOT verified. Don't publish balances, login details, order IDs or other personal financial information. Hide sensitive UI before capturing the chart. The ntfy server can cache uploaded image attachments for a few hours.
7. This is **zero paid model calls**, not an absolute promise of zero Vercel bandwidth / Blob / network usage: the project's existing infrastructure quotas still apply. If Blob is disabled or at quota, the study is unavailable. We don't enable a new subscription.
8. A manual screenshot of an unusual market moment is a **selection-biased sample** and is **not labeled ground-truth**. This does not train a vision model on pixels and cannot prove future performance; further independently validated data and owner approval remain mandatory before any live change.

## Privacy and architecture

`lib/v110-ntfy-free-screenshot-inbox.mjs` uses `pollNtfyScreenshotMessages` for **JSON metadata only**. It never fetches `attachment.url`; `inspectNtfyScreenshotMessage` guards size, age, domain and mime. A reply happens only after parsing a supported exact WEEX symbol and a single named timeframe. No new trading endpoints, no paid model, no extra cron schedule. Server logs only aggregated counts. Source records explicitly say `NTFY_SCREENSHOT_REQUEST_CAPTION_PLUS_WEEX_NOT_IMAGE_VISION` and `ownerIdentityVerified:false`.

## Enable/disable

To enable the dedicated inbox, set `NTFY_SCREENSHOT_TOPIC` in Vercel production to `wr-` + 32 random hex chars and redeploy. **Do not expose this topic in public HTML or GitHub**. To immediately disable, remove the variable and redeploy. Already existing signal/forecast ntfy channels stay unchanged.

Tests: `node --test test/v110-ntfy-free-screenshot-inbox.test.mjs`, plus the full repository test suite.

Linked design: https://github.com/Alex-Rodermel-spec/weex-radar/issues/142 .

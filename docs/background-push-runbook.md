# WEEX RADAR — Reliable background push runbook

## Current architecture (2026-11-07)
- App: https://weex-radar.vercel.app
- Source: https://github.com/Alex-Rodermel-spec/weex-radar
- Radar: `GET /api/signals` — 16 symbols; WEEX primary, Bybit fallback; 5m closes, 15m confirmation.
- Android: Chrome push is subscribed and a real push has previously arrived with sound/vibration.
- Push sender: `POST /api/push-dispatch`; verifies fresh 3-minute signals, sends with Web Push and stores delivered markers in private Vercel Blob.
- Server authorization is restricted to GitHub Actions OIDC (`schedule` / `workflow_dispatch` on `main`) **or** `x-radar-cron-key` matching Vercel's secret `PUSH_CRON_KEY`.
- GitHub Actions workflow: `.github/workflows/push-notifications.yml`. A manual `workflow_dispatch` run succeeded on 2026-11-07 04:12 CET; the last observed scheduled run was 03:31 CET. **GitHub cron is not timely enough for short-lived signals.**
- GitHub project edits DO NOT automatically deploy to Vercel, as the Vercel project is not Git-linked.

## Recommended no-cost independent minute scheduler (requires owner to authenticate to provider)
Use https://cron-job.org/ (external provider; no account exists/has been verified as connected yet). Configure ONE cron job:
- Name: `WEEX RADAR — minute push`
- URL: `https://weex-radar.vercel.app/api/push-dispatch`
- Method: `POST`
- Frequency: `every minute` (all hours, all days)
- Custom header name: `x-radar-cron-key`
- Custom header value: the existing **Vercel Production** environment variable `PUSH_CRON_KEY` (NEVER put secret in GitHub or chat).
- Request body: empty
- Response: `HTTP 200` with `{"ok":true,...}` when healthy. `signals:0,delivered:0` is a healthy scan with no fresh signal. HTTP 401 indicates wrong/missing header; HTTP 503 indicates a backend/market-data error.
- Turn on scheduler error email/status alerts.
- After setup, run one provider test request and inspect HTTP response + execution history. Verify repeat executions for 10+ minutes, including while Chrome is closed.
- Do not promise delivery at an exact second; web push may also be delayed by Android/Chrome or blocked as spam.
- Keep GitHub backup enabled initially. Existing Blob delivered markers attempt to suppress duplicate sends from different schedulers. Reconsider the GitHub schedule only after independent cron has proven stable.

## Critical safety/security notes
- The project contains encrypted WEEX account API variables for a separately protected trading interface; real trading remains disabled. Public signal scanning and push dispatch remain read-only. Never enable live trading while order safety is unverified.
- No trading performance has been validated; `STRONG` is a screening label, not a verified win probability.
- Never expose `PUSH_CRON_KEY`, `BLOB_READ_WRITE_TOKEN`, or VAPID private key in messages, screenshots or source code.
- External scheduler registration/consent must be completed by the project owner (or via an approved browser-assisted workflow). The connected GitHub/Vercel integrations here cannot create cron-job.org accounts or jobs without a supported connection.

## Scheduler audit log
Authorized cron-job.org requests emit `WEEX_RADAR_DISPATCH` with `source:cron` in Vercel runtime logs; GitHub emits `source:github`. Each event includes HTTP status and counts only; no secrets or subscriber identities. Use Vercel logs over the last 30 minutes to distinguish an actual minute scheduler from the irregular GitHub fallback. These logs do not confirm Android delivery. Transient push failures now clear the duplicate-suppression marker so a future scan may retry.

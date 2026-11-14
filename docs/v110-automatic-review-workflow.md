# №110 → GitHub → №108: automatic, owner-gated research proposals

## Existing infrastructure reused
- Live №108 and forecast endpoints remain untouched.
- Existing OIDC-authenticated journal writer runs approximately every 20 minutes.
- The new `workflow_run` job waits for a **successful run on main** of the existing journal writer.
- It reads only `GET /api/signals?mode=journal` public **aggregates**; it never accesses encrypted plaintext, ntfy topics, exchange keys or account positions.
- GitHub CI already tests pull requests; Vercel builds preview branches.

## Automated step, disabled until merged
When, and ONLY when, a known six-policy №110 idea passes the 3-training + 2-independent-holdout screening, it:
1. Validates status, sample sizes, untouched holdout improvement, direction and manual-approval flags using a fixed allowlist.
2. Creates one stable named branch for that policy; never retries a closed/rejected policy.
3. Creates one **draft PR** containing a sanitized JSON research summary at `research/v110-proposals/<POLICY>.json` **and an isolated, pure research-only candidate source** at `research/v110-proposals/<POLICY>.mjs`. Nothing imports this candidate into live №108; there is no trading or signal mutation.
4. Explicitly dispatches the existing read-only GitHub safety tests for this branch (GitHub-token-created PRs do not automatically trigger ordinary PR CI).
5. Leaves the PR for independent forward testing, human review and later explicit approval.

Normal status `KEEP_108`, insufficient data, network error, invalid fields or partial evidence: **no proposal**.

## Important missing step
This mechanism is an automated **research proposal draft**, not an autonomous live strategy rewrite. It deliberately cannot deploy an untested strategy: a separate forward test must show useful improvement on unselected future published alerts, and any later strategy-code PR must receive explicit owner approval and pass CI, with rollback ready. Approving the research draft alone does not activate a trading rule.

## Safeguards
- No automatic merge, no signals/forecasts/orders changes, no extra cron, no new paid data.
- A new GitHub Actions `workflow_run` is executed after existing archive completions; this consumes some existing GitHub Actions runtime, but does not add a scheduled market scan.
- Standard `GITHUB_TOKEN` branch/PR creation may require GitHub repository setting *Allow GitHub Actions to create and approve pull requests*. If disabled, the job fails closed and leaves №108 untouched.
- The public GitHub PR contains only high-level aggregate numbers and allowlisted inert code, never journal contents, secrets or private topics.
- An interrupted run can recover an existing research branch and update its two research artifacts safely. If GitHub's PR-creation setting blocks Actions, a single review issue is attempted instead; production remains untouched.
- The exporter rejects public journal snapshots older than three hours or with an implausible future timestamp.
- This proposal workflow only runs after its feature PR is reviewed and merged. CI and Vercel Preview must pass before considering merge.

## How to verify
1. `npm test` — including `test/v110-owner-proposal.test.mjs`.
2. Confirm current `/api/signals?mode=journal` has `recommendation: KEEP_108`. This must produce **no proposal** (script exits 3).
3. After future independent 3+2 data passes, check a draft PR is created, verify it contains only `research/v110-proposals/*.json` and `.mjs` files, and that production and №108 remain unchanged.
4. No approval is inferred from a notification or a chat message: merge/release authorization remains explicit and separate.

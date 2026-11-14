# Private V110 research workflow — operator setup

The workflow `.github/workflows/v110-private-forward-review.yml` is manual-only. It does **not** run automatically and does not deploy, trade, create PRs, or change production V108.

1. Prepare a verified JSON array following `research/v110-forward-data-contract.md`. Do not use synthetic/backtest outcomes or include account credentials.
2. For a small research-only dataset (under GitHub secret limits), encode the JSON file as a single-line base64 string and store it as the repository Actions secret `V110_PRIVATE_FORWARD_JSON_B64`. GitHub Actions secrets are not a scalable data store; do not use this method for a growing journal.
3. Once the workflow is present on the repository default branch, run **V110 private forward comparison (manual research only)** from GitHub Actions on a trusted branch containing the analyzer. Do not merge experimental production changes solely to activate this workflow.
4. Only aggregate status, counts, and disagreement totals are logged. The dataset is never uploaded as an artifact; it is deleted from the runner after execution.

**Not yet connected:** private automated ingestion and independent forward evaluation. A secure read-only storage integration is required before scheduling this workflow. A successful test or manual run cannot establish forecast profitability.

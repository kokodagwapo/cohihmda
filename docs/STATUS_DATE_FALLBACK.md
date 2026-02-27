# Status Date Fallback for Terminal Statuses

When a loan has a terminal status (Denied, Withdrawn, Funded/Originated) but the status-specific date column is null, the platform uses **current_status_date** as the effective outcome date so reporting and analytics stay consistent.

## Canonical rules

Use these fallbacks in SQL, prompts, and any logic that filters or displays by outcome/status date:

| Status | Effective outcome/status date |
|--------|-------------------------------|
| **Denied** | `COALESCE(uw_denied_date, denial_date, current_status_date)` |
| **Withdrawn** | `COALESCE(withdrawal_date, current_status_date)` (use withdrawal-date column if present) |
| **Funded / Originated** | `funding_date` / `closing_date` (no fallback; these are the primary dates) |

## Behavior

- **Do not** report "no denied date populated" or treat missing `uw_denied_date` (or `denial_date`) as a data error. Use `current_status_date` when the status-specific date is null.
- The prediction pipeline ([PREDICTION_PIPELINE.md](PREDICTION_PIPELINE.md)) and the numeric outcome profile service already use this fallback for Denied (e.g. `denial_date ?? current_status_date` for days_active and recency).
- Agent prompts (Evidence Agent, Cohi Chat, Research Lab) reference this doc so all generated SQL and narrative stays aligned.

## References

- [PREDICTION_PIPELINE.md](PREDICTION_PIPELINE.md) — denial date vs current status date for historical Denied loans
- [numericOutcomeProfileService.ts](../server/src/services/fallout/numericOutcomeProfileService.ts) — `outcomeEndDateForDaysActive`, `outcomeDateForRecency`
- Data quality: Denied loans with no `uw_denied_date` may be flagged as informational; reporting uses `current_status_date` as fallback.

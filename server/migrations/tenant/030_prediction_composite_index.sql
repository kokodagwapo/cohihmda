-- Migration: 030_prediction_composite_index
-- Description: Adds a composite index on loan_predictions(loan_id, created_at DESC)
--              to optimize the DISTINCT ON (loan_id) ORDER BY loan_id, created_at DESC
--              query pattern used by the GET /api/predictions endpoint.
--              The existing separate indexes on loan_id and created_at individually
--              cannot satisfy this pattern efficiently.

CREATE INDEX IF NOT EXISTS idx_loan_predictions_loan_created
  ON loan_predictions(loan_id, created_at DESC);

-- Allow loan_type 'All' for globally-calculated features (e.g. loan amount, time in motion, pullthrough, lock expiration)
-- Database: tenant

ALTER TABLE bucket_thresholds_cache
  DROP CONSTRAINT IF EXISTS bucket_thresholds_cache_loan_type_check;

ALTER TABLE bucket_thresholds_cache
  ADD CONSTRAINT bucket_thresholds_cache_loan_type_check
  CHECK (loan_type IN ('Conventional', 'Government', 'All'));

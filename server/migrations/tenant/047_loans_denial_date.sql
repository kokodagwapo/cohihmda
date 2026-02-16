-- Add denial_date for outcome profile: days_active for Denied = application_date to denial_date.
-- For active loans, days_active remains application_date to today.
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS denial_date DATE;

COMMENT ON COLUMN public.loans.denial_date IS 'Date the loan was denied; used for Denied outcome days_active (application to denial).';

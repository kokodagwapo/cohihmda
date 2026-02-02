-- Data Quality Rules Table
-- Allows tenants to customize which data quality tests run and their severity levels

CREATE TABLE IF NOT EXISTS data_quality_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Rule identification
  rule_id VARCHAR(100) NOT NULL UNIQUE, -- e.g., 'active_with_funding_date'
  rule_name VARCHAR(255) NOT NULL, -- e.g., 'Active Loan with Funding Date'
  
  -- Categorization
  rule_group VARCHAR(100) NOT NULL, -- e.g., 'Status Tests', 'Date Tests', 'Credit Tests'
  
  -- Rule details
  description TEXT,
  field_name VARCHAR(100), -- The field this rule validates
  sql_condition TEXT, -- Custom SQL WHERE clause (for tenant-specific rules)
  
  -- Severity and status
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'warning', 'info')) DEFAULT 'warning',
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Customization
  custom_threshold JSONB, -- For range-based rules, allows custom min/max values
  -- e.g., {"min": 300, "max": 850} for FICO, or {"max_future_months": 6} for date rules
  
  -- Audit fields
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(255)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_data_quality_rules_active 
  ON data_quality_rules(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_data_quality_rules_group 
  ON data_quality_rules(rule_group);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_data_quality_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS data_quality_rules_updated_at ON data_quality_rules;
CREATE TRIGGER data_quality_rules_updated_at
  BEFORE UPDATE ON data_quality_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_data_quality_rules_updated_at();

-- Insert default rules
INSERT INTO data_quality_rules (rule_id, rule_name, rule_group, description, field_name, severity, is_active)
VALUES 
  -- Status Tests
  ('active_with_funding_date', 'Active Loan with Funding Date', 'Status Tests', 'Loan marked as Active but has a funding date - status should be Originated/Funded', 'current_loan_status', 'critical', true),
  ('active_with_closing_date', 'Active Loan with Closing Date', 'Status Tests', 'Loan marked as Active but has a closing date - verify if status is correct', 'current_loan_status', 'warning', true),
  ('funded_no_funding_date', 'Funded Status Missing Funding Date', 'Status Tests', 'Loan marked as Funded/Originated but missing funding date', 'current_loan_status', 'warning', true),
  ('closed_no_closing_date', 'Originated/Funded Missing Closing Date', 'Status Tests', 'Loan is Originated/Funded/Purchased but has no closing date', 'current_loan_status', 'warning', true),
  ('stale_active_4_to_6_months', 'Stale Active Loan (4-6 Months)', 'Status Tests', 'Active Loan with application date 4-6 months ago - may need status review', 'current_loan_status', 'warning', true),
  ('stale_active_6_to_12_months', 'Stale Active Loan (6-12 Months)', 'Status Tests', 'Active Loan with application date 6-12 months ago - likely requires attention', 'current_loan_status', 'critical', true),
  ('stale_active_over_1_year', 'Stale Active Loan (1+ Year)', 'Status Tests', 'Active Loan with application date more than 1 year ago - urgently needs status update', 'current_loan_status', 'critical', true),
  
  -- Date Tests
  ('funding_before_closing', 'Funding Before Closing', 'Date Tests', 'Funding date is before closing date - dates may be swapped', 'funding_date', 'warning', true),
  ('closing_before_application', 'Closing Before Application', 'Date Tests', 'Closing date is before application date - impossible sequence', 'closing_date', 'critical', true),
  ('approval_before_submission', 'UW Approval Before Submission', 'Date Tests', 'UW approval date is before submission to underwriting', 'uw_approval_date', 'critical', true),
  ('future_funding_date', 'Future Funding Date', 'Date Tests', 'Funding date is in the future - data entry error or placeholder', 'funding_date', 'warning', true),
  ('future_closing_date', 'Future Closing Date', 'Date Tests', 'Closing date is in the future - verify this is expected', 'closing_date', 'info', true),
  ('future_closing_date_far', 'Closing Date Far in Future', 'Date Tests', 'Closing date is more than 6 months in the future - likely a data entry error', 'closing_date', 'warning', true),
  
  -- Credit Tests
  ('fico_out_of_range', 'FICO Score Out of Range', 'Credit Tests', 'FICO score is outside valid range (300-850)', 'fico_score', 'critical', true),
  ('dti_over_100', 'DTI Ratio Over 100%', 'Credit Tests', 'DTI ratio exceeds 100% - mathematically unusual', 'dti_ratio', 'warning', true),
  ('ltv_over_100', 'LTV Ratio Over 100%', 'Credit Tests', 'LTV ratio exceeds 100% - verify property value and loan amount', 'ltv_ratio', 'warning', true),
  ('missing_credit_pull', 'Missing Credit Pull Date', 'Credit Tests', 'Credit pull date is missing for loans past application stage', 'credit_pull_date', 'info', true),
  
  -- UW Tests
  ('missing_underwriter', 'Missing Underwriter', 'UW Tests', 'Underwriter is not assigned for loans in underwriting', 'underwriter', 'warning', true),
  ('approved_no_approval_date', 'Approved Without Approval Date', 'UW Tests', 'Loan appears approved but has no UW approval date', 'uw_approval_date', 'warning', true),
  
  -- Mortgage Tests
  ('missing_loan_amount', 'Missing Loan Amount', 'Mortgage Tests', 'Loan amount is missing or zero', 'loan_amount', 'critical', true),
  ('interest_rate_out_of_range', 'Interest Rate Out of Range', 'Mortgage Tests', 'Interest rate is outside expected range (0-15%)', 'interest_rate', 'critical', true),
  ('missing_loan_number', 'Missing Loan Number', 'Mortgage Tests', 'Loan number is missing', 'loan_number', 'critical', true),
  
  -- Personnel Tests
  ('missing_loan_officer', 'Missing Loan Officer', 'Personnel Tests', 'Loan officer is not assigned', 'loan_officer', 'warning', true),
  ('missing_processor', 'Missing Processor', 'Personnel Tests', 'Processor is not assigned for loans in processing', 'processor', 'warning', true),
  ('missing_branch', 'Missing Branch', 'Personnel Tests', 'Branch is not assigned', 'branch', 'warning', true),
  ('missing_closer', 'Missing Closer', 'Personnel Tests', 'Closer is not assigned for loans approaching closing', 'closer', 'info', true),
  
  -- HMDA Compliance Tests (based on FFIEC LAR requirements under 12 CFR 1003)
  ('hmda_missing_loan_type', 'HMDA: Missing Loan Type', 'Application Tests', 'Loan type (Conventional/FHA/VA/USDA-RHS) required per 12 CFR 1003.4(a)(2)', 'loan_type', 'critical', true),
  ('hmda_missing_loan_purpose', 'HMDA: Missing Loan Purpose', 'Application Tests', 'Loan purpose required per 12 CFR 1003.4(a)(3)', 'loan_purpose', 'critical', true),
  ('hmda_missing_lien_status', 'HMDA: Missing Lien Status', 'Application Tests', 'Lien status required per 12 CFR 1003.4(a)(14)', 'lien_position', 'critical', true),
  ('hmda_missing_occupancy_type', 'HMDA: Missing Occupancy Type', 'Application Tests', 'Occupancy type required per 12 CFR 1003.4(a)(29)', 'occupancy_type', 'critical', true),
  ('hmda_missing_property_state', 'HMDA: Missing Property State', 'Application Tests', 'Property state required per 12 CFR 1003.4(a)(9)(i)', 'property_state', 'critical', true),
  ('hmda_missing_county_fips', 'HMDA: Missing County FIPS Code', 'Application Tests', 'County FIPS code required per 12 CFR 1003.4(a)(9)(ii)', 'county_fips_code', 'warning', true),
  ('hmda_missing_loan_amount', 'HMDA: Missing/Invalid Loan Amount', 'Application Tests', 'Loan amount required per 12 CFR 1003.4(a)(7)', 'loan_amount', 'critical', true),
  ('hmda_missing_interest_rate', 'HMDA: Missing Interest Rate', 'Application Tests', 'Interest rate required per 12 CFR 1003.4(a)(21)', 'interest_rate', 'warning', true),
  ('hmda_missing_loan_term', 'HMDA: Missing Loan Term', 'Application Tests', 'Loan term required per 12 CFR 1003.4(a)(25)', 'loan_term', 'warning', true),
  ('hmda_missing_property_value', 'HMDA: Missing Property Value', 'Application Tests', 'Property value required per 12 CFR 1003.4(a)(28)', 'appraised_value', 'warning', true),
  ('hmda_missing_cltv', 'HMDA: Missing Combined LTV', 'Application Tests', 'Combined LTV required per 12 CFR 1003.4(a)(23)', 'cltv', 'info', true),
  ('hmda_missing_total_units', 'HMDA: Missing Number of Units', 'Application Tests', 'Total units required per 12 CFR 1003.4(a)(30)', 'number_of_units', 'info', true),
  -- TRID Compliance Tests (6 trigger items: Name, Income, SSN, Property Address, Est. Value, Loan Amount)
  ('trid_missing_borrower_name', 'TRID: Missing Borrower Name', 'Application Tests', 'Borrower name is one of the 6 TRID trigger items', 'borrower_name', 'warning', true),
  ('trid_missing_income', 'TRID: Missing Income', 'Application Tests', 'Income is one of the 6 TRID trigger items', 'income_total_mo_income', 'warning', true),
  ('trid_missing_property_address', 'TRID: Missing Property Address', 'Application Tests', 'Property address is one of the 6 TRID trigger items', 'property_street', 'warning', true),
  ('trid_missing_estimated_value', 'TRID: Missing Estimated Property Value', 'Application Tests', 'Estimated property value is one of the 6 TRID trigger items', 'appraised_value', 'warning', true),
  ('trid_missing_loan_amount', 'TRID: Missing Loan Amount Sought', 'Application Tests', 'Loan amount sought is one of the 6 TRID trigger items', 'loan_amount', 'warning', true)
ON CONFLICT (rule_id) DO NOTHING;

-- Comment on table
COMMENT ON TABLE data_quality_rules IS 'Tenant-configurable data quality validation rules. Allows tenants to enable/disable specific tests and customize severity levels.';

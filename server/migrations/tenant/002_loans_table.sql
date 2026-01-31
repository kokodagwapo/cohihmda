-- Migration: Loans Table
-- Created: 2026-01-29
-- Database: tenant
--
-- Creates the loans table with all fields from CoheusDataDictionary.xml
-- This is the core table that stores mortgage loan data from Encompass/LOS

-- Enable pgvector extension for embeddings (if available)
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- LOANS - Core loan data table
-- All columns match CoheusDataDictionary.xml aliases
-- =============================================================================
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id TEXT NOT NULL UNIQUE,
  
  -- Core loan fields
  loan_amount DECIMAL(12,2),
  loan_type TEXT,
  loan_program TEXT,
  loan_purpose TEXT,
  loan_term INTEGER,
  loan_number TEXT,
  loan_folder TEXT,
  loan_source TEXT,
  current_loan_status TEXT,
  current_milestone TEXT,
  current_status_date DATE,
  
  -- Financial fields
  interest_rate DECIMAL(8,4),
  base_loan_amount DECIMAL(12,2),
  sales_price DECIMAL(12,2),
  appraised_value DECIMAL(12,2),
  ltv_ratio DECIMAL(12,2),
  cltv DECIMAL(12,2),
  hcltv DECIMAL(12,2),
  be_dti_ratio DECIMAL(12,2),
  income_total_mo_income DECIMAL(12,2),
  assets_subtotal_liquid_assets DECIMAL(12,2),
  combined_assets_all_borrowers DECIMAL(12,2),
  number_of_months_reserves INTEGER,
  
  -- Property fields
  property_street TEXT,
  property_city TEXT,
  property_county TEXT,
  property_state TEXT,
  property_zip TEXT,
  number_of_units INTEGER,
  property_type TEXT,
  occupancy_type TEXT,
  property_rights TEXT,
  lien_position TEXT,
  county_fips_code TEXT,
  state_fips_code TEXT,
  
  -- Date fields
  application_date DATE,
  gfe_application_date DATE,
  started_date DATE,
  pre_approval_date DATE,
  disclosure_prep_date DATE,
  signed_date DATE,
  scrubbed_date DATE,
  processing_date DATE,
  submitted_to_processing_date DATE,
  submitted_to_underwriting_date DATE,
  submittal_date DATE,
  cond_approval_date DATE,
  conditional_approval_date DATE,
  resubmittal_date DATE,
  approval_date DATE,
  uw_final_approval_date DATE,
  uw_denied_date DATE,
  uw_suspended_date DATE,
  ctc_date DATE,
  ready_for_docs_date DATE,
  closer_assignment_date DATE,
  docs_out_date DATE,
  docs_signing_date DATE,
  doc_preparation_date DATE,
  closing_date DATE,
  estimated_closing_date DATE,
  funding_date TIMESTAMPTZ,
  funds_sent_date DATE,
  disbursement_date DATE,
  shipped_date DATE,
  investor_purchase_date DATE,
  purchased_date DATE,
  reconciled_date DATE,
  completion_date DATE,
  post_closing_date DATE,
  lock_date TIMESTAMPTZ,
  lock_expiration_date DATE,
  buy_side_lock_date DATE,
  buy_side_lock_days INTEGER,
  buy_side_lock_expiration DATE,
  sell_side_lock_days INTEGER,
  sell_side_lock_expiration DATE,
  investor_lock_date DATE,
  last_rate_set_date DATE,
  rate_lock_sell_side_last_rate_set_date DATE,
  loan_estimate_sent_date DATE,
  loan_estimate_received_date DATE,
  revised_le_sent_date DATE,
  revised_le_received_date DATE,
  initial_disclosure_due_date DATE,
  gfe_initial_gfe_disclosure_provided_date DATE,
  til_intl_disclosure_provided_date DATE,
  closing_disclosure_sent_date DATE,
  closing_disclosure_received_date DATE,
  revised_cd_sent_date DATE,
  revised_cd_received_date DATE,
  closing_docs_1003_signature_date DATE,
  loan_first_payment_date DATE,
  maturity_date DATE,
  note_date DATE,
  first_rate_adjustment_date DATE,
  credit_pull_date TIMESTAMPTZ,
  appraisal_ordered_date DATE,
  appraisal_completed_date DATE,
  appraisal_received_date DATE,
  flood_certification_date DATE,
  au_decision_date DATE,
  repurchase_date DATE,
  date_sold_to_third_party DATE,
  date_warehoused DATE,
  last_modified_date TIMESTAMPTZ,
  appt_reset_date DATE,
  appt_set_date DATE,
  
  -- Revenue fields
  origination_points DECIMAL(12,2),
  orig_fee_borr_pd DECIMAL(12,2),
  orig_fees_seller DECIMAL(12,2),
  cd_lender_credits DECIMAL(12,2),
  cd_applied_cure DECIMAL(12,2),
  pa_sell_amt DECIMAL(12,2),
  pa_srp_amt DECIMAL(12,2),
  pa_payout_1 DECIMAL(12,2),
  pa_payout_2 DECIMAL(12,2),
  pa_payout_3 DECIMAL(12,2),
  pa_payout_4 DECIMAL(12,2),
  pa_payout_5 DECIMAL(12,2),
  pa_payout_6 DECIMAL(12,2),
  pa_payout_7 DECIMAL(12,2),
  pa_payout_8 DECIMAL(12,2),
  pa_payout_9 DECIMAL(12,2),
  pa_payout_10 DECIMAL(12,2),
  pa_payout_11 DECIMAL(12,2),
  pa_payout_12 DECIMAL(12,2),
  net_buy DECIMAL(12,2),
  net_sell DECIMAL(12,2),
  rate_lock_buy_side_net_buy_rate DECIMAL(12,2),
  rate_lock_buy_side_base_price_rate DECIMAL(12,2),
  rate_lock_buy_side_adjusted_buy_price DECIMAL(12,2),
  srp_from_investor DECIMAL(12,2),
  discount_yield_spread_premium DECIMAL(12,2),
  corporate_price_concession DECIMAL(12,2),
  branch_price_concession DECIMAL(12,2),
  service_fee DECIMAL(12,2),
  guaranty_fee DECIMAL(12,2),
  msr_value DECIMAL(12,2),
  
  -- Rate lock profit margin adjustments
  rate_lock_buy_side_profit_margin_adjustment_1_desc TEXT,
  rate_lock_buy_side_profit_margin_adjustment_1_rate DECIMAL(12,2),
  rate_lock_buy_side_profit_margin_adjustment_2_desc TEXT,
  rate_lock_buy_side_profit_margin_adjustment_2_rate DECIMAL(12,2),
  rate_lock_buy_side_profit_margin_adjustment_3_desc TEXT,
  rate_lock_buy_side_profit_margin_adjustment_3_rate DECIMAL(12,2),
  rate_lock_buy_side_profit_margin_adjustment_4_desc TEXT,
  rate_lock_buy_side_profit_margin_adjustment_4_rate DECIMAL(12,2),
  rate_lock_buy_side_profit_margin_adjustment_5_desc TEXT,
  rate_lock_buy_side_profit_margin_adjustment_5_rate DECIMAL(12,2),
  rate_lock_buy_side_profit_margin_adjustment_6_desc TEXT,
  rate_lock_buy_side_profit_margin_adjustment_6_rate DECIMAL(12,2),
  rate_lock_buy_side_profit_margin_adjustment_7_desc TEXT,
  rate_lock_buy_side_profit_margin_adjustment_7_rate DECIMAL(12,2),
  rate_lock_buy_side_profit_margin_adjustment_8_desc TEXT,
  rate_lock_buy_side_profit_margin_adjustment_8_rate DECIMAL(12,2),
  
  -- ARM fields
  arm_program TEXT,
  margin DECIMAL(5,3),
  margin_index TEXT,
  lookback TEXT,
  first_change_months INTEGER,
  maximum_rate_adjustment_cap DECIMAL(5,3),
  adjustment_period_months INTEGER,
  first_rate_adjustment_cap DECIMAL(5,3),
  floor_rate DECIMAL(5,3),
  life_cap DECIMAL(5,3),
  rounding TEXT,
  description_of_the_arm_index_type TEXT,
  interest_only_payments BOOLEAN,
  number_of_months_interest_only_payments INTEGER,
  balloon_payments BOOLEAN,
  piti_payment DECIMAL(12,2),
  
  -- PMI fields
  pmi_flag BOOLEAN,
  mortgage_insurance_company_name TEXT,
  private_mortgage_insurance_indicator TEXT,
  mi_percent_coverage_1 DECIMAL(5,2),
  mi_coverage_1_months INTEGER,
  mi_percent_coverage_2 DECIMAL(5,2),
  mi_coverage_2_months INTEGER,
  mi_cancel_percent DECIMAL(5,2),
  
  -- HELOC fields
  heloc_initial_draw DECIMAL(12,2),
  heloc_draw_period INTEGER,
  heloc_repayment_period INTEGER,
  
  -- Credit/Score fields
  fico_score INTEGER,
  cu_risk_score DECIMAL(5,2),
  freddie_loan_level_credit_score_value INTEGER,
  freddie_loan_level_credit_score_method TEXT,
  
  -- Underwriting fields
  underwriter_risk_assess_type TEXT,
  underwriter_risk_assess_aus_recomm TEXT,
  underwriting_description TEXT,
  underwriting_aus_source TEXT,
  underwriting_aus_number TEXT,
  number_of_conditions INTEGER,
  fannie_au_decision TEXT,
  fannie_property_valuation_form_type TEXT,
  freddie_au_decision TEXT,
  freddie_avm_model_name_type_other_description TEXT,
  freddie_property_valuation_form_type TEXT,
  freddie_underwriting_type_other TEXT,
  property_valuation_method_type TEXT,
  property_valuation_effective_date DATE,
  
  -- Borrower fields
  borr_employer TEXT,
  borr_position TEXT,
  borr_position_2nd TEXT,
  borr_yrs_on_job DECIMAL(5,2),
  borr_yrs_on_job_2nd DECIMAL(5,2),
  borr_self_employed BOOLEAN,
  borr_self_employed_2nd BOOLEAN,
  co_borr_employer TEXT,
  co_borr_position TEXT,
  co_borr_yrs_on_job DECIMAL(5,2),
  co_borr_self_employed BOOLEAN,
  borrower_type TEXT,
  co_borrower_type TEXT,
  co_borrower_mailing_address_is_same_as_the_property_address BOOLEAN,
  borrower_mailing_address_is_same_as_the_property_address BOOLEAN,
  
  -- Team member IDs
  loan_officer_id TEXT,
  loan_officer TEXT,
  legacy_loan_officer_id TEXT,
  loan_interviewer TEXT,
  loan_processor_id TEXT,
  processor TEXT,
  underwriter_id TEXT,
  underwriter TEXT,
  closer_id TEXT,
  closer TEXT,
  account_executive TEXT,
  
  -- Branch/Org fields
  branch TEXT,
  orgid TEXT,
  broker_lender_name TEXT,
  referral_name TEXT,
  warehouse_co_name TEXT,
  investor TEXT,
  investor_status TEXT,
  
  -- Channel fields
  channel TEXT,
  
  -- NMLS fields
  company_nmls_id TEXT,
  nmls_id TEXT,
  
  -- Loan details
  product_type TEXT,
  mers_min TEXT,
  hedged_loan BOOLEAN,
  lock_days INTEGER,
  total_mortgaged_properties_count INTEGER,
  
  -- QM/ATR fields
  exempt_from_reg_z BOOLEAN,
  atr_loan_type TEXT,
  qm_loan_type TEXT,
  safe_harbor TEXT,
  meets_agency_gse_qm BOOLEAN,
  
  -- HMDA fields
  interest_only_indicator BOOLEAN,
  business_or_commercial_purpose BOOLEAN,
  
  -- Refinance fields
  refinance_cash_out_type TEXT,
  
  -- Fee fields
  fee_details_line_804_borrower_amount_appraisal_fee DECIMAL(12,2),
  fee_details_line_804_seller_amount_appraisal_fee DECIMAL(12,2),
  fee_details_line_805_borrower_amount_credit_report DECIMAL(12,2),
  fee_details_line_805_seller_amount_credit_report DECIMAL(12,2),
  fee_details_line_807_borrower_amount_flood_cert DECIMAL(12,2),
  fee_details_line_807_seller_amount_flood_cert DECIMAL(12,2),
  fee_details_line_804_borrower_poc_amount_appraisal DECIMAL(12,2),
  fee_details_line_804_seller_poc_amount_appraisal DECIMAL(12,2),
  fee_details_line_804_broker_poc_amount_appraisal DECIMAL(12,2),
  fee_details_line_804_lender_poc_amount_appraisal DECIMAL(12,2),
  fee_details_line_804_other_poc_amount_appraisal DECIMAL(12,2),
  fee_details_line_805_borrower_poc_amount_cred_report DECIMAL(12,2),
  fee_details_line_805_seller_poc_amount_cred_report DECIMAL(12,2),
  fee_details_line_805_broker_poc_amount_cred_report DECIMAL(12,2),
  fee_details_line_805_lender_poc_amount_cred_report DECIMAL(12,2),
  fee_details_line_805_other_poc_amount_cred_report DECIMAL(12,2),
  fee_details_line_807_borrower_poc_amount_flood_cert DECIMAL(12,2),
  fee_details_line_807_seller_poc_amount_flood_cert DECIMAL(12,2),
  fee_details_line_807_broker_poc_amount_flood_cert DECIMAL(12,2),
  fee_details_line_807_lender_poc_amount_flood_cert DECIMAL(12,2),
  fee_details_line_807_other_poc_amount_flood_cert DECIMAL(12,2),
  fee_details_line_804_appraisal_fee_pac DECIMAL(12,2),
  fee_details_line_805_credit_report_fee_pac DECIMAL(12,2),
  fee_details_line_807_flood_certification_fee_pac DECIMAL(12,2),
  
  -- Compliance/Mavent fields
  mavent_gse_result TEXT,
  mavent_high_cost_result TEXT,
  mavent_enterprise_result TEXT,
  mavent_atr_qm_result TEXT,
  mavent_tila_tolerance_result TEXT,
  mavent_nmls_licensing_result TEXT,
  mavent_state_rules_result TEXT,
  mavent_hmda_result TEXT,
  mavent_hpml_result TEXT,
  mavent_license_reviewer_result TEXT,
  mavent_other_result TEXT,
  mavent_overall_result TEXT,
  
  -- Document fields
  document_type TEXT,
  du_lp_case_id TEXT,
  
  -- GFE disclosure dates
  gfe_affiliated_business_disclosure_provided_date DATE,
  gfe_initial_gfe_disclosure_charm_booklet_provided_date DATE,
  gfe_initial_gfe_disclosure_hud_special_booklet_provided_date DATE,
  gfe_initial_gfe_disclosure_heloc_brochure_provided_date DATE,
  
  -- Other fields
  guid TEXT,
  uw_touches INTEGER,
  
  -- Metadata
  raw_data JSONB,
  metadata JSONB DEFAULT '{}',
  -- pgvector embedding for RAG
  embedding vector(3072),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- =============================================================================
-- INDEXES - Optimized for common query patterns
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_loans_loan_id ON loans(loan_id);
CREATE INDEX IF NOT EXISTS idx_loans_application_date ON loans(application_date) WHERE application_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_closing_date ON loans(closing_date) WHERE closing_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_funding_date ON loans(funding_date) WHERE funding_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_lock_date ON loans(lock_date) WHERE lock_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_loan_type ON loans(loan_type) WHERE loan_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_current_loan_status ON loans(current_loan_status) WHERE current_loan_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_branch ON loans(branch) WHERE branch IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_channel ON loans(channel) WHERE channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_loan_officer ON loans(loan_officer) WHERE loan_officer IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_processor ON loans(processor) WHERE processor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_underwriter ON loans(underwriter) WHERE underwriter IS NOT NULL;

-- Vector similarity index (requires sufficient data)
-- CREATE INDEX IF NOT EXISTS idx_loans_embedding ON loans USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =============================================================================
-- TRIGGER - Auto-update updated_at
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_loans_updated_at ON loans;
CREATE TRIGGER trigger_loans_updated_at
  BEFORE UPDATE ON loans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

/**
 * Tenant Database Schema
 * Schema for tenant-specific databases (one per lender/client)
 * NO tenant_id columns - each database is for one tenant only
 */

import pg from "pg";

const { Pool } = pg;

/**
 * Create tenant database schema
 * This creates all tables WITHOUT tenant_id columns
 */
export async function createTenantDatabaseSchema(pool: pg.Pool): Promise<void> {
  try {
    console.log("[TenantSchema] Creating tenant database schema...");

    // Create auth schema
    await pool.query("CREATE SCHEMA IF NOT EXISTS auth").catch(() => {});

    // Create users table (NO tenant_id)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        encrypted_password TEXT NOT NULL,
        full_name TEXT,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer', 'super_admin', 'tenant_admin', 'loan_officer', 'processor')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role)
    `
      )
      .catch(() => {});

    // Create profiles table (NO tenant_id)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
        full_name TEXT,
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `
      )
      .catch(() => {});

    // Create employees table (NO tenant_id)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.employees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        employee_id TEXT,
        role TEXT,
        branch TEXT,
        hire_date DATE,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_employees_email ON public.employees(email)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON public.employees(employee_id)
    `
      )
      .catch(() => {});

    // Create loans table (NO tenant_id, UNIQUE on guid)
    // guid: Encompass GUID (unique system identifier)
    // loan_number: Human-readable loan number (Fields.364)
    // loan_id: DEPRECATED - kept for backwards compatibility
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.loans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guid TEXT UNIQUE,
        loan_id TEXT,
        
        -- Core loan fields (all columns match CoheusDataDictionary.xml aliases)
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
        interest_rate DECIMAL(8,4),  -- Allow rates > 99.999 (some loans have rate = 100)
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
        
        -- Date fields (all as DATE type)
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
        cu_risk_score DECIMAL(5,2),  -- CU Risk Score is decimal (1.0-5.0 scale)
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
        borr_yrs_on_job DECIMAL(5,2),  -- Years can be fractional (e.g., 2.5 years)
        borr_yrs_on_job_2nd DECIMAL(5,2),  -- Years can be fractional
        borr_self_employed BOOLEAN,
        borr_self_employed_2nd BOOLEAN,
        co_borr_employer TEXT,
        co_borr_position TEXT,
        co_borr_yrs_on_job DECIMAL(5,2),  -- Years can be fractional
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
        gfe_affiliated_business_disclosure_provided_date DATE,  -- Shortened from 67 chars to stay under PostgreSQL 63-char limit
        gfe_initial_gfe_disclosure_charm_booklet_provided_date DATE,
        gfe_initial_gfe_disclosure_hud_special_booklet_provided_date DATE,
        gfe_initial_gfe_disclosure_heloc_brochure_provided_date DATE,
        
        -- Other fields
        -- Note: guid is defined at the top of the table as the unique identifier
        uw_touches INTEGER,
        
        -- Metadata
        -- Note: raw_data column has been removed - additional fields use structured columns via additional_field_definitions
        metadata JSONB DEFAULT '{}',
        -- pgvector embedding for RAG
        embedding vector(3072),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_by UUID REFERENCES public.users(id)
      )
    `
      )
      .catch(() => {});

    // Create indexes for loans
    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_application_date ON public.loans(application_date) WHERE application_date IS NOT NULL
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_closing_date ON public.loans(closing_date) WHERE closing_date IS NOT NULL
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_funding_date ON public.loans(funding_date) WHERE funding_date IS NOT NULL
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_loan_type ON public.loans(loan_type) WHERE loan_type IS NOT NULL
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_current_loan_status ON public.loans(current_loan_status) WHERE current_loan_status IS NOT NULL
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_branch ON public.loans(branch) WHERE branch IS NOT NULL
    `
      )
      .catch(() => {});

    // Create index on guid for access control joins
    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_guid ON public.loans(guid) WHERE guid IS NOT NULL
    `
      )
      .catch(() => {});

    // Create index on loan_number for human-readable lookups
    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_loan_number ON public.loans(loan_number) WHERE loan_number IS NOT NULL
    `
      )
      .catch(() => {});

    // Create pgvector extension if it doesn't exist
    await pool
      .query(
        `
      CREATE EXTENSION IF NOT EXISTS vector
    `
      )
      .catch(() => {});

    // Create ivfflat index on embedding column for similarity search
    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_embedding 
      ON public.loans USING ivfflat (embedding vector_cosine_ops) 
      WITH (lists = 100)
    `
      )
      .catch(() => {});

    // Migration: Expand DECIMAL(5,2) ratio fields to DECIMAL(12,2) to accommodate Encompass values
    // This migration runs every time to ensure columns are updated if they exist with smaller precision
    try {
      // Check if loans table exists first
      const tableExists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'loans'
        )
      `);

      if (tableExists.rows[0].exists) {
        // Run migration for each field
        await pool.query(`
          DO $$
          BEGIN
            -- Migrate ltv_ratio
            IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = 'loans' 
              AND column_name = 'ltv_ratio'
              AND data_type = 'numeric'
              AND numeric_precision < 12
            ) THEN
              ALTER TABLE public.loans ALTER COLUMN ltv_ratio TYPE DECIMAL(12,2);
              RAISE NOTICE 'Migrated ltv_ratio to DECIMAL(12,2)';
            END IF;
            
            -- Migrate cltv
            IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = 'loans' 
              AND column_name = 'cltv'
              AND data_type = 'numeric'
              AND numeric_precision < 12
            ) THEN
              ALTER TABLE public.loans ALTER COLUMN cltv TYPE DECIMAL(12,2);
              RAISE NOTICE 'Migrated cltv to DECIMAL(12,2)';
            END IF;
            
            -- Migrate hcltv
            IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = 'loans' 
              AND column_name = 'hcltv'
              AND data_type = 'numeric'
              AND numeric_precision < 12
            ) THEN
              ALTER TABLE public.loans ALTER COLUMN hcltv TYPE DECIMAL(12,2);
              RAISE NOTICE 'Migrated hcltv to DECIMAL(12,2)';
            END IF;
            
            -- Migrate be_dti_ratio
            IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = 'loans' 
              AND column_name = 'be_dti_ratio'
              AND data_type = 'numeric'
              AND numeric_precision < 12
            ) THEN
              ALTER TABLE public.loans ALTER COLUMN be_dti_ratio TYPE DECIMAL(12,2);
              RAISE NOTICE 'Migrated be_dti_ratio to DECIMAL(12,2)';
            END IF;
            
            -- Migrate interest_rate to handle rates > 99.999
            IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = 'loans' 
              AND column_name = 'interest_rate'
              AND data_type = 'numeric'
              AND numeric_precision < 8
            ) THEN
              ALTER TABLE public.loans ALTER COLUMN interest_rate TYPE DECIMAL(8,4);
              RAISE NOTICE 'Migrated interest_rate to DECIMAL(8,4)';
            END IF;
          END $$;
        `);
        console.log("[TenantSchema] Ratio fields migration check completed");
      }
    } catch (error: any) {
      console.error(
        "[TenantSchema] Ratio fields migration error:",
        error.message
      );
      // Don't throw - allow schema creation to continue
    }

    // Migration: Change loan_officer_id from UUID to TEXT to handle Encompass string values
    try {
      const migrationResult = await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'loans'
            AND column_name = 'loan_officer_id'
            AND data_type = 'uuid'
          ) THEN
            ALTER TABLE public.loans
            ALTER COLUMN loan_officer_id TYPE TEXT USING loan_officer_id::TEXT;
            RAISE NOTICE 'Migrated loan_officer_id from UUID to TEXT';
          END IF;
        END $$;
      `);
      console.log("[TenantSchema] loan_officer_id migration check completed");
    } catch (error: any) {
      console.error(
        "[TenantSchema] Error migrating loan_officer_id:",
        error.message
      );
      // Don't throw - allow schema creation to continue
    }

    // Migration: Drop orphaned columns not in data dictionary (v2.0 schema cleanup)
    try {
      await pool.query(`
        DO $$
        BEGIN
          -- Drop columns that are not in CoheusDataDictionary.xml
          ALTER TABLE public.loans DROP COLUMN IF EXISTS borrower_name;
          ALTER TABLE public.loans DROP COLUMN IF EXISTS status;
          ALTER TABLE public.loans DROP COLUMN IF EXISTS fund_date;
          ALTER TABLE public.loans DROP COLUMN IF EXISTS pi_payment;
          ALTER TABLE public.loans DROP COLUMN IF EXISTS encompass_instance;
          ALTER TABLE public.loans DROP COLUMN IF EXISTS cycle_time_days;
          RAISE NOTICE 'Orphaned columns cleanup completed';
        END $$;
      `);
      console.log(
        "[TenantSchema] Orphaned columns cleanup migration completed"
      );
    } catch (error: any) {
      console.error(
        "[TenantSchema] Error cleaning up orphaned columns:",
        error.message
      );
      // Don't throw - allow schema creation to continue
    }

    // Migration: Change years-on-job fields from INTEGER to DECIMAL (years can be fractional like 2.5)
    try {
      await pool.query(`
        DO $$
        BEGIN
          -- Migrate borr_yrs_on_job from INTEGER to DECIMAL
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'borr_yrs_on_job'
            AND data_type = 'integer'
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN borr_yrs_on_job TYPE DECIMAL(5,2);
            RAISE NOTICE 'Migrated borr_yrs_on_job to DECIMAL(5,2)';
          END IF;

          -- Migrate borr_yrs_on_job_2nd from INTEGER to DECIMAL
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'borr_yrs_on_job_2nd'
            AND data_type = 'integer'
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN borr_yrs_on_job_2nd TYPE DECIMAL(5,2);
            RAISE NOTICE 'Migrated borr_yrs_on_job_2nd to DECIMAL(5,2)';
          END IF;

          -- Migrate co_borr_yrs_on_job from INTEGER to DECIMAL
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'co_borr_yrs_on_job'
            AND data_type = 'integer'
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN co_borr_yrs_on_job TYPE DECIMAL(5,2);
            RAISE NOTICE 'Migrated co_borr_yrs_on_job to DECIMAL(5,2)';
          END IF;
        END $$;
      `);
      console.log("[TenantSchema] Years-on-job fields migration completed");
    } catch (error: any) {
      console.error(
        "[TenantSchema] Error migrating years-on-job fields:",
        error.message
      );
      // Don't throw - allow schema creation to continue
    }

    // Migration: Change cu_risk_score from INTEGER to DECIMAL (CU Risk Score is a decimal value 1.0-5.0)
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'cu_risk_score'
            AND data_type = 'integer'
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN cu_risk_score TYPE DECIMAL(5,2);
            RAISE NOTICE 'Migrated cu_risk_score to DECIMAL(5,2)';
          END IF;
        END $$;
      `);
      console.log("[TenantSchema] cu_risk_score field migration completed");
    } catch (error: any) {
      console.error(
        "[TenantSchema] Error migrating cu_risk_score field:",
        error.message
      );
      // Don't throw - allow schema creation to continue
    }

    // Migration: Rename truncated GFE disclosure column (PostgreSQL 63-char limit caused truncation)
    try {
      await pool.query(`
        DO $$
        BEGIN
          -- Rename the truncated column to the new shortened name
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'gfe_initial_gfe_disclosure_affiliated_business_disclosure_provi'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'gfe_affiliated_business_disclosure_provided_date'
          ) THEN
            ALTER TABLE public.loans 
            RENAME COLUMN gfe_initial_gfe_disclosure_affiliated_business_disclosure_provi 
            TO gfe_affiliated_business_disclosure_provided_date;
            RAISE NOTICE 'Renamed truncated GFE disclosure column';
          END IF;
        END $$;
      `);
      console.log(
        "[TenantSchema] GFE disclosure column rename migration completed"
      );
    } catch (error: any) {
      console.error(
        "[TenantSchema] Error renaming GFE disclosure column:",
        error.message
      );
      // Don't throw - allow schema creation to continue
    }

    // Create LOS connections table (NO tenant_id - tenant-specific DB)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.los_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        los_type TEXT NOT NULL,
        name TEXT NOT NULL,
        connection_method TEXT NOT NULL,
        -- Encompass-specific fields
        encompass_instance_id TEXT,
        encompass_api_server TEXT DEFAULT 'https://api.elliemae.com',
        encompass_secret_arn TEXT,
        encompass_extraction_method TEXT CHECK (encompass_extraction_method IN ('partner', 'ropc', 'api')),
        encompass_sa_username_encrypted TEXT,
        encompass_sa_password_encrypted TEXT,
        api_client_id_encrypted TEXT,
        api_client_secret_encrypted TEXT,
        encompass_selected_folders JSONB DEFAULT '[]'::jsonb, -- Array of folder names to sync from
        -- General LOS fields
        api_base_url TEXT,
        api_key TEXT,
        api_access_token TEXT,
        api_refresh_token TEXT,
        api_token_expires_at TIMESTAMPTZ,
        api_environment TEXT DEFAULT 'sandbox',
        oauth_authorization_url TEXT,
        oauth_token_url TEXT,
        oauth_scopes TEXT,
        -- Database connection fields (for Calyx, etc.)
        db_host TEXT,
        db_port INTEGER,
        db_name TEXT,
        db_user TEXT,
        db_password_encrypted TEXT,
        -- CSV upload fields
        csv_upload_schedule TEXT,
        csv_last_uploaded_at TIMESTAMPTZ,
        csv_upload_path TEXT,
        csv_field_mapping JSONB,
        -- Sync settings
        sync_enabled BOOLEAN DEFAULT true,
        sync_frequency TEXT DEFAULT 'hourly',
        last_synced_at TIMESTAMPTZ,
        last_loan_modified_at TIMESTAMPTZ, -- MAX(Loan.LastModified) from previously synced loans - used for incremental sync filter
        last_sync_status TEXT,
        last_sync_error TEXT,
        -- Webhook settings
        webhook_url TEXT,
        webhook_secret TEXT,
        webhook_enabled BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_los_connections_active ON public.los_connections(is_active) WHERE is_active = true
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_los_connections_type ON public.los_connections(los_type)
    `
      )
      .catch(() => {});

    // Add encompass_api_server column if it doesn't exist (migration for existing databases)
    await pool
      .query(
        `
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'los_connections'
          AND column_name = 'encompass_api_server'
        ) THEN
          ALTER TABLE public.los_connections 
          ADD COLUMN encompass_api_server TEXT DEFAULT 'https://api.elliemae.com';
        END IF;
      END $$;
    `
      )
      .catch(() => {});

    // Create Encompass field swaps table (NO tenant_id - tenant-specific DB)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.encompass_field_swaps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        los_connection_id UUID REFERENCES public.los_connections(id) ON DELETE CASCADE,
        coheus_alias VARCHAR(255) NOT NULL,
        encompass_field_id VARCHAR(255) NOT NULL,
        swap_type VARCHAR(50) DEFAULT 'Standard' CHECK (swap_type IN ('Standard', 'Profitability')),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(los_connection_id, coheus_alias, swap_type)
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_field_swaps_connection ON public.encompass_field_swaps(los_connection_id)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_field_swaps_alias ON public.encompass_field_swaps(coheus_alias)
    `
      )
      .catch(() => {});

    // Create Encompass token cache table (NO tenant_id - tenant-specific DB)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.encompass_token_cache (
        cache_key VARCHAR(255) PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_token_cache_expires ON public.encompass_token_cache(expires_at)
    `
      )
      .catch(() => {});

    // Create Encompass concurrency metrics table (NO tenant_id - tenant-specific DB)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.encompass_concurrency_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        los_connection_id UUID,
        limit_value INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        utilized INTEGER NOT NULL,
        utilization_ratio DECIMAL(5,4) NOT NULL,
        exceeded_threshold BOOLEAN NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_concurrency_connection ON public.encompass_concurrency_metrics(los_connection_id, timestamp)
    `
      )
      .catch(() => {});

    // Create RAG settings table (NO tenant_id - tenant-specific DB has only one tenant)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.rag_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        -- Embedding/RAG configuration
        embedding_model TEXT DEFAULT 'text-embedding-3-small',
        vector_database TEXT DEFAULT 'pgvector',
        chunk_size INTEGER DEFAULT 1000,
        chunk_overlap INTEGER DEFAULT 200,
        top_k INTEGER DEFAULT 5,
        similarity_threshold NUMERIC DEFAULT 0.7,
        enable_reranking BOOLEAN DEFAULT false,
        reranking_model TEXT,
        context_window INTEGER DEFAULT 8000,
        -- Chat model configuration
        chat_model TEXT DEFAULT 'gpt-4o-mini',
        temperature NUMERIC DEFAULT 0.7,
        custom_system_prompt TEXT,
        -- PII/Privacy settings
        enable_pii_sanitization BOOLEAN DEFAULT true,
        redact_ssn BOOLEAN DEFAULT true,
        redact_dob BOOLEAN DEFAULT true,
        redact_account_numbers BOOLEAN DEFAULT true,
        allow_employee_names BOOLEAN DEFAULT false,
        log_ai_interactions BOOLEAN DEFAULT true,
        -- API Keys (encrypted)
        openai_api_key TEXT,
        gemini_api_key TEXT,
        -- Voice Agentic settings
        voice_agentic_enabled BOOLEAN DEFAULT false,
        voice_model TEXT DEFAULT 'gpt-4o-mini',
        voice_name TEXT DEFAULT 'Aria',
        voice_top_k INTEGER DEFAULT 3,
        voice_similarity_threshold NUMERIC DEFAULT 0.75,
        voice_context_window INTEGER DEFAULT 4000,
        voice_temperature NUMERIC DEFAULT 0.8,
        voice_response_max_length INTEGER DEFAULT 60,
        voice_conversation_memory INTEGER DEFAULT 10,
        voice_rag_enabled BOOLEAN DEFAULT true,
        voice_system_prompt TEXT,
        voice_enable_reranking BOOLEAN DEFAULT false,
        voice_real_time_mode BOOLEAN DEFAULT false,
        -- Personality/Conversation settings
        allowed_topics TEXT,
        conversation_rules TEXT,
        personality_tone TEXT DEFAULT 'professional',
        personality_style TEXT DEFAULT 'concise',
        personality_custom TEXT,
        knowledge_base_links TEXT,
        -- Timestamps
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    // Create RAG document sources table (NO tenant_id)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.rag_document_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('upload', 's3', 'sharepoint', 'confluence', 'url', 'api')),
        source_config JSONB NOT NULL DEFAULT '{}',
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'active', 'error', 'paused')),
        document_count INTEGER DEFAULT 0,
        total_chunks INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        last_sync_at TIMESTAMPTZ,
        sync_frequency TEXT DEFAULT 'daily' CHECK (sync_frequency IN ('realtime', 'hourly', 'daily', 'weekly', 'manual')),
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_rag_document_sources_status ON public.rag_document_sources(status)
    `
      )
      .catch(() => {});

    // Create RAG documents table (NO tenant_id)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.rag_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id UUID NOT NULL REFERENCES public.rag_document_sources(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        file_path TEXT,
        file_type TEXT,
        file_size_bytes INTEGER,
        chunk_count INTEGER DEFAULT 0,
        token_count INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'indexed', 'error', 'deleted')),
        error_message TEXT,
        indexed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON public.rag_documents(source_id)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_rag_documents_status ON public.rag_documents(status)
    `
      )
      .catch(() => {});

    // Add global knowledge sync columns (from migration 019_knowledge_sync_support)
    await pool
      .query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS title TEXT`)
      .catch(() => {});
    await pool
      .query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS content TEXT`)
      .catch(() => {});
    await pool
      .query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS category TEXT`)
      .catch(() => {});
    await pool
      .query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS tags TEXT[]`)
      .catch(() => {});
    await pool
      .query(
        `ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT false`
      )
      .catch(() => {});
    await pool
      .query(
        `ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS global_doc_id UUID`
      )
      .catch(() => {});
    await pool
      .query(
        `ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS global_version INTEGER`
      )
      .catch(() => {});
    await pool
      .query(
        `ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS source_url TEXT`
      )
      .catch(() => {});

    // ============================================
    // TENANT CONFIGURATION TABLES
    // For self-service mapping tool, personas, filters, scoring
    // ============================================

    // Create personas table (user-defined personas beyond defaults)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.personas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        is_system BOOLEAN DEFAULT FALSE, -- true for default personas (Lender Admin, Ops Manager, etc.)
        permissions JSONB DEFAULT '{}', -- what this persona can access
        dashboard_config JSONB DEFAULT '{}', -- persona-specific dashboard settings
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(name)
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_personas_is_system ON public.personas(is_system)
    `
      )
      .catch(() => {});

    // Seed default system personas if they don't exist
    await pool
      .query(
        `
      INSERT INTO public.personas (name, description, is_system, permissions)
      VALUES 
        ('Lender Admin', 'Full tenant configuration access - owns mappings, filters, ranges, and scoring weights', TRUE, 
          '{"can_manage_fields": true, "can_manage_filters": true, "can_manage_ranges": true, "can_manage_scoring": true, "can_manage_personas": true}'::jsonb),
        ('Operations Manager', 'Manages operational filters and complexity rules', TRUE,
          '{"can_manage_filters": true, "can_view_complexity": true, "can_view_turn_times": true}'::jsonb),
        ('Sales Manager', 'Consumes TopTiering insights and prioritization', TRUE,
          '{"can_view_toptiering": true, "can_manage_filters": true, "can_view_revenue": true}'::jsonb),
        ('Executive', 'Views summarized insights and trends', TRUE,
          '{"can_view_dashboards": true, "can_view_reports": true}'::jsonb),
        ('Analyst', 'Builds dashboards and saved views', TRUE,
          '{"can_manage_filters": true, "can_create_reports": true, "can_view_all_data": true}'::jsonb)
      ON CONFLICT (name) DO NOTHING
    `
      )
      .catch(() => {});

    // Create config_versions table (versioning for all config types)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.config_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        config_type VARCHAR(50) NOT NULL, -- 'field_mapping', 'range_rule', 'filter', 'scoring_weight', 'persona', 'complexity'
        config_id UUID, -- reference to the specific config item (null for bulk snapshots)
        config_data JSONB NOT NULL, -- snapshot of the config at this version
        version_number INT NOT NULL DEFAULT 1,
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        published_at TIMESTAMPTZ,
        published_by UUID REFERENCES public.users(id),
        notes TEXT -- reason for change
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_config_versions_type ON public.config_versions(config_type)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_config_versions_config_id ON public.config_versions(config_id) WHERE config_id IS NOT NULL
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_config_versions_status ON public.config_versions(status)
    `
      )
      .catch(() => {});

    // Create custom_fields table (additional LOS fields beyond Coheus defaults)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.custom_fields (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        los_field_id VARCHAR(255) NOT NULL, -- original LOS field ID (e.g., "Fields.CX.CUSTOMFIELD1")
        los_field_name VARCHAR(255), -- human-readable name from LOS
        coheus_alias VARCHAR(255), -- mapped to Coheus alias (null if custom-only)
        display_name VARCHAR(255) NOT NULL, -- user-facing display name
        data_type VARCHAR(50) NOT NULL CHECK (data_type IN ('string', 'number', 'date', 'boolean', 'currency', 'percentage')),
        category VARCHAR(100), -- grouping category (e.g., "Borrower", "Property", "Financial")
        description TEXT,
        is_enabled BOOLEAN DEFAULT TRUE,
        is_custom BOOLEAN DEFAULT TRUE, -- true if added by tenant, false if Coheus default
        visible_to_personas UUID[], -- array of persona IDs that can see this field (null = all)
        formatting_rules JSONB DEFAULT '{}', -- display formatting, validation rules
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(los_field_id)
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_custom_fields_category ON public.custom_fields(category) WHERE category IS NOT NULL
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_custom_fields_enabled ON public.custom_fields(is_enabled) WHERE is_enabled = TRUE
    `
      )
      .catch(() => {});

    // Create range_rules table (guideline thresholds for highlighting)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.range_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        field_alias VARCHAR(255) NOT NULL, -- Coheus alias (e.g., 'ltv_ratio', 'dti_ratio', 'fico_score')
        rule_name VARCHAR(255) NOT NULL,
        description TEXT,
        -- Conditional application (when this rule applies)
        conditions JSONB DEFAULT '{}', -- e.g., {"loan_type": "FHA", "channel": "Retail", "occupancy": "Primary"}
        -- Threshold values
        min_value DECIMAL(12,4), -- minimum acceptable value
        max_value DECIMAL(12,4), -- maximum acceptable value
        warning_min DECIMAL(12,4), -- warning zone minimum (yellow)
        warning_max DECIMAL(12,4), -- warning zone maximum (yellow)
        -- Display settings
        severity VARCHAR(20) DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
        tooltip_text TEXT, -- help text shown on hover
        violation_message TEXT, -- message shown when value is out of range
        highlight_color VARCHAR(7), -- hex color for highlighting (e.g., "#FF0000")
        -- Metadata
        is_active BOOLEAN DEFAULT TRUE,
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_range_rules_field ON public.range_rules(field_alias)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_range_rules_active ON public.range_rules(is_active) WHERE is_active = TRUE
    `
      )
      .catch(() => {});

    // Seed default range rules for common guideline fields
    await pool
      .query(
        `
      INSERT INTO public.range_rules (field_alias, rule_name, description, min_value, max_value, warning_min, warning_max, severity, conditions)
      VALUES 
        ('ltv_ratio', 'Standard LTV Limits', 'LTV must be ≤97% for conventional, warning at 95%+', NULL, 97, NULL, 95, 'warning', '{}'::jsonb),
        ('ltv_ratio', 'FHA LTV Limits', 'FHA LTV must be ≤96.5%', NULL, 96.5, NULL, 95, 'warning', '{"loan_type": "FHA"}'::jsonb),
        ('be_dti_ratio', 'QM DTI Limits', 'DTI should be ≤43% for QM, warning at 40%+', NULL, 43, NULL, 40, 'warning', '{}'::jsonb),
        ('fico_score', 'Minimum FICO', 'FICO should be ≥620, warning below 680', 620, NULL, 680, NULL, 'warning', '{}'::jsonb),
        ('loan_amount', 'Jumbo Threshold', 'Jumbo loans (≥$726,200) require additional docs', NULL, 726200, NULL, 700000, 'info', '{}'::jsonb)
      ON CONFLICT DO NOTHING
    `
      )
      .catch(() => {});

    // Create saved_filters table (user-defined filters)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.saved_filters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        -- Filter definition
        filter_expression JSONB NOT NULL, -- structured filter: {"and": [{"field": "loan_type", "op": "eq", "value": "FHA"}]}
        -- Scope and visibility
        scope VARCHAR(50) NOT NULL CHECK (scope IN ('personal', 'team', 'persona', 'organization')),
        owner_id UUID REFERENCES public.users(id), -- user who created it
        owner_persona_id UUID REFERENCES public.personas(id), -- persona scope (if scope = 'persona')
        team_ids UUID[], -- team scope (if scope = 'team')
        -- Admin controls
        is_locked BOOLEAN DEFAULT FALSE, -- admin-locked standard filters can't be modified
        is_default BOOLEAN DEFAULT FALSE, -- default filter for a persona
        -- Display
        icon VARCHAR(50), -- optional icon name
        color VARCHAR(7), -- optional hex color
        sort_order INT DEFAULT 0,
        -- Metadata
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_saved_filters_owner ON public.saved_filters(owner_id) WHERE owner_id IS NOT NULL
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_saved_filters_scope ON public.saved_filters(scope)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_saved_filters_persona ON public.saved_filters(owner_persona_id) WHERE owner_persona_id IS NOT NULL
    `
      )
      .catch(() => {});

    // Create scoring_weights table (TopTiering and other scorecard weights)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.scoring_weights (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scorecard_type VARCHAR(50) NOT NULL, -- 'sales', 'operations', 'custom'
        persona_id UUID REFERENCES public.personas(id), -- persona-specific weights (null = org-wide default)
        metric_name VARCHAR(100) NOT NULL, -- 'pull_through', 'revenue', 'volume', 'turn_time'
        weight DECIMAL(5,4) NOT NULL CHECK (weight >= 0 AND weight <= 1), -- weight as decimal (0.25 = 25%)
        is_active BOOLEAN DEFAULT TRUE,
        description TEXT,
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(scorecard_type, persona_id, metric_name)
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_scoring_weights_type ON public.scoring_weights(scorecard_type)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_scoring_weights_persona ON public.scoring_weights(persona_id) WHERE persona_id IS NOT NULL
    `
      )
      .catch(() => {});

    // Seed default scoring weights
    await pool
      .query(
        `
      INSERT INTO public.scoring_weights (scorecard_type, persona_id, metric_name, weight, description)
      VALUES 
        -- Sales scorecard defaults (sum = 1.0)
        ('sales', NULL, 'pull_through', 0.30, 'Pull-through percentage weight'),
        ('sales', NULL, 'revenue', 0.25, 'Revenue per loan weight'),
        ('sales', NULL, 'volume', 0.20, 'Loan volume weight'),
        ('sales', NULL, 'turn_time', 0.25, 'Turn time (inverse) weight'),
        -- Operations scorecard defaults (sum = 1.0)
        ('operations', NULL, 'turn_time', 0.40, 'Turn time weight'),
        ('operations', NULL, 'pull_through', 0.30, 'Pull-through percentage weight'),
        ('operations', NULL, 'volume', 0.30, 'Volume processed weight')
      ON CONFLICT (scorecard_type, persona_id, metric_name) DO NOTHING
    `
      )
      .catch(() => {});

    // Create complexity_components table (loan complexity score configuration)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.complexity_components (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        component_name VARCHAR(100) NOT NULL, -- 'loan_purpose', 'loan_type', 'loan_amount', 'occupancy', 'fico', 'ltv', 'dti', 'employment'
        condition_value VARCHAR(255) NOT NULL, -- e.g., 'FHA', 'C to P', 'self_employed', 'jumbo'
        weight DECIMAL(5,4) NOT NULL, -- complexity weight (can be negative, e.g., -0.10 for FICO > 760)
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(component_name, condition_value)
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_complexity_components_name ON public.complexity_components(component_name)
    `
      )
      .catch(() => {});

    // Seed default complexity components (from Qlik logic)
    await pool
      .query(
        `
      INSERT INTO public.complexity_components (component_name, condition_value, weight, description)
      VALUES 
        -- Loan Purpose
        ('loan_purpose', 'C to P', 0.30, 'Construction-to-Permanent: two-phase loan, construction monitoring'),
        ('loan_purpose', 'Purchase', 0.10, 'Standard purchase transaction'),
        ('loan_purpose', 'Refi CO', 0.10, 'Cash-out refinance: additional equity verification'),
        ('loan_purpose', 'Refi No CO', 0.00, 'Rate/term refinance: simplest type'),
        -- Loan Type
        ('loan_type', 'FHA', 0.10, 'Government program: MI, condition requirements'),
        ('loan_type', 'VA', 0.05, 'Government program: COE requirements'),
        ('loan_type', 'Conventional', 0.00, 'Standard underwriting'),
        -- Loan Amount
        ('loan_amount', 'jumbo', 0.10, 'Jumbo loans (≥$1M): additional documentation and reserves'),
        -- Occupancy
        ('occupancy', 'SecondHome', 0.10, 'Additional scrutiny on occupancy intent'),
        ('occupancy', 'Investor', 0.10, 'Non-owner occupied: rental income analysis'),
        ('occupancy', 'Primary', 0.00, 'Standard owner-occupied'),
        -- FICO (note: can be negative for excellent credit)
        ('fico', 'excellent', -0.10, 'FICO > 760: excellent credit reduces complexity'),
        ('fico', 'good', 0.00, 'FICO 681-760: standard processing'),
        ('fico', 'fair', 0.05, 'FICO 620-681: may require compensating factors'),
        ('fico', 'poor', 0.15, 'FICO ≤620: high-risk credit, extensive documentation'),
        -- LTV
        ('ltv', 'high', 0.05, 'LTV ≥95%: high LTV, MI requirements'),
        -- DTI
        ('dti', 'high', 0.05, 'DTI ≥43%: may require compensating factors'),
        -- Employment
        ('employment', 'self_employed', 0.20, 'Self-employed: tax returns, P&L, business documentation')
      ON CONFLICT (component_name, condition_value) DO NOTHING
    `
      )
      .catch(() => {});

    // =========================================================================
    // AI Data Chat Tables
    // =========================================================================

    // Saved visualizations for custom dashboard
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.saved_visualizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        question TEXT NOT NULL,
        visualization_type TEXT NOT NULL,
        visualization_config JSONB NOT NULL,
        query_config JSONB NOT NULL,
        data_snapshot JSONB,
        position INTEGER DEFAULT 0,
        width INTEGER DEFAULT 1,
        height INTEGER DEFAULT 1,
        is_pinned BOOLEAN DEFAULT false,
        refresh_interval INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_saved_visualizations_user_id ON public.saved_visualizations(user_id)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_saved_visualizations_position ON public.saved_visualizations(position)
    `
      )
      .catch(() => {});

    // Chat history for data chat sessions
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.chat_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        session_id UUID NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        visualization_id UUID REFERENCES public.saved_visualizations(id) ON DELETE SET NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON public.chat_history(user_id)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_chat_history_session_id ON public.chat_history(session_id)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON public.chat_history(created_at DESC)
    `
      )
      .catch(() => {});

    // =========================================================================
    // Role-Based Access Control Tables (RLS)
    // =========================================================================

    // Custom tenant roles with section access and permissions
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.tenant_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        section_access TEXT[] DEFAULT '{}',
        permissions JSONB DEFAULT '{}',
        is_system_role BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(name)
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_tenant_roles_name ON public.tenant_roles(name)
    `
      )
      .catch(() => {});

    // User role assignments
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.user_role_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        role_id UUID NOT NULL REFERENCES public.tenant_roles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, role_id)
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_user_role_assignments_user_id ON public.user_role_assignments(user_id)
    `
      )
      .catch(() => {});

    // Row-level filters for roles
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.role_field_filters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role_id UUID NOT NULL REFERENCES public.tenant_roles(id) ON DELETE CASCADE,
        field_name VARCHAR(255) NOT NULL,
        operator VARCHAR(50) NOT NULL,
        value TEXT,
        dynamic_source VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_role_field_filters_role_id ON public.role_field_filters(role_id)
    `
      )
      .catch(() => {});

    // Seed default roles
    await pool
      .query(
        `
      INSERT INTO public.tenant_roles (name, description, section_access, permissions, is_system_role)
      VALUES 
        ('Admin', 'Full access to all features and data', 
         ARRAY['insights', 'loans', 'leaderboard', 'funnel', 'reports', 'data_quality', 'users', 'settings', 'data_chat'],
         '{"fieldRestrictions": []}', true),
        ('Manager', 'Access to insights and team data',
         ARRAY['insights', 'loans', 'leaderboard', 'funnel', 'reports', 'data_chat'],
         '{"fieldRestrictions": []}', true),
        ('Loan Officer', 'Access to own loans only',
         ARRAY['insights', 'loans', 'funnel', 'data_chat'],
         '{"fieldRestrictions": ["branch_price_concession", "corporate_price_concession", "net_buy", "net_sell"]}', true),
        ('Processor', 'Access to assigned loans',
         ARRAY['insights', 'loans', 'funnel'],
         '{"fieldRestrictions": ["branch_price_concession", "corporate_price_concession", "net_buy", "net_sell", "srp_from_investor"]}', true),
        ('Viewer', 'Read-only access to insights',
         ARRAY['insights'],
         '{"fieldRestrictions": ["branch_price_concession", "corporate_price_concession", "net_buy", "net_sell", "srp_from_investor", "pa_srp_amt", "pa_sell_amt"]}', true)
      ON CONFLICT (name) DO NOTHING
    `
      )
      .catch(() => {});

    // =========================================================================
    // Fallout Prediction Tables (for AI-powered loan outcome prediction)
    // =========================================================================

    // Loan predictions table - stores AI prediction results (NO tenant_id)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.loan_predictions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        loan_id TEXT NOT NULL,
        predicted_outcome TEXT NOT NULL CHECK (predicted_outcome IN ('withdraw', 'deny', 'originate')),
        confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
        reasoning TEXT,
        risk_factors TEXT[],
        bucket TEXT DEFAULT 'medium',
        loan_data JSONB,
        model_version TEXT DEFAULT 'gpt-4o',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(loan_id, created_at)
      )
    `
      )
      .catch(() => {});

    // Add loan_data column if it doesn't exist (migration for existing tables)
    await pool
      .query(
        `
      ALTER TABLE public.loan_predictions 
      ADD COLUMN IF NOT EXISTS loan_data JSONB,
      ADD COLUMN IF NOT EXISTS bucket TEXT DEFAULT 'medium'
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loan_predictions_loan ON public.loan_predictions(loan_id)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loan_predictions_outcome ON public.loan_predictions(predicted_outcome)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loan_predictions_created ON public.loan_predictions(created_at DESC)
    `
      )
      .catch(() => {});

    // AI Pattern Learnings table - stores AI-extracted patterns (NO tenant_id)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.ai_pattern_learnings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        learning_type TEXT NOT NULL DEFAULT 'historical_patterns',
        pattern_summary TEXT NOT NULL,
        historical_loan_count INTEGER NOT NULL,
        date_range_start DATE,
        date_range_end DATE,
        model_version TEXT DEFAULT 'gpt-4o',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_ai_pattern_learnings_type ON public.ai_pattern_learnings(learning_type)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_ai_pattern_learnings_active ON public.ai_pattern_learnings(is_active)
    `
      )
      .catch(() => {});

    // Historical Loan Bucket Cache - cached bucket snapshots (NO tenant_id)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.historical_loan_bucket_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        loan_id TEXT NOT NULL UNIQUE,
        bucket_snapshot JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_historical_loan_bucket_cache_loan ON public.historical_loan_bucket_cache(loan_id)
    `
      )
      .catch(() => {});

    // RAG Knowledge Base table - admin-managed knowledge entries (NO tenant_id)
    await pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS public.rag_knowledge_base (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT,
        tags TEXT[],
        is_active BOOLEAN DEFAULT true,
        priority INTEGER DEFAULT 0,
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_active ON public.rag_knowledge_base(is_active)
    `
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_category ON public.rag_knowledge_base(category)
    `
      )
      .catch(() => {});

    // Loan Outcome Embeddings - vector embeddings for RAG (requires pgvector)
    // Note: pgvector extension must be installed separately
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS vector").catch(() => {});

      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS public.loan_outcome_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          loan_id TEXT NOT NULL UNIQUE,
          outcome TEXT NOT NULL CHECK (outcome IN ('withdraw', 'deny', 'originate')),
          canonical_text TEXT NOT NULL,
          embedding vector(1536) NOT NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `
        )
        .catch(() => {});

      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_loan_outcome_embeddings_loan ON public.loan_outcome_embeddings(loan_id)
      `
        )
        .catch(() => {});

      console.log(
        "[TenantSchema] Fallout Prediction tables created (including pgvector)"
      );
    } catch (error: any) {
      console.warn(
        "[TenantSchema] pgvector extension not available - loan_outcome_embeddings table not created. RAG predictions will be disabled."
      );
    }

    // Create derived field functions
    await createTenantDerivedFieldFunctions(pool);

    // Note: Qlik logic functions (flags, turn times) are no longer used
    // Metrics now use direct SQL instead of PostgreSQL functions for simplicity

    console.log("[TenantSchema] Tenant database schema created");
  } catch (error: any) {
    console.error(
      "[TenantSchema] Error creating tenant schema:",
      error.message
    );
    throw error;
  }
}

/**
 * Create derived field calculation functions for tenant database
 */
async function createTenantDerivedFieldFunctions(pool: pg.Pool): Promise<void> {
  try {
    // Revenue calculation function
    await pool
      .query(
        `
      CREATE OR REPLACE FUNCTION calculate_revenue(p_loan_id UUID)
      RETURNS DECIMAL(12,2) AS $$
      DECLARE
        v_revenue DECIMAL(12,2);
      BEGIN
        SELECT 
          COALESCE(origination_points, 0) + 
          COALESCE(orig_fee_borr_pd, 0) + 
          COALESCE(orig_fees_seller, 0) - 
          COALESCE(cd_lender_credits, 0) +
          COALESCE(pa_sell_amt, 0) + 
          COALESCE(pa_srp_amt, 0) +
          COALESCE(pa_payout_1, 0) + COALESCE(pa_payout_2, 0) + COALESCE(pa_payout_3, 0) +
          COALESCE(pa_payout_4, 0) + COALESCE(pa_payout_5, 0) + COALESCE(pa_payout_6, 0) +
          COALESCE(pa_payout_7, 0) + COALESCE(pa_payout_8, 0) + COALESCE(pa_payout_9, 0) +
          COALESCE(pa_payout_10, 0) + COALESCE(pa_payout_11, 0) + COALESCE(pa_payout_12, 0)
        INTO v_revenue
        FROM public.loans
        WHERE id = p_loan_id;
        
        RETURN COALESCE(v_revenue, 0);
      END;
      $$ LANGUAGE plpgsql;
    `
      )
      .catch(() => {});

    // Turn time calculation function
    await pool
      .query(
        `
      CREATE OR REPLACE FUNCTION calculate_turn_time(
        p_start_date DATE,
        p_end_date DATE
      )
      RETURNS INTEGER AS $$
      BEGIN
        IF p_start_date IS NULL OR p_end_date IS NULL THEN
          RETURN NULL;
        END IF;
        
        RETURN p_end_date - p_start_date;
      END;
      $$ LANGUAGE plpgsql;
    `
      )
      .catch(() => {});

    // Margin (BPS) calculation function
    await pool
      .query(
        `
      CREATE OR REPLACE FUNCTION calculate_margin_bps(p_loan_id UUID)
      RETURNS DECIMAL(12,2) AS $$
      DECLARE
        v_revenue DECIMAL(12,2);
        v_loan_amount DECIMAL(12,2);
        v_margin_bps DECIMAL(12,2);
      BEGIN
        SELECT calculate_revenue(p_loan_id), loan_amount
        INTO v_revenue, v_loan_amount
        FROM public.loans
        WHERE id = p_loan_id;
        
        IF v_loan_amount IS NULL OR v_loan_amount <= 0 THEN
          RETURN NULL;
        END IF;
        
        v_margin_bps := (v_revenue / v_loan_amount) * 10000;
        RETURN v_margin_bps;
      END;
      $$ LANGUAGE plpgsql;
    `
      )
      .catch(() => {});

    // Get loans for YTD period
    await pool
      .query(
        `
      CREATE OR REPLACE FUNCTION get_loans_ytd(
        p_date_field TEXT DEFAULT 'application_date'
      )
      RETURNS TABLE (
        id UUID,
        loan_id TEXT,
        loan_amount DECIMAL(12,2),
        application_date DATE,
        closing_date DATE,
        funding_date DATE
      ) AS $$
      BEGIN
        RETURN QUERY
        EXECUTE format('
          SELECT 
            l.id,
            l.loan_id,
            l.loan_amount,
            l.application_date,
            l.closing_date,
            l.funding_date
          FROM public.loans l
          WHERE l.%I >= DATE_TRUNC(''year'', CURRENT_DATE)
            AND l.%I <= CURRENT_DATE
        ', p_date_field, p_date_field);
      END;
      $$ LANGUAGE plpgsql;
    `
      )
      .catch(() => {});

    // Get loans for MTD period
    await pool
      .query(
        `
      CREATE OR REPLACE FUNCTION get_loans_mtd(
        p_date_field TEXT DEFAULT 'application_date'
      )
      RETURNS TABLE (
        id UUID,
        loan_id TEXT,
        loan_amount DECIMAL(12,2),
        application_date DATE,
        closing_date DATE,
        funding_date DATE
      ) AS $$
      BEGIN
        RETURN QUERY
        EXECUTE format('
          SELECT 
            l.id,
            l.loan_id,
            l.loan_amount,
            l.application_date,
            l.closing_date,
            l.funding_date
          FROM public.loans l
          WHERE l.%I >= DATE_TRUNC(''month'', CURRENT_DATE)
            AND l.%I <= CURRENT_DATE
        ', p_date_field, p_date_field);
      END;
      $$ LANGUAGE plpgsql;
    `
      )
      .catch(() => {});
  } catch (error: any) {
    console.warn(
      "[TenantSchema] Error creating derived field functions:",
      error.message
    );
  }
}

/**
 * Qlik Logic Functions
 * PostgreSQL functions implementing Qlik Logic Dictionary definitions
 * These functions are added to tenant databases for reusable metric calculations
 */

import pg from 'pg';

/**
 * Initialize Qlik logic functions in a tenant database
 * These functions implement status flags, turn time calculations, etc. from the Qlik Logic Dictionary
 */
export async function initializeQlikLogicFunctions(pool: pg.Pool): Promise<void> {
  try {
    console.log('[QlikLogicFunctions] Initializing Qlik logic functions...');

    // Status flag functions (return 'Yes'/'No' to match Qlik convention)
    
    // Funded Flag: funding_date IS NOT NULL AND funding_date <= CURRENT_DATE
    await pool.query(`
      CREATE OR REPLACE FUNCTION is_funded_flag(funding_date DATE)
      RETURNS TEXT AS $$
      BEGIN
        RETURN CASE 
          WHEN funding_date IS NOT NULL AND funding_date <= CURRENT_DATE THEN 'Yes'
          ELSE 'No'
        END;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Active Loan Flag: current_status = 'Active Loan' AND application_date IS NOT NULL
    await pool.query(`
      CREATE OR REPLACE FUNCTION is_active_loan_flag(current_status TEXT, application_date DATE)
      RETURNS TEXT AS $$
      BEGIN
        RETURN CASE 
          WHEN current_status = 'Active Loan' AND application_date IS NOT NULL THEN 'Yes'
          ELSE 'No'
        END;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Locked Flag: lock_date IS NOT NULL
    await pool.query(`
      CREATE OR REPLACE FUNCTION is_locked_flag(lock_date DATE)
      RETURNS TEXT AS $$
      BEGIN
        RETURN CASE 
          WHEN lock_date IS NOT NULL THEN 'Yes'
          ELSE 'No'
        END;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Pull Through Originated Flag: status contains 'Originated' or 'purchased'
    await pool.query(`
      CREATE OR REPLACE FUNCTION is_pull_through_originated_flag(current_status TEXT)
      RETURNS TEXT AS $$
      BEGIN
        RETURN CASE 
          WHEN current_status ILIKE '%Originated%' OR current_status ILIKE '%purchased%' THEN 'Yes'
          ELSE 'No'
        END;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Turn time functions (calendar days, not business days)

    // App-Close: DATE(closing_date) - DATE(application_date)
    await pool.query(`
      CREATE OR REPLACE FUNCTION calculate_app_close_days(application_date DATE, closing_date DATE)
      RETURNS INTEGER AS $$
      BEGIN
        RETURN CASE 
          WHEN closing_date IS NOT NULL AND application_date IS NOT NULL 
          THEN DATE(closing_date) - DATE(application_date)
          ELSE NULL
        END;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // App-Fund: DATE(funding_date) - DATE(application_date)
    await pool.query(`
      CREATE OR REPLACE FUNCTION calculate_app_fund_days(application_date DATE, funding_date DATE)
      RETURNS INTEGER AS $$
      BEGIN
        RETURN CASE 
          WHEN funding_date IS NOT NULL AND application_date IS NOT NULL 
          THEN DATE(funding_date) - DATE(application_date)
          ELSE NULL
        END;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Active Aging Days: CURRENT_DATE - application_date (for active loans only)
    await pool.query(`
      CREATE OR REPLACE FUNCTION calculate_active_aging_days(application_date DATE, current_status TEXT)
      RETURNS INTEGER AS $$
      BEGIN
        RETURN CASE 
          WHEN current_status NOT IN ('withdrawn', 'cancelled', 'denied', 'declined', 'funded', 'closed', 'originated')
            AND application_date IS NOT NULL 
          THEN FLOOR(CURRENT_DATE - application_date)
          ELSE NULL
        END;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    console.log('[QlikLogicFunctions] Qlik logic functions initialized successfully');
  } catch (error: any) {
    console.error('[QlikLogicFunctions] Error initializing functions:', error.message);
    throw error;
  }
}

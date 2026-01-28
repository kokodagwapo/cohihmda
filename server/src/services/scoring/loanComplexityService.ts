/**
 * Loan Complexity Service
 * Calculates loan complexity scores based on configurable components
 * 
 * Based on Qlik logic from legacy Coheus:
 * - Loan Purpose: C-to-P (+30%), Purchase (+10%), Refi CO (+10%), Refi No CO (0%)
 * - Loan Type: FHA (+10%), VA (+5%), Conventional (0%)
 * - Loan Amount: Jumbo ≥$1M (+10%)
 * - Occupancy: Second Home (+10%), Investor (+10%), Primary (0%)
 * - FICO: >760 (-10%), 681-760 (0%), 620-681 (+5%), ≤620 (+15%)
 * - LTV: ≥95% (+5%)
 * - DTI: ≥43% (+5%)
 * - Employment: Self-employed (+20%)
 */

import pg from 'pg';
import { logInfo, logError, logDebug } from '../logger.js';

export interface LoanData {
  loan_purpose?: string;
  loan_type?: string;
  loan_amount?: number;
  occupancy_type?: string;
  fico_score?: number;
  ltv_ratio?: number;
  be_dti_ratio?: number;
  borr_self_employed?: boolean;
  co_borr_self_employed?: boolean;
}

export interface ComplexityScore {
  totalScore: number;
  components: ComplexityComponent[];
  interpretation: 'low' | 'medium' | 'high';
}

export interface ComplexityComponent {
  name: string;
  condition: string;
  weight: number;
  applied: boolean;
}

// Default complexity weights (can be overridden by tenant configuration)
const DEFAULT_COMPLEXITY_WEIGHTS: Record<string, Record<string, number>> = {
  loan_purpose: {
    'C to P': 0.30,
    'Construction-to-Permanent': 0.30,
    'Purchase': 0.10,
    'Refi CO': 0.10,
    'Cash-Out Refinance': 0.10,
    'Refi No CO': 0.00,
    'NoCash-Out Refinance': 0.00,
    'Rate/Term Refinance': 0.00,
  },
  loan_type: {
    'FHA': 0.10,
    'VA': 0.05,
    'Conventional': 0.00,
    'USDA': 0.05,
    'Jumbo': 0.15,
  },
  occupancy: {
    'SecondHome': 0.10,
    'Second Home': 0.10,
    'Investor': 0.10,
    'Investment': 0.10,
    'Primary': 0.00,
    'PrimaryResidence': 0.00,
    'Owner Occupied': 0.00,
  },
};

// FICO score ranges and their weights
const FICO_WEIGHTS = [
  { condition: 'excellent', minScore: 760, maxScore: 850, weight: -0.10 },
  { condition: 'good', minScore: 681, maxScore: 759, weight: 0.00 },
  { condition: 'fair', minScore: 620, maxScore: 680, weight: 0.05 },
  { condition: 'poor', minScore: 300, maxScore: 619, weight: 0.15 },
];

export class LoanComplexityService {
  private pool: pg.Pool;
  private customWeights: Record<string, Record<string, number>> | null = null;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * Load custom complexity weights from the database
   */
  async loadCustomWeights(): Promise<void> {
    try {
      const result = await this.pool.query(`
        SELECT component_name, condition_value, weight
        FROM public.complexity_components
        WHERE is_active = TRUE
      `);

      this.customWeights = {};
      for (const row of result.rows) {
        if (!this.customWeights[row.component_name]) {
          this.customWeights[row.component_name] = {};
        }
        this.customWeights[row.component_name][row.condition_value] = parseFloat(row.weight);
      }

      logDebug('Loaded custom complexity weights', { count: result.rows.length });
    } catch (error: any) {
      logError('Error loading custom complexity weights', error);
      this.customWeights = null;
    }
  }

  /**
   * Get weight for a specific component and condition
   */
  private getWeight(component: string, condition: string): number {
    // First check custom weights
    if (this.customWeights?.[component]?.[condition] !== undefined) {
      return this.customWeights[component][condition];
    }
    // Fall back to defaults
    return DEFAULT_COMPLEXITY_WEIGHTS[component]?.[condition] ?? 0;
  }

  /**
   * Calculate complexity score for a loan
   */
  calculateComplexity(loan: LoanData): ComplexityScore {
    const components: ComplexityComponent[] = [];
    let totalScore = 0;

    // 1. Loan Purpose
    if (loan.loan_purpose) {
      const purpose = loan.loan_purpose;
      const purposeWeight = this.getWeight('loan_purpose', purpose);
      components.push({
        name: 'Loan Purpose',
        condition: purpose,
        weight: purposeWeight,
        applied: true,
      });
      totalScore += purposeWeight;
    }

    // 2. Loan Type
    if (loan.loan_type) {
      const loanType = loan.loan_type;
      const typeWeight = this.getWeight('loan_type', loanType);
      components.push({
        name: 'Loan Type',
        condition: loanType,
        weight: typeWeight,
        applied: true,
      });
      totalScore += typeWeight;
    }

    // 3. Loan Amount (Jumbo check)
    if (loan.loan_amount) {
      const amount = loan.loan_amount;
      if (amount >= 1000000) {
        const jumboWeight = this.customWeights?.['loan_amount']?.['jumbo'] ?? 0.10;
        components.push({
          name: 'Loan Amount',
          condition: 'jumbo',
          weight: jumboWeight,
          applied: true,
        });
        totalScore += jumboWeight;
      } else {
        components.push({
          name: 'Loan Amount',
          condition: 'conforming',
          weight: 0,
          applied: false,
        });
      }
    }

    // 4. Occupancy Type
    if (loan.occupancy_type) {
      const occupancy = loan.occupancy_type;
      const occupancyWeight = this.getWeight('occupancy', occupancy);
      components.push({
        name: 'Occupancy',
        condition: occupancy,
        weight: occupancyWeight,
        applied: occupancyWeight !== 0,
      });
      totalScore += occupancyWeight;
    }

    // 5. FICO Score
    if (loan.fico_score) {
      const fico = loan.fico_score;
      let ficoWeight = 0;
      let ficoCondition = 'unknown';

      for (const range of FICO_WEIGHTS) {
        if (fico >= range.minScore && fico <= range.maxScore) {
          // Check for custom override
          ficoWeight = this.customWeights?.['fico']?.[range.condition] ?? range.weight;
          ficoCondition = range.condition;
          break;
        }
      }

      components.push({
        name: 'FICO Score',
        condition: `${ficoCondition} (${fico})`,
        weight: ficoWeight,
        applied: true,
      });
      totalScore += ficoWeight;
    }

    // 6. LTV Ratio
    if (loan.ltv_ratio) {
      const ltv = loan.ltv_ratio;
      if (ltv >= 95) {
        const ltvWeight = this.customWeights?.['ltv']?.['high'] ?? 0.05;
        components.push({
          name: 'LTV',
          condition: `high (${ltv.toFixed(1)}%)`,
          weight: ltvWeight,
          applied: true,
        });
        totalScore += ltvWeight;
      } else {
        components.push({
          name: 'LTV',
          condition: `${ltv.toFixed(1)}%`,
          weight: 0,
          applied: false,
        });
      }
    }

    // 7. DTI Ratio
    if (loan.be_dti_ratio) {
      const dti = loan.be_dti_ratio;
      if (dti >= 43) {
        const dtiWeight = this.customWeights?.['dti']?.['high'] ?? 0.05;
        components.push({
          name: 'DTI',
          condition: `high (${dti.toFixed(1)}%)`,
          weight: dtiWeight,
          applied: true,
        });
        totalScore += dtiWeight;
      } else {
        components.push({
          name: 'DTI',
          condition: `${dti.toFixed(1)}%`,
          weight: 0,
          applied: false,
        });
      }
    }

    // 8. Self-Employment
    const isSelfEmployed = loan.borr_self_employed || loan.co_borr_self_employed;
    if (isSelfEmployed) {
      const selfEmpWeight = this.customWeights?.['employment']?.['self_employed'] ?? 0.20;
      components.push({
        name: 'Employment',
        condition: 'self_employed',
        weight: selfEmpWeight,
        applied: true,
      });
      totalScore += selfEmpWeight;
    } else {
      components.push({
        name: 'Employment',
        condition: 'w2_employee',
        weight: 0,
        applied: false,
      });
    }

    // Determine interpretation
    let interpretation: 'low' | 'medium' | 'high';
    if (totalScore < 0.5) {
      interpretation = 'low';
    } else if (totalScore <= 1.0) {
      interpretation = 'medium';
    } else {
      interpretation = 'high';
    }

    return {
      totalScore: Math.round(totalScore * 100) / 100, // Round to 2 decimal places
      components,
      interpretation,
    };
  }

  /**
   * Calculate complexity scores for multiple loans
   */
  calculateBatch(loans: LoanData[]): ComplexityScore[] {
    return loans.map(loan => this.calculateComplexity(loan));
  }

  /**
   * Calculate complexity for a loan by ID
   */
  async calculateByLoanId(loanId: string): Promise<ComplexityScore | null> {
    try {
      const result = await this.pool.query(`
        SELECT 
          loan_purpose, loan_type, loan_amount, occupancy_type,
          fico_score, ltv_ratio, be_dti_ratio,
          borr_self_employed, co_borr_self_employed
        FROM public.loans
        WHERE loan_id = $1
      `, [loanId]);

      if (result.rows.length === 0) {
        return null;
      }

      const loan = result.rows[0];
      return this.calculateComplexity({
        loan_purpose: loan.loan_purpose,
        loan_type: loan.loan_type,
        loan_amount: loan.loan_amount ? parseFloat(loan.loan_amount) : undefined,
        occupancy_type: loan.occupancy_type,
        fico_score: loan.fico_score ? parseInt(loan.fico_score) : undefined,
        ltv_ratio: loan.ltv_ratio ? parseFloat(loan.ltv_ratio) : undefined,
        be_dti_ratio: loan.be_dti_ratio ? parseFloat(loan.be_dti_ratio) : undefined,
        borr_self_employed: loan.borr_self_employed,
        co_borr_self_employed: loan.co_borr_self_employed,
      });
    } catch (error: any) {
      logError('Error calculating complexity by loan ID', error, { loanId });
      throw error;
    }
  }

  /**
   * Update all loan complexity scores in the database
   * Adds complexity_score column if it doesn't exist
   */
  async updateAllComplexityScores(): Promise<{ updated: number; errors: number }> {
    let updated = 0;
    let errors = 0;

    try {
      // Ensure complexity_score column exists
      await this.pool.query(`
        ALTER TABLE public.loans
        ADD COLUMN IF NOT EXISTS complexity_score DECIMAL(5,2)
      `).catch(() => {});

      // Load custom weights
      await this.loadCustomWeights();

      // Get all loans that need complexity calculation
      const result = await this.pool.query(`
        SELECT 
          id, loan_id, loan_purpose, loan_type, loan_amount, occupancy_type,
          fico_score, ltv_ratio, be_dti_ratio,
          borr_self_employed, co_borr_self_employed
        FROM public.loans
      `);

      logInfo('Starting complexity score update', { totalLoans: result.rows.length });

      for (const loan of result.rows) {
        try {
          const score = this.calculateComplexity({
            loan_purpose: loan.loan_purpose,
            loan_type: loan.loan_type,
            loan_amount: loan.loan_amount ? parseFloat(loan.loan_amount) : undefined,
            occupancy_type: loan.occupancy_type,
            fico_score: loan.fico_score ? parseInt(loan.fico_score) : undefined,
            ltv_ratio: loan.ltv_ratio ? parseFloat(loan.ltv_ratio) : undefined,
            be_dti_ratio: loan.be_dti_ratio ? parseFloat(loan.be_dti_ratio) : undefined,
            borr_self_employed: loan.borr_self_employed,
            co_borr_self_employed: loan.co_borr_self_employed,
          });

          await this.pool.query(`
            UPDATE public.loans
            SET complexity_score = $1
            WHERE id = $2
          `, [score.totalScore, loan.id]);

          updated++;
        } catch (error: any) {
          logError('Error updating loan complexity', error, { loanId: loan.loan_id });
          errors++;
        }
      }

      logInfo('Complexity score update complete', { updated, errors });
      return { updated, errors };
    } catch (error: any) {
      logError('Error in bulk complexity update', error);
      throw error;
    }
  }
}

export default LoanComplexityService;

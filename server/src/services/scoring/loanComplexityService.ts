/**
 * Loan Complexity Service
 * Calculates loan complexity scores using canonical calcLoanComplexity from scorecard-utils.
 * Supports V2 config with dynamic ranges (FICO, DTI, LTV, Loan Amount) and categorical rules.
 */

import pg from 'pg';
import { logInfo, logError, logDebug } from '../logger.js';
import {
  calcLoanComplexity,
  calcLoanComplexityWithBreakdown,
  parseComplexityConfigV2,
  type LoanComplexityData,
  type ComplexityConfigV2,
} from "../../utils/scorecard-utils.js";
import { loanRecordToLoanData } from "./persistedLoanComplexity.js";

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
  non_qm?: boolean | string;
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

/** Map LoanData to LoanComplexityData for canonical calculator. */
function toLoanComplexityData(loan: LoanData): LoanComplexityData {
  return {
    loan_type: loan.loan_type,
    loan_purpose: loan.loan_purpose,
    loan_amount: loan.loan_amount,
    fico_score: loan.fico_score,
    ltv_ratio: loan.ltv_ratio,
    be_dti_ratio: loan.be_dti_ratio,
    occupancy_type: loan.occupancy_type,
    borr_self_employed: loan.borr_self_employed,
    non_qm: loan.non_qm,
  };
}

/** Interpretation from totalScore (100 = baseline). */
function interpretationFromScore(totalScore: number): 'low' | 'medium' | 'high' {
  if (totalScore < 105) return 'low';
  if (totalScore <= 120) return 'medium';
  return 'high';
}

export class LoanComplexityService {
  private pool: pg.Pool;
  private configV2: ComplexityConfigV2 | null = null;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /** After loadCustomWeights(): V2 config for calcLoanComplexity parity on read paths. */
  getConfigV2(): ComplexityConfigV2 | null {
    return this.configV2;
  }

  /**
   * Load complexity config from the database (with range_min/range_max for V2).
   */
  async loadCustomWeights(): Promise<void> {
    try {
      const result = await this.pool.query(`
        SELECT component_name, condition_value, weight, range_min, range_max
        FROM public.complexity_components
        WHERE is_active = TRUE
        ORDER BY component_name, COALESCE(range_min, 0), condition_value
      `);

      if (result.rows.length === 0) {
        this.configV2 = null;
        logDebug('No complexity components in DB, using legacy defaults');
        return;
      }

      this.configV2 = parseComplexityConfigV2(result.rows);
      logDebug('Loaded complexity config V2', { count: result.rows.length });
    } catch (error: any) {
      logError('Error loading complexity config', error);
      this.configV2 = null;
    }
  }

  /**
   * Calculate complexity score for a loan using canonical logic (V2 config or legacy).
   */
  calculateComplexity(loan: LoanData): ComplexityScore {
    const loanData = toLoanComplexityData(loan);

    if (this.configV2 && Object.keys(this.configV2).length > 0) {
      const { totalScore, components } = calcLoanComplexityWithBreakdown(
        loanData,
        this.configV2,
      );
      return {
        totalScore,
        components: components.map((c) => ({
          name: c.name,
          condition: c.condition,
          weight: c.weight / 100,
          applied: c.applied,
        })),
        interpretation: interpretationFromScore(totalScore),
      };
    }

    const totalScore = calcLoanComplexity(loanData);
    return {
      totalScore,
      components: [],
      interpretation: interpretationFromScore(totalScore),
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
      await this.loadCustomWeights();

      const result = await this.pool.query(
        `
        SELECT 
          loan_purpose, loan_type, loan_amount, occupancy_type,
          fico_score, ltv_ratio, be_dti_ratio,
          borr_self_employed, co_borr_self_employed, non_qm,
          complexity_score
        FROM public.loans
        WHERE loan_id = $1
      `,
        [loanId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const loan = result.rows[0];
      return this.calculateComplexity(loanRecordToLoanData(loan));
    } catch (error: any) {
      logError('Error calculating complexity by loan ID', error, { loanId });
      throw error;
    }
  }

  /**
   * Synchronous full-table recompute (batch updates). Prefer background_jobs for production.
   * Expects migration 101+ (complexity_score column present).
   */
  async updateAllComplexityScores(): Promise<{ updated: number; errors: number }> {
    let updated = 0;
    let errors = 0;
    const bs = parseInt(process.env.LOAN_COMPLEXITY_RECOMPUTE_BATCH_SIZE || "1000", 10) || 1000;

    try {
      await this.loadCustomWeights();
      let lastId: string | null = null;

      for (;;) {
        const result = await this.pool.query(
          `
          SELECT id, loan_id,
                 loan_purpose, loan_type, loan_amount, occupancy_type,
                 fico_score, ltv_ratio, be_dti_ratio,
                 borr_self_employed, co_borr_self_employed, non_qm
          FROM public.loans
          WHERE ($1::uuid IS NULL OR id > $1::uuid)
          ORDER BY id ASC
          LIMIT $2
          `,
          [lastId, bs],
        );

        if (result.rows.length === 0) break;

        const pairs: Array<{ id: string; score: number }> = [];
        for (const loan of result.rows) {
          try {
            const score = this.calculateComplexity(loanRecordToLoanData(loan)).totalScore;
            pairs.push({ id: loan.id, score: Math.round(score * 100) / 100 });
          } catch (error: any) {
            logError("Error updating loan complexity", error, { loanId: loan.loan_id });
            errors++;
          }
        }

        if (pairs.length > 0) {
          const parts: string[] = [];
          const params: unknown[] = [];
          let i = 1;
          for (const p of pairs) {
            parts.push(`($${i}::uuid, $${i + 1}::numeric)`);
            params.push(p.id, p.score);
            i += 2;
          }
          await this.pool.query(
            `
            UPDATE public.loans l
            SET complexity_score = v.score
            FROM (VALUES ${parts.join(", ")}) AS v(id, score)
            WHERE l.id = v.id
            `,
            params,
          );
          updated += pairs.length;
        }

        lastId = String(result.rows[result.rows.length - 1].id);
      }

      logInfo("Complexity score update complete", { updated, errors });
      return { updated, errors };
    } catch (error: any) {
      logError("Error in bulk complexity update", error);
      throw error;
    }
  }
}

export default LoanComplexityService;

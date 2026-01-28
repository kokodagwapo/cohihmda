/**
 * TopTiering Service
 * Calculates TopTiering (TTS) scorecard for sales and operations staff
 * 
 * Based on Qlik logic from legacy Coheus:
 * - Sales Scorecard: Pull-through (30%), Revenue (25%), Volume (20%), Turn Time (25%)
 * - Operations Scorecard: Turn Time (40%), Pull-through (30%), Volume (30%)
 * 
 * Metrics are normalized and combined using configurable weights
 */

import pg from 'pg';
import { logInfo, logError, logDebug } from '../logger.js';

export interface TopTieringInput {
  // Actor info
  actorId: string;
  actorName?: string;
  actorType: 'loan_officer' | 'processor' | 'underwriter' | 'closer' | 'branch';
  
  // Raw metrics (will be normalized)
  pullThrough?: number; // Percentage (0-100)
  revenue?: number; // Total revenue in dollars
  volume?: number; // Number of loans
  avgTurnTime?: number; // Average days from app to close
}

export interface TopTieringScore {
  actorId: string;
  actorName?: string;
  actorType: string;
  scorecardType: 'sales' | 'operations';
  totalScore: number;
  percentile?: number; // Relative ranking among peers
  components: TopTieringComponent[];
  interpretation: 'top' | 'above_average' | 'average' | 'below_average' | 'bottom';
}

export interface TopTieringComponent {
  metric: string;
  rawValue: number | null;
  normalizedValue: number;
  weight: number;
  contribution: number; // weight * normalizedValue
}

// Default weights (can be overridden by tenant configuration)
const DEFAULT_SALES_WEIGHTS: Record<string, number> = {
  pull_through: 0.30,
  revenue: 0.25,
  volume: 0.20,
  turn_time: 0.25,
};

const DEFAULT_OPS_WEIGHTS: Record<string, number> = {
  turn_time: 0.40,
  pull_through: 0.30,
  volume: 0.30,
};

// Normalization parameters (min/max for scaling to 0-100)
// These would typically be calculated from the data distribution
const NORMALIZATION_PARAMS = {
  pull_through: { min: 0, max: 100, inverse: false }, // Already percentage
  revenue: { min: 0, max: 50000, inverse: false }, // Per loan revenue
  volume: { min: 0, max: 100, inverse: false }, // Loans per period
  turn_time: { min: 0, max: 90, inverse: true }, // Lower is better
};

export class TopTieringService {
  private pool: pg.Pool;
  private salesWeights: Record<string, number> = { ...DEFAULT_SALES_WEIGHTS };
  private opsWeights: Record<string, number> = { ...DEFAULT_OPS_WEIGHTS };

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * Load custom scoring weights from database
   */
  async loadCustomWeights(): Promise<void> {
    try {
      const result = await this.pool.query(`
        SELECT scorecard_type, metric_name, weight
        FROM public.scoring_weights
        WHERE is_active = TRUE AND persona_id IS NULL
        ORDER BY scorecard_type, metric_name
      `);

      // Reset to defaults first
      this.salesWeights = { ...DEFAULT_SALES_WEIGHTS };
      this.opsWeights = { ...DEFAULT_OPS_WEIGHTS };

      for (const row of result.rows) {
        const weight = parseFloat(row.weight);
        if (row.scorecard_type === 'sales') {
          this.salesWeights[row.metric_name] = weight;
        } else if (row.scorecard_type === 'operations') {
          this.opsWeights[row.metric_name] = weight;
        }
      }

      logDebug('Loaded TopTiering weights', { 
        sales: this.salesWeights, 
        operations: this.opsWeights 
      });
    } catch (error: any) {
      logError('Error loading TopTiering weights', error);
    }
  }

  /**
   * Normalize a metric value to 0-100 scale
   */
  private normalize(metric: string, value: number | null): number {
    if (value === null || value === undefined) return 0;

    const params = NORMALIZATION_PARAMS[metric as keyof typeof NORMALIZATION_PARAMS];
    if (!params) return 0;

    // Clamp to min/max range
    let clamped = Math.max(params.min, Math.min(params.max, value));
    
    // Scale to 0-100
    let normalized = ((clamped - params.min) / (params.max - params.min)) * 100;
    
    // Invert if needed (e.g., turn time where lower is better)
    if (params.inverse) {
      normalized = 100 - normalized;
    }

    return Math.round(normalized * 100) / 100;
  }

  /**
   * Calculate TopTiering score for an actor
   */
  calculateScore(input: TopTieringInput, scorecardType: 'sales' | 'operations'): TopTieringScore {
    const weights = scorecardType === 'sales' ? this.salesWeights : this.opsWeights;
    const components: TopTieringComponent[] = [];
    let totalScore = 0;

    // Process each metric
    const metrics = scorecardType === 'sales' 
      ? ['pull_through', 'revenue', 'volume', 'turn_time']
      : ['turn_time', 'pull_through', 'volume'];

    for (const metric of metrics) {
      const weight = weights[metric] || 0;
      let rawValue: number | null = null;

      // Map input to metric
      switch (metric) {
        case 'pull_through':
          rawValue = input.pullThrough ?? null;
          break;
        case 'revenue':
          rawValue = input.revenue ?? null;
          break;
        case 'volume':
          rawValue = input.volume ?? null;
          break;
        case 'turn_time':
          rawValue = input.avgTurnTime ?? null;
          break;
      }

      const normalizedValue = this.normalize(metric, rawValue);
      const contribution = normalizedValue * weight;

      components.push({
        metric,
        rawValue,
        normalizedValue,
        weight,
        contribution,
      });

      totalScore += contribution;
    }

    // Determine interpretation
    let interpretation: TopTieringScore['interpretation'];
    if (totalScore >= 80) {
      interpretation = 'top';
    } else if (totalScore >= 60) {
      interpretation = 'above_average';
    } else if (totalScore >= 40) {
      interpretation = 'average';
    } else if (totalScore >= 20) {
      interpretation = 'below_average';
    } else {
      interpretation = 'bottom';
    }

    return {
      actorId: input.actorId,
      actorName: input.actorName,
      actorType: input.actorType,
      scorecardType,
      totalScore: Math.round(totalScore * 100) / 100,
      components,
      interpretation,
    };
  }

  /**
   * Calculate TopTiering scores for all loan officers/processors
   */
  async calculateAllScores(
    scorecardType: 'sales' | 'operations',
    startDate?: Date,
    endDate?: Date
  ): Promise<TopTieringScore[]> {
    await this.loadCustomWeights();

    try {
      // Build date filter
      let dateFilter = '';
      const params: any[] = [];
      
      if (startDate && endDate) {
        dateFilter = 'WHERE funding_date BETWEEN $1 AND $2';
        params.push(startDate, endDate);
      } else if (startDate) {
        dateFilter = 'WHERE funding_date >= $1';
        params.push(startDate);
      } else if (endDate) {
        dateFilter = 'WHERE funding_date <= $1';
        params.push(endDate);
      }

      // Determine which field to group by based on scorecard type
      const actorField = scorecardType === 'sales' ? 'loan_officer' : 'processor';
      const actorIdField = scorecardType === 'sales' ? 'loan_officer_id' : 'processor';

      // Calculate aggregate metrics for each actor
      const query = `
        WITH funded_loans AS (
          SELECT *
          FROM public.loans
          ${dateFilter}
          ${dateFilter ? 'AND' : 'WHERE'} funding_date IS NOT NULL
        ),
        actor_metrics AS (
          SELECT 
            ${actorField} as actor_name,
            ${actorIdField} as actor_id,
            COUNT(*) as total_loans,
            COUNT(CASE WHEN funding_date IS NOT NULL THEN 1 END) as funded_loans,
            SUM(CASE WHEN funding_date IS NOT NULL THEN 
              COALESCE(origination_points, 0) + 
              COALESCE(orig_fee_borr_pd, 0) + 
              COALESCE(orig_fees_seller, 0) - 
              COALESCE(cd_lender_credits, 0)
            ELSE 0 END) as total_revenue,
            AVG(
              CASE WHEN application_date IS NOT NULL AND funding_date IS NOT NULL 
              THEN EXTRACT(DAY FROM funding_date - application_date::timestamp)
              END
            ) as avg_turn_time
          FROM public.loans
          ${dateFilter}
          GROUP BY ${actorField}, ${actorIdField}
          HAVING COUNT(*) > 0
        )
        SELECT 
          actor_name,
          actor_id,
          total_loans,
          funded_loans,
          ROUND(100.0 * funded_loans / NULLIF(total_loans, 0), 2) as pull_through,
          ROUND(total_revenue::numeric, 2) as total_revenue,
          ROUND((total_revenue / NULLIF(funded_loans, 0))::numeric, 2) as revenue_per_loan,
          ROUND(avg_turn_time::numeric, 1) as avg_turn_time
        FROM actor_metrics
        WHERE actor_name IS NOT NULL
        ORDER BY funded_loans DESC
      `;

      const result = await this.pool.query(query, params);
      
      const scores: TopTieringScore[] = [];
      const actorType = scorecardType === 'sales' ? 'loan_officer' : 'processor';

      for (const row of result.rows) {
        const score = this.calculateScore({
          actorId: row.actor_id || row.actor_name,
          actorName: row.actor_name,
          actorType: actorType as any,
          pullThrough: row.pull_through ? parseFloat(row.pull_through) : undefined,
          revenue: row.revenue_per_loan ? parseFloat(row.revenue_per_loan) : undefined,
          volume: row.funded_loans ? parseInt(row.funded_loans) : undefined,
          avgTurnTime: row.avg_turn_time ? parseFloat(row.avg_turn_time) : undefined,
        }, scorecardType);

        scores.push(score);
      }

      // Calculate percentiles
      this.calculatePercentiles(scores);

      logInfo('TopTiering scores calculated', { 
        scorecardType, 
        actorCount: scores.length,
        dateRange: { startDate, endDate }
      });

      return scores;
    } catch (error: any) {
      logError('Error calculating TopTiering scores', error);
      throw error;
    }
  }

  /**
   * Add percentile rankings to scores
   */
  private calculatePercentiles(scores: TopTieringScore[]): void {
    if (scores.length === 0) return;

    // Sort by total score descending
    const sorted = [...scores].sort((a, b) => b.totalScore - a.totalScore);
    
    // Assign percentiles
    for (let i = 0; i < sorted.length; i++) {
      const percentile = Math.round(((sorted.length - i) / sorted.length) * 100);
      sorted[i].percentile = percentile;
    }
  }

  /**
   * Get top performers
   */
  async getTopPerformers(
    scorecardType: 'sales' | 'operations',
    limit: number = 10,
    startDate?: Date,
    endDate?: Date
  ): Promise<TopTieringScore[]> {
    const scores = await this.calculateAllScores(scorecardType, startDate, endDate);
    return scores
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit);
  }

  /**
   * Get score for a specific actor
   */
  async getActorScore(
    actorId: string,
    scorecardType: 'sales' | 'operations',
    startDate?: Date,
    endDate?: Date
  ): Promise<TopTieringScore | null> {
    const scores = await this.calculateAllScores(scorecardType, startDate, endDate);
    return scores.find(s => s.actorId === actorId) || null;
  }
}

export default TopTieringService;

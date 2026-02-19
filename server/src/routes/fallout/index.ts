/**
 * Fallout API routes (BRD 2.10)
 * Tenant-scoped: GET risk-bands, top-patterns, predictions, executive-rollup; POST recompute
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import { apiLimiter } from '../../middleware/rateLimiter.js';
import { logError, logInfo } from '../../services/logger.js';
import {
  getHistoricalFalloutRates,
  runFalloutSequencer,
  runNumericOutcomeProfileDerivation,
} from '../../services/fallout/index.js';
import { computeMarketDeltaForDates } from '../../services/dashboard/marketRateService.js';

const router = Router();

// All routes require auth and tenant context
router.use(authenticateToken, attachTenantContext, apiLimiter);

/**
 * GET /api/fallout/risk-bands?status=Denied|Withdrawn|ClosingLate
 * Returns lender-specific risk band definitions for the given status.
 */
router.get('/risk-bands', async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const status = (req.query.status as string) || undefined;
    let query = `SELECT status_type, bucket_type, band_name, band_min, band_max, risk_score, derived_from_years, calculated_at
                 FROM public.risk_band_definitions WHERE 1=1`;
    const params: any[] = [];
    if (status && ['Denied', 'Withdrawn', 'ClosingLate'].includes(status)) {
      query += ` AND status_type = $1`;
      params.push(status);
    }
    query += ` ORDER BY status_type, bucket_type, risk_score DESC`;
    const result = await tenantPool.query(query, params);
    return res.json({ riskBands: result.rows });
  } catch (err: any) {
    logError('Fallout risk-bands failed', err, {});
    return res.status(500).json({ error: 'Failed to fetch risk bands' });
  }
});

/**
 * GET /api/fallout/top-patterns?status=Denied|Withdrawn|ClosingLate&year=2023|2024|2025
 * Returns top historical bucket patterns (combos) for the given status and optional year.
 */
router.get('/top-patterns', async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const status = (req.query.status as string) || undefined;
    const year = req.query.year != null ? parseInt(String(req.query.year), 10) : undefined;
    let query = `SELECT year, status_type, combo_key, dimensions_json, loan_count, rank, calculated_at
                 FROM public.historical_bucket_combos WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;
    if (status && ['Denied', 'Withdrawn', 'ClosingLate'].includes(status)) {
      query += ` AND status_type = $${idx}`;
      params.push(status);
      idx++;
    }
    if (year != null && !isNaN(year)) {
      query += ` AND year = $${idx}`;
      params.push(year);
      idx++;
    }
    query += ` ORDER BY year DESC, status_type, rank ASC LIMIT 100`;
    const result = await tenantPool.query(query, params);
    return res.json({ topPatterns: result.rows });
  } catch (err: any) {
    logError('Fallout top-patterns failed', err, {});
    return res.status(500).json({ error: 'Failed to fetch top patterns' });
  }
});

/**
 * GET /api/fallout/predictions?asOfDate=YYYY-MM-DD&window=MTD|NextMonth|Rolling30
 * Returns loan-level predictions (projected_status, reason_codes, projected_funding_date, etc.).
 */
router.get('/predictions', async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const asOfDate = (req.query.asOfDate as string) || undefined;
    const window = (req.query.window as string) || undefined;
    let query = `
      SELECT loan_id, as_of_date, projected_status, confidence_score, reason_codes,
             projected_funding_date, projected_close_window, created_at
      FROM public.loan_predictions
      WHERE as_of_date IS NOT NULL
    `;
    const params: any[] = [];
    let idx = 1;
    if (asOfDate) {
      query += ` AND as_of_date = $${idx}`;
      params.push(asOfDate);
      idx++;
    }
    if (window && ['MTD', 'NextMonth', 'Rolling30'].includes(window)) {
      query += ` AND projected_close_window = $${idx}`;
      params.push(window);
      idx++;
    }
    query += ` ORDER BY created_at DESC`;
    const result = await tenantPool.query(query, params);
    return res.json({ predictions: result.rows });
  } catch (err: any) {
    logError('Fallout predictions failed', err, {});
    return res.status(500).json({ error: 'Failed to fetch predictions' });
  }
});

/**
 * GET /api/fallout/executive-rollup?asOfDate=YYYY-MM-DD
 * Returns counts (number of loans) by projected_status and by projected_close_window.
 * topContributingBucketsByStatus: per status, bucket_type + bucket_value with loan count (how many loans had that bucket in reason_codes).
 */
router.get('/executive-rollup', async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const asOfDate = (req.query.asOfDate as string) || undefined;
    let where = 'WHERE as_of_date IS NOT NULL AND projected_status IS NOT NULL';
    const params: any[] = [];
    if (asOfDate) {
      where += ` AND as_of_date = $1`;
      params.push(asOfDate);
    }
    const byStatus = await tenantPool.query(
      `SELECT projected_status, COUNT(*) as count FROM public.loan_predictions ${where} GROUP BY projected_status`,
      params
    );
    const byWindow = await tenantPool.query(
      `SELECT projected_close_window, COUNT(*) as count FROM public.loan_predictions ${where} AND projected_close_window IS NOT NULL GROUP BY projected_close_window`,
      params
    );
    const rowsWithReasons = await tenantPool.query(
      `SELECT projected_status, reason_codes FROM public.loan_predictions ${where} AND reason_codes IS NOT NULL`,
      params
    );
    const bucketCountByStatus = new Map<string, Map<string, number>>();
    for (const row of rowsWithReasons.rows) {
      const status = row.projected_status as string;
      const codes = Array.isArray(row.reason_codes) ? row.reason_codes : (typeof row.reason_codes === 'string' ? [] : []);
      if (!bucketCountByStatus.has(status)) bucketCountByStatus.set(status, new Map());
      const perStatus = bucketCountByStatus.get(status)!;
      const seenThisLoan = new Set<string>();
      for (const c of codes) {
        const bt = (c && (c as any).bucket_type != null) ? (c as any).bucket_type : 'Unknown';
        const bv = (c && (c as any).bucket_value != null) ? (c as any).bucket_value : 'Unknown';
        const key = `${bt}|${bv}`;
        if (!seenThisLoan.has(key)) {
          seenThisLoan.add(key);
          perStatus.set(key, (perStatus.get(key) ?? 0) + 1);
        }
      }
    }
    const topContributingBucketsByStatus: Record<string, Array<{ bucket_type: string; bucket_value: string; loan_count: number }>> = {};
    for (const [status, map] of bucketCountByStatus) {
      topContributingBucketsByStatus[status] = [...map.entries()]
        .map(([key, loan_count]) => {
          const [bucket_type, bucket_value] = key.split('|');
          return { bucket_type, bucket_value, loan_count };
        })
        .sort((a, b) => b.loan_count - a.loan_count)
        .slice(0, 20);
    }
    const rollup = {
      byStatus: Object.fromEntries(byStatus.rows.map((r: any) => [r.projected_status, parseInt(r.count, 10)])),
      byWindow: Object.fromEntries(byWindow.rows.map((r: any) => [r.projected_close_window, parseInt(r.count, 10)])),
      topContributingBucketsByStatus,
      asOfDate: asOfDate || null,
    };
    return res.json(rollup);
  } catch (err: any) {
    logError('Fallout executive-rollup failed', err, {});
    return res.status(500).json({ error: 'Failed to fetch executive rollup' });
  }
});

/**
 * POST /api/fallout/recompute
 * Admin: triggers numeric outcome profile derivation + fallout sequencer (no legacy aggregation/turn-time/human jobs).
 */
router.post('/recompute', async (req: AuthRequest, res) => {
  const tenantId = getTenantContext(req).tenantId;
  logInfo('[Fallout] POST /api/fallout/recompute started', { tenantId });
  try {
    const tenantPool = getTenantContext(req).tenantPool;

    const agg = { totalsInserted: 0, combosInserted: 0, yearsProcessed: [] as number[], persistentPatternsInserted: 0 };
    const bands = { inserted: 0, categoricalInserted: 0, driftDetected: false };
    const turnTime = { inserted: 0 };
    const human = { inserted: 0 };

    const rates = await getHistoricalFalloutRates(tenantPool);

    // Numeric outcome profiles (reuse 2023/2024 when present; recalc current and prior year only)
    await runNumericOutcomeProfileDerivation(tenantPool).catch((e) => {
      logError('Numeric outcome profile derivation failed in Fallout Recompute', e, {});
    });

    // Load active loans for Job D (Sequential scoring)
    const activeResult = await tenantPool.query(`
      SELECT loan_id, loan_type, loan_purpose, occupancy_type, fico_score, ltv_ratio, be_dti_ratio,
             borr_self_employed, application_date, lock_date, lock_expiration_date, interest_rate,
             market_rate, market_rate_at_lock,
             estimated_closing_date, funding_date, closing_date, current_status_date, ctc_date, uw_final_approval_date, conditional_approval_date,
             loan_officer_id, loan_officer, loan_processor_id, processor, underwriter_id, underwriter, closer_id, closer
      FROM public.loans
      WHERE current_loan_status = 'Active Loan' AND application_date IS NOT NULL
      LIMIT 5000
    `);
    const activeLoans = activeResult.rows as any[];
    const today = new Date();
    await Promise.all(
      activeLoans.map(async (loan: any) => {
        const lockDate = loan.lock_date ?? loan.application_date;
        if (lockDate) {
          const delta = await computeMarketDeltaForDates(lockDate, today);
          loan.marketChangeDelta = delta ?? undefined;
        }
      })
    );
    const seq = await runFalloutSequencer(tenantPool, activeLoans, {
      historicalDeniedRate: rates.deniedRate,
      historicalWithdrawnRate: rates.withdrawnRate,
    });

    return res.json({
      success: true,
      historicalAggregation: agg,
      riskBands: { inserted: bands.inserted, categoricalInserted: bands.categoricalInserted ?? 0, driftDetected: bands.driftDetected ?? false },
      turnTimeBaselines: turnTime,
      humanPatternStats: human,
      sequencer: seq,
      historicalRates: rates,
    });
  } catch (err: any) {
    logError('Fallout recompute failed', err, {});
    return res.status(500).json({ error: 'Recompute failed', message: err?.message });
  }
});

export default router;

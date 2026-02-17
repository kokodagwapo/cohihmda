/**
 * Insight Details API — Simplified
 *
 * Returns pre-hydrated detail_data stored at generation time.
 * The LLM generates self-describing evidence tables (columns, rows, summary)
 * via the 4-pass pipeline, so no re-query is needed.
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import { handleDatabaseError } from '../../config/database.js';
import { apiLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

// ============================================================================
// Helper: load detail_data from the generated_insights table
// ============================================================================

async function loadInsightDetail(
  tenantPool: any,
  insightId: number
): Promise<{
  detailData: Record<string, any> | null;
  generatedAt: string | null;
  etm: Record<string, any> | null;
}> {
  try {
    let hasDetailDataCol = false;
    try {
      const colCheck = await tenantPool.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'generated_insights' AND column_name = 'detail_data'
      `);
      hasDetailDataCol = colCheck.rows.length > 0;
    } catch { /* ignore */ }

    const selectCols = hasDetailDataCol
      ? 'detail_data, generated_at, evidence'
      : 'generated_at, evidence';

    const result = await tenantPool.query(
      `SELECT ${selectCols} FROM generated_insights WHERE id = $1`,
      [insightId]
    );
    if (result.rows.length === 0) return { detailData: null, generatedAt: null, etm: null };

    const row = result.rows[0];
    const ev = row.evidence || {};

    return {
      detailData: row.detail_data || null,
      generatedAt: row.generated_at || null,
      etm: (ev.what_changed || ev.why || ev.business_impact) ? {
        what_changed: ev.what_changed,
        why: ev.why,
        business_impact: ev.business_impact,
        risk_if_ignored: ev.risk_if_ignored,
        recommended_action: ev.recommended_action,
        owner: ev.owner,
      } : null,
    };
  } catch {
    return { detailData: null, generatedAt: null, etm: null };
  }
}

// ============================================================================
// Helper: date range calculation
// ============================================================================

function calculateStartDate(dateFilter: string): Date {
  const now = new Date();
  switch (dateFilter) {
    case 'today': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'mtd':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'ytd':
    default:
      return new Date(now.getFullYear(), 0, 1);
  }
}

// ============================================================================
// Main route
// ============================================================================

/**
 * GET /api/dashboard/insights/details/:source
 * Query params:
 *   - dateFilter: ytd | mtd | today  (default: ytd)
 *   - insightId:  DB id of the generated_insight row (required)
 *   - tenant_id:  For multi-tenant context
 */
router.get('/details/:source', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const tenantPool = tenantContext.tenantPool;
    const { source } = req.params;
    const { dateFilter = 'ytd', insightId } = req.query;
    const startDate = calculateStartDate(String(dateFilter));

    if (!insightId) {
      return res.status(400).json({
        error: 'insightId is required',
        message: 'Please provide an insightId to fetch detail data.',
      });
    }

    const { detailData, generatedAt, etm } = await loadInsightDetail(tenantPool, Number(insightId));

    if (detailData && detailData.title) {
      const endDate = new Date();
      const filterLabel: Record<string, string> = {
        today: 'Today',
        mtd: 'Month to Date',
        ytd: 'Year to Date',
      };

      console.log(`[InsightDetails] source=${source}, insightId=${insightId} — returning pre-hydrated detail_data (${(detailData.rows as any[] || []).length} rows)`);

      return res.json({
        source,
        dateFilter,
        title: detailData.title,
        summary: detailData.summary || {},
        rows: detailData.rows || [],
        displayConfig: detailData.displayConfig || { columns: [], summaryMetrics: [] },
        etm: etm || detailData.etm || null,
        dateRange: {
          label: filterLabel[String(dateFilter)] || 'Year to Date',
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        ...(generatedAt ? { dataAsOf: generatedAt } : {}),
        comparison: detailData.comparison || null,
        audit: detailData.audit || null,
      });
    }

    // No detail_data available — return a structured message
    console.warn(`[InsightDetails] source=${source}, insightId=${insightId} — no detail_data found`);
    return res.status(404).json({
      error: 'No detail data available',
      message: 'This insight does not have pre-hydrated detail data. Please regenerate insights to populate evidence tables.',
      source,
      insightId: Number(insightId),
    });

  } catch (error: any) {
    console.error('Error fetching insight details:', error);

    if (handleDatabaseError(error, res, 'Failed to fetch insight details')) {
      return;
    }

    res.status(500).json({
      error: 'Failed to fetch insight details',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;

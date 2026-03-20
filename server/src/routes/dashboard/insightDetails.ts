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
import { callLLM, getOpenAIKey, safeExecuteSQL, formatResultsForLLM, type LLMMessage } from '../../services/research/tools.js';
import { loadDashboardInsightById } from '../../services/dashboardInsights/storage.js';
import { getDateRangeForTimeframe } from '../../services/dashboard/analyticsService.js';

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
// Helper: date range calculation (aligned with leaderboard/dashboard timeframes)
// ============================================================================

const DATE_FILTER_LABELS: Record<string, string> = {
  today: 'Today',
  wtd: 'Week to Date',
  mtd: 'Month to Date',
  qtd: 'Quarter to Date',
  ytd: 'Year to Date',
  lm: 'Last Month',
  lq: 'Last Quarter',
  ly: 'Last Year',
};

/** Timeframes supported by getDateRangeForTimeframe in analyticsService */
type SupportedDateFilter = 'today' | 'wtd' | 'mtd' | 'qtd' | 'ytd' | 'lm' | 'lq' | 'ly';

function getDateRangeForFilter(dateFilter: string): { startDate: Date; endDate: Date; label: string } {
  const normalized = String(dateFilter).toLowerCase() as SupportedDateFilter;
  const label = DATE_FILTER_LABELS[normalized] ?? 'Year to Date';

  if (normalized === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const end = new Date();
    return { startDate: d, endDate: end, label };
  }

  const supported: SupportedDateFilter[] = ['wtd', 'mtd', 'qtd', 'ytd', 'lm', 'lq', 'ly'];
  const timeframe = supported.includes(normalized) ? normalized : 'ytd';
  const { start, end } = getDateRangeForTimeframe(timeframe);

  return {
    startDate: start,
    endDate: end,
    label: supported.includes(normalized) ? DATE_FILTER_LABELS[normalized] : label,
  };
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
    const { startDate, endDate, label: dateRangeLabel } = getDateRangeForFilter(String(dateFilter));

    if (!insightId) {
      return res.status(400).json({
        error: 'insightId is required',
        message: 'Please provide an insightId to fetch detail data.',
      });
    }

    const insightIdNum = Number(insightId);

    // Dashboard insights: load from dashboard_generated_insights by id
    if (source === 'dashboard_insights') {
      const row = await loadDashboardInsightById(tenantPool, insightIdNum);
      if (!row) {
        return res.status(404).json({
          error: 'Insight not found',
          message: 'Dashboard insight not found.',
          source,
          insightId: insightIdNum,
        });
      }
      const detailData = row.detail_data as Record<string, any> | null | undefined;
      if (!detailData || !detailData.title) {
        console.warn(`[InsightDetails] source=dashboard_insights, insightId=${insightId} — no detail_data (regenerate insights)`);
        return res.status(404).json({
          error: 'No detail data available',
          message: 'This insight does not have pre-hydrated detail data. Please regenerate insights to populate evidence tables.',
          source: 'dashboard_insights',
          insightId: insightIdNum,
        });
      }
      const etm = detailData.etm ?? (row.what_changed || row.why || row.business_impact
        ? {
            what_changed: row.what_changed,
            why: row.why,
            business_impact: row.business_impact,
            risk_if_ignored: row.risk_if_ignored,
            recommended_action: row.recommended_action,
            owner: row.owner,
          }
        : null);
      console.log(`[InsightDetails] source=dashboard_insights, insightId=${insightId} — returning detail_data (${(detailData.rows || []).length} rows)`);
      return res.json({
        source: 'dashboard_insights',
        dateFilter,
        title: detailData.title || row.headline,
        summary: detailData.summary || {},
        rows: detailData.rows || [],
        displayConfig: detailData.displayConfig || { columns: [], summaryMetrics: [] },
        etm,
        dateRange: {
          label: dateRangeLabel,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        ...(row.generated_at ? { dataAsOf: row.generated_at } : {}),
        comparison: detailData.comparison || null,
        audit: detailData.audit || null,
      });
    }

    // Pipeline insights: load from generated_insights
    const { detailData, generatedAt, etm } = await loadInsightDetail(tenantPool, insightIdNum);

    if (detailData && detailData.title) {
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
          label: dateRangeLabel,
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
      insightId: insightIdNum,
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

// ============================================================================
// POST /insights/chat — Follow-up conversation about an insight
// ============================================================================

const INSIGHT_CHAT_SYSTEM = `You are Cohi, an AI analyst for a mortgage lending platform. The user is asking follow-up questions about a specific data insight.

You have full context about the insight including its headline, summary, key metrics, and the evidence that produced it. You can also run new SQL queries against the loans database to answer the user's questions.

RULES:
- Be concise and specific. Use numbers from the context.
- NEVER show SQL queries, table names, column names, or any database syntax to the user. Speak in business language only.
- If you need to query new data, output ONLY a \`\`\`sql block containing the query and nothing else. The system will execute it and feed results back to you. Then interpret the results in plain business language.
- Only SELECT queries against public.loans (alias: l).
- Use CURRENT_DATE for dates, never hardcoded dates.
- PostgreSQL syntax: DATE - DATE = integer days.
- Present findings with specific numbers, comparisons, and actionable observations.
- Use markdown formatting: **bold** for key numbers, bullet lists for breakdowns, numbered lists for ranked items.
- If the question is unrelated to the insight or data, politely redirect.`;

router.post('/chat', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const { tenantPool, tenantId } = tenantContext;
    const { insightContext, messages } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const apiKey = await getOpenAIKey(tenantId);

    // Build context from the insight
    let contextBlock = '';
    if (insightContext) {
      contextBlock += `\n## Insight\nTitle: ${insightContext.title || 'N/A'}\n`;
      contextBlock += `Summary: ${insightContext.summary || 'N/A'}\n`;
      contextBlock += `Confidence: ${insightContext.confidence || 'N/A'}\n`;

      if (insightContext.keyMetrics && Object.keys(insightContext.keyMetrics).length > 0) {
        contextBlock += `\nKey Metrics:\n`;
        for (const [k, v] of Object.entries(insightContext.keyMetrics)) {
          contextBlock += `- ${k}: ${v}\n`;
        }
      }

      if (insightContext.evidence && Array.isArray(insightContext.evidence)) {
        contextBlock += `\n## Evidence (internal — do NOT expose SQL to the user)\n`;
        for (const [i, ev] of insightContext.evidence.entries()) {
          const fields = ev.fields?.length ? ` (fields: ${ev.fields.join(', ')})` : '';
          contextBlock += `- Evidence ${i + 1}: ${ev.explanation || 'Analysis query'} — returned ${ev.rowCount || 0} rows${fields}\n`;
        }
      }
    }

    // Build LLM conversation
    const llmMessages: LLMMessage[] = [
      { role: 'system', content: INSIGHT_CHAT_SYSTEM + contextBlock },
    ];

    for (const msg of messages) {
      llmMessages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // First LLM call
    let response = await callLLM(llmMessages, apiKey, {
      temperature: 0.3,
      maxTokens: 3000,
    });

    // Check if the response contains SQL queries to execute
    const sqlMatch = response.match(/```sql\n([\s\S]*?)```/);
    if (sqlMatch) {
      const sql = sqlMatch[1].trim();
      try {
        const result = await safeExecuteSQL(sql, tenantPool);
        const formatted = formatResultsForLLM(result);

        // Ask LLM to interpret the results
        llmMessages.push({ role: 'assistant', content: response });
        llmMessages.push({
          role: 'user',
          content: `The query returned ${result.rowCount} rows:\n\n${formatted}\n\nPlease interpret these results in the context of the original question. Be specific with numbers.`,
        });

        response = await callLLM(llmMessages, apiKey, {
          temperature: 0.3,
          maxTokens: 3000,
        });
      } catch (sqlErr: any) {
        response += `\n\nI wasn't able to pull additional data for that question. Let me answer based on what we already know.`;
      }
    }

    // Strip any residual SQL blocks from the final user-facing response
    response = response.replace(/```sql[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();

    res.json({ response });
  } catch (error: any) {
    console.error('[InsightChat] Error:', error);
    if (handleDatabaseError(error, res, 'Failed to process insight chat')) return;
    res.status(500).json({
      error: 'Failed to process insight chat',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

export default router;

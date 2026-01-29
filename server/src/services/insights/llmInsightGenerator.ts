/**
 * LLM Insight Generator
 * Uses OpenAI to generate dynamic, prioritized insights from metrics payload
 */

import { tenantDbManager } from '../../config/tenantDatabaseManager.js';
import { decryptAPIKeys } from '../encryption.js';
import { InsightMetricsPayload } from './insightMetricsCollector.js';

// Insight type matching frontend expectations
export interface GeneratedInsight {
  type: 'success' | 'warning' | 'info' | 'critical';
  message: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reasoning: string;
  source: 'predictions' | 'performance' | 'pipeline' | 'credit_risk' | 'lost_opportunity' | 'comparisons';
  forPodcast: boolean;
}

// LLM response structure
export interface LLMInsightsResponse {
  insights: GeneratedInsight[];
  insightCount: number;
  summaryForPodcast: string;
}

// In-memory cache for LLM insights (could be replaced with Redis)
const insightCache = new Map<string, { data: LLMInsightsResponse; expiresAt: number }>();

/**
 * Get the OpenAI API key for a tenant
 */
async function getOpenAIKey(tenantId?: string): Promise<string> {
  // Try tenant-specific settings first
  if (tenantId) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);
      
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'rag_settings'
        ) as exists
      `);
      
      if (tableCheck.rows[0]?.exists) {
        const result = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
        );
        
        if (result.rows[0]?.openai_api_key) {
          const decrypted = await decryptAPIKeys({ openai_api_key: result.rows[0].openai_api_key });
          if (decrypted.openai_api_key) {
            return decrypted.openai_api_key;
          }
        }
      }
    } catch (error) {
      console.log('[LLMInsights] Error fetching tenant API key, falling back to env');
    }
  }
  
  // Fall back to environment variable
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    return envKey;
  }
  
  throw new Error('OpenAI API key not configured');
}

/**
 * Build the system prompt for insight generation
 */
function buildSystemPrompt(): string {
  return `You are Cohi, an AI assistant for mortgage executives. Your job is to analyze business metrics and generate 3-8 concise, actionable executive insights.

CRITICAL RULES:
1. Generate 8-12 insights covering different aspects of the business
2. Only include insights where there's something NOTABLE to report - don't state the obvious
3. Prioritize warnings and opportunities over "everything is fine" status updates
4. Include specific numbers and percentages in every insight
5. Each insight must be 1-2 sentences maximum
6. Focus on what matters to a mortgage executive: revenue, risk, pipeline health, and performance
7. If a metric looks problematic, flag it as warning or critical
8. If something is performing exceptionally well, highlight it as success
9. ALWAYS include at least one insight from predictions if there are at-risk loans

INSIGHT TYPES:
- "critical": Immediate action required (high risk, significant losses)
- "warning": Attention needed (trending down, approaching thresholds)
- "info": Important context (neutral observations)
- "success": Positive performance (exceeding targets, strong trends)

PRIORITY LEVELS:
- "critical": Must address today
- "high": Address this week
- "medium": Monitor closely
- "low": Good to know

SOURCES (use the most relevant):
- "predictions": Fallout predictions, at-risk loans
- "performance": Pull-through, cycle time, revenue
- "pipeline": Active loans, locked loans, pipeline volume
- "credit_risk": FICO, LTV, DTI concerns
- "lost_opportunity": Withdrawn/denied revenue impact
- "comparisons": Month-over-month, year-over-year trends

OUTPUT FORMAT (strict JSON with 8-12 insights):
{
  "insights": [
    {
      "type": "warning",
      "message": "8 loans totaling $2.4M flagged high-risk for withdrawal (>70% confidence) — recommend immediate LO outreach.",
      "priority": "high",
      "reasoning": "Early intervention on at-risk loans can save 30-40% of potential fallout.",
      "source": "predictions",
      "forPodcast": true
    },
    {
      "type": "success",
      "message": "Pull-through rate: 72.5% (Rolling 90D) — above industry average of 65%.",
      "priority": "high",
      "reasoning": "Strong conversion indicates efficient pipeline management.",
      "source": "performance",
      "forPodcast": true
    }
  ],
  "insightCount": 10,
  "summaryForPodcast": "Brief 2-3 sentence executive summary for audio briefing."
}`;
}

/**
 * Build the user prompt with metrics payload
 */
function buildUserPrompt(metrics: InsightMetricsPayload): string {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  return `Analyze these mortgage business metrics and generate 3-8 prioritized executive insights:

=== PERIOD ===
Date Filter: ${metrics.period.dateFilter.toUpperCase()}
Range: ${metrics.period.start || 'N/A'} to ${metrics.period.end || 'N/A'}

=== PIPELINE (Current State) ===
- Active Loans: ${metrics.pipeline.activeLoans} loans
- Active Volume: ${formatCurrency(metrics.pipeline.activeVolume)}
- Locked Loans: ${metrics.pipeline.lockedLoans}
- Closed Loans: ${metrics.pipeline.closedLoans}
- Closed Volume: ${formatCurrency(metrics.pipeline.closedVolume)}

=== FALLOUT PREDICTIONS ===
- Likely to Withdraw: ${metrics.predictions.likelyWithdraw} loans
- Likely to be Denied: ${metrics.predictions.likelyDeny} loans
- Likely to Originate: ${metrics.predictions.likelyOriginate} loans
- High-Risk Loans (>70% confidence): ${metrics.predictions.highRiskLoans.length} loans
- At-Risk Volume: ${formatCurrency(metrics.predictions.totalAtRiskVolume)}
${metrics.predictions.highRiskLoans.length > 0 ? `- Top Risk Factors: ${[...new Set(metrics.predictions.highRiskLoans.flatMap(l => l.riskFactors))].slice(0, 5).join(', ')}` : ''}

=== PERFORMANCE ===
- Pull-Through Rate (Rolling 90D): ${formatPercent(metrics.performance.pullThroughRolling90D)} (Industry avg: 60-70%, top performers: 72%+)
- Average Cycle Time: ${Math.round(metrics.performance.avgCycleTime)} days (Excellent: ≤28, Good: 29-35, Needs work: >35)
- Revenue YTD: ${formatCurrency(metrics.performance.revenueYTD)}
- Revenue MTD: ${formatCurrency(metrics.performance.revenueMTD)}
- Volume YTD: ${formatCurrency(metrics.performance.volumeYTD)}
- Volume MTD: ${formatCurrency(metrics.performance.volumeMTD)}

=== CREDIT RISK PROFILE ===
- Weighted Avg FICO: ${Math.round(metrics.creditRisk.waFico)} (Risk: <680, High Risk: <620)
- Weighted Avg LTV: ${formatPercent(metrics.creditRisk.waLtv)} (Risk: >80%, High Risk: >95%)
- Weighted Avg DTI: ${formatPercent(metrics.creditRisk.waDti)} (Risk: >43%, High Risk: >50%)
- High-Risk Loans (FICO<620 OR LTV>95 OR DTI>50): ${metrics.creditRisk.highRiskLoanCount} loans

=== LOST OPPORTUNITY ===
- Withdrawn Loans: ${metrics.lostOpportunity.withdrawnUnits} loans
- Withdrawn Volume: ${formatCurrency(metrics.lostOpportunity.withdrawnVolume)}
- Lost Proforma Revenue: ${formatCurrency(metrics.lostOpportunity.withdrawnProformaRevenue)}
- Denied Loans: ${metrics.lostOpportunity.deniedUnits} loans
- Denied Volume: ${formatCurrency(metrics.lostOpportunity.deniedVolume)}

=== FUNNEL (${metrics.period.dateFilter.toUpperCase()}) ===
- Loans Started: ${metrics.funnel.loansStarted}
- Loans Locked: ${metrics.funnel.loansLocked}
- Loans Originated: ${metrics.funnel.loansOriginated}
- Fallout Rate: ${formatPercent(metrics.funnel.falloutRate)}

=== TRENDS ===
- Volume vs Last Month: ${metrics.comparisons.volumeVsLastMonth > 0 ? '+' : ''}${formatPercent(metrics.comparisons.volumeVsLastMonth)}
- Volume vs Last Year: ${metrics.comparisons.volumeVsLastYear > 0 ? '+' : ''}${formatPercent(metrics.comparisons.volumeVsLastYear)}
- Cycle Time vs Last Month: ${metrics.comparisons.cycleTimeVsLastMonth > 0 ? '+' : ''}${formatPercent(metrics.comparisons.cycleTimeVsLastMonth)} (negative is better)

Generate 8-12 insights now. Cover predictions, performance, pipeline, credit risk, lost opportunity, and trends. Focus on what an executive needs to know TODAY.`;
}

/**
 * Call OpenAI API
 */
async function callOpenAI(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    }),
  });

  if (!response.ok) {
    const error = await response.json() as { error?: { message?: string } };
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Parse and validate LLM response
 */
function parseAndValidateLLMResponse(responseText: string): LLMInsightsResponse {
  try {
    const parsed = JSON.parse(responseText);
    
    // Validate structure
    if (!parsed.insights || !Array.isArray(parsed.insights)) {
      throw new Error('Invalid response structure: missing insights array');
    }

    // Validate each insight
    const validatedInsights: GeneratedInsight[] = parsed.insights.map((insight: any, index: number) => {
      // Validate type
      const validTypes = ['success', 'warning', 'info', 'critical'];
      const type = validTypes.includes(insight.type) ? insight.type : 'info';
      
      // Validate priority
      const validPriorities = ['critical', 'high', 'medium', 'low'];
      const priority = validPriorities.includes(insight.priority) ? insight.priority : 'medium';
      
      // Validate source
      const validSources = ['predictions', 'performance', 'pipeline', 'credit_risk', 'lost_opportunity', 'comparisons'];
      const source = validSources.includes(insight.source) ? insight.source : 'performance';

      return {
        type,
        message: String(insight.message || `Insight ${index + 1}`),
        priority,
        reasoning: String(insight.reasoning || ''),
        source,
        forPodcast: Boolean(insight.forPodcast)
      };
    });

    return {
      insights: validatedInsights,
      insightCount: validatedInsights.length,
      summaryForPodcast: String(parsed.summaryForPodcast || '')
    };
  } catch (error) {
    console.error('[LLMInsights] Failed to parse LLM response:', error);
    throw new Error('Failed to parse LLM response');
  }
}

/**
 * Get cache key for insights
 */
function getCacheKey(dateFilter: string, tenantId?: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `insights:${tenantId || 'default'}:${dateFilter}:${today}`;
}

/**
 * Check cache for existing insights
 */
export function getFromCache(cacheKey: string): LLMInsightsResponse | null {
  const cached = insightCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[LLMInsights] Cache hit for ${cacheKey}`);
    return cached.data;
  }
  if (cached) {
    insightCache.delete(cacheKey); // Clean up expired
  }
  return null;
}

/**
 * Store insights in cache
 */
export function setCache(cacheKey: string, data: LLMInsightsResponse, ttlSeconds: number = 3600): void {
  insightCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + (ttlSeconds * 1000)
  });
  console.log(`[LLMInsights] Cached insights for ${cacheKey} (TTL: ${ttlSeconds}s)`);
}

/**
 * Clear insights cache (for manual refresh)
 */
export function clearCache(tenantId?: string): void {
  if (tenantId) {
    // Clear only for specific tenant
    for (const key of insightCache.keys()) {
      if (key.includes(`:${tenantId}:`)) {
        insightCache.delete(key);
      }
    }
  } else {
    // Clear all
    insightCache.clear();
  }
  console.log(`[LLMInsights] Cache cleared${tenantId ? ` for tenant ${tenantId}` : ''}`);
}

/**
 * Main function to generate LLM insights from metrics payload
 */
export async function generateLLMInsights(
  metricsPayload: InsightMetricsPayload,
  tenantId?: string,
  options: {
    useCache?: boolean;
    cacheTtlSeconds?: number;
  } = {}
): Promise<LLMInsightsResponse> {
  const { useCache = true, cacheTtlSeconds = 3600 } = options;
  const dateFilter = metricsPayload.period.dateFilter;
  
  // Check cache
  if (useCache) {
    const cacheKey = getCacheKey(dateFilter, tenantId);
    const cached = getFromCache(cacheKey);
    if (cached) {
      return cached;
    }
  }

  console.log(`[LLMInsights] Generating insights for tenant: ${tenantId || 'default'}, dateFilter: ${dateFilter}`);

  try {
    // Get API key
    const apiKey = await getOpenAIKey(tenantId);
    
    // Build prompts
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(metricsPayload);
    
    console.log(`[LLMInsights] Calling OpenAI API...`);
    const startTime = Date.now();
    
    // Call LLM
    const responseText = await callOpenAI(systemPrompt, userPrompt, apiKey);
    
    const elapsed = Date.now() - startTime;
    console.log(`[LLMInsights] OpenAI responded in ${elapsed}ms`);
    
    // Parse and validate
    const result = parseAndValidateLLMResponse(responseText);
    
    console.log(`[LLMInsights] Generated ${result.insights.length} insights`);
    
    // Cache result
    if (useCache) {
      const cacheKey = getCacheKey(dateFilter, tenantId);
      setCache(cacheKey, result, cacheTtlSeconds);
    }
    
    return result;
    
  } catch (error) {
    console.error('[LLMInsights] Error generating insights:', error);
    throw error;
  }
}

export default {
  generateLLMInsights,
  getFromCache,
  setCache,
  clearCache
};

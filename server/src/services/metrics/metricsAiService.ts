/**
 * Metrics AI Service
 * Provides LLM-powered explanations and insights for metrics
 */

import { tenantDbManager } from '../../config/tenantDatabaseManager.js';
import { decryptAPIKeys } from '../encryption.js';
import { METRICS_CATALOG, MetricDefinition } from './metricsService.js';

export interface MetricExplanation {
  summary: string;
  howItWorks: string;
  timeframeLogic: string;
  interpretation: string;
  relatedMetrics: string[];
}

export interface MetricResultExplanation {
  valueInterpretation: string;
  businessContext: string;
  recommendations: string[];
  benchmarkComparison?: string;
}

export interface MetricChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Get the OpenAI API key for a tenant (from tenant-specific database)
 */
async function getOpenAIKey(tenantId?: string): Promise<string> {
  console.log(`[MetricsAI] Getting OpenAI key for tenant: ${tenantId || 'none'}`);
  
  // First try tenant-specific settings from tenant database
  if (tenantId) {
    try {
      // Get tenant database pool
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);
      
      // Check if rag_settings table exists and has data
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'rag_settings'
        ) as exists
      `);
      
      if (!tableCheck.rows[0]?.exists) {
        console.log(`[MetricsAI] rag_settings table does not exist in tenant database. Please save RAG settings first.`);
      } else {
        // Query rag_settings from tenant database (no tenant_id column)
        const result = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
        );
        
        console.log(`[MetricsAI] RAG settings query for tenant ${tenantId} returned ${result.rows.length} rows`);
        
        if (result.rows[0]?.openai_api_key) {
          console.log(`[MetricsAI] Found API key in tenant database, attempting to decrypt...`);
          const decrypted = await decryptAPIKeys({ openai_api_key: result.rows[0].openai_api_key });
          if (decrypted.openai_api_key) {
            console.log(`[MetricsAI] Successfully decrypted API key from tenant database`);
            return decrypted.openai_api_key;
          } else {
            console.log(`[MetricsAI] Decryption returned empty key`);
          }
        } else {
          console.log(`[MetricsAI] No openai_api_key found in tenant database for ${tenantId}`);
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('[MetricsAI] Error fetching tenant API key:', errorMessage);
    }
  }
  
  // Fall back to environment variable
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    console.log(`[MetricsAI] Using OPENAI_API_KEY from environment variable`);
    return envKey;
  }
  
  throw new Error('OpenAI API key not configured. Please set it in RAG settings or environment variables.');
}

/**
 * Call OpenAI Chat Completion API
 */
async function callOpenAI(
  messages: MetricChatMessage[],
  apiKey: string,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.json() as { error?: { message?: string } };
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Generate a natural language explanation of a metric
 */
export async function explainMetric(
  metricId: string,
  tenantId?: string
): Promise<MetricExplanation> {
  const metric = METRICS_CATALOG[metricId];
  if (!metric) {
    throw new Error(`Metric not found: ${metricId}`);
  }

  const apiKey = await getOpenAIKey(tenantId);

  const systemPrompt = `You are a mortgage industry expert and data analyst. You explain business metrics in clear, accessible language for mortgage professionals. Focus on the database fields used and how timeframe filtering works.

Format your response as JSON with these exact fields:
{
  "summary": "A 1-2 sentence plain English explanation of what this metric measures",
  "howItWorks": "Explain which database fields are used and how the calculation works. Be specific about field names.",
  "timeframeLogic": "Explain which date field is used for filtering (e.g., application_date, lock_date, funding_date) and how selecting different timeframes affects the results",
  "interpretation": "How to interpret high vs low values, what's considered good performance",
  "relatedMetrics": ["array", "of", "related", "metric", "names"]
}`;

  const userPrompt = `Explain this mortgage industry metric and its database implementation:

**Name:** ${metric.name}
**ID:** ${metricId}
**Category:** ${metric.category}
**Description:** ${metric.description}
**Default Date Field for Filtering:** ${metric.defaultDateField || 'application_date'}
**SQL Implementation:** ${metric.sqlQuery?.replace(/\s+/g, ' ') || 'N/A'}

Focus on:
1. What database fields are used in the calculation
2. How the default date field (${metric.defaultDateField || 'application_date'}) affects timeframe filtering
3. What happens when users select MTD, YTD, or custom date ranges

Provide a clear explanation in JSON format.`;

  const response = await callOpenAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], apiKey, { temperature: 0.5 });

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    // Return a fallback if JSON parsing fails
    return {
      summary: metric.description,
      howItWorks: `This metric uses the following SQL: ${metric.sqlQuery?.replace(/\s+/g, ' ').slice(0, 200) || 'custom logic'}`,
      timeframeLogic: `Filtered by ${metric.defaultDateField || 'application_date'}. Selecting different timeframes (MTD, YTD, etc.) will filter records where this date falls within the selected range.`,
      interpretation: 'Higher values generally indicate better performance. Compare against historical trends and industry benchmarks.',
      relatedMetrics: []
    };
  }
}

/**
 * Generate an explanation of a specific metric result
 */
export async function explainMetricResult(
  metricId: string,
  value: number | string,
  metadata?: Record<string, any>,
  tenantId?: string
): Promise<MetricResultExplanation> {
  const metric = METRICS_CATALOG[metricId];
  if (!metric) {
    throw new Error(`Metric not found: ${metricId}`);
  }

  const apiKey = await getOpenAIKey(tenantId);

  const systemPrompt = `You are a mortgage industry expert and data analyst. Analyze metric results and provide actionable business insights. Be specific and practical.

Format your response as JSON with these exact fields:
{
  "valueInterpretation": "What this specific value means in practical terms",
  "businessContext": "How this value relates to typical mortgage industry performance",
  "recommendations": ["array", "of", "specific", "actionable", "recommendations"],
  "benchmarkComparison": "How this compares to industry benchmarks (if applicable)"
}`;

  const valueStr = typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value;
  const metadataStr = metadata ? JSON.stringify(metadata, null, 2) : 'N/A';

  const userPrompt = `Analyze this metric result:

**Metric:** ${metric.name}
**Category:** ${metric.category}
**Description:** ${metric.description}
**Current Value:** ${valueStr}
**Additional Context:** ${metadataStr}

What does this value mean for the business? Provide insights in JSON format.`;

  const response = await callOpenAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], apiKey, { temperature: 0.6 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    return {
      valueInterpretation: `The current value is ${valueStr}`,
      businessContext: 'Compare this to your historical trends and targets.',
      recommendations: ['Review historical trends', 'Compare to industry benchmarks', 'Identify contributing factors'],
      benchmarkComparison: 'Benchmark data not available'
    };
  }
}

/**
 * Interactive chat about metrics
 */
export async function chatAboutMetrics(
  messages: MetricChatMessage[],
  tenantId?: string
): Promise<string> {
  const apiKey = await getOpenAIKey(tenantId);

  // Build context about available metrics
  const metricsContext = Object.values(METRICS_CATALOG)
    .map(m => `- **${m.name}** (${m.id}): ${m.description}`)
    .join('\n');

  const systemPrompt = `You are an expert mortgage industry data analyst and business intelligence consultant. You help users understand metrics, KPIs, and data analysis for mortgage operations.

## Available Metrics Catalog
${metricsContext}

## Your Capabilities
- Explain what any metric measures and why it matters
- Help interpret metric values and trends
- Suggest which metrics to use for specific business questions
- Compare and correlate different metrics
- Provide industry context and benchmarks
- Recommend actions based on metric performance

Be conversational, helpful, and focus on practical business value. Use specific examples when helpful. If asked about a metric not in the catalog, explain that and suggest alternatives.`;

  const fullMessages: MetricChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  return callOpenAI(fullMessages, apiKey, { 
    temperature: 0.7, 
    maxTokens: 1500 
  });
}

/**
 * Get pre-computed natural language descriptions for all metrics
 * These are static descriptions that don't require an API call
 */
export function getStaticMetricDescriptions(): Record<string, { fieldsUsed: string; timeframeInfo: string }> {
  return {
    'active_loans': {
      fieldsUsed: 'Uses current_loan_status (must equal "Active Loan") and application_date (must not be null).',
      timeframeInfo: 'Not filtered by timeframe - shows current state of all active loans regardless of date selection.'
    },
    'closed_loans': {
      fieldsUsed: 'Uses funding_date to identify funded loans. Counts records where funding_date is not null.',
      timeframeInfo: 'Filtered by funding_date. Selecting YTD shows loans funded since Jan 1; MTD shows loans funded this month.'
    },
    'locked_loans': {
      fieldsUsed: 'Uses lock_date to identify rate-locked loans. Counts records where lock_date is not null.',
      timeframeInfo: 'Filtered by lock_date. Timeframe selection filters to loans locked within that date range.'
    },
    'avg_cycle_time': {
      fieldsUsed: 'Calculates days between application_date and closing_date (or funding_date as fallback).',
      timeframeInfo: 'Filtered by closing_date (or funding_date). Only includes loans that closed/funded within the selected timeframe.'
    },
    'pull_through_rate': {
      fieldsUsed: 'Uses current_loan_status (excludes "Active Loan"), application_date, funding_date, and investor_purchase_date.',
      timeframeInfo: 'Filtered by application_date. Calculates % of non-active loans with application in timeframe that eventually funded.'
    },
    'credit_pulls': {
      fieldsUsed: 'Uses credit_report_date to count credit inquiries.',
      timeframeInfo: 'Filtered by credit_report_date. Shows credit pulls that occurred within the selected timeframe.'
    },
    'avg_loan_amount': {
      fieldsUsed: 'Uses loan_amount field. Calculates average across matching loans.',
      timeframeInfo: 'Filtered by application_date. Averages loan amounts for loans applied within the timeframe.'
    },
    'total_revenue': {
      fieldsUsed: 'Sums revenue-related fields (varies by implementation).',
      timeframeInfo: 'Filtered by funding_date. Shows total revenue from loans funded in the selected timeframe.'
    },
    'avg_revenue_per_loan': {
      fieldsUsed: 'Divides total_revenue by count of funded loans.',
      timeframeInfo: 'Filtered by funding_date. Average revenue per loan funded in the selected timeframe.'
    }
  };
}

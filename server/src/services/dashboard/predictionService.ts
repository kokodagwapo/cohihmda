/**
 * Loan Prediction Service
 * Uses retrieval-augmented inference (RAG) to predict loan outcomes (withdraw, deny, or originate).
 * Historical loans are embedded by canonical signal representation; active loans are compared
 * via similarity search to retrieve top-K similar historical loans, then GPT-5 mini infers
 * outcomes from aggregated similar-historical summaries + signal strengths. No traditional
 * training or fine-tuning.
 *
 * Data Processing Pipeline:
 * 1. Market Delta Calculation (MARKET_DELTA_CALCULATION.md)
 * 2. Pullthrough Calculation (PULLTHROUGH_CALCULATION.md) 
 * 3. Signal Strength Bucketing (BUCKET_REFERENCE.md)
 * 4. Composite Signal Calculation
 * 5. Final output with Calculated Signal Strengths and Reason Codes
 * 
 * Implementation Status:
 * ✅ Individual feature bucketing (FICO, LTV, DTI, Loan Amount, Loan Type, Loan Purpose, Channel, Occupancy)
 * ✅ Pullthrough calculation for LO, UW, Closer, Processor
 * ✅ Composite signals (Credit Metrics, Loan Characteristics)
 * ✅ Individual pullthrough signals (LO, UW, Closer, Processor) - separate buckets
 * ✅ Time in Motion, MLO AE Fallout Prone, Interest Lock vs Market signals
 * ✅ Reason code generation
 * ✅ Data preparation with field extraction and validation (CLTV, Lender Credit, Commission fields, Person names)
 * ✅ CLTV and Lender Credit Amount bucketing (if data available)
 * ✅ Commission fields calculation (from assumption or raw values)
 * ⚠️  Market delta calculation (structure complete, needs MARKET_RATES data)
 * ⚠️  Milestone data for Time in Motion (extracted but needs milestone logic implementation) - Fields: Fields.Log.MS.CurrentMilestone, Active days (Application Date -> Current Status Date/Closing date OR Today's date for active loans)
 */

import pg from 'pg';
import { logInfo, logError } from '../logger.js';
import { getMarketRateForDate, getMarketRatesForRange, getMostRecentMarketRate, initializeMarketRateCache, autoSyncMarketRatesIfNeeded } from './marketRateService.js';
import { pool } from '../../config/database.js';
import {
  toCanonicalLoanText,
  DEFAULT_LOAN_RAG_SIGNAL_FIELDS,
  DEFAULT_LOAN_RAG_SIGNAL_LABELS,
  LOAN_RAG_TOP_K,
  ensureHistoricalEmbeddings,
  getEmbeddedLoanIds,
  searchSimilarHistorical,
  aggregateRetrieved,
  type CanonicalConfig,
  type AggregatedSimilar,
} from './loanRag/index.js';
import { generateEmbeddings } from '../embeddingService.js';
import { LOAN_RAG_EMBEDDING_MODEL, LOAN_RAG_EMBED_BATCH_SIZE } from './loanRag/config.js';

export interface LoanPrediction {
  loanId: string;
  predictedOutcome: 'withdraw' | 'deny' | 'originate';
  confidence: number; // 0-100
  reasoning: string;
  riskFactors: string[];
}

export interface PredictionRequest {
  loans: any[]; // Active loans to analyze
  allLoans?: any[]; // All loans (including historical) for pullthrough calculation
  customPrompt?: string; // Optional custom prompt override
  /** Tenant ID = organization/company. From profiles.tenant_id or Default Tenant for super_admin. Required for persisting pattern learnings to DB so they show in per-tenant debug. */
  tenantId?: string | null;
  /** Tenant database pool. For isolated tenant databases, pass the tenant-specific pool instead of using the global pool. */
  tenantPool?: pg.Pool;
}

export interface PredictionResponse {
  predictions: LoanPrediction[];
  bucketedLoans?: any[]; // Full loan data with signal strength buckets and rule-based summaries
  summary: {
    totalAnalyzed: number;
    predictedWithdraw: number;
    predictedDeny: number;
    predictedOriginate: number;
  };
  metadata: {
    model: string;
    timestamp: string;
    processingTimeMs: number;
    totalBucketedLoans?: number;
    predictionsInProgress?: boolean;
  };
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PREDICTION_MODEL = process.env.PREDICTION_MODEL || 'gpt-5-mini';

// Pricing (USD per 1M tokens) for cost logging — matches by model name prefix for snapshots (e.g. gpt-5-mini-2025-08-07)
function getModelPricing(model: string): { input: number; output: number } {
  if (model.includes('gpt-5-mini')) return { input: 0.25, output: 2.00 };
  if (model.includes('o4-mini')) return { input: 1.10, output: 4.40 };
  return { input: 0.25, output: 2.00 }; // default to gpt-5-mini pricing
}

/** Returns estimated USD cost for token usage (for batch cost logging). */
function getEstimatedCostUsd(
  usage: { prompt_tokens?: number; completion_tokens?: number },
  model: string = PREDICTION_MODEL
): number {
  const in_ = usage.prompt_tokens ?? 0;
  const out = usage.completion_tokens ?? 0;
  const pricing = getModelPricing(model);
  return (in_ / 1e6) * pricing.input + (out / 1e6) * pricing.output;
}

function logTokenUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }, context: string): void {
  const in_ = usage.prompt_tokens ?? 0;
  const out = usage.completion_tokens ?? 0;
  const total = usage.total_tokens ?? in_ + out;
  const costUsd = getEstimatedCostUsd(usage);
  console.log(`[Tokens] ${context} — prompt: ${in_.toLocaleString()}, completion: ${out.toLocaleString()}, total: ${total.toLocaleString()} — est. cost: $${costUsd.toFixed(4)}`);
}

// Learning configuration
// Keep batches small enough to fit under LEARNING_MAX_INPUT_TOKENS
const HISTORICAL_LEARNING_BATCH_SIZE = 150;
const ACTIVE_LOAN_BATCH_SIZE = 100; // Process active loans in batches of 100
// Note: Learnings do not expire - they persist until manually refreshed

/** Per-tenant "predict in progress" flag so frontend can poll until background embeddings + RAG are fully done. */
const predictInProgressByTenant = new Map<string, boolean>();

export function getPredictInProgress(tenantId: string | null): boolean {
  return tenantId ? !!predictInProgressByTenant.get(tenantId) : false;
}

// gpt-5-mini has 400K context; use 180K so estimated tokens stay safely under real limit
const LEARNING_MAX_INPUT_TOKENS = 180000;
// ~4 chars per token for English/JSON rough estimate
const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Keys that define "bucket values" for deduplication. Same values => same risk profile. */
const BUCKET_DEDUPE_KEYS = [
  'ficoScoreSignal', 'ltvSignal', 'dtiSignal', 'cltvSignal', 'lenderCreditAmountSignal',
  'loanAmountSignal', 'loanTypeSignal', 'loanPurposeSignal', 'occupancyTypeSignal', 'channelSignal',
  'timeToApprovalSignal', 'timeInMotionSignal',
  'loPullthroughSignal', 'uwPullthroughSignal', 'closerPullthroughSignal', 'processorPullthroughSignal',
  'marketChangeDeltaSignal',
  'creditMetricsSignalStrength', 'loanCharacteristicsSignalStrength', 'timeInMotionSignalStrength',
  'mloAeFalloutProneSignalStrength', 'interestLockVsMarketSignalStrength',
  'uwPullthroughSignalStrength', 'closerPullthroughSignalStrength', 'processorPullthroughSignalStrength',
  'actualOutcome'
] as const;

function getBucketSignature(loan: any): string {
  const obj: Record<string, unknown> = {};
  for (const k of BUCKET_DEDUPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(loan, k)) {
      obj[k] = loan[k];
    }
  }
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

/**
 * Get or create AI pattern learnings from historical loans.
 * When forceRefresh is true, skips existing lookup and always runs learning + save.
 */
async function getOrCreatePatternLearnings(
  tenantId: string | null,
  historicalLoansData: any[],
  dbPool: pg.Pool,
  options?: { forceRefresh?: boolean }
): Promise<string> {
  if (historicalLoansData.length === 0) {
    return '';
  }

  if (tenantId == null) {
    logInfo('Pattern learning running without tenantId; learnings will not be persisted to database', {
      historicalLoanCount: historicalLoansData.length
    });
  }

  try {
    if (!options?.forceRefresh) {
      // Check for existing active learnings (no tenant_id column in isolated tenant DBs)
      const existingResult = await dbPool.query(
        `SELECT pattern_summary, expires_at, historical_loan_count, updated_at
         FROM public.ai_pattern_learnings
         WHERE learning_type = 'historical_patterns'
           AND is_active = true
         ORDER BY updated_at DESC
         LIMIT 1`
      );

      if (existingResult.rows.length > 0) {
        const learning = existingResult.rows[0];
        logInfo('Using existing AI pattern learnings', {
          historicalLoanCount: learning.historical_loan_count,
          updatedAt: learning.updated_at,
          expiresAt: learning.expires_at
        });
        return learning.pattern_summary;
      }
    }

    // No valid learnings found (or forceRefresh): process historical loans in sections
    logInfo('No existing learnings found, processing historical loans to generate patterns', {
      totalHistoricalLoans: historicalLoansData.length,
      batchSize: HISTORICAL_LEARNING_BATCH_SIZE
    });

    // Process historical loans in batches and generate pattern summaries
    const batches: any[][] = [];
    for (let i = 0; i < historicalLoansData.length; i += HISTORICAL_LEARNING_BATCH_SIZE) {
      batches.push(historicalLoansData.slice(i, i + HISTORICAL_LEARNING_BATCH_SIZE));
    }

    let allPatternSummaries: string[] = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      // Dedupe by exact same bucket values (and actualOutcome); keep first of each profile
      const seen = new Map<string, any>();
      for (const loan of batch) {
        const sig = getBucketSignature(loan);
        if (!seen.has(sig)) seen.set(sig, loan);
      }
      let loansToSend = Array.from(seen.values());
      const dupesRemoved = batch.length - loansToSend.length;
      if (dupesRemoved > 0) {
        logInfo('Learning batch deduped by bucket values', {
          batchIndex: batchIndex + 1,
          totalBatches: batches.length,
          before: batch.length,
          after: loansToSend.length,
          removed: dupesRemoved
        });
      }

      // Cap by token limit so we don't exceed context; use full set only if under cap
      // NOTE: This learning prompt is built in-code only. The admin-editable prompt (Knowledge Base, category Fallout) is used for predictions (step 6), not for this pattern-extraction learning step.
      const instructionSuffix = `

For each loan, you can see:
- Signal strengths (1-6 scale) for various metrics
- Actual outcome: "withdraw", "deny", or "originate"

Identify and summarize the key patterns you observe:
1. Which signal strength combinations lead to withdrawals?
2. Which signal strength combinations lead to denials?
3. Which signal strength combinations lead to successful origination?
4. What are the most important risk factors?

Return a concise pattern summary (max 500 words) that can be reused for future predictions. Focus on actionable patterns, not individual loan details.`;
      const prefixBase = `You are an expert loan analyst. Analyze the following historical loans with their actual outcomes to identify patterns between signal strengths and final outcomes.

Historical Loans (batch ${batchIndex + 1} of ${batches.length}, `;
      const prefixTail = ` loans):\n\n`;
      let estTokens = Math.ceil((prefixBase.length + prefixTail.length + String(loansToSend.length).length + instructionSuffix.length) / CHARS_PER_TOKEN_ESTIMATE);
      let lastOk = loansToSend.length;
      for (let n = loansToSend.length; n >= 1; n--) {
        const chunk = loansToSend.slice(0, n);
        const json = JSON.stringify(chunk, null, 2);
        const instructionPrefix = prefixBase + String(n) + prefixTail;
        const total = Math.ceil((instructionPrefix.length + json.length + instructionSuffix.length) / CHARS_PER_TOKEN_ESTIMATE);
        if (total <= LEARNING_MAX_INPUT_TOKENS) {
          lastOk = n;
          estTokens = total;
          break;
        }
      }
      loansToSend = loansToSend.slice(0, lastOk);
      const omittedByCap = (batch.length - dupesRemoved) - loansToSend.length;
      if (omittedByCap > 0) {
        logInfo('Learning batch trimmed to fit token limit', {
          batchIndex: batchIndex + 1,
          totalBatches: batches.length,
          sent: loansToSend.length,
          omitted: omittedByCap,
          estInputTokens: estTokens,
          maxTokens: LEARNING_MAX_INPUT_TOKENS
        });
        console.log(
          `[Learning] ⚠️  TOKEN LIMIT HIT — batch ${batchIndex + 1}/${batches.length}: sent ${loansToSend.length} loans, omitted ${omittedByCap} (est. ${estTokens.toLocaleString()} tokens > ${LEARNING_MAX_INPUT_TOKENS.toLocaleString()} max). Consider lowering HISTORICAL_LEARNING_BATCH_SIZE if this appears often.`
        );
      }

      const loansJson = JSON.stringify(loansToSend, null, 2);
      const noteParts: string[] = [];
      if (dupesRemoved > 0) noteParts.push(`${dupesRemoved} loans with identical bucket values omitted`);
      if (omittedByCap > 0) noteParts.push(`${omittedByCap} loans omitted for context limit`);
      const extraNote = noteParts.length ? `\n(${noteParts.join('; ')}.)` : '';
      const instructionPrefix = prefixBase + String(loansToSend.length) + prefixTail;
      const learningPrompt = instructionPrefix + loansJson + extraNote + instructionSuffix;

      try {
        const patternSummary = await callAIModelForLearning(learningPrompt, OPENAI_API_KEY, `batch ${batchIndex + 1}/${batches.length}`);
        const hasOutput = Boolean(patternSummary && patternSummary.trim().length > 0);
        logInfo('Learning batch completed', {
          batch: `${batchIndex + 1}/${batches.length}`,
          hasOutput,
          outputLength: patternSummary?.length ?? 0
        });
        if (patternSummary) {
          allPatternSummaries.push(`Batch ${batchIndex + 1} Patterns:\n${patternSummary}`);
        }

        // Add delay between batches
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }
      } catch (error: any) {
        logError(`Failed to generate patterns for historical batch ${batchIndex + 1}`, error);
        // Continue with other batches
      }
    }

    // Combine all pattern summaries
    const combinedSummary = allPatternSummaries.join('\n\n---\n\n');

    // Can happen if every learning batch failed (e.g. OpenAI API error, rate limit, or model returned empty)
    if (!combinedSummary) {
      logInfo('Skipping save: no pattern summaries generated from historical loans', {
        tenantId,
        batchCount: batches.length,
        historicalLoanCount: historicalLoansData.length,
        whereToLook: 'Logs are in this terminal (server stdout). Scan for "Learning batch completed" and check hasOutput: true/false; if all false, look for "Error calling AI model for learning" above. Verify OPENAI_API_KEY and PREDICTION_MODEL.'
      });
      return combinedSummary;
    }

    // Save learnings to database (only if we have a tenant so they show in per-tenant debug)
    if (tenantId == null) {
      logInfo('Skipping save: tenantId is null, pattern learnings not persisted to database', {
        batchCount: batches.length,
        historicalLoanCount: historicalLoansData.length
      });
      return combinedSummary;
    }

    {
      const dateRangeStart = historicalLoansData.length > 0 
        ? historicalLoansData.reduce((earliest, loan) => {
            const date = loan.applicationDate ? new Date(loan.applicationDate) : null;
            if (!date || isNaN(date.getTime())) return earliest;
            return earliest && new Date(earliest) < date ? earliest : loan.applicationDate;
          }, null as string | null)
        : null;
      
      const dateRangeEnd = historicalLoansData.length > 0
        ? historicalLoansData.reduce((latest, loan) => {
            const date = loan.applicationDate ? new Date(loan.applicationDate) : null;
            if (!date || isNaN(date.getTime())) return latest;
            return latest && new Date(latest) > date ? latest : loan.applicationDate;
          }, null as string | null)
        : null;

      // Learnings do not expire - set expires_at to NULL so they persist indefinitely
      // They can be manually refreshed later when new historical loans are available
      // Note: Isolated tenant DBs don't have tenant_id column

      await dbPool.query(
        `INSERT INTO public.ai_pattern_learnings 
         (learning_type, pattern_summary, historical_loan_count, date_range_start, date_range_end, model_version, expires_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          'historical_patterns',
          combinedSummary,
          historicalLoansData.length,
          dateRangeStart,
          dateRangeEnd,
          PREDICTION_MODEL,
          null, // expires_at = NULL means learnings never expire
          JSON.stringify({ batchCount: batches.length })
        ]
      );

      logInfo('Saved AI pattern learnings to database (no expiration)', {
        historicalLoanCount: historicalLoansData.length,
        batchCount: batches.length,
        note: 'Learnings will persist until manually refreshed'
      });
    }

    return combinedSummary;
  } catch (error: any) {
    logError('Error getting or creating pattern learnings', error);
    return ''; // Return empty string on error, predictions will still work
  }
}

/**
 * Call AI model specifically for learning pattern extraction
 * Returns a pattern summary string instead of loan predictions
 */
const LEARNING_FETCH_MAX_RETRIES = 3;
const LEARNING_FETCH_INITIAL_BACKOFF_MS = 1000;

async function callAIModelForLearning(
  prompt: string,
  apiKey?: string,
  context?: string
): Promise<string | null> {
  const apiKeyToUse = apiKey || OPENAI_API_KEY;
  
  if (!apiKeyToUse) {
    return null;
  }

  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: PREDICTION_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are an expert loan analyst. Extract and summarize patterns from historical loan data. Return concise, actionable pattern summaries.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    max_completion_tokens: 1000
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= LEARNING_FETCH_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKeyToUse}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(`AI API error (${response.status}): ${errBody.error?.message || response.statusText || 'Unknown error'}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: { content?: string | Array<{ type?: string; text?: string }> };
          finish_reason?: string;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const usage = data.usage;
      if (usage) {
        logTokenUsage(usage, context ? `learning ${context}` : 'learning');
      }

      const rawContent = data.choices?.[0]?.message?.content;
      const finishReason = data.choices?.[0]?.finish_reason;
      // Support both string and array-of-parts (e.g. multimodal) response shapes
      const content =
        typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? (rawContent as { type?: string; text?: string }[])
                .map((p) => (p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
                .join('')
            : null;

      if (usage && !(content && content.trim())) {
        logInfo('Learning API returned usage but no text content — response shape debug', {
          context: context ?? 'learning',
          choicesLength: data.choices?.length ?? 0,
          finishReason: finishReason ?? 'unknown',
          rawContentType: rawContent === null ? 'null' : rawContent === undefined ? 'undefined' : Array.isArray(rawContent) ? 'array' : typeof rawContent,
          firstChoicePreview:
            data.choices?.[0] != null
              ? JSON.stringify(data.choices[0]).slice(0, 400)
              : 'no first choice',
          hint: 'If finishReason is "content_filter" or "length", check PREDICTION_MODEL and prompt content.',
        });
      }

      return (content && content.trim()) || null;
    } catch (err: any) {
      lastError = err;
      const cause = err?.cause ?? err?.message ?? String(err);
      const code = err?.code ?? err?.cause?.code;
      const isRetryable = err?.message === 'fetch failed' || ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(code);
      if (attempt < LEARNING_FETCH_MAX_RETRIES && isRetryable) {
        const delay = LEARNING_FETCH_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logInfo('Learning API fetch failed, retrying', { attempt, maxRetries: LEARNING_FETCH_MAX_RETRIES, cause, retryInMs: delay });
        await new Promise(r => setTimeout(r, delay));
      } else {
        logError('Error calling AI model for learning', err, { cause, code, attempt });
        return null;
      }
    }
  }
  const exhaustedCause = (lastError as any)?.cause ?? (lastError as Error)?.message ?? String(lastError);
  const exhaustedCode = (lastError as any)?.code ?? (lastError as any)?.cause?.code;
  logError('Error calling AI model for learning (exhausted retries)', lastError as Error, { cause: exhaustedCause, code: exhaustedCode });
  return null;
}

/**
 * Get the default prediction prompt
 * This can be overridden with a custom prompt in the request
 * The loans passed here should already be bucketed and enriched with signal strengths
 */
function getDefaultPrompt(loans: any[], historicalLoans: any[] = []): string {
  let historicalSection = '';
  if (historicalLoans.length > 0) {
    // Limit to most recent 50 historical loans to avoid token limits
    const recentHistorical = historicalLoans
      .sort((a, b) => {
        const dateA = a.applicationDate ? new Date(a.applicationDate).getTime() : 0;
        const dateB = b.applicationDate ? new Date(b.applicationDate).getTime() : 0;
        return dateB - dateA; // Most recent first
      })
      .slice(0, 50);
    
    historicalSection = `

Historical Loan Data (for pattern learning):
Analyze these past loans with their actual outcomes to identify patterns between signal strengths and final outcomes. Use these patterns to inform your predictions for the active loans below.

${JSON.stringify(recentHistorical, null, 2)}

---`;
  }
  
  return `You are an expert loan analyst AI agent. Analyze the following active loans and predict their likely outcomes.

For each loan, predict whether it will:
1. WITHDRAW - Borrower will withdraw the application
2. DENY - Lender will deny the application  
3. ORIGINATE - Loan will successfully close

Each loan has been pre-processed with signal strength buckets (1-6 scale) and calculated metrics:
- Credit Metrics Signal Strength: Composite of FICO, LTV, DTI (higher = higher denial risk)
- Loan Characteristics Signal Strength: Composite of loan type, purpose, channel, occupancy (higher = more complex = higher risk)
- Time in Motion Signal Strength: Based on loan age and milestones (higher = older = higher withdrawal risk)
- MLO AE Fallout Prone Signal Strength: Based on LO historical pullthrough (higher = lower pullthrough = higher risk)
- Interest Lock vs Market Signal Strength: Market delta between lock rate and current rate (higher = unfavorable = higher withdrawal risk)
- UW Pullthrough Signal Strength: Individual UW pullthrough bucket (higher = lower pullthrough = higher risk)
- Closer Pullthrough Signal Strength: Individual Closer pullthrough bucket (higher = lower pullthrough = higher risk)
- Processor Pullthrough Signal Strength: Individual Processor pullthrough bucket (higher = lower pullthrough = higher risk)

Each loan also includes reason codes explaining the signal strengths.

Pay special attention to:
- Market Change Delta: Positive values indicate rates fell since lock (withdrawal risk)
- LO Pullthrough: Lower percentages indicate higher historical fallout
- Credit Signal: Higher buckets indicate denial risk
- Time in Motion: Older loans have higher withdrawal risk
${historicalLoans.length > 0 ? '- Historical patterns: Learn from the historical loan data below to identify which signal strength combinations led to withdraw, deny, or originate outcomes' : ''}

${historicalSection}

Active Loans to analyze (with pre-calculated signal strengths):
${JSON.stringify(loans, null, 2)}

Return your analysis as a JSON object with a "predictions" array containing objects with this structure for each loan:
{
  "loanId": "string",
  "predictedOutcome": "withdraw" | "deny" | "originate",
  "confidence": 0-100,
  "reasoning": "brief explanation referencing the signal strengths and reason codes${historicalLoans.length > 0 ? ', and patterns learned from historical data' : ''}",
  "riskFactors": ["factor1", "factor2"]
}

Return ONLY valid JSON with a "predictions" key containing the array, no additional text.`;
}

/**
 * Call AI model to get predictions.
 * Returns predictions and optional usage (for RAG batch cost tracking).
 */
async function callAIModel(
  prompt: string,
  apiKey?: string,
  context?: string
): Promise<{ predictions: LoanPrediction[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const apiKeyToUse = apiKey || OPENAI_API_KEY;
  
  if (!apiKeyToUse) {
    throw new Error('OPENAI_API_KEY is not configured. Please set it in environment variables.');
  }

  try {
    logInfo('Calling AI model for loan predictions', {
      model: PREDICTION_MODEL,
      loanCount: prompt.includes('"loanId"') ? (prompt.match(/"loanId"/g) || []).length : 0,
      promptSource: prompt.includes('Historical Data Learning') ? 'Knowledge Base (Fallout)' : 'Default Prompt',
      promptLength: prompt.length
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKeyToUse}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PREDICTION_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an expert loan analyst. Always return valid JSON objects. Never include markdown code blocks or additional text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        // Omit temperature to use API default
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      throw new Error(`AI API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const usage = data.usage;
    if (usage) {
      logTokenUsage(usage, context ? `prediction ${context}` : 'prediction');
      // Dedicated cost log per RAG batch for easy tracking/summing
      if (context?.includes('RAG batch')) {
        const costUsd = getEstimatedCostUsd(usage);
        console.log(
          `[Cost] ${context}: $${costUsd.toFixed(4)} (prompt: ${(usage.prompt_tokens ?? 0).toLocaleString()}, completion: ${(usage.completion_tokens ?? 0).toLocaleString()})`
        );
      }
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from AI model');
    }

    // Parse JSON response - handle both wrapped and unwrapped formats
    let parsed: any;
    try {
      // Try parsing as direct JSON
      parsed = JSON.parse(content);
      
      // If it's wrapped in a "predictions" key, extract it
      if (parsed.predictions && Array.isArray(parsed.predictions)) {
        parsed = parsed.predictions;
      } else if (parsed.data && Array.isArray(parsed.data)) {
        parsed = parsed.data;
      } else if (!Array.isArray(parsed)) {
        // If it's an object but not an array, try to extract array
        const keys = Object.keys(parsed);
        if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
          parsed = parsed[keys[0]];
        } else {
          throw new Error('Response is not in expected format');
        }
      }
    } catch (parseError) {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || 
                       content.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[1]);
        parsed = extracted.predictions || extracted.data || extracted;
        if (!Array.isArray(parsed)) {
          throw new Error('Extracted JSON is not in expected format');
        }
      } else {
        throw new Error(`Failed to parse AI response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      }
    }

    // Validate and normalize predictions
    if (!Array.isArray(parsed)) {
      throw new Error('AI response is not an array');
    }

    const predictions = parsed.map((pred: any) => ({
      loanId: String(pred.loanId || pred.loan_id || ''),
      predictedOutcome: (pred.predictedOutcome || pred.outcome || 'originate').toLowerCase(),
      confidence: Math.max(0, Math.min(100, Number(pred.confidence || pred.confidenceScore || 50))),
      reasoning: String(pred.reasoning || pred.reason || pred.explanation || ''),
      riskFactors: Array.isArray(pred.riskFactors) 
        ? pred.riskFactors.map(String)
        : pred.riskFactors 
          ? [String(pred.riskFactors)]
          : []
    })).filter((p: LoanPrediction) => p.loanId); // Filter out invalid predictions

    return { predictions, usage };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logError('Failed to get AI predictions', error, {});
    throw new Error(`AI prediction failed: ${errorMessage}`);
  }
}

/**
 * Prepare loan data for AI analysis
 * Extracts and formats relevant loan fields with proper validation and normalization
 * 
 * Note: raw_data column has been removed. This function now relies solely on
 * the structured loan columns. Legacy raw_data support is provided for backward
 * compatibility during migration but should be empty.
 */
export function prepareLoanData(loans: any[]): any[] {
  return loans.map((loan, idx) => {
    // Legacy raw_data support - will be empty after migration
    // Kept for backward compatibility during transition
    const rawData = loan.raw_data 
      ? (typeof loan.raw_data === 'string' ? JSON.parse(loan.raw_data) : loan.raw_data)
      : {};
    
    // Parse metadata if it's a string (JSONB from database)
    const metadata = typeof loan.metadata === 'string'
      ? JSON.parse(loan.metadata)
      : (loan.metadata || {});

    // Helper to safely parse numeric values
    const parseNumeric = (value: any): number | null => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
      return isNaN(parsed) ? null : parsed;
    };

    // Helper to safely parse date values
    const parseDate = (value: any): Date | null => {
      if (!value) return null;
      try {
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
      } catch {
        return null;
      }
    };

    const applicationDate = parseDate(loan.application_date || rawData.application_date);
    const lockDate = parseDate(loan.lock_date || rawData.lock_date);
    const lockExpirationDate = parseDate(loan.lock_expiration_date || rawData.lock_expiration_date);
    const closingDate = parseDate(loan.closing_date || rawData.closing_date);
    const estimatedClosingDate = parseDate(loan.estimated_closing_date || rawData.estimated_closing_date);
    const fundDate = parseDate(loan.fund_date || rawData.fund_date || rawData.funding_date || rawData['Funding Date']);
    const uwDeniedDate = parseDate(loan.uw_denied_date || rawData.uw_denied_date);
    const uwSuspendedDate = parseDate(loan.uw_suspended_date || rawData.uw_suspended_date);
    const lastModifiedDate = parseDate(loan.last_modified_date || rawData.last_modified_date);

    // Debug: log first raw row and prepared output for loan_purpose, channel, lock_date
    const preparedLoanPurpose = String(loan.loan_purpose || rawData.loan_purpose || rawData['Fields.19'] || '');
    const preparedChannel = String(
      loan.channel ||
      rawData.channel ||
      rawData['Channel'] ||
      rawData['Fields.2626'] ||
      ''
    );
    if (idx === 0) {
      const rawKeys = loan && typeof loan === 'object' ? Object.keys(loan).filter(k => /loan_purpose|channel|lock_date|loan_id/i.test(k)) : [];
      logInfo('[PredictDebug] prepareLoanData first row', {
        rawRowKeysSample: rawKeys,
        'rawRow.loan_id': loan?.loan_id,
        typeof_loan_id: typeof loan?.loan_id,
        'rawRow.loan_purpose': loan?.loan_purpose,
        'rawRow.channel': loan?.channel,
        'rawRow.lock_date': loan?.lock_date,
        preparedLockDate: lockDate != null ? (lockDate instanceof Date ? lockDate.toISOString() : String(lockDate)) : null,
        prepared_loanPurpose: preparedLoanPurpose || '(empty)',
        prepared_channel: preparedChannel || '(empty)',
      });
    }

    return {
      loanId: String(loan.loan_id || loan.id || rawData.GUID || rawData.guid || ''),
      loanNumber: String(loan.loan_number ?? rawData.loan_number ?? '').trim() || null,
      loanAmount: parseNumeric(loan.loan_amount || rawData.loan_amount) || 0,
      loanType: String(loan.loan_type || rawData.loan_type || 'Unknown'),
      status: String(loan.status || rawData.status || 'Active'),
      applicationDate,
      lockDate,
      lockExpirationDate,
      closingDate,
      estimatedClosingDate,
      fundDate,
      uwDeniedDate,
      uwSuspendedDate,
      lastModifiedDate,
      interestRate: (() => {
        // Try all possible interest rate field name variations
        const interestRateValue = 
          loan.interest_rate ||
          rawData.interest_rate ||
          rawData.interestRate ||
          rawData['Interest Rate'] ||
          rawData['interest rate'] ||
          rawData['Rate'] ||
          rawData.rate ||
          // Try case-insensitive search for any field containing "interest" or "rate"
          (() => {
            if (rawData && typeof rawData === 'object') {
              for (const key in rawData) {
                const keyLower = key.toLowerCase();
                if ((keyLower.includes('interest') && keyLower.includes('rate')) || 
                    (keyLower === 'rate' || keyLower === 'interest')) {
                  const val = rawData[key];
                  if (val !== null && val !== undefined && val !== '') {
                    return val;
                  }
                }
              }
            }
            return null;
          })();
        return parseNumeric(interestRateValue);
      })(),
      // FICO Score - check Encompass field IDs and aliases from CoheusDataDictionary
      ficoScore: parseNumeric(
        loan.fico_score || 
        rawData.fico_score || 
        rawData.fico || 
        rawData['FICO Score'] ||
        rawData['Fields.VASUMM.X23'] ||           // Encompass: FICO Score
        rawData['Fields.ULDD.X101'] ||            // Encompass: Freddie Loan Level Credit Score Value
        loan.credit_score
      ),
      // LTV - check Encompass field IDs and aliases
      ltv: parseNumeric(
        loan.ltv || 
        loan.ltv_ratio ||
        rawData.ltv || 
        rawData.loan_to_value || 
        rawData['LTV Ratio'] ||
        rawData['Fields.353']                     // Encompass: LTV Ratio
      ),
      dti: (() => {
        // Try all possible DTI field name variations including Encompass field IDs
        const dtiValue = 
          loan.dti || 
          loan.be_dti_ratio ||                    // Tenant schema column
          metadata.dti ||
          metadata.dti_ratio ||
          rawData.dti || 
          rawData.dti_ratio || 
          rawData['BE DTI Ratio'] || 
          rawData['be dti ratio'] || // Case-insensitive
          rawData['DTI Ratio'] ||
          rawData['dti ratio'] || // Case-insensitive
          rawData['Debt-to-Income Ratio'] ||
          rawData['Fields.742'] ||                // Encompass: BE DTI Ratio
          // Try case-insensitive search for any field containing "dti"
          (() => {
            if (rawData && typeof rawData === 'object') {
              for (const key in rawData) {
                if (key.toLowerCase().includes('dti') || key.toLowerCase().includes('debt')) {
                  const val = rawData[key];
                  if (val !== null && val !== undefined && val !== '') {
                    return val;
                  }
                }
              }
            }
            return null;
          })();
        return parseNumeric(dtiValue);
      })(),
      // CLTV - check Encompass field IDs
      cltv: parseNumeric(
        loan.cltv ||
        rawData.cltv || 
        rawData.combined_loan_to_value || 
        rawData.combined_ltv ||
        rawData['Fields.976']                     // Encompass: CLTV (if available)
      ), // Combined Loan-to-Value
      loanPurpose: preparedLoanPurpose,
      loan_purpose: preparedLoanPurpose,
      branch: String(loan.branch || rawData.branch || ''),
      cycleTimeDays: parseNumeric(loan.cycle_time_days || rawData.cycle_time_days),
      // Person names for pullthrough calculations - check schema columns, aliases, and Encompass field IDs
      loanOfficerName: String(
        loan.loan_officer_name || 
        loan.loan_officer ||
        rawData.loan_officer_name || 
        rawData.loan_officer || 
        rawData.officer_name || 
        rawData['Loan Officer'] ||
        rawData['Fields.317'] ||                      // Encompass: Loan Officer
        rawData['Fields.LoanTeamMember.Name.Loan Officer'] ||  // Encompass: Loan Officer (team member)
        ''
      ),
      underwriterName: String(
        loan.underwriter ||
        rawData.underwriter || 
        rawData.underwriter_name || 
        rawData['Underwriter'] ||
        rawData['Fields.LoanTeamMember.Name.Underwriter'] ||   // Encompass: Underwriter
        ''
      ),
      closerName: String(
        loan.closer ||
        rawData.closer || 
        rawData.closer_name || 
        rawData['Closer'] ||
        rawData['Fields.LoanTeamMember.Name.Closer'] ||        // Encompass: Closer
        ''
      ),
      processorName: String(
        loan.processor ||
        rawData.processor || 
        rawData.processor_name || 
        rawData['Processor'] ||
        rawData['Fields.LoanTeamMember.Name.Loan Processor'] || // Encompass: Processor
        ''
      ),
      // Loan characteristics (check CSV field names and Encompass field IDs)
      occupancyType: String(
        loan.occupancy_type ||
        rawData.occupancy_type || 
        rawData.occupancyType || 
        rawData['Occupancy Type'] ||
        rawData['Fields.1811'] ||                     // Encompass: Occupancy Type (if available)
        ''
      ),
      channel: preparedChannel,
      // Commission fields (if available in data)
      commissionAssumption: parseNumeric(rawData.commission_assumption || rawData.commissionAssumption),
      commissionAtRisk: parseNumeric(rawData.commission_at_risk || rawData.commissionAtRisk),
      commissionPersonalizationOverride: parseNumeric(rawData.commission_personalization_override || rawData.commissionPersonalizationOverride),
      // Lender credit amount
      lenderCreditAmount: parseNumeric(rawData.lender_credit_amount || rawData.lenderCreditAmount || rawData.lender_credit),
      // Milestone data for Time in Motion calculation
      // Extract Current Milestone - check direct DB column first, then fallback fields
      lastCompletedMilestone: String(
        loan.current_milestone ||  // Direct DB column (snake_case)
        loan.last_completed_milestone ||
        rawData.current_milestone ||  // Legacy support
        rawData['Current Milestone'] ||  // Legacy support
        rawData['Last Completed Milestone'] || 
        rawData.last_completed_milestone || 
        rawData.lastCompletedMilestone || 
        rawData['Fields.Log.MS.CurrentMilestone'] ||
        ''
      ),
      // Check for milestone date fields
      milestones: loan.milestones || rawData.milestones || rawData.milestone_data || (() => {
        // Build milestone array from date fields if available
        const milestoneDates: any[] = [];
        const creditPullDate = loan.credit_pull_date || rawData['Credit Pull Date'];
        const conditionalApprovalDate = loan.conditional_approval_date || rawData['Conditional Approval Date'];
        const uwFinalApprovalDate = loan.uw_final_approval_date || rawData['UW Final Approval Date'];
        const ctcDate = loan.ctc_date || rawData['CTC Date'];
        const lastCompletedMilestoneDate = loan.last_completed_milestone_date || rawData['Last Completed Milestone'];
        
        if (creditPullDate) milestoneDates.push({ name: 'Credit Pull', date: parseDate(creditPullDate) });
        if (conditionalApprovalDate) milestoneDates.push({ name: 'Conditional Approval', date: parseDate(conditionalApprovalDate) });
        if (uwFinalApprovalDate) milestoneDates.push({ name: 'UW Final Approval', date: parseDate(uwFinalApprovalDate) });
        if (ctcDate) milestoneDates.push({ name: 'Clear to Close', date: parseDate(ctcDate) });
        if (lastCompletedMilestoneDate) milestoneDates.push({ name: 'Last Completed', date: parseDate(lastCompletedMilestoneDate) });
        return milestoneDates.length > 0 ? milestoneDates : null;
      })(),
      // Note: raw_data column has been removed - additional fields should use structured columns
      // Calculate days since application
      daysSinceApplication: applicationDate 
        ? Math.floor((new Date().getTime() - applicationDate.getTime()) / (1000 * 60 * 60 * 24))
        : null
    };
  });
}

/**
 * Market rate data is now loaded from database via marketRateService
 * Rates are fetched from FRED API and stored in public.market_rates table
 * See marketRateService.ts for implementation
 */

/**
 * Calculate market change delta for a loan
 * Lock rate = market rate at lock date (or application date if no lock date)
 * Close rate = market rate at close/status date (or most recent for active loans)
 * Delta = lockMarketRate - closeMarketRate (positive = rates fell = withdrawal risk)
 */
async function calculateMarketDelta(loan: any): Promise<{
  marketChangeDelta: number | null;
  marketChangeOverall: number | null;
  lockMarketRate: number | null;
  closeMarketRate: number | null;
  maxChangeRate: number | null;
  maxChangeDate: string | null;
}> {
  // Determine lock date (priority: lock_date > application_date)
  const lockDate = loan.lockDate || loan.lock_date || loan.applicationDate || loan.application_date;
  if (!lockDate) {
    return {
      marketChangeDelta: null,
      marketChangeOverall: null,
      lockMarketRate: null,
      closeMarketRate: null,
      maxChangeRate: null,
      maxChangeDate: null
    };
  }

  // Determine if loan is active (check status from loan columns)
  // Note: raw_data column has been removed - use structured columns only
  const rawData = loan.raw_data 
    ? (typeof loan.raw_data === 'string' ? JSON.parse(loan.raw_data) : loan.raw_data)
    : {}; // Empty for backward compatibility
  
  const currentLoanStatus = loan.status || 
                            loan.current_loan_status ||
                            rawData['Current Loan Status'] || 
                            rawData.current_loan_status ||
                            rawData['Loan Status'] ||
                            rawData.loan_status ||
                            rawData['Fields.1393'] ||
                            'Active';
  
  // Loan is active if status is "Active Loan", "Active", or "Inquiry"
  const isActive = currentLoanStatus && 
                   (currentLoanStatus.toLowerCase() === 'active loan' ||
                    currentLoanStatus.toLowerCase() === 'active' ||
                    currentLoanStatus.toLowerCase() === 'inquiry');
  
  // Extract Current Status Date (for historical loans)
  const currentStatusDate = loan.current_status_date ||
                            loan.status_date ||
                            rawData['Current Status Date'] ||
                            rawData.current_status_date ||
                            rawData['Status Date'] ||
                            rawData.status_date ||
                            null;
  
  // For historical loans: use Current Status Date (or closing date if no status date)
  // For active loans: use today (will get most recent market rate)
  let closeDate: Date | null = null;
  if (isActive) {
    closeDate = new Date();
  } else if (currentStatusDate) {
    // Validate currentStatusDate before using it
    const statusDateObj = new Date(currentStatusDate);
    if (!isNaN(statusDateObj.getTime())) {
      closeDate = statusDateObj;
    } else {
      // Invalid date, fall back to closing date
      closeDate = loan.closingDate || loan.closing_date ? new Date(loan.closingDate || loan.closing_date) : null;
      if (closeDate && isNaN(closeDate.getTime())) {
        closeDate = null;
      }
    }
  } else {
    // No currentStatusDate, use closing date
    closeDate = loan.closingDate || loan.closing_date ? new Date(loan.closingDate || loan.closing_date) : null;
    if (closeDate && isNaN(closeDate.getTime())) {
      closeDate = null;
    }
  }
  
  // If still no valid closeDate, use today for active loans, or return null
  if (!closeDate) {
    closeDate = isActive ? new Date() : null;
  }

  if (!closeDate) {
    return {
      marketChangeDelta: null,
      marketChangeOverall: null,
      lockMarketRate: null,
      closeMarketRate: null,
      maxChangeRate: null,
      maxChangeDate: null
    };
  }

  // Validate dates before creating Date objects
  const lockDateObj = lockDate ? new Date(lockDate) : null;
  const closeDateObj = closeDate ? new Date(closeDate) : null;

  // Check if dates are valid
  if (!lockDateObj || isNaN(lockDateObj.getTime())) {
    return {
      marketChangeDelta: null,
      marketChangeOverall: null,
      lockMarketRate: null,
      closeMarketRate: null,
      maxChangeRate: null,
      maxChangeDate: null
    };
  }

  if (!closeDateObj || isNaN(closeDateObj.getTime())) {
    return {
      marketChangeDelta: null,
      marketChangeOverall: null,
      lockMarketRate: null,
      closeMarketRate: null,
      maxChangeRate: null,
      maxChangeDate: null
    };
  }

  if (closeDateObj < lockDateObj) {
    return {
      marketChangeDelta: null,
      marketChangeOverall: null,
      lockMarketRate: null,
      closeMarketRate: null,
      maxChangeRate: null,
      maxChangeDate: null
    };
  }

  // Lookup market rates from database
  try {
    // Format dates for lookup (YYYY-MM-DD) - dates are validated above
    const lockDateStr = lockDateObj.toISOString().split('T')[0];
    const closeDateStr = closeDateObj.toISOString().split('T')[0];

    // Get lock rate: Market rate at lock date (or application date if no lock date - lockDate already falls back to application_date)
    let lockMarketRate: number | null = await getMarketRateForDate(lockDateStr);
    if (lockMarketRate === null) {
      // If not found for exact date, try going back up to 7 days to find a rate
      const targetDate = new Date(lockDateStr);
      for (let daysBack = 1; daysBack <= 7; daysBack++) {
        const checkDate = new Date(targetDate);
        checkDate.setDate(targetDate.getDate() - daysBack);
        const checkDateStr = checkDate.toISOString().split('T')[0];
        lockMarketRate = await getMarketRateForDate(checkDateStr);
        if (lockMarketRate !== null) break;
      }
    }

    // Get close rate:
    // - For historical loans: Use market rate from Current Status Date
    // - For active loans: Use most recent market rate (usually today's date)
    let closeMarketRate: number | null = null;
    if (isActive) {
      // For active loans, get the most recent market rate
      closeMarketRate = await getMostRecentMarketRate();
      // If no recent rate found, try today's date as fallback, then yesterday, etc.
      if (closeMarketRate === null) {
        // Try today's date
        closeMarketRate = await getMarketRateForDate(closeDateStr);
        // If still null, try going back up to 7 days to find a rate
        if (closeMarketRate === null) {
          const today = new Date(closeDateStr);
          for (let daysBack = 1; daysBack <= 7; daysBack++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() - daysBack);
            const checkDateStr = checkDate.toISOString().split('T')[0];
            closeMarketRate = await getMarketRateForDate(checkDateStr);
            if (closeMarketRate !== null) {
              break;
            }
          }
        }
      }
    } else {
      // For historical loans, use market rate from Current Status Date (or closing date if no status date)
      closeMarketRate = await getMarketRateForDate(closeDateStr);
      // If not found, try going back up to 7 days to find a rate
      if (closeMarketRate === null && closeDateStr) {
        const targetDate = new Date(closeDateStr);
        for (let daysBack = 1; daysBack <= 7; daysBack++) {
          const checkDate = new Date(targetDate);
          checkDate.setDate(targetDate.getDate() - daysBack);
          const checkDateStr = checkDate.toISOString().split('T')[0];
          closeMarketRate = await getMarketRateForDate(checkDateStr);
          if (closeMarketRate !== null) {
            break;
          }
        }
      }
    }

    // If we don't have both rates, return null (no logging to reduce terminal noise)
    if (lockMarketRate === null || closeMarketRate === null) {
      return {
        marketChangeDelta: null,
        marketChangeOverall: null,
        lockMarketRate,
        closeMarketRate,
        maxChangeRate: null,
        maxChangeDate: null
      };
    }
    
    // Reset failure counter on success (so we log failures from different batches)
    if ((calculateMarketDelta as any).__failureCount) {
      (calculateMarketDelta as any).__failureCount = 0;
    }

    // Calculate delta: lockRate - closeRate
    // Positive delta = rates went DOWN (unfavorable, withdrawal risk)
    // Negative delta = rates went UP (favorable, borrower saved)
    const marketChangeDelta = lockMarketRate - closeMarketRate;
    const marketChangeOverall = marketChangeDelta;

    // Find max change during the period (for maxChangeRate and maxChangeDate)
    const ratesInPeriod = await getMarketRatesForRange(lockDateObj, closeDateObj);
    let maxChangeRate: number | null = null;
    let maxChangeDate: string | null = null;

    if (ratesInPeriod.length > 0) {
      // Find the maximum deviation from lock rate
      let maxDeviation = 0;
      for (const rateData of ratesInPeriod) {
        const deviation = Math.abs(rateData.rate - lockMarketRate);
        if (deviation > maxDeviation) {
          maxDeviation = deviation;
          maxChangeRate = rateData.rate;
          maxChangeDate = rateData.date;
        }
      }
    }

    return {
      marketChangeDelta,
      marketChangeOverall,
      lockMarketRate,
      closeMarketRate,
      maxChangeRate,
      maxChangeDate
    };
  } catch (error: any) {
    // Silently handle all errors (no logging to reduce terminal noise)
    return {
      marketChangeDelta: null,
      marketChangeOverall: null,
      lockMarketRate: null,
      closeMarketRate: null,
      maxChangeRate: null,
      maxChangeDate: null
    };
  }
}

/**
 * Calculate pullthrough rate for a specific role
 * Based on PULLTHROUGH_CALCULATION.md
 * 
 * Note: raw_data column has been removed. This function now primarily relies on
 * structured loan columns and metadata fields.
 */
function calculatePullthroughForRole(
  allLoans: any[],
  roleColumnCandidates: string[]
): Record<string, number> {
  const pullthroughMap: Record<string, number> = {};

  // Find role column by checking loan columns and metadata
  // Legacy raw_data support kept for backward compatibility
  let roleColumn: string | null = null;
  let actualRawDataKey: string | null = null; // The actual key name for value extraction
  
  // Try to find a matching field in the first loan's properties or metadata
  if (allLoans.length > 0) {
    const firstLoan = allLoans[0];
    // Legacy raw_data support - will be empty after migration
    const rawData = firstLoan.raw_data 
      ? (typeof firstLoan.raw_data === 'string' ? JSON.parse(firstLoan.raw_data) : firstLoan.raw_data)
      : {};
    
    // Check keys available in the loan object (excluding internal fields)
    const rawDataKeys = rawData && typeof rawData === 'object' ? Object.keys(rawData) : [];
    
    // Debug: log keys to help diagnose
    if (rawDataKeys.length > 0 && rawDataKeys.length < 50) {
      logInfo('Checking for role column', {
        roleCandidates: roleColumnCandidates,
        rawDataKeys: rawDataKeys.slice(0, 20), // First 20 keys
        rawDataKeyCount: rawDataKeys.length
      });
    }
    
    for (const candidate of roleColumnCandidates) {
      // Check direct loan property first (database columns from tenant schema)
      // Use 'in' operator to check if column EXISTS (even if value is null/empty)
      if (candidate in firstLoan) {
        roleColumn = candidate;
        actualRawDataKey = candidate; // Use this field for consistency
        break;
      }
      
      // Check exact match in legacy data (for CSV imports)
      if (rawData && typeof rawData === 'object' && rawData[candidate] !== undefined) {
        roleColumn = candidate;
        actualRawDataKey = candidate; // Store actual key
        break;
      }
      
      // Check case-insensitive match (for CSV field names with spaces/casing)
      const lowerCandidate = candidate.toLowerCase();
      for (const key of rawDataKeys) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === lowerCandidate) {
          roleColumn = candidate; // Use candidate for consistency in logic
          actualRawDataKey = key; // Store ACTUAL key for value extraction
          break;
        }
        // Also check for partial matches (e.g., "loan officer" in "Loan Officer Name")
        if (lowerCandidate.includes('loan') && lowerCandidate.includes('officer')) {
          if (lowerKey.includes('loan') && lowerKey.includes('officer')) {
            roleColumn = candidate;
            actualRawDataKey = key;
            break;
          }
        }
      }
      
      if (roleColumn && actualRawDataKey) break;
      
      // Check metadata (for database-stored fields)
      if (firstLoan.metadata && typeof firstLoan.metadata === 'object') {
        // For Loan Officer, check metadata.loan_officer_name
        if (candidate === 'Loan Officer' || candidate === 'loan_officer_name') {
          if (firstLoan.metadata.loan_officer_name !== undefined) {
            roleColumn = candidate;
            break;
          }
        }
        // For other roles, check metadata fields
        if (candidate === 'Underwriter' && firstLoan.metadata.underwriter_name !== undefined) {
          roleColumn = candidate;
          break;
        }
        if (candidate === 'Closer' && (firstLoan.metadata.closer !== undefined || firstLoan.metadata.closer_name !== undefined)) {
          roleColumn = candidate;
          break;
        }
        if (candidate === 'Processor' && (firstLoan.metadata.processor !== undefined || firstLoan.metadata.processor_name !== undefined)) {
          roleColumn = candidate;
          break;
        }
      }
      
      // Check prepared field names (if loan was already prepared)
      if (candidate === 'Loan Officer' && firstLoan.loanOfficerName !== undefined) {
        roleColumn = candidate;
        break;
      }
      if (candidate === 'Underwriter' && firstLoan.underwriterName !== undefined) {
        roleColumn = candidate;
        break;
      }
      if (candidate === 'Closer' && firstLoan.closerName !== undefined) {
        roleColumn = candidate;
        break;
      }
      if (candidate === 'Processor' && firstLoan.processorName !== undefined) {
        roleColumn = candidate;
        break;
      }
    }
  }

  if (!roleColumn) {
    logInfo('No role column found for pullthrough calculation', { 
      roleCandidates: roleColumnCandidates,
      sampleLoanKeys: allLoans.length > 0 ? Object.keys(allLoans[0] || {}) : []
    });
    return pullthroughMap; // No role column found
  }

  // Log success if we found the role column
  if (roleColumn && actualRawDataKey) {
    logInfo('Found role column for pullthrough calculation', {
      roleColumn,
      actualRawDataKey,
      roleCandidates: roleColumnCandidates
    });
  }

  // Filter to ONLY non-active loans (historical loans) for pullthrough calculation
  // Historical loans = loans where current_loan_status != "Active Loan"
  // This ensures pullthrough = (Originated Loans) / (All Non-Active Loans)
  const finalizedLoans = allLoans.filter(loan => {
    // Parse raw_data if it's a string
    let rawData = loan.raw_data;
    if (rawData && typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        rawData = null;
      }
    }
    
    // Use same status extraction logic as pullthrough calculation (matches mapForecastStatus priority)
    let status = null;
    
    // PRIORITY 0: Check direct database column (from optimized queries without raw_data)
    if (!status && loan.current_loan_status) {
      status = loan.current_loan_status;
    }
    
    // PRIORITY 1: Check current_loan_status from raw_data (primary field, matches mapForecastStatus)
    if (!status && rawData && typeof rawData === 'object') {
      status = rawData['Current Loan Status'] || rawData.current_loan_status || 
               rawData['Loan Status'] || rawData.loan_status || null;
    }
    
    // PRIORITY 2: Check Fields.1393 (LOS-specific field, matches mapForecastStatus)
    if (!status && rawData && typeof rawData === 'object') {
      status = rawData['Fields.1393'] || null;
    }
    
    // PRIORITY 3: Check loan.status field
    if (!status) {
      status = loan.status;
    }
    
    // PRIORITY 4: Check other status fields in raw_data
    if (!status && rawData && typeof rawData === 'object') {
      status = rawData.status || rawData.Status || rawData['Current Status'] || 
               rawData['current_status'] || null;
    }
    
    // PRIORITY 5: Check metadata
    if (!status && loan.metadata) {
      const metadata = typeof loan.metadata === 'string'
        ? JSON.parse(loan.metadata)
        : (loan.metadata || {});
      status = metadata.status || null;
    }
    
    // Normalize status (same as normalizeRawStatus in ClosingFalloutForecast.tsx)
    const statusUpper = (status ?? '').toString().trim().toUpperCase();
    
    // If we have a status, check if it's finalized (not active)
    if (statusUpper) {
      // Exclude active/inquiry statuses (matches mapForecastStatus: if (s === 'ACTIVE LOAN') return 'Active')
      if (statusUpper === 'ACTIVE LOAN' || statusUpper === 'ACTIVE' || statusUpper === 'INQUIRY') {
        return false;
      }
      // Include all other statuses as finalized (Originated, Denied, Withdrawn, etc.)
      // Note: The pullthrough calculation will further filter to only count Originated, Denied, Withdrawn
      return true;
    }
    
    // If no status found at all, exclude it (can't determine if it's finalized)
    return false;
  });

  // Debug: log finalized loans count and sample statuses with more detail
  if (finalizedLoans.length === 0 && allLoans.length > 0) {
    const sampleStatuses = allLoans.slice(0, 10).map(loan => {
      let rawData = loan.raw_data;
      if (rawData && typeof rawData === 'string') {
        try {
          rawData = JSON.parse(rawData);
        } catch (e) {
          rawData = null;
        }
      }
      
      // Check current_loan_status (primary field)
      const currentLoanStatus = rawData && typeof rawData === 'object' ? 
        (rawData.current_loan_status || rawData['Current Loan Status'] || rawData['Loan Status'] || rawData.loan_status) : null;
      
      // Check other status fields
      let status = loan.status;
      if (!status && rawData && typeof rawData === 'object') {
        status = rawData.status || rawData.Status || rawData['Current Status'] || rawData['current_status'] || null;
      }
      
      // Determine if this loan would be considered finalized
      let isFinalized = false;
      if (currentLoanStatus) {
        const statusUpper = currentLoanStatus.toString().toUpperCase().trim();
        isFinalized = !(statusUpper === 'ACTIVE LOAN' || statusUpper === 'ACTIVE' || statusUpper === 'INQUIRY');
      } else if (status) {
        const statusUpper = status.toString().toUpperCase().trim();
        isFinalized = !(statusUpper === 'ACTIVE LOAN' || statusUpper === 'ACTIVE' || statusUpper === 'INQUIRY');
      }
      
      return {
        loanId: loan.loan_id || loan.loanId,
        statusFromLoan: loan.status,
        currentLoanStatus: currentLoanStatus,
        statusFromRawData: rawData && typeof rawData === 'object' ? (rawData.status || rawData.Status) : null,
        isFinalized: isFinalized,
        rawDataKeys: rawData && typeof rawData === 'object' ? Object.keys(rawData).filter(k => k.toLowerCase().includes('status')).slice(0, 10) : []
      };
    });
    
    // Collect unique current_loan_status values across all loans
    const uniqueCurrentLoanStatuses = new Set<string>();
    const uniqueStatuses = new Set<string>();
    
    allLoans.forEach(loan => {
      let rawData = loan.raw_data;
      if (rawData && typeof rawData === 'string') {
        try {
          rawData = JSON.parse(rawData);
        } catch (e) {
          rawData = null;
        }
      }
      
      // Track current_loan_status values
      if (rawData && typeof rawData === 'object') {
        const currentLoanStatus = rawData.current_loan_status || rawData['Current Loan Status'] || 
                                 rawData['Loan Status'] || rawData.loan_status;
        if (currentLoanStatus) {
          uniqueCurrentLoanStatuses.add(currentLoanStatus.toString().toLowerCase());
        }
      }
      
      // Track other status values
      let status = loan.status;
      if (!status && rawData && typeof rawData === 'object') {
        status = rawData.status || rawData.Status || rawData['Current Status'] || rawData['current_status'] || null;
      }
      if (status) {
        uniqueStatuses.add(status.toString().toLowerCase());
      }
    });
    
    logInfo('No finalized loans found for pullthrough calculation', {
      totalLoans: allLoans.length,
      finalizedLoansCount: finalizedLoans.length,
      sampleStatuses,
      uniqueCurrentLoanStatusValues: Array.from(uniqueCurrentLoanStatuses).slice(0, 20),
      uniqueStatusValues: Array.from(uniqueStatuses).slice(0, 20),
      roleColumn,
      actualRawDataKey,
      note: 'Finalized loans = loans where current_loan_status != "Active Loan"'
    });
  } else if (finalizedLoans.length > 0) {
    logInfo('Found finalized loans for pullthrough calculation', {
      totalLoans: allLoans.length,
      finalizedLoansCount: finalizedLoans.length,
      roleColumn,
      actualRawDataKey
    });
  }

  // Group by person name
  const personLoans: Record<string, { total: number; originated: number }> = {};

  finalizedLoans.forEach(loan => {
    const rawData = typeof loan.raw_data === 'string' 
      ? JSON.parse(loan.raw_data) 
      : (loan.raw_data || {});
    
    // Parse metadata if it's a string
    const metadata = typeof loan.metadata === 'string'
      ? JSON.parse(loan.metadata)
      : (loan.metadata || {});
    
    // Try to get person name from multiple sources:
    // 1. Prepared field names (if loan was already prepared)
    // 2. Metadata fields (from import)
    // 3. Raw column names (from database or raw_data) - use actualRawDataKey if available
    let personName: string | null = null;
    
    // Check direct database columns first (from tenant schema), then prepared fields
    if (roleColumnCandidates.includes('loan_officer')) {
      personName = loan.loan_officer || loan.loanOfficerName || null;
      if (!personName && metadata && typeof metadata === 'object') {
        personName = metadata.loan_officer_name || null;
      }
    } else if (roleColumnCandidates.includes('underwriter')) {
      personName = loan.underwriter || loan.underwriterName || null;
      if (!personName && metadata && typeof metadata === 'object') {
        personName = metadata.underwriter_name || null;
      }
    } else if (roleColumnCandidates.includes('closer')) {
      personName = loan.closer || loan.closerName || null;
      if (!personName && metadata && typeof metadata === 'object') {
        personName = metadata.closer || metadata.closer_name || null;
      }
    } else if (roleColumnCandidates.includes('processor')) {
      personName = loan.processor || loan.processorName || null;
      if (!personName && metadata && typeof metadata === 'object') {
        personName = metadata.processor || metadata.processor_name || null;
      }
    }
    
    // Fallback to raw column names if prepared fields not found
    // Use actualRawDataKey if we found it earlier (most reliable)
    if (!personName && roleColumn) {
      // First try the actual raw_data key we found (most reliable for CSV imports)
      if (actualRawDataKey && rawData && typeof rawData === 'object') {
        personName = rawData[actualRawDataKey] || null;
      }
      
      // If still not found, try exact match with roleColumn
      if (!personName && rawData && typeof rawData === 'object') {
        personName = rawData[roleColumn] || null;
      }
      
      // If not found, try case-insensitive search in raw_data
      if (!personName && rawData && typeof rawData === 'object') {
        const lowerRoleColumn = roleColumn.toLowerCase();
        for (const key in rawData) {
          if (key.toLowerCase() === lowerRoleColumn) {
            personName = rawData[key];
            break;
          }
        }
      }
      
      // Last resort: check top-level loan object (for database columns)
      if (!personName) {
        personName = loan[roleColumn] || null;
      }
    }
    
    if (!personName || typeof personName !== 'string') {
      // Debug: log why person name extraction failed
      if (finalizedLoans.length > 0 && finalizedLoans.indexOf(loan) < 3) {
        logInfo('Person name extraction failed for finalized loan', {
          loanId: loan.loan_id || loan.loanId,
          roleColumn,
          actualRawDataKey,
          hasRawData: !!rawData,
          rawDataKeys: rawData && typeof rawData === 'object' ? Object.keys(rawData).slice(0, 10) : [],
          rawDataValue: actualRawDataKey && rawData && typeof rawData === 'object' ? rawData[actualRawDataKey] : null,
          hasMetadata: !!metadata,
          metadataKeys: metadata && typeof metadata === 'object' ? Object.keys(metadata).slice(0, 10) : []
        });
      }
      return;
    }

    // Normalize name (lowercase, trim)
    const normalizedName = personName.toLowerCase().trim();
    
    // Skip placeholder/missing names
    if (normalizedName.includes('99-missing') || normalizedName === '' || normalizedName === 'null') {
      return;
    }

    if (!personLoans[normalizedName]) {
      personLoans[normalizedName] = { total: 0, originated: 0 };
    }

    // Get status using same logic as ClosingFalloutForecast.tsx mapForecastStatus
    // Prefer current_loan_status from raw_data (matches finalized loan filter)
    let status = null;
    
    // Priority 0: Check direct database column (from optimized queries without raw_data)
    if (!status && loan.current_loan_status) {
      status = loan.current_loan_status;
    }
    
    // Priority 1: Check current_loan_status from raw_data (primary field, matches mapForecastStatus)
    if (!status && rawData && typeof rawData === 'object') {
      status = rawData['Current Loan Status'] || rawData.current_loan_status || 
               rawData['Loan Status'] || rawData.loan_status || null;
    }
    
    // Priority 2: Check Fields.1393 (LOS-specific field, matches mapForecastStatus)
    if (!status && rawData && typeof rawData === 'object') {
      status = rawData['Fields.1393'] || null;
    }
    
    // Priority 3: Check loan.status field
    if (!status) {
      status = loan.status;
    }
    
    // Priority 4: Check other status fields in raw_data
    if (!status && rawData && typeof rawData === 'object') {
      status = rawData.status || rawData.Status || rawData['Current Status'] || 
               rawData['current_status'] || null;
    }
    
    // Priority 5: Check metadata
    if (!status && metadata && typeof metadata === 'object') {
      status = metadata.status || null;
    }
    
    // Normalize status (same as normalizeRawStatus in ClosingFalloutForecast.tsx)
    const statusUpper = (status ?? '').toString().trim().toUpperCase();
    
    // Map status to forecast categories (matching mapForecastStatus logic)
    // Pullthrough = Count(Originated) / Count(Originated + Denied + Withdrawn)
    // Only count loans that are Originated, Denied, or Withdrawn
    
    let isOriginated = false;
    let isFinalized = false; // Is this loan in the finalized set (Originated, Denied, or Withdrawn)?
    
    // Check for Originated - multiple variations
    // Full status: 'LOAN ORIGINATED', Short: 'ORIGINATED', 'FUNDED', 'CLOSED', 'PURCHASED'
    if (statusUpper === 'LOAN ORIGINATED' || 
        statusUpper === 'ORIGINATED' ||
        statusUpper === 'FUNDED' ||
        statusUpper === 'CLOSED' ||
        statusUpper === 'PURCHASED' ||
        statusUpper.includes('ORIGINATED') ||
        statusUpper.includes('PURCHASED')) {
      isOriginated = true;
      isFinalized = true;
    }
    // Also check funding_date as backup indicator of originated (loan was funded)
    else if (loan.funding_date || loan.fund_date) {
      isOriginated = true;
      isFinalized = true;
    }
    // Check for Denied - multiple variations
    else if (statusUpper === 'APPLICATION DENIED' || 
             statusUpper === 'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION' ||
             statusUpper === 'DENIED' ||
             statusUpper.includes('DENIED')) {
      isFinalized = true;
    }
    // Check for Withdrawn - multiple variations
    else if (statusUpper === 'APPLICATION WITHDRAWN' ||
             statusUpper === 'APPLICATION APPROVED BUT NOT ACCEPTED' ||
             statusUpper === 'FILE CLOSED FOR INCOMPLETENESS' ||
             statusUpper === 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED' ||
             statusUpper === 'WITHDRAWN' ||
             statusUpper.includes('WITHDRAWN') ||
             statusUpper.includes('CANCELLED') ||
             statusUpper.includes('CANCELED')) {
      isFinalized = true;
    }
    // Exclude Active Loan and other statuses (don't count in total)
    // Note: We already filtered out Active Loan in finalizedLoans filter, but double-check here
    else if (statusUpper === 'ACTIVE LOAN' || statusUpper === 'ACTIVE' || statusUpper === 'INQUIRY') {
      // Should not reach here if finalizedLoans filter is working, but skip just in case
      return;
    }
    // For loans with recognized non-active status but not in above categories,
    // count as finalized (in the denominator) but not originated
    else if (statusUpper && statusUpper !== '') {
      // Any other non-empty status = finalized but not originated
      isFinalized = true;
    }
    // For any other status (empty), don't count it (exclude from calculation)
    
    // Only count loans that are in the finalized set (Originated, Denied, or Withdrawn)
    if (isFinalized) {
      personLoans[normalizedName].total++;
      if (isOriginated) {
        personLoans[normalizedName].originated++;
      }
    }
  });

  // Debug: Check status distribution in finalized loans to understand why pullthrough might be 0
  const statusDistribution: Record<string, number> = {};
  const sampleStatuses: Array<{loanId: string, status: string, currentLoanStatus: string | null, isOriginated: boolean, forecastCategory: string}> = [];
  
  // Count all statuses across all finalized loans (single pass)
  finalizedLoans.forEach((loan, index) => {
    let rawData = loan.raw_data;
    if (rawData && typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        rawData = null;
      }
    }
    
    // Use same status extraction logic as in the pullthrough calculation (matches mapForecastStatus)
    let status = null;
    
    // Priority 1: Check current_loan_status from raw_data (primary field, matches mapForecastStatus)
    if (rawData && typeof rawData === 'object') {
      status = rawData['Current Loan Status'] || rawData.current_loan_status || 
               rawData['Loan Status'] || rawData.loan_status || null;
    }
    
    // Priority 2: Check Fields.1393 (LOS-specific field, matches mapForecastStatus)
    if (!status && rawData && typeof rawData === 'object') {
      status = rawData['Fields.1393'] || null;
    }
    
    // Priority 3: Check loan.status field
    if (!status) {
      status = loan.status;
    }
    
    // Priority 4: Check other status fields in raw_data
    if (!status && rawData && typeof rawData === 'object') {
      status = rawData.status || rawData.Status || rawData['Current Status'] || 
               rawData['current_status'] || null;
    }
    
    // Normalize status (same as normalizeRawStatus in ClosingFalloutForecast.tsx)
    const statusUpper = (status ?? 'UNKNOWN').toString().trim().toUpperCase();
    statusDistribution[statusUpper] = (statusDistribution[statusUpper] || 0) + 1;
    
    // Collect sample statuses for first 5 loans
    if (index < 5) {
      const currentLoanStatus = rawData && typeof rawData === 'object' ? 
        (rawData['Current Loan Status'] || rawData.current_loan_status || 
         rawData['Loan Status'] || rawData.loan_status) : null;
      // Check if originated using same logic as pullthrough calculation
      const isOriginated = statusUpper === 'LOAN ORIGINATED';
      const isDenied = statusUpper === 'APPLICATION DENIED' || 
                      statusUpper === 'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION';
      const isWithdrawn = statusUpper === 'APPLICATION WITHDRAWN' ||
                         statusUpper === 'APPLICATION APPROVED BUT NOT ACCEPTED' ||
                         statusUpper === 'FILE CLOSED FOR INCOMPLETENESS' ||
                         statusUpper === 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED';
      const forecastCategory = isOriginated ? 'Originated' : 
                               isDenied ? 'Denied' : 
                               isWithdrawn ? 'Withdrawn' : 'Other';
      
      sampleStatuses.push({
        loanId: loan.loan_id || loan.loanId || 'unknown',
        status: loan.status || 'null',
        currentLoanStatus: currentLoanStatus || null,
        isOriginated,
        forecastCategory
      });
    }
  });

  // Calculate pullthrough percentage for each person
  Object.keys(personLoans).forEach(name => {
    const { total, originated } = personLoans[name];
    if (total > 0) {
      pullthroughMap[name] = (originated / total) * 100;
    }
  });

  // Debug: log pullthrough calculation results with status distribution
  if (Object.keys(pullthroughMap).length > 0) {
    const sampleNames = Object.keys(pullthroughMap).slice(0, 5);
    const sampleValues = sampleNames.map(name => ({ 
      name, 
      pullthrough: pullthroughMap[name],
      total: personLoans[name].total,
      originated: personLoans[name].originated
    }));
    logInfo('Pullthrough calculation completed with results', {
      roleColumn,
      actualRawDataKey,
      totalFinalizedLoans: finalizedLoans.length,
      uniquePersons: Object.keys(personLoans).length,
      pullthroughMapSize: Object.keys(pullthroughMap).length,
      sampleValues,
      statusDistribution,
      sampleStatuses,
      note: 'Pullthrough = (Originated / Total Finalized) × 100. Check statusDistribution to see if "ORIGINATED" status is being found.'
    });
  } else if (finalizedLoans.length > 0) {
    logInfo('Pullthrough calculation found finalized loans but no person names', {
      roleColumn,
      actualRawDataKey,
      finalizedLoansCount: finalizedLoans.length,
      personLoansCount: Object.keys(personLoans).length,
      statusDistribution,
      sampleStatuses
    });
  }

  return pullthroughMap;
}

/**
 * Bucket a numeric value into 1-6 scale based on ranges
 */
function bucketNumeric(value: number | null, ranges: Array<{ min: number | null; max: number | null; bucket: number }>): number | null {
  if (value === null || value === undefined || isNaN(value)) return null;
  
  for (const range of ranges) {
    const min = range.min === null ? -Infinity : range.min;
    const max = range.max === null ? Infinity : range.max;
    if (value >= min && (range.max === null || value <= max)) {
      return range.bucket;
    }
  }
  return null;
}

/**
 * Bucket categorical value
 */
function bucketCategorical(value: string | null, mapping: Record<string, number>): number | null {
  if (!value) return null;
  const normalized = value.toString().trim();
  return mapping[normalized] || mapping[normalized.toLowerCase()] || null;
}

/**
 * Bucket loan data into signal strength buckets
 * Based on BUCKET_REFERENCE.md, MARKET_DELTA_CALCULATION.md, and PULLTHROUGH_CALCULATION.md
 * 
 * Processing Flow:
 * 1. Calculate market delta (needs market rate data - PLACEHOLDER)
 * 2. Calculate pullthrough rates for LO, UW, Closer, Processor (from allLoans)
 * 3. Bucket individual features (FICO, LTV, DTI, Loan Amount, Loan Type, etc.)
 * 4. Bucket individual pullthrough signals (LO, UW, Closer, Processor)
 * 5. Calculate composite signals (Credit Metrics, Loan Characteristics)
 * 6. Calculate Time in Motion, MLO AE Fallout Prone, Interest Lock vs Market signals
 * 7. Generate reason codes for each signal category
 * 
 * Output Structure (matches screenshot):
 * - Individual signal buckets (1-6 scale)
 * - Calculated Signal Strength (composite signals)
 * - Reason Codes (explaining each signal strength)
 * 
 * TODO/PLACEHOLDERS:
 * - Market rate data loading (MARKET_RATES array)
 * - CLTV calculation (if available in loan data)
 * - Lender Credit Amount (if available in loan data)
 * - Commission fields (Commission Assumption, Commission at Risk, Commission Personalization Override)
 * - Milestone data for Time in Motion (currently using timeToApproval as proxy)
 * - Current market rate lookup
 * 
 * BUCKET DIRECTION VERIFICATION (1 = less fallout prone, 6 = more fallout prone):
 * ✅ FICO: Bucket 1 (≥770) = excellent credit (less denial, but withdrawal risk - dual nature)
 * ✅ LTV: Bucket 1 (≤60%) = low LTV (less fallout prone), Bucket 6 (>90%) = high LTV (more fallout prone)
 * ✅ DTI: Bucket 1 (≤30%) = low DTI (less fallout prone), Bucket 6 (>56%) = high DTI (more fallout prone)
 * ✅ Loan Amount: Bucket 1 (<$200K) = small (less fallout prone), Bucket 6 (≥$900K) = large (more fallout prone)
 * ✅ Loan Type: Bucket 1 (Conventional) = simple (less fallout prone), Bucket 6 (Other/Construction) = complex (more fallout prone)
 * ✅ Loan Purpose: Bucket 1 (Refi No CO) = simple (less fallout prone), Bucket 4 (C to P) = complex (more fallout prone)
 * ✅ Occupancy: Bucket 1 (PrimaryResidence) = less fallout prone, Bucket 3 (Investor) = more fallout prone
 * ✅ Channel: Bucket 1 (Banked - Retail) = less fallout prone, Bucket 4 (Other) = more fallout prone
 * ✅ Time to Approval: Bucket 1 (0-25 days) = fresh (less fallout prone), Bucket 6 (>150 days) = old (more fallout prone)
 * ✅ LO Pullthrough: Bucket 1 (≥85%) = high pullthrough (less fallout prone), Bucket 6 (<50%) = low pullthrough (more fallout prone)
 * ✅ UW/Closer/Processor Pullthrough: Same as LO (high = 1, low = 6)
 * ✅ Market Delta: Bucket 1 (≤-0.3) = favorable rates (less fallout prone), Bucket 6 (>+0.5) = unfavorable (more fallout prone)
 * ✅ Credit Signal: Composite (lower = less fallout prone, higher = more fallout prone)
 * ✅ Loan Characteristics Signal: Composite (lower = simple/less fallout prone, higher = complex/more fallout prone)
 * ✅ MLO AE Fallout Prone: Uses LO Pullthrough directly (high pullthrough = 1, low = 6)
 * ✅ Interest Lock vs Market: Uses Market Delta directly (favorable = 1, unfavorable = 6)
 */
/** Optional: label for progress logs so we can tell "active" vs "historical" bucketing. */
export async function bucketLoanData(
  loans: any[],
  allLoans: any[] = [],
  options?: { logContext?: string }
): Promise<any[]> {
  const logContext = options?.logContext || 'loans';
  // Step 1: Calculate pullthrough rates for all roles (needs all loans)
  // Use exact column names from tenant schema (tenantDatabaseSchema.ts)
  const loPullthrough = calculatePullthroughForRole(allLoans, ['loan_officer']);
  
  // Debug logging for pullthrough calculation
  logInfo('LO Pullthrough calculation completed', {
    totalLoans: allLoans.length,
    pullthroughMapSize: Object.keys(loPullthrough).length,
    samplePullthroughValues: Object.entries(loPullthrough).slice(0, 5).map(([name, pct]) => ({ name, pct }))
  });
  const uwPullthrough = calculatePullthroughForRole(allLoans, ['underwriter']);
  const closerPullthrough = calculatePullthroughForRole(allLoans, ['closer']);
  const processorPullthrough = calculatePullthroughForRole(allLoans, ['processor']);

  // Process loans in batches to avoid connection pool exhaustion
  // Even with market rate cache, processing 7,000+ loans in parallel overwhelms the pool
  // Smaller batches ensure connections are released between batches
  const BUCKETING_BATCH_SIZE = 200; // Process 200 loans at a time (reduced from 500 to prevent pool exhaustion)
  const bucketedLoans: any[] = [];
  let missingFieldsLogCount = 0;

  for (let i = 0; i < loans.length; i += BUCKETING_BATCH_SIZE) {
    const batch = loans.slice(i, i + BUCKETING_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (loan) => {
    // Note: loan is already prepared (camelCase) with all fields extracted

    // Step 2: Calculate market delta (now async - queries database)
    // Pass all necessary fields including interestRate, loanId, and raw_data for status/date extraction
    const marketDelta = await calculateMarketDelta({
      lockDate: loan.lockDate,
      applicationDate: loan.applicationDate,
      closingDate: loan.closingDate,
      interestRate: loan.interestRate,
      interest_rate: loan.interestRate, // Also pass as snake_case for compatibility
      status: loan.status,
      loanId: loan.loanId,
      loan_id: loan.loanId,
      raw_data: loan.raw_data // Pass raw_data so calculateMarketDelta can extract Current Status Date
    });

    // Step 3: Get person names for pullthrough lookup (now using prepared fields)
    const loName = (loan.loanOfficerName || '').toLowerCase().trim();
    const uwName = (loan.underwriterName || '').toLowerCase().trim();
    const closerName = (loan.closerName || '').toLowerCase().trim();
    const processorName = (loan.processorName || '').toLowerCase().trim();

    // Step 4: Bucket individual features (use prepared loan fields)
    // NOTE: All buckets follow 1 = less fallout prone, 6 = more fallout prone
    const ficoScore = loan.ficoScore;
    // FICO: Bucket 1 (≥770) = excellent credit = less denial risk but more withdrawal risk (strong borrowers shop)
    //       Bucket 6 (<620) = poor credit = more denial risk but less withdrawal risk
    //       Dual nature: High FICO = withdrawal risk, Low FICO = denial risk (both are fallout types)
    const ficoBucket = bucketNumeric(ficoScore, [
      { min: 770, max: null, bucket: 1 }, // Excellent credit (less denial, but withdrawal risk)
      { min: 730, max: 769, bucket: 2 }, // Very good credit
      { min: 700, max: 729, bucket: 3 }, // Good credit
      { min: 660, max: 699, bucket: 4 }, // Fair credit
      { min: 620, max: 659, bucket: 5 }, // Poor credit (more denial risk)
      { min: null, max: 619, bucket: 6 } // Very poor credit (most denial risk)
    ]);

    const ltv = loan.ltv;
    // LTV: Lower LTV = less fallout prone (1), Higher LTV = more fallout prone (6)
    const ltvBucket = bucketNumeric(ltv, [
      { min: null, max: 60, bucket: 1 }, // Very low LTV (less fallout prone)
      { min: 61, max: 70, bucket: 2 }, // Low LTV
      { min: 71, max: 80, bucket: 3 }, // Moderate LTV
      { min: 81, max: 85, bucket: 4 }, // Elevated LTV
      { min: 86, max: 90, bucket: 5 }, // High LTV
      { min: 91, max: null, bucket: 6 } // Very high LTV (more fallout prone)
    ]);

    const dti = loan.dti;
    
    // Debug logging for DTI extraction
    if (dti === null || dti === undefined) {
      const rawData = typeof loan.raw_data === 'string' 
        ? JSON.parse(loan.raw_data) 
        : (loan.raw_data || {});
      logInfo('DTI is null/undefined for loan', {
        loanId: loan.loanId,
        hasRawData: !!rawData,
        rawDataKeys: rawData ? Object.keys(rawData) : [],
        metadataDti: loan.metadata?.dti,
        metadataDtiRatio: loan.metadata?.dti_ratio,
        rawDataDti: rawData.dti,
        rawDataDtiRatio: rawData.dti_ratio,
        rawDataBeDtiRatio: rawData['BE DTI Ratio'],
        // Check all possible DTI field name variations
        allDtiFields: rawData ? Object.keys(rawData).filter(k => k.toLowerCase().includes('dti')) : []
      });
    }
    
    // DTI: Lower DTI = less fallout prone (1), Higher DTI = more fallout prone (6)
    const dtiBucket = bucketNumeric(dti, [
      { min: null, max: 30, bucket: 1 }, // Very low DTI (less fallout prone)
      { min: 31, max: 36, bucket: 2 }, // Low DTI
      { min: 37, max: 43, bucket: 3 }, // Moderate DTI
      { min: 44, max: 49, bucket: 4 }, // Elevated DTI
      { min: 50, max: 56, bucket: 5 }, // High DTI
      { min: 57, max: null, bucket: 6 } // Very high DTI (more fallout prone)
    ]);

    const loanAmount = loan.loanAmount || 0;
    // Loan Amount: Smaller amount = less fallout prone (1), Larger amount = more fallout prone (6)
    const loanAmountBucket = bucketNumeric(loanAmount, [
      { min: null, max: 199999, bucket: 1 }, // Lowest amount (less fallout prone)
      { min: 200000, max: 299999, bucket: 2 }, // Low amount
      { min: 300000, max: 399999, bucket: 3 }, // Medium amount
      { min: 400000, max: 599999, bucket: 4 }, // Elevated amount
      { min: 600000, max: 899999, bucket: 5 }, // High amount
      { min: 900000, max: null, bucket: 6 } // Very high amount (more fallout prone)
    ]);

    const loanType = loan.loanType || '';
    // Loan Type: Simple/standard types = less fallout prone (1), Complex types = more fallout prone (6)
    const loanTypeBucket = bucketCategorical(loanType, {
      'Conventional': 1, // Standard (less fallout prone)
      'VA': 2, // Veterans Affairs
      'HELOC': 3, // Home Equity Line
      'Rural': 4, // Rural development
      'FHA': 5, // Federal Housing Administration
      'FarmersHomeAdministrative': 5, // FHA variant
      'Other': 6, // Other types (more fallout prone)
      'Construction': 6 // Construction (more fallout prone)
    });

    const loanPurpose = loan.loanPurpose || '';
    // Loan Purpose: Simple purposes = less fallout prone (1), Complex purposes = more fallout prone (4)
    const loanPurposeBucket = bucketCategorical(loanPurpose, {
      'Refi No CO': 1, // Refinance no cash-out (less fallout prone)
      'Refi CO': 2, // Refinance with cash-out
      'Purchase': 3, // Home purchase
      'C to P': 4 // Construction to permanent (more fallout prone)
    });

    // Occupancy: Primary residence = less fallout prone (1), Investment = more fallout prone (3)
    const occupancyBucket = bucketCategorical(loan.occupancyType, {
      'PrimaryResidence': 1, // Primary residence (less fallout prone)
      'SecondHome': 2, // Second home
      'Investor': 3 // Investment property (more fallout prone)
    });

    // Channel: Retail = less fallout prone (1), Other channels = more fallout prone (4)
    const channelBucket = bucketCategorical(loan.channel, {
      'Banked - Retail': 1, // Retail banking (less fallout prone)
      'Banked - Wholesale': 2, // Wholesale banking
      'Brokered': 3, // Brokered loans
      'Other': 4 // Other channels (more fallout prone)
    });

    // Time to Approval (Application Date → Current Status Date)
    // For active loans, use today; for closed loans, use closing date
    const applicationDate = loan.applicationDate;
    const isActive = !loan.closingDate && loan.status !== 'Closed' && loan.status !== 'Originated' && loan.status !== 'Funded';
    const currentStatusDate = isActive ? new Date() : (loan.closingDate || new Date());
    const timeToApprovalDays = applicationDate 
      ? Math.floor((new Date(currentStatusDate).getTime() - new Date(applicationDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    // Time to Approval: Fresh loans = less fallout prone (1), Old loans = more fallout prone (6)
    const timeToApprovalBucket = bucketNumeric(timeToApprovalDays, [
      { min: null, max: 25, bucket: 1 }, // Very fresh (less fallout prone)
      { min: 26, max: 40, bucket: 2 }, // Fresh
      { min: 41, max: 60, bucket: 3 }, // Normal
      { min: 61, max: 90, bucket: 4 }, // Aging
      { min: 91, max: 150, bucket: 5 }, // Old
      { min: 151, max: null, bucket: 6 } // Very old (more fallout prone)
    ]);

    // LO Pullthrough: High pullthrough = less fallout prone (1), Low pullthrough = more fallout prone (6)
    const loNameLower = loName ? loName.toLowerCase().trim() : null;
    // Try pullthrough map first (calculated from historical loans), fallback to loan's existing loPullthroughPercentage if available
    // Also check snake_case variant (lo_pullthrough_percentage) for database compatibility
    // IMPORTANT: Check multiple possible field names and formats to ensure we find the percentage
    // Try multiple name variations to match the pullthrough map (which uses normalized names)
    let loPullthroughPct = null;
    if (loNameLower) {
      loPullthroughPct = loPullthrough[loNameLower] ?? null;
      // If not found, try raw loan_officer field (in case prepareLoanData extracted it differently)
      if (!loPullthroughPct && loan.loan_officer) {
        const rawLoNameLower = String(loan.loan_officer).toLowerCase().trim();
        loPullthroughPct = loPullthrough[rawLoNameLower] ?? null;
      }
      // Also try loanOfficerName directly (in case it's set differently)
      if (!loPullthroughPct && loan.loanOfficerName && loan.loanOfficerName !== loName) {
        const altLoNameLower = String(loan.loanOfficerName).toLowerCase().trim();
        loPullthroughPct = loPullthrough[altLoNameLower] ?? null;
      }
    }
    // Normalize percentage value: handle both number and string types, ensure it's a valid number
    // Check multiple possible field name variations (camelCase, snake_case, and any nested paths)
    const loPullthroughPctRaw = loPullthroughPct ?? 
                                loan.loPullthroughPercentage ?? 
                                (loan as any).lo_pullthrough_percentage ??
                                (loan as any).loPullthroughPct ??
                                (loan as any).lo_pullthrough_pct ??
                                null;
    // Convert to number if it's a string, handle null/undefined
    const loPullthroughPctFinal = loPullthroughPctRaw != null 
      ? (typeof loPullthroughPctRaw === 'string' ? parseFloat(loPullthroughPctRaw) : Number(loPullthroughPctRaw))
      : null;
    // Ensure it's a valid number (not NaN)
    const loPullthroughPctValid = (loPullthroughPctFinal != null && !isNaN(loPullthroughPctFinal)) ? loPullthroughPctFinal : null;
    
    // Debug logging: Log when we have a percentage but bucket is still null (for troubleshooting)
    if (loPullthroughPctValid != null && loPullthroughPctValid > 0 && loPullthroughPctValid <= 100) {
      const testBucket = bucketNumeric(loPullthroughPctValid, [
        { min: 85, max: null, bucket: 1 },
        { min: 78, max: 84.999, bucket: 2 },
        { min: 70, max: 77.999, bucket: 3 },
        { min: 60, max: 69.999, bucket: 4 },
        { min: 50, max: 59.999, bucket: 5 },
        { min: null, max: 49.999, bucket: 6 }
      ]);
      if (testBucket == null) {
        logInfo('[PredictDebug] LO Pullthrough bucket calculation returned null despite valid percentage', {
          loanId: loan.loanId,
          loName: loName,
          loPullthroughPctValid,
          loPullthroughPctRaw,
          loPullthroughPct,
          loanHasLoPullthroughPercentage: !!loan.loPullthroughPercentage,
          loanHasLoPullthroughPercentageSnake: !!(loan as any).lo_pullthrough_percentage
        });
      }
    }
    
    // Calculate bucket from final percentage value (includes fallback)
    // IMPORTANT: Always calculate bucket if percentage exists, even if it's from fallback
    // Note: Ranges must cover all possible values without gaps. Using 84.999 to ensure 84.78 matches bucket 2, etc.
    const loPullthroughBucket = bucketNumeric(loPullthroughPctValid, [
      { min: 85, max: null, bucket: 1 }, // Excellent pullthrough (less fallout prone) - 85%+
      { min: 78, max: 84.999, bucket: 2 }, // Good pullthrough - 78-84.999%
      { min: 70, max: 77.999, bucket: 3 }, // Average pullthrough - 70-77.999%
      { min: 60, max: 69.999, bucket: 4 }, // Below average - 60-69.999%
      { min: 50, max: 59.999, bucket: 5 }, // Poor pullthrough - 50-59.999%
      { min: null, max: 49.999, bucket: 6 } // Very poor pullthrough (more fallout prone) - <50%
    ]);

    // Market Change Delta: Negative (favorable) = less fallout prone (1), Positive (unfavorable) = more fallout prone (6)
    // Negative delta = rates went UP since lock (borrower saved, motivated to close)
    // Positive delta = rates went DOWN since lock (better rates available, withdrawal risk)
    const marketDeltaBucket = bucketNumeric(marketDelta.marketChangeDelta, [
      { min: null, max: -0.3, bucket: 1 }, // Very favorable (rates up ≥0.3%, less fallout prone)
      { min: -0.299, max: -0.1, bucket: 2 }, // Favorable (rates up 0.1-0.3%) - Fixed: -0.299 to cover gap
      { min: -0.099, max: 0.05, bucket: 3 }, // Neutral (minimal change) - Fixed: -0.099 to cover gap
      { min: 0.051, max: 0.2, bucket: 4 }, // Slightly unfavorable (rates down 0.06-0.2%) - Fixed: 0.051 to cover gap
      { min: 0.201, max: 0.5, bucket: 5 }, // Unfavorable (rates down 0.21-0.5%) - Fixed: 0.201 to cover gap
      { min: 0.501, max: null, bucket: 6 } // Very unfavorable (rates down >0.5%, more fallout prone) - Fixed: 0.501 to cover gap
    ]);

    // Step 5: Calculate composite signals
    // Credit Signal = Average of (FICO + LTV + DTI), rounded
    // Lower value (1-2) = less fallout prone, Higher value (5-6) = more fallout prone
    const creditSignalComponents = [ficoBucket, ltvBucket, dtiBucket].filter(b => b !== null) as number[];
    const creditSignal = creditSignalComponents.length > 0
      ? Math.round(creditSignalComponents.reduce((sum, b) => sum + b, 0) / creditSignalComponents.length)
      : null;

    // Loan Characteristics Signal = Average of (Loan Type + Loan Purpose + Channel + Occupancy), rounded
    // Lower value (1-2) = simple loan (less fallout prone), Higher value (4-6) = complex loan (more fallout prone)
    const loanCharComponents = [loanTypeBucket, loanPurposeBucket, channelBucket, occupancyBucket].filter(b => b !== null) as number[];
    const loanCharacteristicsSignal = loanCharComponents.length > 0
      ? Math.round(loanCharComponents.reduce((sum, b) => sum + b, 0) / loanCharComponents.length)
      : null;

    // Individual pullthrough signals (UW, Closer, Processor) - separate buckets instead of composite Operations Signal
    // High pullthrough = less fallout prone (1), Low pullthrough = more fallout prone (6)
    const uwPct = uwName ? uwPullthrough[uwName] : null;
    const uwPullthroughBucket = bucketNumeric(uwPct, [
      { min: 85, max: null, bucket: 1 }, // Excellent pullthrough (less fallout prone) - 85%+
      { min: 78, max: 84.999, bucket: 2 }, // Good pullthrough - 78-84.999%
      { min: 70, max: 77.999, bucket: 3 }, // Average pullthrough - 70-77.999%
      { min: 60, max: 69.999, bucket: 4 }, // Below average - 60-69.999%
      { min: 50, max: 59.999, bucket: 5 }, // Poor pullthrough - 50-59.999%
      { min: null, max: 49.999, bucket: 6 } // Very poor pullthrough (more fallout prone) - <50%
    ]);

    const closerPct = closerName ? closerPullthrough[closerName] : null;
    const closerPullthroughBucket = bucketNumeric(closerPct, [
      { min: 85, max: null, bucket: 1 }, // Excellent pullthrough (less fallout prone) - 85%+
      { min: 78, max: 84.999, bucket: 2 }, // Good pullthrough - 78-84.999%
      { min: 70, max: 77.999, bucket: 3 }, // Average pullthrough - 70-77.999%
      { min: 60, max: 69.999, bucket: 4 }, // Below average - 60-69.999%
      { min: 50, max: 59.999, bucket: 5 }, // Poor pullthrough - 50-59.999%
      { min: null, max: 49.999, bucket: 6 } // Very poor pullthrough (more fallout prone) - <50%
    ]);

    const processorPct = processorName ? processorPullthrough[processorName] : null;
    const processorPullthroughBucket = bucketNumeric(processorPct, [
      { min: 85, max: null, bucket: 1 }, // Excellent pullthrough (less fallout prone) - 85%+
      { min: 78, max: 84.999, bucket: 2 }, // Good pullthrough - 78-84.999%
      { min: 70, max: 77.999, bucket: 3 }, // Average pullthrough - 70-77.999%
      { min: 60, max: 69.999, bucket: 4 }, // Below average - 60-69.999%
      { min: 50, max: 59.999, bucket: 5 }, // Poor pullthrough - 50-59.999%
      { min: null, max: 49.999, bucket: 6 } // Very poor pullthrough (more fallout prone) - <50%
    ]);

    // Time in Motion Signal - Active Days only (no milestones)
    // Non-active: has closing date, funding date, or status closed/originated/funded/withdrawn/denied
    //   -> Use first available of: funding_date, closing_date, uw_denied_date, uw_suspended_date, last_modified_date
    // Active: use today's date
    // Buckets: 1-10 days=1, 11-20=2, 21-30=3, 31-45=4, 46-60=5, >60=6
    const statusStr = String(loan.status || '').toLowerCase().trim();
    const isNonActive = !!(
      loan.closingDate || loan.closing_date ||
      loan.fundDate || loan.fund_date ||
      ['closed', 'originated', 'funded', 'withdrawn', 'denied'].includes(statusStr)
    );
    const endDateForTim = isNonActive
      ? (() => {
          const dates = [
            loan.fundDate || loan.fund_date,
            loan.closingDate || loan.closing_date,
            loan.uwDeniedDate || (loan as any).uw_denied_date,
            loan.uwSuspendedDate || (loan as any).uw_suspended_date,
            loan.lastModifiedDate || (loan as any).last_modified_date,
          ].filter(Boolean);
          const first = dates.find(d => d != null);
          return first ? new Date(first) : null;
        })()
      : new Date();
    const activeDays = (loan.applicationDate && endDateForTim)
      ? Math.floor((new Date(endDateForTim).getTime() - new Date(loan.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const timeInMotionBucket = bucketNumeric(activeDays, [
      { min: null, max: 10, bucket: 1 },  // 1-10 days
      { min: 11, max: 20, bucket: 2 },   // 11-20 days
      { min: 21, max: 30, bucket: 3 },   // 21-30 days
      { min: 31, max: 45, bucket: 4 },   // 31-45 days
      { min: 46, max: 74, bucket: 5 },   // 46-74 days
      { min: 75, max: null, bucket: 6 }, // 75+ days
    ]);
    const timeInMotionSignal = timeInMotionBucket;

    // ----- COMMENTED OUT: Previous milestone-based Time in Motion implementation -----
    // Uncomment to revert to milestone + active days logic
    /*
    const isActiveLoanForTim = !loan.closingDate && !loan.fundDate && loan.status !== 'Closed' && loan.status !== 'Originated' && loan.status !== 'Funded';
    const endDateForTim = isActiveLoanForTim ? new Date() : (loan.closingDate || loan.fundDate || loan.closing_date || loan.fund_date || null);
    const activeDays = (loan.applicationDate && endDateForTim)
      ? Math.floor((new Date(endDateForTim).getTime() - new Date(loan.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const milestoneMap: Record<string, number> = {
      'Started': 1, 'PreApproval': 2, 'Pre-Approval': 2, 'Disclosure Prep': 3, 'DisclosurePrep': 3,
      'Signed': 4, 'Scrubbed': 5, 'Processing': 6, 'Submittal': 7, 'Cond. Approval': 8, 'Cond Approval': 8,
      'Conditional Approval': 8, 'Resubmittal': 9, 'Resubmit': 9, 'Approval': 10, 'Ready for Docs': 11,
      'ReadyForDocs': 11, 'Doc Preparation': 12, 'DocPreparation': 12, 'Closer Assignment': 13,
      'CloserAssignment': 13, 'Docs Out': 14, 'DocsOut': 14, 'Appt Set': 15, 'ApptSet': 15,
      'Appt Reset': 16, 'ApptReset': 16, 'Docs Signing': 17, 'Doc Signing': 17, 'DocsSigning': 17,
      'DocSigning': 17, 'Funding': 18
    };
    const lastCompletedMilestone = loan.lastCompletedMilestone || '';
    const milestoneNumber = milestoneMap[lastCompletedMilestone] || milestoneMap[lastCompletedMilestone.trim()] ||
      (() => { const m = lastCompletedMilestone.toLowerCase().trim(); for (const [k, v] of Object.entries(milestoneMap)) { if (k.toLowerCase() === m) return v; } return null; })();
    let timeInMotionBucket: number | null = null;
    if (milestoneNumber !== null && activeDays !== null) {
      if ([14, 17, 18].includes(milestoneNumber)) timeInMotionBucket = 1;
      else if ([10, 11].includes(milestoneNumber) && activeDays <= 7) timeInMotionBucket = 2;
      else if ([8, 9].includes(milestoneNumber) && activeDays <= 10) timeInMotionBucket = 3;
      else if ([5, 6, 7].includes(milestoneNumber) && activeDays > 10) timeInMotionBucket = 4;
      else if ([1, 2, 3, 4].includes(milestoneNumber) && activeDays > 5) timeInMotionBucket = 5;
      else if ([1, 2, 3, 4, 5, 6, 7, 8, 9].includes(milestoneNumber) && activeDays > 15) timeInMotionBucket = 6;
      else { if (activeDays <= 7) timeInMotionBucket = 2; else if (activeDays <= 10) timeInMotionBucket = 3; else if (activeDays <= 15) timeInMotionBucket = 4; else timeInMotionBucket = 5; }
    } else if (activeDays !== null) {
      if (activeDays <= 7) timeInMotionBucket = 2; else if (activeDays <= 10) timeInMotionBucket = 3;
      else if (activeDays <= 15) timeInMotionBucket = 4; else if (activeDays <= 30) timeInMotionBucket = 5; else timeInMotionBucket = 6;
    }
    const timeInMotionSignal = timeInMotionBucket;
    */

    // MLO AE Fallout Prone Signal (uses LO Pullthrough)
    // High pullthrough = less fallout prone (1), Low pullthrough = more fallout prone (6)
    // Uses LO Pullthrough bucket directly (already follows 1=good, 6=bad pattern)
    const mloAeFalloutProneSignal = loPullthroughBucket;

    // Interest Lock vs Market Signal (uses Market Delta)
    // Lower value (1-2) = favorable rates (less fallout prone), Higher value (5-6) = unfavorable rates (more fallout prone)
    const interestLockVsMarketSignal = marketDeltaBucket;

    // PLACEHOLDER: Commission fields
    // TODO: Implement commission calculation logic
    const commissionAtRisk = null; // PLACEHOLDER: Commission Assumption * Loan Amount
    const commissionPersonalizationOverride = null; // PLACEHOLDER: Raw value

    // Step 6: Generate reason codes for each signal category
    const generateReasonCodes = (signal: number | null, category: string): string[] => {
      if (signal === null) return [];
      const reasons: string[] = [];
      
      if (category === 'Credit Metrics') {
        if (ficoBucket && ficoBucket >= 5) reasons.push(`FICO ${ficoScore || 'N/A'} (Bucket ${ficoBucket})`);
        if (ltvBucket && ltvBucket >= 5) reasons.push(`LTV ${ltv || 'N/A'}% (Bucket ${ltvBucket})`);
        if (dtiBucket && dtiBucket >= 5) reasons.push(`DTI ${dti || 'N/A'}% (Bucket ${dtiBucket})`);
      } else if (category === 'Loan Characteristics') {
        if (loanTypeBucket && loanTypeBucket >= 4) reasons.push(`Loan Type: ${loan.loanType || 'N/A'} (Bucket ${loanTypeBucket})`);
        if (loanPurposeBucket && loanPurposeBucket >= 3) reasons.push(`Purpose: ${loan.loanPurpose || 'N/A'} (Bucket ${loanPurposeBucket})`);
        if (channelBucket && channelBucket >= 3) reasons.push(`Channel: ${loan.channel || 'N/A'} (Bucket ${channelBucket})`);
      } else if (category === 'Time in Motion') {
        if (timeInMotionBucket && timeInMotionBucket >= 4) {
          reasons.push(`Active ${activeDays ?? 'N/A'} days (Bucket ${timeInMotionBucket})`);
        }
      } else if (category === 'MLO AE Fallout Prone') {
        if (loPullthroughBucket && loPullthroughBucket >= 4) {
          reasons.push(`LO Pullthrough ${loPullthroughPct?.toFixed(1) || 'N/A'}% (Bucket ${loPullthroughBucket})`);
        }
      } else if (category === 'Interest Lock vs Market') {
        if (marketDeltaBucket && marketDeltaBucket >= 4) {
          reasons.push(`Market Delta ${marketDelta.marketChangeDelta?.toFixed(3) || 'N/A'}% (Bucket ${marketDeltaBucket})`);
        }
      } else if (category === 'UW Pullthrough') {
        if (uwPullthroughBucket && uwPullthroughBucket >= 4) {
          reasons.push(`UW Pullthrough ${uwPct?.toFixed(1) || 'N/A'}% (Bucket ${uwPullthroughBucket})`);
        }
      } else if (category === 'Closer Pullthrough') {
        if (closerPullthroughBucket && closerPullthroughBucket >= 4) {
          reasons.push(`Closer Pullthrough ${closerPct?.toFixed(1) || 'N/A'}% (Bucket ${closerPullthroughBucket})`);
        }
      } else if (category === 'Processor Pullthrough') {
        if (processorPullthroughBucket && processorPullthroughBucket >= 4) {
          reasons.push(`Processor Pullthrough ${processorPct?.toFixed(1) || 'N/A'}% (Bucket ${processorPullthroughBucket})`);
        }
      }
      
      return reasons.length > 0 ? reasons : ['No significant risk factors'];
    };

    // Debug: log when purpose, channel, or lock_date is missing (up to 5 occurrences)
    const outPurpose = (loan.loanPurpose ?? (loan as any).loan_purpose ?? '').toString().trim() || null;
    const outChannel = (loan.channel ?? (loan as any).channel ?? '').toString().trim() || null;
    const outLockDate = loan.lockDate != null ? (loan.lockDate instanceof Date ? loan.lockDate.toISOString().split('T')[0] : String(loan.lockDate).split('T')[0]) : (loan as any).lock_date ?? null;
    const anyMissing = !outPurpose || !outChannel || !outLockDate;
    if (anyMissing && missingFieldsLogCount < 5) {
      missingFieldsLogCount += 1;
      logInfo('[PredictDebug] bucketLoanData output missing fields', {
        occurrence: missingFieldsLogCount,
        loanId: loan.loanId,
        prepared_loanPurpose: loan.loanPurpose,
        prepared_channel: loan.channel,
        prepared_lockDate: loan.lockDate,
        out_purpose: outPurpose,
        out_channel: outChannel,
        out_lock_date: outLockDate,
      });
    }

    // Final output structure - use snake_case to match database columns
    // NOTE: loan spread includes prepared data (camelCase from prepareLoanData)
    // We add snake_case aliases for frontend consistency with DB schema
    return {
      ...loan,
      // Core identifiers (snake_case matching DB)
      loan_id: loan.loanId,
      loan_number: loan.loanNumber,
      loan_amount: loanAmount,
      loan_type: loan.loanType,
      loan_purpose: (loan.loanPurpose ?? (loan as any).loan_purpose ?? '').toString().trim() || null,
      channel: (loan.channel ?? (loan as any).channel ?? '').toString().trim() || null,

      // Credit metrics (snake_case matching DB)
      fico_score: loan.ficoScore,
      ltv_ratio: loan.ltv,
      be_dti_ratio: loan.dti,
      
      // Personnel (snake_case matching DB)
      loan_officer: loan.loanOfficerName || loName || 'Unknown',
      
      // Rates (snake_case)
      interest_rate: loan.interestRate,
      market_rate: marketDelta.closeMarketRate,
      
      // Milestone (snake_case)
      current_milestone: loan.lastCompletedMilestone || '',
      
      // Commission fields
      commission_at_risk: commissionAtRisk,
      commission_personalization_override: commissionPersonalizationOverride,
      
      // Dates (snake_case for API/frontend)
      estimated_closing_date: loan.closingDate || loan.estimatedClosingDate,
      lock_date: loan.lockDate != null
        ? (loan.lockDate instanceof Date ? loan.lockDate.toISOString().split('T')[0] : String(loan.lockDate).split('T')[0])
        : (loan as any).lock_date ?? null,
      lock_expiration_date: loan.lockExpirationDate != null
        ? (loan.lockExpirationDate instanceof Date ? loan.lockExpirationDate.toISOString().split('T')[0] : String(loan.lockExpirationDate).split('T')[0])
        : (loan as any).lock_expiration_date ?? null,

      // Individual signal buckets
      ficoScoreSignal: ficoBucket,
      ltvSignal: ltvBucket,
      dtiSignal: dtiBucket,
      // CLTV: Lower CLTV = less fallout prone (1), Higher CLTV = more fallout prone (6)
      cltvSignal: loan.cltv ? bucketNumeric(loan.cltv, [
        { min: null, max: 60, bucket: 1 }, // Very low CLTV (less fallout prone)
        { min: 61, max: 70, bucket: 2 }, // Low CLTV
        { min: 71, max: 80, bucket: 3 }, // Moderate CLTV
        { min: 81, max: 85, bucket: 4 }, // Elevated CLTV
        { min: 86, max: 90, bucket: 5 }, // High CLTV
        { min: 91, max: null, bucket: 6 } // Very high CLTV (more fallout prone)
      ]) : null,
      // Lender Credit Amount: Higher credit = less fallout prone (1), Lower/no credit = more fallout prone (6)
      lenderCreditAmountSignal: loan.lenderCreditAmount ? bucketNumeric(loan.lenderCreditAmount, [
        { min: 5000, max: null, bucket: 1 }, // High lender credit (less fallout prone) - $5000+
        { min: 2000, max: 4999.999, bucket: 2 }, // Moderate lender credit - $2000-4999.999
        { min: 1000, max: 1999.999, bucket: 3 }, // Low lender credit - $1000-1999.999
        { min: 500, max: 999.999, bucket: 4 }, // Minimal lender credit - $500-999.999
        { min: 0.001, max: 499.999, bucket: 5 }, // Very minimal lender credit - $0.001-499.999 (Fixed: 0.001 to cover gap)
        { min: null, max: 0, bucket: 6 } // No lender credit (more fallout prone) - $0
      ]) : null,
      loanAmountSignal: loanAmountBucket,
      loanTypeSignal: loanTypeBucket,
      loanPurposeSignal: loanPurposeBucket,
      occupancyTypeSignal: occupancyBucket,
      channelSignal: channelBucket,
      timeToApprovalSignal: timeToApprovalBucket,
      timeInMotionSignal: timeInMotionBucket,
      activeDays: activeDays,
      lastCompletedMilestone: loan.lastCompletedMilestone || '',
      milestoneNumber: null, // No longer used - Time in Motion is active-days only
      loPullthroughSignal: loPullthroughBucket,
      uwPullthroughSignal: uwPullthroughBucket,
      closerPullthroughSignal: closerPullthroughBucket,
      processorPullthroughSignal: processorPullthroughBucket,
      marketChangeDeltaSignal: marketDeltaBucket,
      
      // Composite signals (Calculated Signal Strength - first row of bottom section)
      creditMetricsSignalStrength: creditSignal,
      loanCharacteristicsSignalStrength: loanCharacteristicsSignal,
      timeInMotionSignalStrength: timeInMotionSignal,
      mloAeFalloutProneSignalStrength: mloAeFalloutProneSignal,
      interestLockVsMarketSignalStrength: interestLockVsMarketSignal,
      uwPullthroughSignalStrength: uwPullthroughBucket,
      closerPullthroughSignalStrength: closerPullthroughBucket,
      processorPullthroughSignalStrength: processorPullthroughBucket,
      
      // Reason codes (Reason Codes - second row of bottom section)
      creditMetricsReasonCodes: generateReasonCodes(creditSignal, 'Credit Metrics'),
      loanCharacteristicsReasonCodes: generateReasonCodes(loanCharacteristicsSignal, 'Loan Characteristics'),
      timeInMotionReasonCodes: generateReasonCodes(timeInMotionSignal, 'Time in Motion'),
      mloAeFalloutProneReasonCodes: generateReasonCodes(mloAeFalloutProneSignal, 'MLO AE Fallout Prone'),
      interestLockVsMarketReasonCodes: generateReasonCodes(interestLockVsMarketSignal, 'Interest Lock vs Market'),
      uwPullthroughReasonCodes: generateReasonCodes(uwPullthroughBucket, 'UW Pullthrough'),
      closerPullthroughReasonCodes: generateReasonCodes(closerPullthroughBucket, 'Closer Pullthrough'),
      processorPullthroughReasonCodes: generateReasonCodes(processorPullthroughBucket, 'Processor Pullthrough'),
      
      // Market delta details
      marketChangeDelta: marketDelta.marketChangeDelta,
      marketChangeOverall: marketDelta.marketChangeOverall,
      lockMarketRate: marketDelta.lockMarketRate,
      closeMarketRate: marketDelta.closeMarketRate,
      
      // Pullthrough details (use final validated value that includes fallback from loan data)
      loPullthroughPercentage: loPullthroughPctValid,
      uwPullthroughPercentage: uwPct,
      closerPullthroughPercentage: closerPct,
      processorPullthroughPercentage: processorPct,
      
      // Overall bucket (high/medium/low) - will be set after generateRuleBasedSummary is called
      // Bucket calculation moved to generateRuleBasedSummary to avoid duplicate logic
      bucket: 'medium', // Placeholder - will be overwritten after riskSummary is calculated
      
      // Signal strength for sorting (average of composite signals, higher = more risk)
      signal_strength: (() => {
        const compositeSignals = [
          creditSignal, 
          loanCharacteristicsSignal, 
          timeInMotionSignal, 
          mloAeFalloutProneSignal,
          interestLockVsMarketSignal
        ].filter(s => s !== null) as number[];
        
        if (compositeSignals.length === 0) return null;
        return Math.round((compositeSignals.reduce((sum, s) => sum + s, 0) / compositeSignals.length) * 10) / 10;
      })()
    };
    }));
    
    bucketedLoans.push(...batchResults);
    
    // Log progress for large batches (logContext identifies active vs historical)
    if (loans.length > 1000) {
      const progress = Math.min(100, Math.round(((i + batch.length) / loans.length) * 100));
      logInfo(`Bucketing [${logContext}]: ${progress}% (${i + batch.length}/${loans.length})`);
    }
    
    // Small delay between batches to allow connections to be released back to pool
    // This prevents connection pool exhaustion when processing thousands of loans
    if (i + BUCKETING_BATCH_SIZE < loans.length) {
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay between batches
    }
  }

  return bucketedLoans;
}

/**
 * Historical bucket cache: bucket values are stored in the database (historical_loan_bucket_cache).
 * Data persists across server restarts—stopping "npm run dev:all" does not clear the DB; only the Node
 * process stops. The database keeps all cached buckets until explicitly cleared or overwritten.
 */
/** Keys added by bucketLoanData to each loan (used when saving/loading historical bucket cache) */
const BUCKET_SNAPSHOT_KEYS = [
  'guid', 'mloOrAeName', 'loanAmount', 'lockedRate', 'commissionAtRisk', 'commissionPersonalizationOverride',
  'marketRate', 'estimatedClosingDate', 'ficoScoreSignal', 'ltvSignal', 'dtiSignal', 'cltvSignal',
  'lenderCreditAmountSignal', 'loanAmountSignal', 'loanTypeSignal', 'loanPurposeSignal', 'occupancyTypeSignal',
  'channelSignal', 'timeToApprovalSignal', 'timeInMotionSignal', 'activeDays', 'lastCompletedMilestone',
  'milestoneNumber', 'loPullthroughSignal', 'uwPullthroughSignal', 'closerPullthroughSignal',
  'processorPullthroughSignal', 'marketChangeDeltaSignal', 'creditMetricsSignalStrength',
  'loanCharacteristicsSignalStrength', 'timeInMotionSignalStrength', 'mloAeFalloutProneSignalStrength',
  'interestLockVsMarketSignalStrength', 'uwPullthroughSignalStrength', 'closerPullthroughSignalStrength',
  'processorPullthroughSignalStrength', 'creditMetricsReasonCodes', 'loanCharacteristicsReasonCodes',
  'timeInMotionReasonCodes', 'mloAeFalloutProneReasonCodes', 'interestLockVsMarketReasonCodes',
  'uwPullthroughReasonCodes', 'closerPullthroughReasonCodes', 'processorPullthroughReasonCodes',
  'marketChangeDelta', 'marketChangeOverall', 'lockMarketRate', 'closeMarketRate',
  'loPullthroughPercentage', 'uwPullthroughPercentage', 'closerPullthroughPercentage', 'processorPullthroughPercentage'
] as const;

/** Filter to finalized/historical loans only (exclude ACTIVE LOAN, ACTIVE, INQUIRY). Uses same logic as pullthrough. */
function filterHistoricalLoans(allLoans: any[]): any[] {
  return allLoans.filter(loan => {
    let rawData = loan.raw_data;
    if (rawData && typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch {
        rawData = null;
      }
    }
    let status: string | null = null;
    if (rawData && typeof rawData === 'object') {
      status = rawData['Current Loan Status'] ?? rawData.current_loan_status ?? rawData['Loan Status'] ?? rawData.loan_status ?? null;
    }
    if (!status && rawData && typeof rawData === 'object') status = rawData['Fields.1393'] ?? null;
    if (!status) {
      status = loan.status ?? (rawData && typeof rawData === 'object' ? (rawData.status ?? rawData.Status ?? rawData['Current Status'] ?? rawData.current_status) : null) ?? null;
    }
    const statusUpper = (status ?? '').toString().trim().toUpperCase();
    if (!statusUpper) return false;
    if (statusUpper === 'ACTIVE LOAN' || statusUpper === 'ACTIVE' || statusUpper === 'INQUIRY') return false;
    return true;
  });
}

/** Add actualOutcome (withdraw|deny|originate) to each bucketed historical loan for pattern learning. */
function addActualOutcomeToHistorical(bucketedHistorical: any[]): any[] {
  return bucketedHistorical.map(loan => {
    const raw = loan.raw_data;
    const rd = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    const status = (rd && (rd['Current Loan Status'] ?? rd.current_loan_status ?? rd['Loan Status'] ?? rd.loan_status)) ?? loan.status ?? '';
    const statusUpper = (status ?? '').toString().trim().toUpperCase();
    let actualOutcome: 'withdraw' | 'deny' | 'originate';
    if (statusUpper === 'APPLICATION WITHDRAWN' || statusUpper === 'APPLICATION APPROVED BUT NOT ACCEPTED' ||
        statusUpper === 'FILE CLOSED FOR INCOMPLETENESS' || statusUpper === 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED' || statusUpper === 'WITHDRAWN') {
      actualOutcome = 'withdraw';
    } else if (statusUpper === 'APPLICATION DENIED' || statusUpper === 'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION' || statusUpper === 'DENIED' || statusUpper === 'DECLINED') {
      actualOutcome = 'deny';
    } else {
      actualOutcome = 'originate';
    }
    return { ...loan, actualOutcome };
  });
}

/**
 * Load cached bucket snapshots for historical loans. Only historical loans are cached; active loans are always re-bucketed.
 * Returns map of loan_id -> bucket snapshot (fields to merge onto prepared loan).
 * Note: Isolated tenant DBs don't have tenant_id column - each tenant has their own DB.
 */
async function getCachedHistoricalBuckets(
  tenantId: string | null,
  loanIds: string[],
  dbPool: pg.Pool
): Promise<Map<string, Record<string, unknown>>> {
  if (!tenantId || loanIds.length === 0) return new Map();
  const ids = [...new Set(loanIds.map(String).filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const result = await dbPool.query(
      `SELECT loan_id, bucket_snapshot FROM public.historical_loan_bucket_cache
       WHERE loan_id = ANY($1)`,
      [ids]
    );
    const map = new Map<string, Record<string, unknown>>();
    for (const row of result.rows) {
      if (row.loan_id && row.bucket_snapshot && typeof row.bucket_snapshot === 'object') {
        map.set(String(row.loan_id), row.bucket_snapshot as Record<string, unknown>);
      }
    }
    return map;
  } catch (err: any) {
    logError('Failed to load historical bucket cache', err, { tenantId, loanCount: ids.length });
    return new Map();
  }
}

/** Set of loan_ids that exist in historical_loan_bucket_cache for this tenant. */
async function getCachedHistoricalBucketLoanIds(tenantId: string | null, dbPool: pg.Pool): Promise<Set<string>> {
  if (!tenantId) return new Set();
  try {
    const result = await dbPool.query(
      `SELECT loan_id FROM public.historical_loan_bucket_cache`
    );
    return new Set(result.rows.map((r: any) => String(r.loan_id ?? '')).filter(Boolean));
  } catch (err: any) {
    logError('Failed to load historical bucket cache loan ids', err, { tenantId });
    return new Set();
  }
}

/** Clear all rows from historical_loan_bucket_cache so the next predict run will re-bucket from scratch. */
export async function clearHistoricalBucketCache(dbPool: pg.Pool): Promise<void> {
  try {
    await dbPool.query('TRUNCATE TABLE public.historical_loan_bucket_cache');
    logInfo('Cleared historical loan bucket cache');
  } catch (err: any) {
    logError('Failed to clear historical bucket cache', err, {});
    throw err;
  }
}

/** True if tenant has at least one active row in ai_pattern_learnings (historical_patterns). */
async function hasActivePatternLearnings(tenantId: string | null, dbPool: pg.Pool): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const result = await dbPool.query(
      `SELECT 1 FROM public.ai_pattern_learnings
       WHERE learning_type = 'historical_patterns' AND is_active = true LIMIT 1`
    );
    return result.rows.length > 0;
  } catch (err: any) {
    logError('Failed to check pattern learnings', err, { tenantId });
    return false;
  }
}

/**
 * Persist bucket snapshots for historical loans. Only call with bucketed historical (finalized) loans.
 * Active loans must not be cached so they are re-bucketed when data changes.
 * Note: Isolated tenant DBs use loan_id as unique key (no tenant_id column).
 */
async function saveHistoricalBuckets(
  tenantId: string | null,
  bucketedLoans: any[],
  dbPool: pg.Pool
): Promise<void> {
  if (!tenantId || bucketedLoans.length === 0) return;
  try {
    for (const loan of bucketedLoans) {
      const loanId = loan.loan_id ?? loan.loanId;
      if (!loanId) continue;
      const snapshot: Record<string, unknown> = {};
      for (const k of BUCKET_SNAPSHOT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(loan, k)) {
          snapshot[k] = loan[k];
        }
      }
      if (Object.keys(snapshot).length === 0) continue;
      await dbPool.query(
        `INSERT INTO public.historical_loan_bucket_cache (loan_id, bucket_snapshot)
         VALUES ($1, $2)
         ON CONFLICT (loan_id) DO UPDATE SET bucket_snapshot = EXCLUDED.bucket_snapshot, created_at = NOW()`,
        [String(loanId), JSON.stringify(snapshot)]
      );
    }
    logInfo('Saved historical loan bucket cache', { tenantId, count: bucketedLoans.length });
  } catch (err: any) {
    logError('Failed to save historical bucket cache', err, { tenantId, count: bucketedLoans.length });
  }
}

/** Ensures only one predict flow runs at a time; later requests wait for the current one to finish. */
let predictMutex: Promise<void> = Promise.resolve();
async function withPredictMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = predictMutex;
  let release: () => void;
  predictMutex = new Promise<void>(r => { release = r; });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

/**
 * Predict loan outcomes using agentic AI.
 * Exactly one request runs at a time; others wait. Flow: historical buckets → pattern learnings → active buckets → AI on active.
 */
export async function predictLoanOutcomes(
  request: PredictionRequest,
  apiKey?: string
): Promise<PredictionResponse> {
  return withPredictMutex(async () => runPredictFlow(request, apiKey));
}

/**
 * SIMPLIFIED prediction flow - instant bucketing without RAG/AI batch processing
 * 
 * This function:
 * 1. Buckets historical loans (cached for performance)
 * 2. Buckets active loans with signal strengths
 * 3. Generates rule-based risk summaries (instant)
 * 4. Returns immediately - no background processing
 * 
 * AI recommendations are available on-demand via GET /api/loans/:id/recommendations
 */
async function runPredictFlow(
  request: PredictionRequest,
  apiKey?: string
): Promise<PredictionResponse> {
  const startTime = Date.now();
  let bucketedLoans: any[] = [];
  const tenantId = request.tenantId ?? null;
  // Use tenant pool if provided (isolated tenant DB), otherwise fall back to global pool (shared DB)
  const dbPool = request.tenantPool ?? pool;
  const allLoans = request.allLoans ?? request.loans ?? [];
  const preparedLoans = prepareLoanData(request.loans);
  const historicalLoans = request.allLoans?.length ? filterHistoricalLoans(request.allLoans) : [];

  if (preparedLoans.length === 0) {
    return {
      predictions: [],
      bucketedLoans: [],
      summary: { totalAnalyzed: 0, predictedWithdraw: 0, predictedDeny: 0, predictedOriginate: 0 },
      metadata: { model: 'rule-based', timestamp: new Date().toISOString(), processingTimeMs: Date.now() - startTime }
    };
  }

  // Auto-sync market rates from FRED before prediction (non-blocking)
  // This ensures market delta calculation has up-to-date data
  try {
    const syncedCount = await autoSyncMarketRatesIfNeeded();
    if (syncedCount > 0) {
      logInfo('Auto-synced market rates from FRED', { syncedCount });
    }
  } catch (syncErr: any) {
    // Non-blocking - log and continue
    logError('Market rate auto-sync failed (non-blocking)', syncErr, {});
  }

  const allLoansForPullthrough = allLoans;
  logInfo('Predict started (simplified - instant bucketing)', {
    activeLoans: preparedLoans.length,
    allLoans: allLoans.length,
    historicalLoans: historicalLoans.length,
    tenantId,
    flow: '1=hist buckets, 2=hist backfill, 3=active buckets → done'
  });

  try {
  await initializeMarketRateCache().catch(err => logError('Market rate cache init failed', err));

  let allBucketedHistorical: any[] = [];

  // ——— Step 0 (optional): Clear bucket cache when requested (e.g. CLEAR_BUCKET_CACHE=1). ———
  if (process.env.CLEAR_BUCKET_CACHE === '1' || process.env.CLEAR_BUCKET_CACHE === 'true') {
    await clearHistoricalBucketCache(dbPool);
  }

  // ——— Step 1: If historical bucket cache is empty, bucket and save all historical loans. ———
  const cachedIds = await getCachedHistoricalBucketLoanIds(tenantId, dbPool);
  if (cachedIds.size === 0 && historicalLoans.length > 0) {
    logInfo('Step 1/3: Historical bucket cache is empty — bucketing and saving all historical loans', { count: historicalLoans.length });
    const bucketed = await bucketLoanData(prepareLoanData(historicalLoans), allLoansForPullthrough, { logContext: 'historical' });
    await saveHistoricalBuckets(tenantId, bucketed, dbPool);
    allBucketedHistorical = bucketed;
    logInfo('Step 1/3: Done — saved all historical buckets', { count: bucketed.length });
  } else if (cachedIds.size > 0) {
    logInfo('Step 1/3: Historical bucket cache not empty — skipping', { cachedCount: cachedIds.size });
  } else {
    logInfo('Step 1/3: No historical loans to bucket — skipping');
  }

  // ——— Step 2: If cache isn't empty, for each historical loan not in cache: bucket and save. ———
  if (cachedIds.size > 0 && historicalLoans.length > 0) {
    const missed = historicalLoans.filter(l => !cachedIds.has(String(l.loan_id ?? l.loanId ?? '')));
    if (missed.length > 0) {
      logInfo('Step 2/3: Backfilling historical buckets for loans not in cache', { toAdd: missed.length, cached: cachedIds.size });
      const bucketedMisses = await bucketLoanData(prepareLoanData(missed), allLoansForPullthrough, { logContext: 'historical' });
      await saveHistoricalBuckets(tenantId, bucketedMisses, dbPool);
      for (const id of bucketedMisses.map(b => String(b.loan_id ?? b.loanId))) {
        if (id) cachedIds.add(id);
      }
      logInfo('Step 2/3: Done — saved new historical buckets', { count: bucketedMisses.length });
    } else {
      logInfo('Step 2/3: All historical loans already in cache — skipping');
    }
    // Build full bucketed historical from cache
    const ids = historicalLoans.map(l => String(l.loan_id ?? l.loanId ?? '')).filter(Boolean);
    const cached = await getCachedHistoricalBuckets(tenantId, ids, dbPool);
    const prepared = prepareLoanData(historicalLoans);
    allBucketedHistorical = historicalLoans.map((loan, i) => {
      const id = String(loan.loan_id ?? loan.loanId ?? prepared[i]?.loanId ?? '');
      return { ...prepared[i], ...(cached.get(id) || {}) } as any;
    });
  }

  const historicalWithOutcomes = addActualOutcomeToHistorical(allBucketedHistorical);

  // ——— Step 3: Bucket all active loans with signal strengths ———
  logInfo('Step 3/3: Bucketing all active loans', { count: preparedLoans.length });
  try {
    bucketedLoans = await bucketLoanData(preparedLoans, allLoansForPullthrough, { logContext: 'active' });
    
    // Add rule-based risk summaries to each loan
    // generateRuleBasedSummary now calculates bucket and riskScore, so we use those values
    bucketedLoans = bucketedLoans.map(loan => {
      const riskSummary = generateRuleBasedSummary(loan);
      
      return {
        ...loan,
        riskSummary,
        bucket: riskSummary.bucket, // Use bucket from riskSummary (calculated in generateRuleBasedSummary)
        riskScore: riskSummary.riskScore // Store riskScore on loan object
      };
    });
    
    logInfo('Step 3/3: Active loan bucketing done', {
      activeCount: bucketedLoans.length,
      historicalCount: historicalWithOutcomes.length,
    });
    
    // ——— Step 4: Save predictions to database ———
    try {
      const saveResult = await savePredictionsToDatabase(bucketedLoans, dbPool, 'rule-based-v1');
      logInfo('Step 4: Predictions saved to database', saveResult);
    } catch (saveErr: any) {
      // Non-blocking - log error and continue
      logError('Step 4: Failed to save predictions to database (non-blocking)', saveErr, {});
    }
  } catch (err: any) {
    logError('Step 3/3: Active bucketing failed', err, { loanCount: preparedLoans.length });
    bucketedLoans = [];
  }

  // ——— Return bucketed data immediately (no background processing) ———
  // Count loans by predicted outcome from riskSummary
  const outcomeCounts = { withdraw: 0, deny: 0, originate: 0, at_risk: 0 };
  const bucketCounts = { high: 0, medium: 0, low: 0, unknown: 0 };
  bucketedLoans.forEach(loan => {
    // Count by bucket
    const bucket = loan.bucket || 'unknown';
    if (bucket in bucketCounts) bucketCounts[bucket as keyof typeof bucketCounts]++;
    
    // Count by predicted outcome from riskSummary
    const outcome = loan.riskSummary?.predictedOutcome;
    if (outcome && outcome in outcomeCounts) {
      outcomeCounts[outcome as keyof typeof outcomeCounts]++;
    }
  });
  
  const processingTimeMs = Date.now() - startTime;
  logInfo('Prediction complete (simplified - instant)', {
    bucketedLoansCount: bucketedLoans.length,
    historicalCount: historicalWithOutcomes.length,
    processingTimeMs,
    bucketCounts,
    outcomeCounts
  });

  return {
    predictions: [], // No AI predictions - use rule-based summaries on each loan instead
    bucketedLoans: bucketedLoans || [],
    summary: {
      totalAnalyzed: bucketedLoans.length,
      // Use actual predicted outcomes from riskSummary
      predictedWithdraw: outcomeCounts.withdraw,
      predictedDeny: outcomeCounts.deny,
      predictedOriginate: outcomeCounts.originate + outcomeCounts.at_risk // at_risk likely to originate with intervention
    },
    metadata: {
      model: 'rule-based',
      timestamp: new Date().toISOString(),
      processingTimeMs,
      totalBucketedLoans: bucketedLoans.length,
      predictionsInProgress: false // No background processing
    }
  };

  } catch (error: unknown) {
    logError('Error predicting loan outcomes', error, {});
    
    // Even on error, try to return bucketedLoans if we have them
    if (typeof bucketedLoans !== 'undefined' && bucketedLoans.length > 0) {
      logInfo('Returning bucketed loans despite error', { count: bucketedLoans.length });
      return {
        predictions: [],
        bucketedLoans,
        summary: {
          totalAnalyzed: bucketedLoans.length,
          predictedWithdraw: 0,
          predictedDeny: 0,
          predictedOriginate: 0
        },
        metadata: {
          model: 'rule-based',
          timestamp: new Date().toISOString(),
          processingTimeMs: Date.now() - startTime
        }
      };
    }
    
    throw error;
  }
}

/**
 * Generate rule-based risk summary from loan signal strengths
 * This provides instant prediction summaries without AI
 * 
 * Distinguishes between:
 * - DENY: Credit-related issues (bad FICO, high LTV, high DTI) - lender will reject
 * - WITHDRAW: Market/process issues (unfavorable rates, long pipeline, low LO pullthrough) - borrower will cancel
 */
export function generateRuleBasedSummary(loan: any): {
  risks: string[];
  positives: string[];
  overallRisk: string;
  predictedOutcome: 'originate' | 'withdraw' | 'deny';
  confidence: number;
  bucket: 'high' | 'medium' | 'low';
  riskScore: number;
} {
  const risks: string[] = [];
  const positives: string[] = [];
  
  // Track risk categories to determine deny vs withdraw
  let creditRiskScore = 0;  // Issues that lead to DENY (lender rejection)
  let processRiskScore = 0; // Issues that lead to WITHDRAW (borrower cancellation)
  
  // Credit Risk Score (denial risk): FICO, DTI, LTV ≥ 5: +2-3 each; Loan characteristics ≥ 3: +2
  // COMMENTED OUT: UW pullthrough ≥ 4: +1
  if (loan.ficoScoreSignal === 6) {
    risks.push('Credit metrics indicate elevated risk (low FICO, high DTI, or high LTV)');
    creditRiskScore += 4;
  } else if (loan.ficoScoreSignal >= 5) {
    creditRiskScore += 3;
  }
  if (loan.dtiSignal === 6) {
    creditRiskScore += 3;
  } else if (loan.dtiSignal >= 5) {
    creditRiskScore += 2;
  }
  if (loan.ltvSignal === 6) {
    creditRiskScore += 3;
  } else if (loan.ltvSignal >= 5) {
    creditRiskScore += 2;
  }
  if (loan.loanCharacteristicsSignalStrength >= 3) {
    risks.push('Loan characteristics indicate higher risk (jumbo, investment, cash-out refi)');
    creditRiskScore += 2;
  }
  // COMMENTED OUT: UW pullthrough contribution to credit risk score
  // if (loan.uwPullthroughSignalStrength >= 4) {
  //   risks.push('Underwriter has moderate historical fallout rate');
  //   creditRiskScore += 1;
  // }
  
  // Process Risk Score (withdrawal risk): Time in Motion ≥ 5: +2, ≥ 4: +1; MLO pullthrough ≥ 5: +2; Interest Lock vs Market ≥ 5: +3, ≥ 4: +1; FICO ≤ 2: +2 (shop/withdraw risk)
  if (loan.timeInMotionSignalStrength >= 5) {
    risks.push('Loan has been in pipeline longer than typical');
    processRiskScore += 2;
  } else if (loan.timeInMotionSignalStrength >= 4) {
    risks.push('Loan is taking longer than average to process');
    processRiskScore += 1;
  }
  if (loan.mloAeFalloutProneSignalStrength >= 5) {
    risks.push('Loan officer has below-average historical pullthrough rate');
    processRiskScore += 2;
  }
  if (loan.interestLockVsMarketSignalStrength >= 5) {
    risks.push('Interest rate lock is unfavorable compared to current market');
    processRiskScore += 3;
  } else if (loan.interestLockVsMarketSignalStrength >= 4) {
    risks.push('Interest rate lock is slightly above current market rates');
    processRiskScore += 1;
  }
  if (loan.ficoScoreSignal <= 2) {
    processRiskScore += 2; // Strong borrower - shop/withdraw risk
  }

  
  // Low risk signals (bucket 1-2) - indicates likely to close
  if (loan.creditMetricsSignalStrength <= 2) {
    positives.push('Strong credit profile (high FICO, low DTI)');
  }
  if (loan.loanCharacteristicsSignalStrength <= 2) {
    positives.push('Favorable loan characteristics (conforming, purchase, owner-occupied)');
  }
  if (loan.timeInMotionSignalStrength <= 2) {
    positives.push('Loan is progressing on schedule');
  }
  if (loan.mloAeFalloutProneSignalStrength <= 2) {
    positives.push('Loan officer has excellent historical pullthrough rate');
  }
  if (loan.interestLockVsMarketSignalStrength <= 2) {
    positives.push('Rate lock is favorable compared to market');
  }
  
  // Determine predicted outcome directly from creditRiskScore and processRiskScore
  // No overall risk level calculation - predictions based solely on credit vs process risk scores
  let predictedOutcome: 'originate' | 'withdraw' | 'deny' = 'originate';
  let confidence = 70;
  
  // Determine whether likely to be denied (credit issues) or withdrawn (process/market issues)
  if (creditRiskScore > 7 && creditRiskScore > processRiskScore) {
    predictedOutcome = 'deny';
    confidence = 55 + Math.min(creditRiskScore * 5, 30);
  } else if (processRiskScore > 6 && processRiskScore > creditRiskScore) {
    predictedOutcome = 'withdraw';
    confidence = 55 + Math.min(processRiskScore * 5, 30);
  } else if ((creditRiskScore > 7 || processRiskScore > 6) && creditRiskScore === processRiskScore) {
    // Both scores are high, or they're equal - default to withdraw as process risk
    predictedOutcome = 'withdraw';
    confidence = 55 + Math.min(Math.max(creditRiskScore, processRiskScore) * 5, 30);
  } else {
    // Both scores are low/balanced - default to originate
    predictedOutcome = 'originate';
    confidence = 70 + Math.min(positives.length * 5, 25);
  }
  
  // Derive overallRisk from predictedOutcome for API response (not used in prediction logic)
  let overallRisk: string;
  if (predictedOutcome === 'deny' || predictedOutcome === 'withdraw') {
    overallRisk = 'high';
  } else {
    // 'originate' or any other case
    overallRisk = 'low';
  }
  
  // Calculate riskScore based on process risk and credit risk (split approach)
  // Process Risk: Time in Motion, MLO AE Fallout Prone, Interest Lock vs Market, Inverse FICO
  // Credit Risk: FICO, DTI, LTV, Loan Characteristics, UW Pullthrough
  // Final Risk Score = max(process risk, credit risk)
  
  // Process risk buckets (inverse FICO: higher FICO = stronger borrower = more shop/withdraw risk)
  const processRiskBuckets = [
    loan.timeInMotionSignalStrength,
    loan.mloAeFalloutProneSignalStrength,
    loan.interestLockVsMarketSignalStrength,
    loan.ficoScoreSignal !== null && loan.ficoScoreSignal !== undefined 
      ? 7 - loan.ficoScoreSignal // Invert: FICO bucket 1 (excellent) → 6 (high process risk), FICO bucket 6 (poor) → 1 (low process risk)
      : null
  ].filter(b => b !== null && b !== undefined && typeof b === 'number') as number[];
  
  // Credit risk buckets
  const creditRiskBuckets = [
    loan.ficoScoreSignal,
    loan.dtiSignal,
    loan.ltvSignal,
    loan.loanCharacteristicsSignalStrength,
    // COMMENTED OUT: loan.uwPullthroughSignalStrength
  ].filter(b => b !== null && b !== undefined && typeof b === 'number') as number[];
  
  let riskScore: number;
  if (processRiskBuckets.length === 0 && creditRiskBuckets.length === 0) {
    // Fallback if no signal buckets available
    riskScore = 50;
  } else {
    // Calculate average for each risk type
    const processRiskAvg = processRiskBuckets.length > 0
      ? processRiskBuckets.reduce((sum, b) => sum + b, 0) / processRiskBuckets.length
      : 0;
    const creditRiskAvg = creditRiskBuckets.length > 0
      ? creditRiskBuckets.reduce((sum, b) => sum + b, 0) / creditRiskBuckets.length
      : 0;
    
    // Use max of process risk and credit risk
    const maxRiskAvg = Math.max(processRiskAvg, creditRiskAvg);
    
    // Scale from 1-6 range to 1-100 range: (avg - 1) / 5 * 99 + 1
    riskScore = Math.round(((maxRiskAvg - 1) / 5) * 99 + 1);
    // Clamp to ensure it stays within 1-100
    riskScore = Math.min(100, Math.max(1, riskScore));
  }
  
  // Calculate bucket based on riskScore ranges
  let bucket: 'high' | 'medium' | 'low';
  if (riskScore >= 75) {
    bucket = 'high';
  } else if (riskScore >= 50) {
    bucket = 'medium';
  } else {
    bucket = 'low';
  }
  
  return {
    risks,
    positives,
    overallRisk,
    predictedOutcome,
    confidence,
    bucket,
    riskScore
  };
}

/**
 * Save predictions to the loan_predictions table in the tenant database
 * Uses upsert logic - updates existing predictions for the same loan_id if they exist
 * Saves the full bucketed loan data including signal strengths for display on reload
 */
export async function savePredictionsToDatabase(
  bucketedLoans: any[],
  dbPool: pg.Pool,
  modelVersion: string = 'rule-based-v1'
): Promise<{ saved: number; errors: number }> {
  let savedCount = 0;
  let errorCount = 0;
  
  if (!bucketedLoans || bucketedLoans.length === 0) {
    return { saved: 0, errors: 0 };
  }
  
  logInfo('Saving predictions to database', { loanCount: bucketedLoans.length });
  
  for (const loan of bucketedLoans) {
    const loanId = loan.loan_id || loan.loanId;
    const riskSummary = loan.riskSummary;
    
    if (!loanId || !riskSummary) {
      errorCount++;
      continue;
    }
    
    // Map 'at_risk' to 'originate' for database storage (constraint only allows withdraw/deny/originate)
    let predictedOutcome = riskSummary.predictedOutcome;
    if (predictedOutcome === 'at_risk') {
      predictedOutcome = 'originate';
    }
    
    // Ensure outcome is valid for the CHECK constraint
    if (!['withdraw', 'deny', 'originate'].includes(predictedOutcome)) {
      predictedOutcome = 'originate'; // Default fallback
    }
    
    try {
      // Generate reasoning from risks array
      const reasoning = riskSummary.risks && riskSummary.risks.length > 0
        ? riskSummary.risks.join('; ')
        : (riskSummary.positives && riskSummary.positives.length > 0 
            ? `Low risk: ${riskSummary.positives.slice(0, 2).join('; ')}`
            : `Overall risk: ${riskSummary.overallRisk || 'unknown'}`);
      
      // Combine risks and any negative signals as risk factors
      const riskFactors = riskSummary.risks || [];
      
      // Get bucket (high/medium/low)
      const bucket = loan.bucket || 'medium';
      
      // Prepare loan_data JSONB - store all the computed fields for display
      // This includes signal strengths, credit metrics, pullthrough rates, etc.
      // Include loan_number, lock_date, loan_purpose, channel for critical loan cards on refresh
      const loanData = {
        // Basic loan info
        loan_id: loanId,
        loan_number: loan.loan_number ?? loan.loanNumber ?? null,
        loan_officer: loan.loan_officer,
        loan_amount: loan.loan_amount,
        loan_type: loan.loan_type,
        loan_purpose: loan.loan_purpose ?? loan.loanPurpose ?? null,
        channel: loan.channel ?? null,
        current_milestone: loan.current_milestone || loan.lastCompletedMilestone,
        
        // Lock dates (for Rate & Market section on loan cards)
        lock_date: loan.lock_date ?? loan.lockDate ?? null,
        lock_expiration_date: loan.lock_expiration_date ?? loan.lockExpirationDate ?? null,
        estimated_closing_date: loan.estimated_closing_date ?? loan.estimatedClosingDate ?? loan.closing_date ?? loan.closingDate ?? null,
        
        // Credit metrics
        fico_score: loan.fico_score,
        ltv_ratio: loan.ltv_ratio,
        be_dti_ratio: loan.be_dti_ratio,
        
        // Rate info
        interest_rate: loan.interest_rate,
        market_rate: loan.market_rate,
        lockMarketRate: loan.lockMarketRate,
        closeMarketRate: loan.closeMarketRate,
        marketChangeDelta: loan.marketChangeDelta,
        
        // Time in motion
        activeDays: loan.activeDays,
        
        // Pullthrough percentages
        loPullthroughPercentage: loan.loPullthroughPercentage,
        uwPullthroughPercentage: loan.uwPullthroughPercentage,
        closerPullthroughPercentage: loan.closerPullthroughPercentage,
        processorPullthroughPercentage: loan.processorPullthroughPercentage,
        
        // Signal strengths (1-6 scale)
        creditMetricsSignalStrength: loan.creditMetricsSignalStrength,
        loanCharacteristicsSignalStrength: loan.loanCharacteristicsSignalStrength,
        timeInMotionSignalStrength: loan.timeInMotionSignalStrength,
        mloAeFalloutProneSignalStrength: loan.mloAeFalloutProneSignalStrength,
        interestLockVsMarketSignalStrength: loan.interestLockVsMarketSignalStrength,
        uwPullthroughSignalStrength: loan.uwPullthroughSignalStrength,
        closerPullthroughSignalStrength: loan.closerPullthroughSignalStrength,
        processorPullthroughSignalStrength: loan.processorPullthroughSignalStrength,
        
        // Individual signals
        ficoScoreSignal: loan.ficoScoreSignal,
        ltvSignal: loan.ltvSignal,
        dtiSignal: loan.dtiSignal,
        loPullthroughSignal: loan.loPullthroughSignal,
        marketChangeDeltaSignal: loan.marketChangeDeltaSignal,
        
        // Risk summary
        riskSummary: loan.riskSummary,
        bucket: bucket,
      };
      
      // Upsert: Delete any existing prediction for this loan, then insert new one
      // This ensures we always have the latest prediction
      await dbPool.query(
        `DELETE FROM public.loan_predictions WHERE loan_id = $1`,
        [String(loanId)]
      );
      
      await dbPool.query(
        `INSERT INTO public.loan_predictions 
          (loan_id, predicted_outcome, confidence, reasoning, risk_factors, bucket, loan_data, model_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          String(loanId),
          predictedOutcome,
          Math.round(riskSummary.confidence || 50),
          reasoning,
          riskFactors.length > 0 ? riskFactors : null,
          bucket,
          JSON.stringify(loanData),
          modelVersion
        ]
      );
      
      savedCount++;
    } catch (err: any) {
      // Log error but continue processing other loans
      if (errorCount < 5) { // Only log first 5 errors to avoid spam
        logError('Failed to save prediction for loan', err, { loanId });
      }
      errorCount++;
    }
  }
  
  logInfo('Predictions saved to database', { saved: savedCount, errors: errorCount, total: bucketedLoans.length });
  return { saved: savedCount, errors: errorCount };
}

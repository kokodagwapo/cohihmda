/**
 * Predictions API Routes
 * Consolidated endpoints for loan predictions and recommendations
 * 
 * Migrated from /api/loans/predict, /api/loans/predict/status, 
 * /api/loans/predictions, /api/loans/:loanId/recommendations
 */

import { Router } from 'express';
import { pool, handleDatabaseError } from '../../config/database.js';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import { apiLimiter } from '../../middleware/rateLimiter.js';
import { logError, logWarn, logInfo, logDebug } from '../../services/logger.js';

const router = Router();

// =============================================================================
// PREDICT - POST /api/predictions
// =============================================================================
// Migrated from: /api/loans/predict
// =============================================================================

/**
 * POST /api/predictions
 * Predict outcomes for active loans - simplified version with instant bucketing
 * Returns signal strength buckets and rule-based risk summaries
 */
router.post('/', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const tenantPool = tenantContext.tenantPool;
    const tenantId = tenantContext.tenantId;

    const { customPrompt, loanIds, maxLoanAgeMonths = 0, limit = 1000 } = req.body;

    // Calculate cutoff date if filtering by age
    const cutoffDate = maxLoanAgeMonths && maxLoanAgeMonths > 0
      ? new Date(Date.now() - maxLoanAgeMonths * 30 * 24 * 60 * 60 * 1000)
      : null;

    // Fetch active loans using same criteria as metricsService
    const activeLoansQuery = `
      SELECT 
        loan_id, loan_number, loan_amount, interest_rate, loan_type,
        application_date, lock_date, lock_expiration_date, closing_date, funding_date,
        current_loan_status, current_milestone, branch, loan_officer,
        fico_score, be_dti_ratio, ltv_ratio, cltv,
        loan_purpose, property_type, occupancy_type, channel,
        underwriter, closer, processor
      FROM public.loans 
      WHERE current_loan_status = 'Active Loan'
        AND application_date IS NOT NULL
        AND application_date::text != ''
        ${cutoffDate ? `AND application_date >= $1` : ''}
      ORDER BY application_date DESC
      LIMIT ${Math.min(limit, 2000)}
    `;

    logInfo('[Predictions] Query', {
      cutoffDate: cutoffDate?.toISOString() || 'none',
      maxLoanAgeMonths
    });

    const loansResult = await tenantPool.query(
      activeLoansQuery,
      cutoffDate ? [cutoffDate.toISOString().split('T')[0]] : []
    );
    let activeLoans = loansResult.rows;

    // Fetch historical loans for pull-through calculations
    const historicalLoansQuery = `
      SELECT 
        loan_id, current_loan_status, loan_officer, underwriter, closer, processor,
        application_date, funding_date
      FROM public.loans 
      WHERE current_loan_status != 'Active Loan' OR current_loan_status IS NULL
      ORDER BY application_date DESC
      LIMIT 5000
    `;
    const historicalResult = await tenantPool.query(historicalLoansQuery);
    const allLoans = [...activeLoans, ...historicalResult.rows];

    // Filter to specific loan IDs if provided
    if (loanIds && Array.isArray(loanIds) && loanIds.length > 0) {
      const loanIdSet = new Set(loanIds);
      activeLoans = activeLoans.filter(l => loanIdSet.has(l.loan_id));
    }

    logInfo('[Predictions] Data loaded', {
      activeLoans: activeLoans.length,
      historicalLoans: allLoans.length - activeLoans.length
    });

    if (activeLoans.length === 0) {
      return res.json({
        predictions: [],
        bucketedLoans: [],
        bucketSummary: { high: 0, medium: 0, low: 0 },
        summary: {
          totalAnalyzed: 0,
          predictedWithdraw: 0,
          predictedDeny: 0,
          predictedOriginate: 0
        },
        metadata: {
          model: process.env.PREDICTION_MODEL || 'gpt-4o',
          timestamp: new Date().toISOString(),
          processingTimeMs: 0
        }
      });
    }

    // Fetch OpenAI API key from tenant's rag_settings
    let tenantApiKey: string | undefined;
    try {
      const { decryptAPIKeys } = await import('../../services/encryption.js');
      const apiKeyResult = await tenantPool.query(
        `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
      );
      if (apiKeyResult.rows[0]?.openai_api_key) {
        const decrypted = await decryptAPIKeys({ openai_api_key: apiKeyResult.rows[0].openai_api_key });
        tenantApiKey = decrypted.openai_api_key || undefined;
      }
    } catch (apiKeyError: any) {
      logInfo('[Predictions] Could not fetch tenant API key', { error: apiKeyError.message });
    }

    // Call prediction service
    const { predictLoanOutcomes } = await import('../../services/dashboard/predictionService.js');

    const result = await predictLoanOutcomes({
      loans: activeLoans,
      allLoans,
      customPrompt,
      tenantId,
      tenantPool
    }, tenantApiKey);

    // Limit response size
    const LOANS_PER_BUCKET = 50;

    // Enrich bucketed loans with loan_purpose and channel from raw DB when missing
    // (avoids "--" in UI when values exist in DB but are lost in prepareLoanData/bucketLoanData)
    const rawByLoanId = new Map(activeLoans.map((l: any) => [l.loan_id, l]));
    if (result.bucketedLoans && Array.isArray(result.bucketedLoans)) {
      result.bucketedLoans.forEach((loan: any) => {
        const raw = rawByLoanId.get(loan.loan_id);
        if (raw) {
          const lp = loan.loan_purpose ?? loan.loanPurpose;
          const ch = loan.channel;
          if ((lp == null || String(lp).trim() === '') && raw.loan_purpose) {
            loan.loan_purpose = raw.loan_purpose;
            loan.loanPurpose = raw.loan_purpose;
          }
          if ((ch == null || String(ch).trim() === '') && raw.channel) {
            loan.channel = raw.channel;
          }
        }
      });
    }

    // Extract bucket summary
    const bucketSummary: Record<string, number> = {};
    if (result.bucketedLoans && Array.isArray(result.bucketedLoans)) {
      result.bucketedLoans.forEach((loan: any) => {
        const bucket = loan.bucket || 'unknown';
        bucketSummary[bucket] = (bucketSummary[bucket] || 0) + 1;
      });
    }

    // Essential fields for response
    const essentialFields = [
      'loan_id', 'loan_number', 'loan_amount', 'loan_type', 'loan_purpose', 'loanPurpose', 'channel',
      'bucket', 'current_loan_status', 'status', 'branch',
      'application_date', 'lock_date', 'lock_expiration_date', 'closing_date', 'funding_date',
      'estimated_closing_date',
      'fico_score', 'ltv_ratio', 'be_dti_ratio',
      'loan_officer', 'underwriter', 'closer', 'processor',
      'interest_rate', 'market_rate',
      'marketChangeDelta', 'lockMarketRate', 'closeMarketRate',
      'current_milestone', 'lastCompletedMilestone', 'milestoneNumber',
      'activeDays',
      'loPullthroughPercentage', 'uwPullthroughPercentage',
      'closerPullthroughPercentage', 'processorPullthroughPercentage',
      'creditMetricsSignalStrength', 'loanCharacteristicsSignalStrength',
      'timeInMotionSignalStrength', 'mloAeFalloutProneSignalStrength',
      'interestLockVsMarketSignalStrength', 'uwPullthroughSignalStrength',
      'closerPullthroughSignalStrength', 'processorPullthroughSignalStrength',
      'ficoScoreSignal', 'ltvSignal', 'dtiSignal', 'loPullthroughSignal', 'marketChangeDeltaSignal',
      'riskSummary'
    ];

    const rawByLoanIdPred = new Map<string, any>();
    activeLoans.forEach((l: any) => {
      const id = l.loan_id ?? l.loanId;
      if (id != null && String(id).trim() !== '') rawByLoanIdPred.set(String(id), l);
    });
    // Debug: log first raw row after building rawByLoanIdPred
    const firstRawPred = activeLoans[0];
    if (firstRawPred) {
      const fid = firstRawPred.loan_id ?? firstRawPred.loanId;
      logInfo('[PredictDebug] predictions first raw row', {
        'raw.loan_id': fid,
        typeof_loan_id: typeof fid,
        'raw.loan_purpose': firstRawPred.loan_purpose,
        'raw.channel': firstRawPred.channel,
        'raw.lock_date': firstRawPred.lock_date,
        rawByLoanIdSize: rawByLoanIdPred.size,
        sampleMapKeys: Array.from(rawByLoanIdPred.keys()).slice(0, 3),
      });
    }
    let firstStrippedBackfillLogged = false;
    const bucketGroups: Record<string, any[]> = {};
    if (result.bucketedLoans && Array.isArray(result.bucketedLoans)) {
      result.bucketedLoans.forEach((loan: any) => {
        const bucket = loan.bucket || 'unknown';
        if (!bucketGroups[bucket]) bucketGroups[bucket] = [];
        if (bucketGroups[bucket].length < LOANS_PER_BUCKET) {
          const stripped: Record<string, any> = {};
          essentialFields.forEach(f => {
            if (loan[f] !== undefined) stripped[f] = loan[f];
          });
          const lid = loan.loan_id ?? loan.loanId;
          let rawFound = false;
          const backfillSet: Record<string, any> = {};
          if (lid != null) {
            const raw = rawByLoanIdPred.get(String(lid));
            rawFound = !!raw;
            if (raw) {
              if (raw.loan_purpose != null && String(raw.loan_purpose).trim() !== '') {
                stripped.loan_purpose = raw.loan_purpose;
                stripped.loanPurpose = raw.loan_purpose;
                backfillSet.loan_purpose = raw.loan_purpose;
              }
              if (raw.channel != null && String(raw.channel).trim() !== '') {
                stripped.channel = raw.channel;
                backfillSet.channel = raw.channel;
              }
              if (raw.lock_expiration_date != null) {
                stripped.lock_expiration_date = raw.lock_expiration_date;
                backfillSet.lock_expiration_date = raw.lock_expiration_date;
              }
              if (raw.lock_date != null) {
                stripped.lock_date = raw.lock_date;
                backfillSet.lock_date = raw.lock_date;
              }
            }
          }
          if (!firstStrippedBackfillLogged) {
            firstStrippedBackfillLogged = true;
            logInfo('[PredictDebug] predictions first stripped backfill', {
              loan_id: lid,
              lookupKey: lid != null ? String(lid) : null,
              rawFound,
              backfillSet,
              strippedBeforeBackfill_loan_purpose: loan.loan_purpose ?? loan.loanPurpose,
              strippedBeforeBackfill_channel: loan.channel,
              strippedBeforeBackfill_lock_date: loan.lock_date,
            });
          }
          bucketGroups[bucket].push(stripped);
        }
      });
    }

    const limitedLoans = Object.values(bucketGroups).flat();

    const slimResult = {
      predictions: result.predictions || [],
      bucketedLoans: limitedLoans,
      bucketSummary,
      totalBucketedLoans: result.bucketedLoans?.length || 0,
      summary: result.summary,
      metadata: result.metadata
    };

    const responseSize = JSON.stringify(slimResult).length;
    logInfo('[Predictions] Response', {
      predictions: slimResult.predictions?.length || 0,
      bucketedLoans: slimResult.bucketedLoans?.length || 0,
      responseSizeMB: (responseSize / 1024 / 1024).toFixed(2)
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', responseSize.toString());
    res.json(slimResult);

  } catch (error: any) {
    logError('Error predicting loan outcomes', error, { userId: req.userId });

    if (handleDatabaseError(error, res, 'Failed to predict loan outcomes')) {
      return;
    }

    res.status(500).json({ error: error.message || 'Failed to predict loan outcomes' });
  }
});

// =============================================================================
// PREDICT STATUS - GET /api/predictions/status
// =============================================================================
// Migrated from: /api/loans/predict/status
// =============================================================================

/**
 * GET /api/predictions/status
 * Returns whether the prediction pipeline is still in progress for this tenant
 */
router.get('/status', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const tenantId = tenantContext.tenantId;

    const { getPredictInProgress } = await import('../../services/dashboard/predictionService.js');
    const inProgress = getPredictInProgress(tenantId ?? null);
    res.json({ inProgress });
  } catch (error: any) {
    logError('Error fetching predict status', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch predict status' });
  }
});

// =============================================================================
// GET PREDICTIONS - GET /api/predictions
// =============================================================================
// Migrated from: /api/loans/predictions
// =============================================================================

/**
 * GET /api/predictions
 * Fetch stored AI predictions for loans
 * Returns the most recent prediction for each loan
 */
router.get('/', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const tenantPool = tenantContext.tenantPool;

    // Optional filters
    const loanIds = req.query.loanIds ? (Array.isArray(req.query.loanIds) ? req.query.loanIds : [req.query.loanIds]) : null;
    const outcome = req.query.outcome as string | null;
    const limit = parseInt(req.query.limit as string) || 10000;

    // Query most recent prediction per loan
    let query = `
      SELECT DISTINCT ON (loan_id)
        loan_id,
        predicted_outcome,
        confidence,
        reasoning,
        risk_factors,
        model_version,
        created_at,
        updated_at
      FROM public.loan_predictions
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (loanIds && loanIds.length > 0) {
      query += ` AND loan_id = ANY($${paramIndex})`;
      params.push(loanIds);
      paramIndex++;
    }

    if (outcome && ['withdraw', 'deny', 'originate'].includes(outcome)) {
      query += ` AND predicted_outcome = $${paramIndex}`;
      params.push(outcome);
      paramIndex++;
    }

    query += ` ORDER BY loan_id, created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await tenantPool.query(query, params);

    const predictions = result.rows.map(row => ({
      loanId: row.loan_id,
      predictedOutcome: row.predicted_outcome,
      confidence: row.confidence,
      reasoning: row.reasoning,
      riskFactors: row.risk_factors || [],
      modelVersion: row.model_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json({
      predictions,
      count: predictions.length,
      summary: {
        withdraw: predictions.filter(p => p.predictedOutcome === 'withdraw').length,
        deny: predictions.filter(p => p.predictedOutcome === 'deny').length,
        originate: predictions.filter(p => p.predictedOutcome === 'originate').length
      }
    });

  } catch (error: any) {
    logError('Error fetching loan predictions', error, { userId: req.userId });

    if (handleDatabaseError(error, res, 'Failed to fetch loan predictions')) {
      return;
    }

    res.status(500).json({ error: error.message || 'Failed to fetch loan predictions' });
  }
});

// =============================================================================
// LOAN RECOMMENDATIONS - GET /api/predictions/:loanId/recommendations
// =============================================================================
// Migrated from: /api/loans/:loanId/recommendations
// =============================================================================

/**
 * GET /api/predictions/:loanId/recommendations
 * Get AI-powered recommendations for a specific loan
 */
router.get('/:loanId/recommendations', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const tenantPool = tenantContext.tenantPool;
    const { loanId } = req.params;

    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID is required' });
    }

    // Fetch the loan data
    const loanResult = await tenantPool.query(
      `SELECT * FROM public.loans WHERE loan_id = $1`,
      [loanId]
    );

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const loan = loanResult.rows[0];

    // Fetch OpenAI API key
    let apiKey: string | undefined;
    try {
      const { decryptAPIKeys } = await import('../../services/encryption.js');
      const apiKeyResult = await tenantPool.query(
        `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
      );
      if (apiKeyResult.rows[0]?.openai_api_key) {
        const decrypted = await decryptAPIKeys({ openai_api_key: apiKeyResult.rows[0].openai_api_key });
        apiKey = decrypted.openai_api_key || undefined;
      }
    } catch (apiKeyError: any) {
      logInfo('[Predictions] Could not fetch tenant API key for recommendations', { error: apiKeyError.message });
    }

    // Fall back to environment variable
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
    const apiKeyToUse = apiKey || OPENAI_API_KEY;

    // Validate API key
    const hasValidApiKey = apiKeyToUse &&
      apiKeyToUse.trim().length > 0 &&
      !apiKeyToUse.includes('your-api-key') &&
      apiKeyToUse.trim().startsWith('sk-');

    if (!hasValidApiKey) {
      // Return rule-based recommendations
      const recommendations = generateRuleBasedRecommendations(loan);
      return res.json({
        loanId,
        recommendations,
        source: 'rule-based',
        message: 'AI recommendations unavailable - using rule-based suggestions'
      });
    }

    // Generate AI recommendations
    try {
      const recommendations = await generateAIRecommendations(loan, apiKeyToUse);
      res.json({
        loanId,
        recommendations,
        source: 'ai'
      });
    } catch (aiError: any) {
      logError('[Predictions] AI recommendation generation failed', aiError);
      const recommendations = generateRuleBasedRecommendations(loan);
      res.json({
        loanId,
        recommendations,
        source: 'rule-based',
        message: 'AI generation failed - using rule-based suggestions'
      });
    }

  } catch (error: any) {
    logError('Error getting loan recommendations', error, { userId: req.userId, loanId: req.params.loanId });
    res.status(500).json({ error: error.message || 'Failed to get loan recommendations' });
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate rule-based recommendations based on loan characteristics
 */
function generateRuleBasedRecommendations(loan: any): string[] {
  const recommendations: string[] = [];

  const fico = loan.fico_score || loan.credit_score;
  const dti = loan.dti_ratio || loan.dti || loan.be_dti_ratio;
  const ltv = loan.ltv || loan.loan_to_value || loan.ltv_ratio;

  if (fico && fico < 680) {
    recommendations.push('Consider credit counseling or rapid rescoring to improve FICO score before proceeding');
  }
  if (dti && dti > 43) {
    recommendations.push('High DTI detected - explore debt payoff strategies or income documentation to improve qualification');
  }
  if (ltv && ltv > 80) {
    recommendations.push('High LTV may require PMI - discuss options with borrower including larger down payment');
  }

  const appDate = loan.application_date ? new Date(loan.application_date) : null;
  if (appDate) {
    const daysSinceApp = Math.floor((Date.now() - appDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceApp > 30) {
      recommendations.push(`Loan has been in pipeline ${daysSinceApp} days - review status and address any outstanding conditions`);
    }
    if (daysSinceApp > 45) {
      recommendations.push('Consider rate lock extension options to protect borrower from market volatility');
    }
  }

  const loanType = (loan.loan_type || '').toLowerCase();
  if (loanType.includes('jumbo') || loanType.includes('non-conforming')) {
    recommendations.push('Jumbo loan - ensure all reserve requirements and documentation are complete');
  }
  if (loanType.includes('investment') || loanType.includes('investor')) {
    recommendations.push('Investment property - verify rental income documentation and DSCR requirements');
  }

  const loanPurpose = (loan.loan_purpose || loan.purpose || '').toLowerCase();
  if (loanPurpose.includes('cash') && loanPurpose.includes('out')) {
    recommendations.push('Cash-out refinance - confirm seasoning requirements and verify use of funds');
  }

  if (recommendations.length === 0) {
    recommendations.push('Continue monitoring loan progress and maintain regular borrower communication');
    recommendations.push('Ensure all conditions are cleared promptly to minimize pipeline time');
  }

  return recommendations;
}

/**
 * Generate AI-powered recommendations using GPT
 */
async function generateAIRecommendations(loan: any, apiKey: string): Promise<string[]> {
  const loanSummary = {
    loanAmount: loan.loan_amount,
    loanType: loan.loan_type,
    loanPurpose: loan.loan_purpose || loan.purpose,
    fico: loan.fico_score || loan.credit_score,
    dti: loan.dti_ratio || loan.dti || loan.be_dti_ratio,
    ltv: loan.ltv || loan.loan_to_value || loan.ltv_ratio,
    interestRate: loan.interest_rate,
    applicationDate: loan.application_date,
    currentStatus: loan.current_loan_status || loan.status,
    loanOfficer: loan.loan_officer,
    branch: loan.branch,
    propertyType: loan.property_type,
    occupancy: loan.occupancy_type
  };

  const prompt = `You are a mortgage loan advisor. Based on the following loan details, provide 3-5 specific, actionable recommendations to help this loan close successfully.

Loan Details:
${JSON.stringify(loanSummary, null, 2)}

Provide recommendations as a JSON array of strings. Focus on:
1. Risk mitigation strategies
2. Communication touchpoints
3. Documentation requirements
4. Timeline optimization
5. Borrower support actions

Return ONLY a JSON array of recommendation strings, no other text.
Example: ["Recommendation 1", "Recommendation 2", "Recommendation 3"]`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a mortgage lending expert. Respond only with valid JSON arrays.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '[]';

  try {
    const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
    const recommendations = JSON.parse(cleanContent);
    return Array.isArray(recommendations) ? recommendations : [];
  } catch (parseError) {
    logError('[Predictions] Failed to parse AI recommendations', parseError);
    return [];
  }
}

export default router;

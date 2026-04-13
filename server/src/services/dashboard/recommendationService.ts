/**
 * Loan Recommendation Service
 * Uses agentic AI to generate actionable recommendations for preventing loan fallout
 * Based on loan predictions and signal strengths
 */

import { logInfo, logError } from '../logger.js';
import { pool } from '../../config/database.js';
import { predictLoanOutcomes, PredictionRequest, bucketLoanData, prepareLoanData } from './predictionService.js';

export interface Recommendation {
  action: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
  timeline: 'immediate' | 'short-term' | 'ongoing';
}

export interface LoanRecommendations {
  loanId: string;
  predictedOutcome: 'withdraw' | 'deny' | 'originate';
  recommendations: {
    loanOfficer?: Recommendation[];
    underwriter?: Recommendation[];
    processor?: Recommendation[];
    closer?: Recommendation[];
  };
  summary: string;
}

export interface RecommendationRequest {
  loans: any[]; // Active loans to analyze
  allLoans?: any[]; // All loans (including historical) for pullthrough calculation
  predictions?: any[]; // Optional: pre-generated predictions (if not provided, will generate them)
  customPrompt?: string; // Optional custom prompt override
}

export interface RecommendationResponse {
  recommendations: LoanRecommendations[];
  metadata: {
    model: string;
    timestamp: string;
    processingTimeMs: number;
  };
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECOMMENDATION_MODEL = process.env.RECOMMENDATION_MODEL || process.env.PREDICTION_MODEL || 'gpt-5.4';

/**
 * Get the default recommendations prompt
 */
function getDefaultRecommendationsPrompt(predictions: any[], bucketedLoans: any[]): string {
  return `You are an expert loan lifecycle management AI agent. Your task is to generate actionable, role-specific recommendations to prevent loan fallout.

Based on the loan predictions and signal strengths provided, generate specific recommendations for loan officers, underwriters, processors, and closers.

Return your analysis as a JSON object with a "recommendations" array containing objects with this structure for each loan:
{
  "loanId": "string",
  "predictedOutcome": "withdraw" | "deny" | "originate",
  "recommendations": {
    "loanOfficer": [{"action": "string", "priority": "high"|"medium"|"low", "rationale": "string", "timeline": "immediate"|"short-term"|"ongoing"}],
    "underwriter": [{"action": "string", "priority": "high"|"medium"|"low", "rationale": "string", "timeline": "immediate"|"short-term"|"ongoing"}],
    "processor": [{"action": "string", "priority": "high"|"medium"|"low", "rationale": "string", "timeline": "immediate"|"short-term"|"ongoing"}],
    "closer": [{"action": "string", "priority": "high"|"medium"|"low", "rationale": "string", "timeline": "immediate"|"short-term"|"ongoing"}]
  },
  "summary": "string"
}

Loan predictions:
${JSON.stringify(predictions, null, 2)}

Loan data with signal strengths:
${JSON.stringify(bucketedLoans, null, 2)}

Return ONLY valid JSON with a "recommendations" key containing the array, no additional text.`;
}

/**
 * Call AI model to get recommendations
 */
async function callRecommendationModel(
  prompt: string,
  apiKey?: string
): Promise<LoanRecommendations[]> {
  const apiKeyToUse = apiKey || OPENAI_API_KEY;
  
  if (!apiKeyToUse) {
    throw new Error('OPENAI_API_KEY is not configured. Please set it in environment variables.');
  }

  try {
    logInfo('Calling AI model for loan recommendations', {
      model: RECOMMENDATION_MODEL,
      promptLength: prompt.length,
      promptSource: prompt.includes('Loan Fallout Prevention Recommendations') ? 'Knowledge Base (Recommendations)' : 'Default Prompt'
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKeyToUse}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: RECOMMENDATION_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an expert loan lifecycle management advisor. Always return valid JSON objects. Never include markdown code blocks or additional text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      throw new Error(`AI API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from AI model');
    }

    // Parse JSON response
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        throw parseError;
      }
    }

    // Handle different response formats
    const recommendations = parsed.recommendations || parsed.data || (Array.isArray(parsed) ? parsed : [parsed]);

    if (!Array.isArray(recommendations)) {
      throw new Error('Invalid response format: recommendations must be an array');
    }

    return recommendations.map((rec: any) => ({
      loanId: String(rec.loanId || rec.loan_id || ''),
      predictedOutcome: (rec.predictedOutcome || rec.predicted_outcome || 'originate').toLowerCase(),
      recommendations: {
        loanOfficer: Array.isArray(rec.recommendations?.loanOfficer) 
          ? rec.recommendations.loanOfficer.map((r: any) => ({
              action: String(r.action || ''),
              priority: (r.priority || 'medium').toLowerCase(),
              rationale: String(r.rationale || ''),
              timeline: (r.timeline || 'short-term').toLowerCase()
            }))
          : undefined,
        underwriter: Array.isArray(rec.recommendations?.underwriter)
          ? rec.recommendations.underwriter.map((r: any) => ({
              action: String(r.action || ''),
              priority: (r.priority || 'medium').toLowerCase(),
              rationale: String(r.rationale || ''),
              timeline: (r.timeline || 'short-term').toLowerCase()
            }))
          : undefined,
        processor: Array.isArray(rec.recommendations?.processor)
          ? rec.recommendations.processor.map((r: any) => ({
              action: String(r.action || ''),
              priority: (r.priority || 'medium').toLowerCase(),
              rationale: String(r.rationale || ''),
              timeline: (r.timeline || 'short-term').toLowerCase()
            }))
          : undefined,
        closer: Array.isArray(rec.recommendations?.closer)
          ? rec.recommendations.closer.map((r: any) => ({
              action: String(r.action || ''),
              priority: (r.priority || 'medium').toLowerCase(),
              rationale: String(r.rationale || ''),
              timeline: (r.timeline || 'short-term').toLowerCase()
            }))
          : undefined,
      },
      summary: String(rec.summary || '')
    })).filter((r: LoanRecommendations) => r.loanId); // Filter out invalid recommendations

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logError('Failed to get AI recommendations', error, {});
    throw new Error(`AI recommendation failed: ${errorMessage}`);
  }
}

/**
 * Generate recommendations for loans based on predictions
 */
export async function generateLoanRecommendations(
  request: RecommendationRequest,
  apiKey?: string
): Promise<RecommendationResponse> {
  const startTime = Date.now();

  try {
    // Step 1: Get predictions (if not provided)
    let predictions: any[];
    let bucketedLoans: any[];

    if (request.predictions && request.predictions.length > 0) {
      // Use provided predictions
      predictions = request.predictions;
      
      // Still need to bucket loans for signal strength data
      const preparedLoans = prepareLoanData(request.loans);
      const allLoansForPullthrough = request.allLoans || request.loans;
      bucketedLoans = await bucketLoanData(preparedLoans, allLoansForPullthrough);
    } else {
      // Generate predictions first
      const predictionResult = await predictLoanOutcomes({
        loans: request.loans,
        allLoans: request.allLoans,
        customPrompt: undefined // Use default prediction prompt
      }, apiKey);
      
      predictions = predictionResult.predictions;
      bucketedLoans = predictionResult.bucketedLoans || [];
    }

    if (predictions.length === 0) {
      return {
        recommendations: [],
        metadata: {
          model: RECOMMENDATION_MODEL,
          timestamp: new Date().toISOString(),
          processingTimeMs: Date.now() - startTime
        }
      };
    }

    // Step 2: Build recommendations prompt
    let prompt = request.customPrompt;
    
    if (!prompt) {
      // Check for Recommendations category knowledge base entries
      try {
        const kbResult = await pool.query(
          `SELECT content, priority 
           FROM public.rag_knowledge_base 
           WHERE category = 'Recommendations' 
           AND is_active = true 
           ORDER BY priority DESC, created_at DESC`
        );
        
        if (kbResult.rows.length > 0) {
          // Combine all Recommendations entries into a single prompt
          const stripHtml = (html: string) => {
            return html
              .replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .trim();
          };
          
          const kbPrompts = kbResult.rows
            .map(row => stripHtml(row.content))
            .filter(content => content.length > 0)
            .join('\n\n---\n\n');
          
          // Use knowledge base prompt, then add predictions and loan data
          prompt = `${kbPrompts}

Loan predictions to analyze:
${JSON.stringify(predictions, null, 2)}

Loan data with signal strengths:
${JSON.stringify(bucketedLoans, null, 2)}

Return your analysis as a JSON object with a "recommendations" array containing objects with this structure for each loan:
{
  "loanId": "string",
  "predictedOutcome": "withdraw" | "deny" | "originate",
  "recommendations": {
    "loanOfficer": [{"action": "string", "priority": "high"|"medium"|"low", "rationale": "string", "timeline": "immediate"|"short-term"|"ongoing"}],
    "underwriter": [{"action": "string", "priority": "high"|"medium"|"low", "rationale": "string", "timeline": "immediate"|"short-term"|"ongoing"}],
    "processor": [{"action": "string", "priority": "high"|"medium"|"low", "rationale": "string", "timeline": "immediate"|"short-term"|"ongoing"}],
    "closer": [{"action": "string", "priority": "high"|"medium"|"low", "rationale": "string", "timeline": "immediate"|"short-term"|"ongoing"}]
  },
  "summary": "string"
}

Return ONLY valid JSON with a "recommendations" key containing the array, no additional text.`;
          
          logInfo('Using knowledge base prompt for Recommendations category', {
            entryCount: kbResult.rows.length,
            priorities: kbResult.rows.map(r => r.priority)
          });
        } else {
          // No Recommendations entries found, use default prompt
          prompt = getDefaultRecommendationsPrompt(predictions, bucketedLoans);
        }
      } catch (error) {
        logError('Error fetching knowledge base entries for Recommendations category', error);
        // Fallback to default prompt if KB lookup fails
        prompt = getDefaultRecommendationsPrompt(predictions, bucketedLoans);
      }
    }
    
    if (!prompt) {
      prompt = getDefaultRecommendationsPrompt(predictions, bucketedLoans);
    }

    // Step 3: Call AI model for recommendations
    const recommendations = await callRecommendationModel(prompt, apiKey);

    logInfo('Loan recommendations completed', {
      totalAnalyzed: recommendations.length,
      processingTimeMs: Date.now() - startTime
    });

    return {
      recommendations,
      metadata: {
        model: RECOMMENDATION_MODEL,
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime
      }
    };

  } catch (error: unknown) {
    logError('Error generating loan recommendations', error, {});
    throw error;
  }
}

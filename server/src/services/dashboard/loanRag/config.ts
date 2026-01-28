/**
 * Loan RAG (Retrieval-Augmented Inference) configuration.
 * Signal fields, K, and embedding model can be tuned without rewriting logic.
 */

/** Default signal strength field names used for canonical representation and similarity. */
export const DEFAULT_LOAN_RAG_SIGNAL_FIELDS = [
  'creditMetricsSignalStrength',
  'loanCharacteristicsSignalStrength',
  'timeInMotionSignalStrength',
  'mloAeFalloutProneSignalStrength',
  'interestLockVsMarketSignalStrength',
  'uwPullthroughSignalStrength',
] as const;

/** Human-readable labels for signal fields (same order as DEFAULT_LOAN_RAG_SIGNAL_FIELDS). */
export const DEFAULT_LOAN_RAG_SIGNAL_LABELS: Record<string, string> = {
  creditMetricsSignalStrength: 'Credit Metrics',
  loanCharacteristicsSignalStrength: 'Loan Characteristics',
  timeInMotionSignalStrength: 'Time in Motion',
  mloAeFalloutProneSignalStrength: 'MLO AE Fallout Prone',
  interestLockVsMarketSignalStrength: 'Interest Lock vs Market',
  uwPullthroughSignalStrength: 'UW Pullthrough',
};

/** Top-K similar historical loans to retrieve per active loan. Default 20–50. */
export const LOAN_RAG_TOP_K = Math.min(50, Math.max(20, parseInt(process.env.LOAN_RAG_TOP_K || '30', 10) || 30));

/** Embedding model for loan canonical text. Use one compatible with GPT-5 mini inference (OpenAI). */
export const LOAN_RAG_EMBEDDING_MODEL = process.env.LOAN_RAG_EMBEDDING_MODEL || 'openai/text-embedding-3-small';

/** Batch size for embedding API calls (OpenAI allows many inputs per request). */
export const LOAN_RAG_EMBED_BATCH_SIZE = Math.min(100, Math.max(1, parseInt(process.env.LOAN_RAG_EMBED_BATCH_SIZE || '50', 10) || 50));

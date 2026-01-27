/**
 * Loan RAG (Retrieval-Augmented Inference) module.
 * Canonical representation, embedding storage, similarity search, aggregation.
 */

export { toCanonicalLoanText, type CanonicalConfig } from './canonicalLoan.js';
export {
  DEFAULT_LOAN_RAG_SIGNAL_FIELDS,
  DEFAULT_LOAN_RAG_SIGNAL_LABELS,
  LOAN_RAG_TOP_K,
  LOAN_RAG_EMBEDDING_MODEL,
  LOAN_RAG_EMBED_BATCH_SIZE,
} from './config.js';
export {
  ensureLoanEmbeddingTable,
  getEmbeddedLoanIds,
  ensureHistoricalEmbeddings,
  searchSimilarHistorical,
  type LoanWithOutcome,
  type SimilarLoan,
} from './loanEmbeddingStore.js';
export { aggregateRetrieved, type AggregatedSimilar } from './loanAggregation.js';

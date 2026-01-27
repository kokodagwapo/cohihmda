/**
 * Loan outcome embedding store.
 * Generates embeddings for canonical loan text and stores them in pgvector.
 * Supports one-time bulk embedding and incremental embedding for new historical loans.
 */

import { pool } from '../../../config/database.js';
import { generateEmbeddings, getEmbeddingDimensions } from '../../embeddingService.js';
import { logInfo, logError } from '../../logger.js';
import type { CanonicalConfig } from './canonicalLoan.js';
import { toCanonicalLoanText } from './canonicalLoan.js';
import {
  LOAN_RAG_EMBEDDING_MODEL,
  LOAN_RAG_EMBED_BATCH_SIZE,
  LOAN_RAG_TOP_K,
} from './config.js';

export type LoanWithOutcome = {
  loan_id?: string;
  loanId?: string;
  actualOutcome: 'withdraw' | 'deny' | 'originate';
  [k: string]: unknown;
};

export type SimilarLoan = {
  loan_id: string;
  outcome: 'withdraw' | 'deny' | 'originate';
  similarity: number;
};

const TABLE = 'public.loan_outcome_embeddings';
const DEFAULT_TOP_K = LOAN_RAG_TOP_K;

/**
 * Ensure loan_outcome_embeddings table exists and has correct structure.
 * Call is idempotent; migration should create the table.
 */
export async function ensureLoanEmbeddingTable(tenantId: string): Promise<void> {
  try {
    await pool.query(
      `SELECT 1 FROM ${TABLE} WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
  } catch {
    logError('loan_outcome_embeddings table missing or inaccessible', new Error('table check'), { tenantId });
    throw new Error('loan_outcome_embeddings table is required for RAG prediction. Run migrations.');
  }
}

/**
 * Return set of loan_ids that already have embeddings for this tenant.
 */
export async function getEmbeddedLoanIds(
  tenantId: string
): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT loan_id FROM ${TABLE} WHERE tenant_id = $1`,
    [tenantId]
  );
  return new Set((result.rows as { loan_id: string }[]).map((r) => String(r.loan_id)));
}

/**
 * Embed and store historical loans. Supports bulk (all) and incremental (only those not yet stored).
 * Loans must have actualOutcome and all canonical signal fields populated (use bucketed historical loans with addActualOutcome).
 */
export async function ensureHistoricalEmbeddings(
  tenantId: string,
  loans: LoanWithOutcome[],
  config: CanonicalConfig,
  options: { incrementalOnly?: boolean; apiKey?: string } = {}
): Promise<{ embedded: number; skipped: number }> {
  if (!loans.length) return { embedded: 0, skipped: 0 };

  const existing = options.incrementalOnly ? await getEmbeddedLoanIds(tenantId) : new Set<string>();
  const toEmbed = options.incrementalOnly
    ? loans.filter((l) => !existing.has(String(l.loan_id ?? l.loanId ?? '')))
    : loans;

  if (toEmbed.length === 0) {
    return { embedded: 0, skipped: loans.length };
  }

  const texts: string[] = [];
  const meta: { loanId: string; outcome: string }[] = [];
  for (const loan of toEmbed) {
    const id = String(loan.loan_id ?? loan.loanId ?? '');
    const outcome = String(loan.actualOutcome ?? 'originate').toLowerCase() as 'withdraw' | 'deny' | 'originate';
    texts.push(toCanonicalLoanText(loan as Record<string, unknown>, config));
    meta.push({ loanId: id, outcome });
  }

  const dim = getEmbeddingDimensions(LOAN_RAG_EMBEDDING_MODEL);
  let embedded = 0;
  const batchSize = LOAN_RAG_EMBED_BATCH_SIZE;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batchTexts = texts.slice(i, i + batchSize);
    const batchMeta = meta.slice(i, i + batchSize);
    const results = await generateEmbeddings(
      batchTexts,
      LOAN_RAG_EMBEDDING_MODEL,
      options.apiKey
    );
    for (let j = 0; j < results.length; j++) {
      const emb = results[j].embedding;
      if (emb.length !== dim) {
        logError('Embedding dimension mismatch', new Error('dim'), {
          expected: dim,
          got: emb.length,
          model: LOAN_RAG_EMBEDDING_MODEL,
        });
        continue;
      }
      const { loanId, outcome } = batchMeta[j];
      const canonicalText = batchTexts[j];
      const vecStr = `[${emb.join(',')}]`;
      try {
        await pool.query(
          `INSERT INTO ${TABLE} (tenant_id, loan_id, outcome, canonical_text, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5::vector, $6)
           ON CONFLICT (tenant_id, loan_id) DO UPDATE SET
             outcome = EXCLUDED.outcome,
             canonical_text = EXCLUDED.canonical_text,
             embedding = EXCLUDED.embedding,
             metadata = EXCLUDED.metadata`,
          [tenantId, loanId, outcome, canonicalText, vecStr, JSON.stringify({})]
        );
        embedded++;
        if (embedded % 1000 === 0) {
          logInfo('Loan RAG: historical embeddings progress', { embedded, total: toEmbed.length, tenantId });
        }
      } catch (err: unknown) {
        logError('Failed to store loan embedding', err as Error, { tenantId, loanId });
      }
    }
  }

  if (embedded > 0 && embedded % 1000 !== 0) {
    logInfo('Loan RAG: historical embeddings progress', { embedded, total: toEmbed.length, tenantId });
  }

  logInfo('Loan RAG: historical embeddings ensured', {
    tenantId,
    embedded,
    skipped: toEmbed.length - embedded,
    totalLoans: loans.length,
    incremental: options.incrementalOnly,
  });
  return { embedded, skipped: loans.length - embedded };
}

/**
 * Search for top-K historical loans most similar to the query embedding (cosine similarity).
 */
export async function searchSimilarHistorical(
  tenantId: string,
  queryEmbedding: number[],
  topK: number = DEFAULT_TOP_K
): Promise<SimilarLoan[]> {
  const vecStr = `[${queryEmbedding.join(',')}]`;
  const result = await pool.query(
    `SELECT loan_id, outcome,
            1 - (embedding <=> $1::vector) AS similarity
     FROM ${TABLE}
     WHERE tenant_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vecStr, tenantId, topK]
  );
  return (result.rows as { loan_id: string; outcome: string; similarity: number }[]).map((r) => ({
    loan_id: String(r.loan_id),
    outcome: r.outcome as 'withdraw' | 'deny' | 'originate',
    similarity: Number(r.similarity),
  }));
}

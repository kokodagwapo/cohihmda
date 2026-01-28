/**
 * Loan outcome embedding store.
 * Generates embeddings for canonical loan text and stores them in pgvector.
 * Supports one-time bulk embedding and incremental embedding for new historical loans.
 * 
 * Note: For isolated tenant databases, pass the tenant-specific pool. Tables do not have
 * tenant_id column as each tenant has their own database.
 */

import pg from 'pg';
import { pool as globalPool } from '../../../config/database.js';
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
 * Note: Isolated tenant DBs don't have tenant_id column.
 */
export async function ensureLoanEmbeddingTable(tenantId: string, pool?: pg.Pool): Promise<void> {
  const dbPool = pool ?? globalPool;
  try {
    await dbPool.query(
      `SELECT 1 FROM ${TABLE} LIMIT 1`
    );
  } catch {
    logError('loan_outcome_embeddings table missing or inaccessible', new Error('table check'), { tenantId });
    throw new Error('loan_outcome_embeddings table is required for RAG prediction. Run migrations.');
  }
}

/**
 * Return set of loan_ids that already have embeddings for this tenant.
 * Note: Isolated tenant DBs don't have tenant_id column - each tenant has their own DB.
 */
export async function getEmbeddedLoanIds(
  tenantId: string,
  pool?: pg.Pool
): Promise<Set<string>> {
  const dbPool = pool ?? globalPool;
  const result = await dbPool.query(
    `SELECT loan_id FROM ${TABLE}`
  );
  return new Set((result.rows as { loan_id: string }[]).map((r) => String(r.loan_id)));
}

/**
 * Embed and store historical loans. Supports bulk (all) and incremental (only those not yet stored).
 * Loans must have actualOutcome and all canonical signal fields populated (use bucketed historical loans with addActualOutcome).
 * Note: Isolated tenant DBs don't have tenant_id column - each tenant has their own DB.
 */
export async function ensureHistoricalEmbeddings(
  tenantId: string,
  loans: LoanWithOutcome[],
  config: CanonicalConfig,
  options: { incrementalOnly?: boolean; apiKey?: string; pool?: pg.Pool } = {}
): Promise<{ embedded: number; skipped: number }> {
  if (!loans.length) return { embedded: 0, skipped: 0 };

  const dbPool = options.pool ?? globalPool;
  const existing = options.incrementalOnly ? await getEmbeddedLoanIds(tenantId, dbPool) : new Set<string>();
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
        // Note: Isolated tenant DBs don't have tenant_id column - use loan_id as unique key
        await dbPool.query(
          `INSERT INTO ${TABLE} (loan_id, outcome, canonical_text, embedding, metadata)
           VALUES ($1, $2, $3, $4::vector, $5)
           ON CONFLICT (loan_id) DO UPDATE SET
             outcome = EXCLUDED.outcome,
             canonical_text = EXCLUDED.canonical_text,
             embedding = EXCLUDED.embedding,
             metadata = EXCLUDED.metadata`,
          [loanId, outcome, canonicalText, vecStr, JSON.stringify({})]
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
 * Note: Isolated tenant DBs don't have tenant_id column - each tenant has their own DB.
 */
export async function searchSimilarHistorical(
  tenantId: string,
  queryEmbedding: number[],
  topK: number = DEFAULT_TOP_K,
  pool?: pg.Pool
): Promise<SimilarLoan[]> {
  const dbPool = pool ?? globalPool;
  const vecStr = `[${queryEmbedding.join(',')}]`;
  const result = await dbPool.query(
    `SELECT loan_id, outcome,
            1 - (embedding <=> $1::vector) AS similarity
     FROM ${TABLE}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vecStr, topK]
  );
  return (result.rows as { loan_id: string; outcome: string; similarity: number }[]).map((r) => ({
    loan_id: String(r.loan_id),
    outcome: r.outcome as 'withdraw' | 'deny' | 'originate',
    similarity: Number(r.similarity),
  }));
}

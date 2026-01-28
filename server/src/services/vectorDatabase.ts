/**
 * Vector Database Service
 * Handles storing and querying embeddings in Pinecone or pgvector
 */

import { pool } from '../config/database.js';
import pg from 'pg';

export interface VectorSearchResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, any>;
}

/**
 * Store embeddings in vector database
 */
export async function storeEmbeddings(
  tenantId: string,
  documentId: string,
  chunks: Array<{
    text: string;
    embedding: number[];
    index: number;
    metadata?: Record<string, any>;
  }>,
  vectorDatabase: 'pinecone' | 'pgvector' | 'opensearch' = 'pgvector'
): Promise<void> {
  switch (vectorDatabase) {
    case 'pinecone':
      await storeInPinecone(tenantId, documentId, chunks);
      break;
    case 'pgvector':
      await storeInPgVector(tenantId, documentId, chunks);
      break;
    case 'opensearch':
      throw new Error('OpenSearch not yet implemented');
    default:
      throw new Error(`Unsupported vector database: ${vectorDatabase}`);
  }
}

/**
 * Search for similar embeddings
 */
export async function searchEmbeddings(
  tenantId: string,
  queryEmbedding: number[],
  topK: number = 5,
  similarityThreshold: number = 0.75,
  vectorDatabase: 'pinecone' | 'pgvector' | 'opensearch' = 'pgvector'
): Promise<VectorSearchResult[]> {
  switch (vectorDatabase) {
    case 'pinecone':
      return searchPinecone(tenantId, queryEmbedding, topK, similarityThreshold);
    case 'pgvector':
      return searchPgVector(tenantId, queryEmbedding, topK, similarityThreshold);
    case 'opensearch':
      throw new Error('OpenSearch not yet implemented');
    default:
      throw new Error(`Unsupported vector database: ${vectorDatabase}`);
  }
}

/**
 * Store embeddings in Pinecone
 */
async function storeInPinecone(
  tenantId: string,
  documentId: string,
  chunks: Array<{
    text: string;
    embedding: number[];
    index: number;
    metadata?: Record<string, any>;
  }>
): Promise<void> {
  const apiKey = process.env.PINECONE_API_KEY;
  const environment = process.env.PINECONE_ENVIRONMENT || 'us-east-1';
  const indexName = process.env.PINECONE_INDEX_NAME || `coheus-${tenantId}`;

  if (!apiKey) {
    throw new Error('PINECONE_API_KEY is not configured');
  }

  try {
    // Prepare vectors for Pinecone upsert
    const vectors = chunks.map((chunk, idx) => ({
      id: `${documentId}-chunk-${chunk.index}`,
      values: chunk.embedding,
      metadata: {
        tenant_id: tenantId,
        document_id: documentId,
        chunk_index: chunk.index,
        text: chunk.text.substring(0, 1000), // Store first 1000 chars
        ...chunk.metadata,
      },
    }));

    // Pinecone upsert API
    const response = await fetch(
      `https://${indexName}-${environment}.svc.pinecone.io/vectors/upsert`,
      {
        method: 'POST',
        headers: {
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vectors,
          namespace: tenantId, // Use tenant_id as namespace for isolation
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json() as { message?: string };
      throw new Error(`Pinecone API error: ${error.message || 'Unknown error'}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to store embeddings in Pinecone: ${errorMessage}`);
  }
}

/**
 * Search Pinecone
 */
async function searchPinecone(
  tenantId: string,
  queryEmbedding: number[],
  topK: number,
  similarityThreshold: number
): Promise<VectorSearchResult[]> {
  const apiKey = process.env.PINECONE_API_KEY;
  const environment = process.env.PINECONE_ENVIRONMENT || 'us-east-1';
  const indexName = process.env.PINECONE_INDEX_NAME || `coheus-${tenantId}`;

  if (!apiKey) {
    throw new Error('PINECONE_API_KEY is not configured');
  }

  try {
    const response = await fetch(
      `https://${indexName}-${environment}.svc.pinecone.io/query`,
      {
        method: 'POST',
        headers: {
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vector: queryEmbedding,
          topK,
          includeMetadata: true,
          namespace: tenantId,
          filter: {
            tenant_id: { $eq: tenantId },
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json() as { message?: string };
      throw new Error(`Pinecone API error: ${error.message || 'Unknown error'}`);
    }

    const data = await response.json() as { matches?: Array<{ id: string; score: number; metadata?: { text?: string } }> };
    return (data.matches || [])
      .filter((match: any) => match.score >= similarityThreshold)
      .map((match: any) => ({
        id: match.id,
        text: match.metadata?.text || '',
        score: match.score,
        metadata: match.metadata,
      }));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to search Pinecone: ${errorMessage}`);
  }
}

/**
 * Store embeddings in pgvector
 */
async function storeInPgVector(
  tenantId: string,
  documentId: string,
  chunks: Array<{
    text: string;
    embedding: number[];
    index: number;
    metadata?: Record<string, any>;
  }>
): Promise<void> {
  try {
    // Check if pgvector extension is installed
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Insert embeddings
    for (const chunk of chunks) {
      // Convert array to pgvector format
      const embeddingStr = `[${chunk.embedding.join(',')}]`;

      await pool.query(
        `INSERT INTO public.rag_embeddings
         (document_id, tenant_id, chunk_index, chunk_text, token_count, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
         ON CONFLICT (document_id, chunk_index) DO UPDATE
         SET chunk_text = EXCLUDED.chunk_text,
             embedding = EXCLUDED.embedding,
             metadata = EXCLUDED.metadata,
             token_count = EXCLUDED.token_count`,
        [
          documentId,
          tenantId,
          chunk.index,
          chunk.text,
          Math.ceil(chunk.text.length / 4), // Estimate token count
          embeddingStr,
          JSON.stringify(chunk.metadata || {}),
        ]
      );
    }
  } catch (error: any) {
    // If vector type doesn't exist, try to create it
    if (error.message?.includes('type "vector" does not exist')) {
      throw new Error('pgvector extension not installed. Run: CREATE EXTENSION vector;');
    }
    throw new Error(`Failed to store embeddings in pgvector: ${error.message}`);
  }
}

/**
 * Search pgvector
 */
async function searchPgVector(
  tenantId: string,
  queryEmbedding: number[],
  topK: number,
  similarityThreshold: number
): Promise<VectorSearchResult[]> {
  try {
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Use cosine similarity (1 - cosine_distance)
    const result = await pool.query(
      `SELECT 
        id,
        chunk_text,
        chunk_index,
        metadata,
        1 - (embedding <=> $1::vector) as similarity
       FROM public.rag_embeddings
       WHERE tenant_id = $2
         AND 1 - (embedding <=> $1::vector) >= $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      [embeddingStr, tenantId, similarityThreshold, topK]
    );

    return result.rows.map((row) => ({
      id: row.id,
      text: row.chunk_text,
      score: parseFloat(row.similarity),
      metadata: row.metadata || {},
    }));
  } catch (error: any) {
    throw new Error(`Failed to search pgvector: ${error.message}`);
  }
}

/**
 * Store loan embedding directly on loans table
 */
export async function storeLoanEmbedding(
  tenantPool: pg.Pool,
  loanId: string,
  embedding: number[]
): Promise<void> {
  try {
    // Check if pgvector extension is installed
    await tenantPool.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Convert array to pgvector format
    const embeddingStr = `[${embedding.join(',')}]`;

    await tenantPool.query(
      `UPDATE public.loans
       SET embedding = $1::vector, updated_at = NOW()
       WHERE loan_id = $2`,
      [embeddingStr, loanId]
    );
  } catch (error: any) {
    if (error.message?.includes('type "vector" does not exist')) {
      throw new Error('pgvector extension not installed. Run: CREATE EXTENSION vector;');
    }
    throw new Error(`Failed to store loan embedding: ${error.message}`);
  }
}

/**
 * Search loans by embedding similarity
 */
export async function searchLoansByEmbedding(
  tenantPool: pg.Pool,
  queryEmbedding: number[],
  topK: number = 10,
  similarityThreshold: number = 0.75
): Promise<Array<{
  loan_id: string;
  borrower_name: string;
  loan_amount: number;
  similarity: number;
}>> {
  try {
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Use cosine similarity (1 - cosine_distance)
    const result = await tenantPool.query(
      `SELECT 
        loan_id,
        borrower_name,
        loan_amount,
        1 - (embedding <=> $1::vector) as similarity
       FROM public.loans
       WHERE embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) >= $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [embeddingStr, similarityThreshold, topK]
    );

    return result.rows.map((row) => ({
      loan_id: row.loan_id,
      borrower_name: row.borrower_name,
      loan_amount: parseFloat(row.loan_amount) || 0,
      similarity: parseFloat(row.similarity),
    }));
  } catch (error: any) {
    throw new Error(`Failed to search loans by embedding: ${error.message}`);
  }
}


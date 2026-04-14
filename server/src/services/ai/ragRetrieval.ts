/**
 * Shared RAG Retrieval Module
 *
 * Unified knowledge base retrieval used by Cohi Chat, Workbench, Research Lab,
 * and Insight Agents. Supports optional category-scoped filtering so personas
 * and agents can pull from specific knowledge domains.
 */

import pg from "pg";
import { generateEmbeddings } from "../embeddingService.js";

export interface RAGChunk {
  text: string;
  score: number;
  source: string;
  category: string | null;
  isGlobal: boolean;
  sourceUrl: string | null;
}

export interface RAGResult {
  chunks: RAGChunk[];
  /** Formatted markdown string ready for LLM injection */
  formatted: string;
  totalChunks: number;
}

export interface RAGOptions {
  /** Limit results to these document categories. Omit for no filter (all categories). */
  categories?: string[];
  /** Number of top chunks to return per query text. Default: 5 */
  topK?: number;
  /** Minimum cosine similarity threshold. Default: 0.3 */
  threshold?: number;
  /** Maximum character length per chunk in formatted output. Default: 500 */
  maxChunkLength?: number;
  /** Label for log messages identifying the caller */
  caller?: string;
}

function buildQueryVariants(question: string): string[] {
  const base = (question || "").trim();
  if (!base) return [];

  const variants: string[] = [base];
  variants.push(`mortgage lending analysis: ${base}`);

  const lower = base.toLowerCase();

  // Domain synonym expansion improves recall when users use product nicknames
  // that differ from wording inside uploaded docs.
  if (
    lower.includes("toptiering") ||
    lower.includes("top tiering") ||
    lower.includes("top tier score") ||
    lower.includes("tts")
  ) {
    variants.push(
      `total team score tts definition formula tier thresholds sales scorecard operations scorecard`
    );
    variants.push(
      `explain how top tier score is calculated for loan officers and operations staff`
    );
  }

  if (lower.includes("pull through") || lower.includes("pull-through")) {
    variants.push(
      `pull-through rate denominator completed loans funded count fallout rate definition`
    );
  }

  // Deduplicate while preserving order.
  return Array.from(new Set(variants));
}

/**
 * Check whether the rag_embeddings table exists and has rows.
 * Returns false if the tenant has no knowledge base set up.
 */
async function hasEmbeddings(pool: pg.Pool): Promise<boolean> {
  try {
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'rag_embeddings'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) return false;

    const countCheck = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.rag_embeddings`
    );
    return parseInt(countCheck.rows[0]?.cnt || "0") > 0;
  } catch {
    return false;
  }
}

/**
 * Core RAG retrieval function shared across all AI surfaces.
 *
 * @param queryTexts  One or more text strings to embed and search. Using multiple
 *                    phrasings improves recall for ambiguous topics.
 * @param pool        Tenant database connection pool.
 * @param options     Optional configuration for category scoping, limits, etc.
 */
export async function retrieveKnowledge(
  queryTexts: string[],
  pool: pg.Pool,
  options: RAGOptions = {}
): Promise<RAGResult> {
  const {
    categories,
    topK = 5,
    threshold = 0.3,
    maxChunkLength = 500,
    caller = "RAG",
  } = options;

  const empty: RAGResult = { chunks: [], formatted: "", totalChunks: 0 };

  try {
    if (!(await hasEmbeddings(pool))) return empty;

    const embedResults = await generateEmbeddings(
      queryTexts,
      "openai/text-embedding-3-large"
    );
    if (!embedResults || embedResults.length === 0) return empty;

    const allChunks: RAGChunk[] = [];
    const seenTexts = new Set<string>();

    // Build the category filter clause once
    const categoryFilter =
      categories && categories.length > 0
        ? `AND d.category = ANY($4::text[])`
        : "";

    for (const embedResult of embedResults) {
      const embStr = `[${embedResult.embedding.join(",")}]`;
      try {
        const queryParams: (string | number | string[])[] = [
          embStr,
          threshold,
          topK,
        ];
        if (categories && categories.length > 0) {
          queryParams.push(categories);
        }

        const result = await pool.query(
          `SELECT
            e.chunk_text,
            d.title,
            d.filename,
            d.category,
            d.is_global,
            d.source_url,
            1 - (e.embedding <=> $1::vector) as similarity
          FROM rag_embeddings e
          JOIN rag_documents d ON e.document_id = d.id
          WHERE d.status = 'indexed'
            AND 1 - (e.embedding <=> $1::vector) >= $2
            ${categoryFilter}
          ORDER BY e.embedding <=> $1::vector
          LIMIT $3`,
          queryParams
        );

        for (const row of result.rows) {
          const text = row.chunk_text?.trim();
          if (!text || seenTexts.has(text)) continue;
          seenTexts.add(text);
          allChunks.push({
            text,
            score: parseFloat(row.similarity),
            source: row.title || row.filename || "Unknown",
            category: row.category || null,
            isGlobal: row.is_global || false,
            sourceUrl: row.source_url || null,
          });
        }
      } catch (queryErr: any) {
        console.warn(`[${caller}] Knowledge query failed: ${queryErr.message}`);
      }
    }

    if (allChunks.length === 0) return empty;

    // Sort by relevance score descending, deduplicated
    allChunks.sort((a, b) => b.score - a.score);
    const topChunks = allChunks.slice(0, topK * 2); // allow headroom from multiple query texts

    const categoryLabel =
      categories && categories.length > 0
        ? ` [categories: ${categories.join(", ")}]`
        : "";
    console.log(
      `[${caller}] Found ${topChunks.length} relevant knowledge chunks${categoryLabel}`
    );

    // Format for LLM injection
    let formatted = "## Relevant Knowledge Base Context\n";
    formatted +=
      "The following excerpts from the knowledge base may be relevant:\n\n";
    for (const chunk of topChunks) {
      const categoryTag = chunk.category ? ` (${chunk.category})` : "";
      formatted += `**[${chunk.source}${categoryTag}]** (relevance: ${(chunk.score * 100).toFixed(0)}%)\n`;
      formatted += `${chunk.text.substring(0, maxChunkLength)}\n\n`;
    }

    return { chunks: topChunks, formatted, totalChunks: topChunks.length };
  } catch (err: any) {
    console.warn(`[${caller}] Knowledge retrieval failed (non-fatal): ${err.message}`);
    return empty;
  }
}

export interface RAGSource {
  name: string;
  url: string | null;
  category: string | null;
  isGlobal: boolean;
}

/**
 * Convenience wrapper that accepts a single query string and returns
 * a structured result compatible with Cohi Chat and Workbench.
 * Includes deduplicated sources for attribution rendering.
 */
export async function retrieveRAGContext(
  question: string,
  pool: pg.Pool,
  options: RAGOptions = {}
): Promise<{ chunks: string[]; sources: RAGSource[]; formatted: string; totalChunks: number }> {
  const queryTexts = buildQueryVariants(question);
  const result = await retrieveKnowledge(queryTexts.length > 0 ? queryTexts : [question], pool, {
    caller: "CohiChat-RAG",
    ...options,
  });

  // Deduplicate sources by name
  const sourceMap = new Map<string, RAGSource>();
  for (const chunk of result.chunks) {
    if (!sourceMap.has(chunk.source)) {
      sourceMap.set(chunk.source, {
        name: chunk.source,
        url: chunk.sourceUrl,
        category: chunk.category,
        isGlobal: chunk.isGlobal,
      });
    }
  }

  return {
    chunks: result.chunks.map((c) => c.text),
    sources: Array.from(sourceMap.values()),
    formatted: result.formatted,
    totalChunks: result.totalChunks,
  };
}

/**
 * Convenience wrapper used by Research Lab and Insight Agents.
 * Accepts a topic string (optionally multi-phrased) and returns a
 * formatted markdown context string ready for LLM injection.
 *
 * Preserves the exact return format of the original getKnowledgeContext.
 */
export async function getKnowledgeContext(
  pool: pg.Pool,
  _tenantId: string,
  topic?: string,
  options: Omit<RAGOptions, "caller"> = {}
): Promise<string> {
  const queryTexts: string[] = [];
  if (topic) {
    queryTexts.push(topic);
    queryTexts.push(`mortgage lending analysis: ${topic}`);
  } else {
    queryTexts.push("mortgage pipeline performance and risk analysis");
    queryTexts.push("loan conversion rates and fallout patterns");
  }

  const result = await retrieveKnowledge(queryTexts, pool, {
    topK: 5,
    threshold: 0.3,
    maxChunkLength: 500,
    caller: "Research-RAG",
    ...options,
  });

  return result.formatted;
}

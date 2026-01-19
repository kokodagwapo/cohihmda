/**
 * Document Chunker Service
 * Splits documents into chunks for embedding based on RAG settings
 */

export interface Chunk {
  text: string;
  index: number;
  tokenCount: number;
  metadata?: Record<string, any>;
}

export interface ChunkingOptions {
  chunkSize: number; // in tokens
  chunkOverlap: number; // in tokens
}

/**
 * Chunk a document into smaller pieces
 */
export function chunkDocument(
  text: string,
  options: ChunkingOptions
): Chunk[] {
  const { chunkSize, chunkOverlap } = options;

  // Split text into sentences (simple approach)
  const sentences = splitIntoSentences(text);
  
  // Convert sentences to tokens and group into chunks
  const chunks: Chunk[] = [];
  let currentChunk: string[] = [];
  let currentTokenCount = 0;
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokenCount(sentence);
    
    // If adding this sentence would exceed chunk size, finalize current chunk
    if (currentTokenCount + sentenceTokens > chunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.join(' '),
        index: chunkIndex++,
        tokenCount: currentTokenCount,
      });

      // Start new chunk with overlap (keep last N tokens)
      const overlapTokens = Math.min(chunkOverlap, currentTokenCount);
      const overlapText = getOverlapText(currentChunk, overlapTokens);
      currentChunk = overlapText.length > 0 ? [overlapText] : [];
      currentTokenCount = overlapText.length > 0 ? estimateTokenCount(overlapText) : 0;
    }

    currentChunk.push(sentence);
    currentTokenCount += sentenceTokens;
  }

  // Add final chunk if it has content
  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.join(' '),
      index: chunkIndex,
      tokenCount: currentTokenCount,
    });
  }

  return chunks;
}

/**
 * Split text into sentences (simple approach)
 */
function splitIntoSentences(text: string): string[] {
  // Simple sentence splitting on periods, exclamation marks, and question marks
  // In production, use a proper NLP library
  return text
    .split(/([.!?]+\s+)/)
    .filter(s => s.trim().length > 0)
    .map(s => s.trim())
    .filter(s => s.length > 10); // Filter out very short fragments
}

/**
 * Get overlap text from the end of current chunk
 */
function getOverlapText(sentences: string[], targetTokens: number): string {
  if (sentences.length === 0) return '';

  let overlapText = '';
  let tokenCount = 0;

  // Start from the end and work backwards
  for (let i = sentences.length - 1; i >= 0 && tokenCount < targetTokens; i--) {
    const sentence = sentences[i];
    const sentenceTokens = estimateTokenCount(sentence);
    
    if (tokenCount + sentenceTokens <= targetTokens) {
      overlapText = sentence + (overlapText ? ' ' + overlapText : '');
      tokenCount += sentenceTokens;
    } else {
      break;
    }
  }

  return overlapText;
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}


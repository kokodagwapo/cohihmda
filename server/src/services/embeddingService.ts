/**
 * Embedding Service
 * Generates embeddings for text chunks using various providers
 */

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokenCount: number;
}

/**
 * Generate embeddings for text chunks
 * @param texts - Array of text strings to embed
 * @param model - Model identifier (e.g., 'openai/text-embedding-3-large')
 * @param apiKey - Optional API key. If not provided, uses environment variable
 */
export async function generateEmbeddings(
  texts: string[],
  model: string = "openai/text-embedding-3-large",
  apiKey?: string
): Promise<EmbeddingResult[]> {
  const [provider, modelName] = model.split("/");

  switch (provider) {
    case "openai":
      return generateOpenAIEmbeddings(texts, modelName, apiKey);
    case "cohere":
      return generateCohereEmbeddings(texts, modelName, apiKey);
    case "aws":
      return generateAWSEmbeddings(texts, modelName, apiKey);
    default:
      throw new Error(`Unsupported embedding provider: ${provider}`);
  }
}

/**
 * Generate embeddings using OpenAI with batching
 * OpenAI recommends batches of ~100 texts max to avoid connection issues
 */
const OPENAI_BATCH_SIZE = 50; // Conservative batch size
const OPENAI_MAX_RETRIES = 3;
const OPENAI_RETRY_DELAY_MS = 1000;

async function generateOpenAIEmbeddings(
  texts: string[],
  modelName: string,
  apiKeyOverride?: string
): Promise<EmbeddingResult[]> {
  const apiKey = apiKeyOverride || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Please set it in RAG settings or environment variables."
    );
  }

  const model = modelName || "text-embedding-3-large";
  const allResults: EmbeddingResult[] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
    const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);
    console.log(
      `[Embeddings] Processing batch ${
        Math.floor(i / OPENAI_BATCH_SIZE) + 1
      }/${Math.ceil(texts.length / OPENAI_BATCH_SIZE)} (${batch.length} texts)`
    );

    const batchResults = await fetchOpenAIEmbeddingsWithRetry(
      batch,
      model,
      apiKey
    );
    allResults.push(...batchResults);

    // Small delay between batches to avoid rate limiting
    if (i + OPENAI_BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return allResults;
}

async function fetchOpenAIEmbeddingsWithRetry(
  texts: string[],
  model: string,
  apiKey: string,
  attempt: number = 1
): Promise<EmbeddingResult[]> {
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `OpenAI API error: ${error.error?.message || "Unknown error"}`
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding: number[] }>;
      usage?: { total_tokens?: number };
    };
    return (data.data || []).map((item: any) => ({
      embedding: item.embedding,
      model: `openai/${model}`,
      tokenCount: data.usage?.total_tokens
        ? Math.floor(data.usage.total_tokens / texts.length)
        : 0,
    }));
  } catch (error: unknown) {
    const isRetryable =
      error instanceof Error &&
      (error.message.includes("ECONNRESET") ||
        error.message.includes("fetch failed") ||
        error.message.includes("rate limit"));

    if (isRetryable && attempt < OPENAI_MAX_RETRIES) {
      console.warn(
        `[Embeddings] Retry ${attempt}/${OPENAI_MAX_RETRIES} after error:`,
        error instanceof Error ? error.message : "Unknown"
      );
      await new Promise((resolve) =>
        setTimeout(resolve, OPENAI_RETRY_DELAY_MS * attempt)
      );
      return fetchOpenAIEmbeddingsWithRetry(texts, model, apiKey, attempt + 1);
    }

    // Log detailed error for debugging
    if (error instanceof Error) {
      console.error("[Embeddings] OpenAI fetch error:", {
        message: error.message,
        cause: (error as any).cause,
        code: (error as any).code,
        attempt,
      });
    }
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to generate OpenAI embeddings: ${errorMessage}`);
  }
}

/**
 * Generate embeddings using Cohere
 */
async function generateCohereEmbeddings(
  texts: string[],
  modelName: string,
  apiKeyOverride?: string
): Promise<EmbeddingResult[]> {
  const apiKey = apiKeyOverride || process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error("COHERE_API_KEY is not configured");
  }

  try {
    const model = modelName || "embed-english-v3.0";
    const response = await fetch("https://api.cohere.ai/v1/embed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        texts,
        input_type: "search_document",
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      throw new Error(`Cohere API error: ${error.message || "Unknown error"}`);
    }

    const data = (await response.json()) as { embeddings?: number[][] };
    return (data.embeddings || []).map(
      (embedding: number[], index: number) => ({
        embedding,
        model: `cohere/${model}`,
        tokenCount: 0, // Cohere doesn't return token count
      })
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to generate Cohere embeddings: ${errorMessage}`);
  }
}

/**
 * Generate embeddings using AWS Bedrock (Titan)
 */
async function generateAWSEmbeddings(
  texts: string[],
  modelName: string,
  apiKeyOverride?: string
): Promise<EmbeddingResult[]> {
  // AWS Bedrock integration would go here
  // This requires AWS SDK and proper credentials
  throw new Error("AWS embeddings not yet implemented");
}

/**
 * Get embedding dimensions for a model
 */
export function getEmbeddingDimensions(model: string): number {
  const [provider, modelName] = model.split("/");

  switch (provider) {
    case "openai":
      if (modelName === "text-embedding-3-large") return 3072;
      if (modelName === "text-embedding-3-small") return 1536;
      return 1536; // Default
    case "cohere":
      if (modelName === "embed-english-v3.0") return 1024;
      return 1024; // Default
    case "aws":
      return 1024; // Titan default
    default:
      return 1536;
  }
}

/**
 * LLM Usage Tracker
 *
 * Lightweight helper to persist OpenAI token usage to the tenant DB
 * (cost_events + cost_daily_summary). Never throws — cost tracking failures
 * are logged as warnings and never propagate to the calling flow.
 *
 * Usage:
 *   import { logLLMUsage } from '../services/llmUsageTracker.js';
 *   await logLLMUsage({ tenantPool, tenantId, model, promptTokens, completionTokens });
 */

import type { Pool } from "pg";
import { logWarn } from "./logger.js";

/**
 * USD price per 1 000 tokens { input, output }.
 * Prices are approximate and reflect OpenAI's March 2026 public pricing.
 * Output-only models (TTS) express cost per 1 000 characters as `input`.
 */
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o":                   { input: 0.0025,  output: 0.010  },
  "gpt-4o-2024-11-20":        { input: 0.0025,  output: 0.010  },
  "gpt-4o-2024-08-06":        { input: 0.0025,  output: 0.010  },
  "gpt-4o-mini":              { input: 0.00015, output: 0.0006 },
  "gpt-4o-mini-2024-07-18":   { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo":              { input: 0.010,   output: 0.030  },
  "gpt-4-turbo-preview":      { input: 0.010,   output: 0.030  },
  "gpt-4":                    { input: 0.030,   output: 0.060  },
  "gpt-3.5-turbo":            { input: 0.0005,  output: 0.0015 },
  "o1":                       { input: 0.015,   output: 0.060  },
  "o1-mini":                  { input: 0.003,   output: 0.012  },
  "o3-mini":                  { input: 0.0011,  output: 0.0044 },
  // TTS: cost is per 1K characters (passed as promptTokens); output price = 0
  "tts-1":                    { input: 0.015,   output: 0      },
  "tts-1-hd":                 { input: 0.030,   output: 0      },
};

/** Fall-back price for unknown models. */
const DEFAULT_PRICE = MODEL_PRICES["gpt-4o"];

export interface LLMUsageEvent {
  tenantPool: Pool;
  tenantId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
  /** Who triggered the call — 'post-sync-hook', 'user', 'scheduler', etc. */
  requestedBy?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Persist a single LLM usage event to cost_events and upsert the daily summary.
 * Silently drops failures — never throws.
 */
export async function logLLMUsage(event: LLMUsageEvent): Promise<void> {
  const {
    tenantPool,
    tenantId,
    model,
    promptTokens,
    completionTokens,
    requestedBy,
    metadata,
  } = event;

  const totalTokens = event.totalTokens ?? promptTokens + completionTokens;
  const prices = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  const inputCost = (promptTokens / 1000) * prices.input;
  const outputCost = (completionTokens / 1000) * prices.output;
  const totalCost = inputCost + outputCost;
  const unitPrice = totalTokens > 0 ? totalCost / totalTokens : 0;

  try {
    await tenantPool.query(
      `INSERT INTO public.cost_events
         (tenant_id, service_category, service_provider, service_name,
          usage_type, usage_amount, usage_unit, unit_price, total_cost,
          prompt_tokens, completion_tokens, total_tokens, requested_by, metadata)
       VALUES ($1, 'llm', 'openai', $2, 'tokens', $3, 'tokens', $4, $5, $6, $7, $8, $9, $10)`,
      [
        tenantId,
        model,
        totalTokens,
        unitPrice,
        totalCost,
        promptTokens,
        completionTokens,
        totalTokens,
        requestedBy ?? null,
        JSON.stringify(metadata ?? {}),
      ]
    );

    const today = new Date().toISOString().split("T")[0];
    await tenantPool.query(
      `INSERT INTO public.cost_daily_summary
         (tenant_id, date, total_cost, total_tokens, prompt_tokens, completion_tokens)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, date) DO UPDATE
         SET total_cost        = cost_daily_summary.total_cost + EXCLUDED.total_cost,
             total_tokens      = cost_daily_summary.total_tokens + EXCLUDED.total_tokens,
             prompt_tokens     = cost_daily_summary.prompt_tokens + EXCLUDED.prompt_tokens,
             completion_tokens = cost_daily_summary.completion_tokens + EXCLUDED.completion_tokens,
             updated_at        = NOW()`,
      [tenantId, today, totalCost, totalTokens, promptTokens, completionTokens]
    );
  } catch (err: any) {
    logWarn(
      `[LLMUsage] Failed to log usage for tenant ${tenantId} model ${model}: ${err.message}`
    );
  }
}

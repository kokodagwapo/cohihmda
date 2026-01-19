// @ts-nocheck
import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database.js';
import { AuthRequest } from './auth.js';

/**
 * Middleware to track costs for API operations
 * Usage: Apply to routes that incur costs (voice AI, LLM calls, etc.)
 */
export interface CostTrackingOptions {
  serviceCategory: 'voice_ai' | 'llm' | 'embedding' | 'aws' | 'vector_db' | 'other';
  serviceProvider: string; // 'gemini', 'openai', 'aws', 'pinecone', etc.
  serviceName: string; // 'gemini-2.0-flash-live', 'gpt-4o', etc.
  getUsageAmount: (req: Request, res: Response) => Promise<{ amount: number; unit: string }> | { amount: number; unit: string };
  getUnitPrice: (req: Request, res: Response) => number;
  getMetadata?: (req: Request, res: Response) => Record<string, any>;
}

/**
 * Create a cost tracking middleware with specific options
 */
export function trackCost(options: CostTrackingOptions) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to track costs after response
    res.json = function (body: any) {
      try {
        // Only track if request was successful (2xx status)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          Promise.resolve(logCost(req, res, options)).catch((error) => {
            console.error('Error tracking cost:', error);
          });
        }
      } catch (error) {
        // Don't fail the request if cost tracking fails
        console.error('Error tracking cost:', error);
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * Log a cost event to the database
 */
async function logCost(
  req: AuthRequest,
  res: Response,
  options: CostTrackingOptions
) {
  try {
    // Get tenant_id from request (if authenticated)
    if (!req.userId) {
      return; // Skip tracking for unauthenticated requests
    }

    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return; // No tenant found
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Get usage amount
    const usage = await Promise.resolve(options.getUsageAmount(req, res));
    if (usage.amount <= 0) {
      return; // No usage to track
    }

    // Get unit price
    const unitPrice = options.getUnitPrice(req, res);
    const totalCost = usage.amount * unitPrice;

    // Get metadata
    const metadata = options.getMetadata ? options.getMetadata(req, res) : {};

    // Get session_id from request if available (for voice AI)
    const sessionId = (req.body?.session_id || req.query?.session_id || metadata?.session_id) as string | undefined;

    // Get instance_id if available
    const instanceId = (req.body?.instance_id || req.query?.instance_id || metadata?.instance_id) as string | undefined;

    // Insert cost event
    await pool.query(
      `INSERT INTO public.cost_events
       (tenant_id, instance_id, service_category, service_provider, service_name,
        usage_type, usage_amount, usage_unit, unit_price, total_cost,
        request_id, user_id, session_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        tenantId,
        instanceId || null,
        options.serviceCategory,
        options.serviceProvider,
        options.serviceName,
        usage.unit, // e.g., 'audio_input_minutes', 'tokens', 'requests'
        usage.amount,
        usage.unit,
        unitPrice,
        totalCost,
        req.headers['x-request-id'] || null,
        req.userId,
        sessionId || null,
        JSON.stringify(metadata),
      ]
    );

    // Update daily summary (async, don't wait)
    updateDailySummary(tenantId, options.serviceCategory, totalCost, usage).catch((error) => {
      console.error('Error updating daily summary:', error);
    });
  } catch (error) {
    console.error('Error logging cost:', error);
    // Don't throw - cost tracking should never break the request
  }
}

/**
 * Update daily cost summary (materialized view)
 */
async function updateDailySummary(
  tenantId: string,
  category: string,
  cost: number,
  usage: { amount: number; unit: string }
) {
  const today = new Date().toISOString().split('T')[0];

  // Get or create daily summary
  const existing = await pool.query(
    'SELECT id FROM public.cost_daily_summary WHERE tenant_id = $1 AND date = $2',
    [tenantId, today]
  );

  if (existing.rows.length === 0) {
    // Create new daily summary
    await pool.query(
      `INSERT INTO public.cost_daily_summary (tenant_id, date, total_cost)
       VALUES ($1, $2, $3)`,
      [tenantId, today, cost]
    );
  } else {
    // Update existing summary based on category
    const updateFields: string[] = ['total_cost = total_cost + $3'];
    const values: any[] = [tenantId, today, cost];
    let paramIndex = 4;

    // Update category-specific fields
    switch (category) {
      case 'voice_ai':
        if (usage.unit === 'minutes') {
          updateFields.push(`voice_total_minutes = COALESCE(voice_total_minutes, 0) + $${paramIndex}`);
          values.push(usage.amount);
          paramIndex++;
        }
        // Could add provider-specific fields here
        break;
      case 'llm':
        if (usage.unit === 'tokens') {
          // Would need to distinguish input vs output tokens
          // For now, just update total_cost
        }
        break;
      // Add more cases as needed
    }

    await pool.query(
      `UPDATE public.cost_daily_summary
       SET ${updateFields.join(', ')}, updated_at = NOW()
       WHERE tenant_id = $1 AND date = $2`,
      values
    );
  }
}

/**
 * Helper function to manually log a cost event
 * Useful for tracking costs outside of middleware
 */
export async function logCostEvent(
  tenantId: string,
  options: {
    instanceId?: string;
    serviceCategory: CostTrackingOptions['serviceCategory'];
    serviceProvider: string;
    serviceName: string;
    usageType: string;
    usageAmount: number;
    usageUnit: string;
    unitPrice: number;
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
  }
) {
  try {
    const totalCost = options.usageAmount * options.unitPrice;

    await pool.query(
      `INSERT INTO public.cost_events
       (tenant_id, instance_id, service_category, service_provider, service_name,
        usage_type, usage_amount, usage_unit, unit_price, total_cost,
        user_id, session_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        tenantId,
        options.instanceId || null,
        options.serviceCategory,
        options.serviceProvider,
        options.serviceName,
        options.usageType,
        options.usageAmount,
        options.usageUnit,
        options.unitPrice,
        totalCost,
        options.userId || null,
        options.sessionId || null,
        JSON.stringify(options.metadata || {}),
      ]
    );

    // Update daily summary
    await updateDailySummary(tenantId, options.serviceCategory, totalCost, {
      amount: options.usageAmount,
      unit: options.usageUnit,
    });
  } catch (error) {
    console.error('Error logging cost event:', error);
    throw error;
  }
}


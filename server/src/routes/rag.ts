import { Router } from "express";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import {
  encryptAPIKeys,
  decryptAPIKeys,
} from "../services/encryption.js";
import { auditLog, logDataAccess } from "../services/auditLogger.js";
import pg from "pg";

/**
 * Helper function to resolve tenant context from auth request
 * Uses JWT token values instead of querying the database
 */
function resolveTenantContext(
  req: AuthRequest,
  requestedTenantId?: string
): {
  targetTenantId: string | null;
  isSuperAdmin: boolean;
  noTenantContext?: boolean;
  error?: { status: number; message: string };
} {
  const isSuperAdmin =
    req.isSuperAdmin ||
    req.userRole === "super_admin" ||
    req.userRole === "platform_admin";
  const userTenantId = req.tenantId;

  let targetTenantId: string | null = null;

  if (isSuperAdmin && requestedTenantId) {
    targetTenantId = requestedTenantId;
  } else if (userTenantId) {
    targetTenantId = userTenantId;
  } else if (isSuperAdmin) {
    // Platform admin without tenant context - return flag for GET requests to return defaults
    return {
      targetTenantId: null,
      isSuperAdmin,
      noTenantContext: true,
    };
  } else {
    return {
      targetTenantId: null,
      isSuperAdmin,
      error: {
        status: 403,
        message: "Access denied. Tenant context required.",
      },
    };
  }

  return { targetTenantId, isSuperAdmin };
}

/**
 * Helper function to get tenant pool for RAG settings
 * Uses tenantDatabaseManager to connect to tenant-specific database
 */
async function getTenantPoolForRag(tenantId: string): Promise<pg.Pool> {
  return tenantDbManager.getTenantPool(tenantId);
}

/**
 * Create rag_settings table in tenant database if it doesn't exist
 */
async function createRagSettingsTable(tenantPool: pg.Pool): Promise<void> {
  await tenantPool.query(`
    CREATE TABLE IF NOT EXISTS public.rag_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Embedding/RAG configuration
      embedding_model TEXT DEFAULT 'text-embedding-3-small',
      vector_database TEXT DEFAULT 'pgvector',
      chunk_size INTEGER DEFAULT 1000,
      chunk_overlap INTEGER DEFAULT 200,
      top_k INTEGER DEFAULT 5,
      similarity_threshold NUMERIC DEFAULT 0.7,
      enable_reranking BOOLEAN DEFAULT false,
      reranking_model TEXT,
      context_window INTEGER DEFAULT 8000,
      -- Chat model configuration
      chat_model TEXT DEFAULT 'gpt-5.4-mini',
      temperature NUMERIC DEFAULT 0.7,
      custom_system_prompt TEXT,
      -- PII/Privacy settings
      enable_pii_sanitization BOOLEAN DEFAULT true,
      redact_ssn BOOLEAN DEFAULT true,
      redact_dob BOOLEAN DEFAULT true,
      redact_account_numbers BOOLEAN DEFAULT true,
      allow_employee_names BOOLEAN DEFAULT false,
      log_ai_interactions BOOLEAN DEFAULT true,
      -- API Keys (encrypted)
      openai_api_key TEXT,
      gemini_api_key TEXT,
      -- Voice Agentic settings
      voice_agentic_enabled BOOLEAN DEFAULT false,
      voice_model TEXT DEFAULT 'gpt-4o-mini',
      voice_name TEXT DEFAULT 'Aria',
      voice_top_k INTEGER DEFAULT 3,
      voice_similarity_threshold NUMERIC DEFAULT 0.75,
      voice_context_window INTEGER DEFAULT 4000,
      voice_temperature NUMERIC DEFAULT 0.8,
      voice_response_max_length INTEGER DEFAULT 60,
      voice_conversation_memory INTEGER DEFAULT 10,
      voice_rag_enabled BOOLEAN DEFAULT true,
      voice_system_prompt TEXT,
      voice_enable_reranking BOOLEAN DEFAULT false,
      voice_real_time_mode BOOLEAN DEFAULT false,
      -- Personality/Conversation settings
      allowed_topics TEXT,
      conversation_rules TEXT,
      personality_tone TEXT DEFAULT 'professional',
      personality_style TEXT DEFAULT 'concise',
      personality_custom TEXT,
      knowledge_base_links TEXT,
      -- Timestamps
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Ensure rag_settings table and row exists in tenant database
 * Creates table if missing, then creates default settings if no row exists
 */
async function ensureRagSettings(tenantPool: pg.Pool): Promise<void> {
  // First, create the table if it doesn't exist
  await createRagSettingsTable(tenantPool);

  // Then check if a row exists
  const existing = await tenantPool.query(
    "SELECT id FROM public.rag_settings LIMIT 1"
  );
  if (existing.rows.length === 0) {
    // Create default settings
    const defaultAllowedTopics = `Loan origination
Underwriting
Compliance and regulatory requirements
Staff productivity and performance
TopTiering system and rankings
Fallout estimation and prediction
Market trends and industry news
Executive insights and strategic clarity
Company health signals
Profitability analysis
Cycle time optimization
Capacity management
Risk assessment
Operational bottlenecks
Performance metrics and benchmarks`;

    const defaultConversationRules = `Always ask for clarification when information is unclear
Never provide financial advice or make credit decisions
Always cite sources when referencing data or metrics
Be proactive and predictive - surface important information before being asked
Connect insights across different domains (market trends, staff performance, operational data)
Use executive-level language appropriate for leadership
Speak clearly and concisely - every word counts
Provide actionable insights that lead to decisions
Never include stage directions or bracketed text in responses
Read financial figures in full professional terms (e.g., "one point two million dollars" not "1.2M")
Stay current with mortgage industry trends and Fed announcements`;

    const defaultKnowledgeBaseLinks = `https://docs.coheus.com
https://wiki.coheus.com/knowledge-base
https://docs.coheus.com/rag
https://docs.coheus.com/voice-agentic`;

    const defaultPersonalityCustom = `Be proactive and predictive - identify patterns before they become problems. Ask smart questions the CEO didn't even think of. Connect dots others might miss across market trends, staff performance, and operational data. Surface hidden opportunities and risks. Deliver insights like a trusted advisor, not just reporting data but providing strategic intelligence. Think like a Chief of Staff - every insight should matter to leadership and lead to actionable decisions.`;

    await tenantPool.query(
      `INSERT INTO public.rag_settings (
        allowed_topics, 
        conversation_rules, 
        knowledge_base_links,
        personality_tone,
        personality_style,
        personality_custom
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        defaultAllowedTopics,
        defaultConversationRules,
        defaultKnowledgeBaseLinks,
        "professional",
        "concise",
        defaultPersonalityCustom,
      ]
    );

    console.log(
      "[RAG Settings] Created rag_settings table and default row in tenant database"
    );
  }
}

const router = Router();

// Validation schemas
const ragSettingsSchema = z.object({
  embedding_model: z.string().optional(),
  vector_database: z.enum(["pinecone", "pgvector", "opensearch"]).optional(),
  chunk_size: z.number().int().min(1).max(8192).optional(),
  chunk_overlap: z.number().int().min(0).optional(),
  top_k: z.number().int().min(1).max(50).optional(),
  similarity_threshold: z.number().min(0).max(1).optional(),
  enable_reranking: z.boolean().optional(),
  reranking_model: z.string().optional(),
  context_window: z.number().int().min(1).max(200000).optional(),
  chat_model: z.string().optional(),
  voice_model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  custom_system_prompt: z.string().optional(),
  enable_pii_sanitization: z.boolean().optional(),
  redact_ssn: z.boolean().optional(),
  redact_dob: z.boolean().optional(),
  redact_account_numbers: z.boolean().optional(),
  allow_employee_names: z.boolean().optional(),
  log_ai_interactions: z.boolean().optional(),
  // API Keys
  openai_api_key: z.string().nullable().optional(),
  gemini_api_key: z.string().nullable().optional(),
  // Cohi Voice Agentic specific settings
  voice_agentic_enabled: z.boolean().optional(),
  voice_name: z.string().optional(),
  voice_top_k: z.number().int().min(1).max(20).optional(),
  voice_similarity_threshold: z.number().min(0).max(1).optional(),
  voice_context_window: z.number().int().min(1000).max(32000).optional(),
  voice_temperature: z.number().min(0).max(2).optional(),
  voice_response_max_length: z.number().int().min(10).max(180).optional(),
  voice_conversation_memory: z.number().int().min(5).max(50).optional(),
  voice_rag_enabled: z.boolean().optional(),
  voice_system_prompt: z.string().optional(),
  voice_enable_reranking: z.boolean().optional(),
  voice_real_time_mode: z.boolean().optional(),
  // Voice agentic configuration fields
  allowed_topics: z.string().nullable().optional(),
  conversation_rules: z.string().nullable().optional(),
  personality_tone: z.string().optional(),
  personality_style: z.string().optional(),
  personality_custom: z.string().nullable().optional(),
  knowledge_base_links: z.string().nullable().optional(),
});

/**
 * GET /api/rag/settings
 * Get RAG settings for authenticated tenant (from tenant-specific database)
 */
router.get("/settings", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const requestedTenantId = req.query.tenant_id as string | undefined;

    // Use helper to resolve tenant context
    const { targetTenantId, isSuperAdmin, noTenantContext, error } =
      resolveTenantContext(req, requestedTenantId);

    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    // For platform admins without tenant context, return default/empty settings
    if (noTenantContext) {
      return res.json({
        settings: {
          // Return default values so the UI can display them
          embedding_model: "text-embedding-3-small",
          chat_model: "gpt-5.4-mini",
          temperature: 0.7,
          chunk_size: 1000,
          chunk_overlap: 200,
          top_k: 5,
          similarity_threshold: 0.7,
          enable_pii_sanitization: true,
        },
        message: "No tenant selected. Select a tenant to view/edit settings.",
      });
    }

    if (!targetTenantId) {
      return res
        .status(403)
        .json({ error: "Access denied. Tenant context required." });
    }

    // Get tenant database pool
    const tenantPool = await getTenantPoolForRag(targetTenantId);

    // Ensure default settings exist
    await ensureRagSettings(tenantPool);

    // Get settings from tenant database (no tenant_id column)
    const result = await tenantPool.query(
      "SELECT * FROM public.rag_settings LIMIT 1"
    );

    if (result.rows.length === 0) {
      return res.json({ settings: {} });
    }

    const settings = result.rows[0];

    // Decrypt API keys before returning
    const decryptedSettings = await decryptAPIKeys(settings);

    // Log data access (isPlatformAdmin flag for platform admins accessing tenant data)
    await logDataAccess({
      userId: req.userId!,
      tenantId: targetTenantId,
      resourceType: "rag_settings",
      resourceId: settings.id,
      action: "view",
      containsPII: true,
      piiFields: ["openai_api_key", "gemini_api_key"],
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      isPlatformAdmin: isSuperAdmin && requestedTenantId !== undefined,
    });

    res.json({ settings: decryptedSettings });
  } catch (error: any) {
    console.error("Error fetching RAG settings:", error);
    res.status(500).json({ error: "Failed to fetch RAG settings" });
  }
});

/**
 * PUT /api/rag/settings
 * Update RAG settings for authenticated tenant (in tenant-specific database)
 */
router.put("/settings", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const updates = ragSettingsSchema.parse(req.body);
    const requestedTenantId = req.query.tenant_id as string | undefined;

    // Use auth middleware values (from JWT token) instead of querying database
    const isSuperAdmin =
      req.isSuperAdmin ||
      req.userRole === "super_admin" ||
      req.userRole === "platform_admin";
    const userTenantId = req.tenantId;

    console.log(
      `[RAG Settings] User role: ${req.userRole}, isSuperAdmin: ${isSuperAdmin}, requestedTenantId: ${requestedTenantId}, userTenantId: ${userTenantId}`
    );

    // Determine target tenant
    let targetTenantId: string;
    if (isSuperAdmin && requestedTenantId) {
      targetTenantId = requestedTenantId;
      console.log(
        `[RAG Settings] Super admin updating tenant: ${targetTenantId}`
      );
    } else if (userTenantId) {
      targetTenantId = userTenantId;
      console.log(
        `[RAG Settings] Regular user updating their tenant: ${targetTenantId}`
      );
    } else if (isSuperAdmin) {
      // Super admin without tenant context - need tenant_id param
      return res.status(400).json({
        error: "tenant_id query parameter required for platform admins",
      });
    } else {
      return res
        .status(403)
        .json({ error: "Access denied. Tenant context required." });
    }

    // Get tenant database pool
    const tenantPool = await getTenantPoolForRag(targetTenantId);

    // Ensure rag_settings row exists
    await ensureRagSettings(tenantPool);

    // Encrypt API keys before storing
    const encryptedUpdates = await encryptAPIKeys(updates);

    // Build dynamic UPDATE query (no tenant_id column in tenant-specific DB)
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(encryptedUpdates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    // Update the single rag_settings row in tenant database
    const query = `
      UPDATE public.rag_settings
      SET ${updateFields.join(", ")}, updated_at = NOW()
      RETURNING *
    `;

    console.log(
      `[RAG Settings] Updating settings in tenant database for: ${targetTenantId}`
    );
    console.log(
      `[RAG Settings] Fields being updated:`,
      Object.keys(encryptedUpdates).filter(
        (k) => encryptedUpdates[k] !== undefined
      )
    );

    const result = await tenantPool.query(query, values);
    console.log(`[RAG Settings] UPDATE returned ${result.rows.length} rows`);

    if (result.rows.length === 0) {
      return res.status(500).json({ error: "Failed to update RAG settings" });
    }

    // Decrypt before returning
    const decryptedResult = await decryptAPIKeys(result.rows[0]);

    // Audit log
    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      tenantId: targetTenantId,
      action: "update",
      resource: "rag_settings",
      description: "Updated RAG settings in tenant database",
      changes: { fields: Object.keys(updates) },
      status: "success",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({ settings: decryptedResult });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: "Invalid request data", details: error.errors });
    }
    console.error("Error updating RAG settings:", error);
    res.status(500).json({ error: "Failed to update RAG settings" });
  }
});

// --- Unused endpoints removed (sources, documents, voice, search) ---
// These were prototype endpoints with no frontend callers.
// Source/document management is handled via ragKnowledgeBase.ts


/**
 * GET /api/rag/costs
 * Get RAG-related costs for authenticated tenant
 */
router.get("/costs", authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Check if super admin is requesting a specific tenant's costs
    const requestedTenantId = req.query.tenant_id as string | undefined;

    // Use helper to resolve tenant context
    const { targetTenantId, noTenantContext, error } = resolveTenantContext(
      req,
      requestedTenantId
    );

    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    // For platform admins without tenant context, return empty costs
    if (noTenantContext) {
      return res.json({
        costs: [],
        message: "No tenant selected. Select a tenant to view costs.",
      });
    }

    if (!targetTenantId) {
      return res
        .status(403)
        .json({ error: "Access denied. Tenant context required." });
    }

    const tenantId = targetTenantId;

    // Get date range (default to last 30 days)
    const startDate =
      (req.query.start_date as string) ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = (req.query.end_date as string) || new Date().toISOString();

    // Get tenant database pool
    const tenantPool = await getTenantPoolForRag(tenantId);

    // Check if cost_events table exists in tenant DB
    try {
      const tableCheck = await tenantPool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'cost_events'
        )`
      );

      const tableExists = tableCheck.rows[0]?.exists;

      if (!tableExists) {
        console.log(
          "cost_events table does not exist in tenant DB, returning empty costs array"
        );
        return res.json({ costs: [] });
      }

      // Query RAG-related costs from tenant DB (no tenant_id filter needed)
      const result = await tenantPool.query(
        `SELECT 
          id,
          service_category,
          service_provider,
          service_name,
          usage_type,
          usage_amount,
          usage_unit,
          unit_price,
          total_cost,
          created_at,
          metadata
         FROM cost_events
         WHERE service_category IN ('embedding', 'chat', 'voice_ai', 'rag', 'vector_search')
           AND created_at >= $1 
           AND created_at <= $2
         ORDER BY created_at DESC
         LIMIT 1000`,
        [startDate, endDate]
      );

      res.json({ costs: result.rows });
    } catch (dbError: any) {
      // If table doesn't exist (42P01 = relation does not exist)
      if (dbError.code === "42P01") {
        console.log(
          "cost_events table does not exist in tenant DB, returning empty costs array"
        );
        return res.json({ costs: [] });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error("Error fetching RAG costs:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch RAG costs", details: error.message });
  }
});

export default router;

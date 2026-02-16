/**
 * Insight Feedback & Training Admin Routes
 *
 * Platform admin endpoints for:
 * - Reviewing insight feedback across all tenants
 * - Aggregate feedback stats
 * - Managing training examples (CRUD)
 */

import { Router, Response } from "express";
import { pool as managementPool } from "../../config/managementDatabase.js";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { z } from "zod";

const router = Router();

// Require platform admin for all routes
const requirePlatformAdmin = requireRole("super_admin", "platform_admin");

// ============================================================================
// GET /api/admin/insight-feedback - Paginated feedback across tenants
// ============================================================================
router.get(
  "/",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const querySchema = z.object({
        tenant_id: z.string().optional(),
        bucket: z.string().optional(),
        rating: z.enum(["1", "-1"]).optional(),
        page: z.string().optional().default("1"),
        limit: z.string().optional().default("50"),
      });

      const { tenant_id, bucket, rating, page, limit } = querySchema.parse(req.query);
      const pageNum = parseInt(page, 10);
      const limitNum = Math.min(parseInt(limit, 10), 100);
      const offset = (pageNum - 1) * limitNum;

      // If a specific tenant is specified, query their DB
      if (tenant_id) {
        try {
          const tenantPool = await tenantDbManager.getTenantPool(tenant_id);

          // Check if table exists
          const tableCheck = await tenantPool.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'insight_feedback'
            ) as exists
          `);

          if (!tableCheck.rows[0]?.exists) {
            return res.json({ feedback: [], total: 0, page: pageNum, limit: limitNum });
          }

          let whereClause = "WHERE 1=1";
          const params: any[] = [];
          let paramIdx = 1;

          if (bucket) {
            whereClause += ` AND f.insight_bucket = $${paramIdx++}`;
            params.push(bucket);
          }
          if (rating) {
            whereClause += ` AND f.rating = $${paramIdx++}`;
            params.push(parseInt(rating, 10));
          }

          const countResult = await tenantPool.query(
            `SELECT COUNT(*) as total FROM insight_feedback f ${whereClause}`,
            params
          );

          const result = await tenantPool.query(
            `SELECT f.id, f.insight_id, f.user_id, f.user_email, f.user_name, f.rating, f.tags, f.comment, f.insight_headline, f.insight_bucket, f.created_at
             FROM insight_feedback f
             ${whereClause}
             ORDER BY f.created_at DESC
             LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            [...params, limitNum, offset]
          );

          return res.json({
            feedback: result.rows.map((r: any) => ({ ...r, tenant_id })),
            total: parseInt(countResult.rows[0].total, 10),
            page: pageNum,
            limit: limitNum,
          });
        } catch (err: any) {
          console.error(`[InsightFeedback] Error querying tenant ${tenant_id}:`, err);
          return res.json({ feedback: [], total: 0, page: pageNum, limit: limitNum });
        }
      }

      // Without tenant_id, return empty (multi-tenant query requires explicit tenant selection)
      return res.json({
        feedback: [],
        total: 0,
        page: pageNum,
        limit: limitNum,
        message: "Specify tenant_id to view feedback",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid query params", details: error.errors });
      }
      console.error("[InsightFeedback] Error listing feedback:", error);
      res.status(500).json({ error: error.message || "Failed to list feedback" });
    }
  }
);

// ============================================================================
// GET /api/admin/insight-feedback/stats - Aggregate feedback stats for a tenant
// ============================================================================
router.get(
  "/stats",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenant_id } = req.query;

      if (!tenant_id) {
        return res.status(400).json({ error: "tenant_id is required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenant_id as string);

      // Check if table exists
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'insight_feedback'
        ) as exists
      `);

      if (!tableCheck.rows[0]?.exists) {
        return res.json({
          totalFeedback: 0,
          positiveCount: 0,
          negativeCount: 0,
          positiveRate: 0,
          bucketDistribution: [],
          topTags: [],
          worstInsights: [],
        });
      }

      // Total counts
      const countsResult = await tenantPool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN rating = 1 THEN 1 END) as positive,
          COUNT(CASE WHEN rating = -1 THEN 1 END) as negative
        FROM insight_feedback
      `);

      const total = parseInt(countsResult.rows[0].total, 10);
      const positive = parseInt(countsResult.rows[0].positive, 10);
      const negative = parseInt(countsResult.rows[0].negative, 10);

      // Bucket distribution
      const bucketResult = await tenantPool.query(`
        SELECT insight_bucket as bucket, rating, COUNT(*) as count
        FROM insight_feedback
        WHERE insight_bucket IS NOT NULL
        GROUP BY insight_bucket, rating
        ORDER BY insight_bucket
      `);

      // Tag frequency
      const tagResult = await tenantPool.query(`
        SELECT tag, COUNT(*) as count
        FROM insight_feedback, unnest(tags) AS tag
        GROUP BY tag
        ORDER BY count DESC
        LIMIT 10
      `);

      // Worst rated insights (most negative feedback)
      const worstResult = await tenantPool.query(`
        SELECT insight_headline, insight_bucket, COUNT(*) as neg_count
        FROM insight_feedback
        WHERE rating = -1 AND insight_headline IS NOT NULL
        GROUP BY insight_headline, insight_bucket
        ORDER BY neg_count DESC
        LIMIT 10
      `);

      res.json({
        totalFeedback: total,
        positiveCount: positive,
        negativeCount: negative,
        positiveRate: total > 0 ? Math.round((positive / total) * 100) : 0,
        bucketDistribution: bucketResult.rows,
        topTags: tagResult.rows,
        worstInsights: worstResult.rows,
      });
    } catch (error: any) {
      console.error("[InsightFeedback] Error fetching stats:", error);
      res.status(500).json({ error: error.message || "Failed to fetch feedback stats" });
    }
  }
);

// ============================================================================
// Training Examples CRUD
// ============================================================================

// GET /api/admin/insight-feedback/training-examples - List training examples
router.get(
  "/training-examples",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      // Check if table exists
      const tableCheck = await managementPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'insight_training_examples'
        ) as exists
      `);

      if (!tableCheck.rows[0]?.exists) {
        return res.json({ examples: [], total: 0 });
      }

      const { prompt_id, example_type, active_only } = req.query;

      let whereClause = "WHERE 1=1";
      const params: any[] = [];
      let paramIdx = 1;

      if (prompt_id) {
        whereClause += ` AND prompt_id = $${paramIdx++}`;
        params.push(prompt_id);
      }
      if (example_type) {
        whereClause += ` AND example_type = $${paramIdx++}`;
        params.push(example_type);
      }
      if (active_only === "true") {
        whereClause += ` AND is_active = true`;
      }

      const result = await managementPool.query(
        `SELECT id, prompt_id, example_type, headline, understory, source_insight_id, source_tenant_id,
                feedback_rating, admin_note, curated_by, is_active, created_at
         FROM insight_training_examples
         ${whereClause}
         ORDER BY prompt_id, example_type, created_at DESC`,
        params
      );

      res.json({
        examples: result.rows,
        total: result.rows.length,
      });
    } catch (error: any) {
      console.error("[InsightFeedback] Error listing training examples:", error);
      res.status(500).json({ error: error.message || "Failed to list training examples" });
    }
  }
);

// POST /api/admin/insight-feedback/training-examples - Create a training example
router.post(
  "/training-examples",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      const createSchema = z.object({
        prompt_id: z.string().min(1),
        example_type: z.enum(["positive", "negative"]),
        headline: z.string().min(1),
        understory: z.string().optional(),
        source_insight_id: z.number().optional(),
        source_tenant_id: z.string().optional(),
        feedback_rating: z.union([z.literal(-1), z.literal(1)]).optional(),
        admin_note: z.string().optional(),
      });

      const data = createSchema.parse(req.body);

      const result = await managementPool.query(
        `INSERT INTO insight_training_examples
         (prompt_id, example_type, headline, understory, source_insight_id, source_tenant_id, feedback_rating, admin_note, curated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          data.prompt_id,
          data.example_type,
          data.headline,
          data.understory || null,
          data.source_insight_id || null,
          data.source_tenant_id || null,
          data.feedback_rating || null,
          data.admin_note || null,
          req.userId,
        ]
      );

      res.json({ example: result.rows[0] });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("[InsightFeedback] Error creating training example:", error);
      res.status(500).json({ error: error.message || "Failed to create training example" });
    }
  }
);

// PUT /api/admin/insight-feedback/training-examples/:id - Update a training example
router.put(
  "/training-examples/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      const id = req.params.id;

      const updateSchema = z.object({
        headline: z.string().min(1).optional(),
        understory: z.string().optional(),
        admin_note: z.string().optional(),
        is_active: z.boolean().optional(),
        example_type: z.enum(["positive", "negative"]).optional(),
      });

      const data = updateSchema.parse(req.body);

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (data.headline !== undefined) {
        setClauses.push(`headline = $${paramIdx++}`);
        values.push(data.headline);
      }
      if (data.understory !== undefined) {
        setClauses.push(`understory = $${paramIdx++}`);
        values.push(data.understory);
      }
      if (data.admin_note !== undefined) {
        setClauses.push(`admin_note = $${paramIdx++}`);
        values.push(data.admin_note);
      }
      if (data.is_active !== undefined) {
        setClauses.push(`is_active = $${paramIdx++}`);
        values.push(data.is_active);
      }
      if (data.example_type !== undefined) {
        setClauses.push(`example_type = $${paramIdx++}`);
        values.push(data.example_type);
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      values.push(id);

      const result = await managementPool.query(
        `UPDATE insight_training_examples SET ${setClauses.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Training example not found" });
      }

      res.json({ example: result.rows[0] });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("[InsightFeedback] Error updating training example:", error);
      res.status(500).json({ error: error.message || "Failed to update training example" });
    }
  }
);

// DELETE /api/admin/insight-feedback/training-examples/:id - Delete a training example
router.delete(
  "/training-examples/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      const id = req.params.id;

      const result = await managementPool.query(
        `DELETE FROM insight_training_examples WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Training example not found" });
      }

      res.json({ success: true, deletedId: id });
    } catch (error: any) {
      console.error("[InsightFeedback] Error deleting training example:", error);
      res.status(500).json({ error: error.message || "Failed to delete training example" });
    }
  }
);

// ============================================================================
// Prompt Experiments CRUD
// ============================================================================

// GET /api/admin/insight-feedback/experiments - List experiments
router.get(
  "/experiments",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      // Check if table exists
      const tableCheck = await managementPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'prompt_experiments'
        ) as exists
      `);

      if (!tableCheck.rows[0]?.exists) {
        return res.json({ experiments: [], total: 0 });
      }

      const { prompt_id, status } = req.query;

      let whereClause = "WHERE 1=1";
      const params: any[] = [];
      let paramIdx = 1;

      if (prompt_id) {
        whereClause += ` AND prompt_id = $${paramIdx++}`;
        params.push(prompt_id);
      }
      if (status) {
        whereClause += ` AND status = $${paramIdx++}`;
        params.push(status);
      }

      const result = await managementPool.query(
        `SELECT id, prompt_id, name, description, status,
                variant_system_prompt, variant_model, variant_temperature, variant_max_tokens,
                traffic_pct, created_by, created_at, completed_at
         FROM prompt_experiments
         ${whereClause}
         ORDER BY created_at DESC`,
        params
      );

      res.json({
        experiments: result.rows,
        total: result.rows.length,
      });
    } catch (error: any) {
      console.error("[Experiments] Error listing experiments:", error);
      res.status(500).json({ error: error.message || "Failed to list experiments" });
    }
  }
);

// POST /api/admin/insight-feedback/experiments - Create experiment
router.post(
  "/experiments",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      const createSchema = z.object({
        prompt_id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        variant_system_prompt: z.string().min(1),
        variant_model: z.string().optional(),
        variant_temperature: z.number().min(0).max(2).optional(),
        variant_max_tokens: z.number().int().min(100).optional(),
        traffic_pct: z.number().int().min(0).max(100).default(50),
      });

      const data = createSchema.parse(req.body);

      const result = await managementPool.query(
        `INSERT INTO prompt_experiments
         (prompt_id, name, description, variant_system_prompt, variant_model, variant_temperature, variant_max_tokens, traffic_pct, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          data.prompt_id,
          data.name,
          data.description || null,
          data.variant_system_prompt,
          data.variant_model || null,
          data.variant_temperature ?? null,
          data.variant_max_tokens || null,
          data.traffic_pct,
          req.userId,
        ]
      );

      res.json({ experiment: result.rows[0] });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("[Experiments] Error creating experiment:", error);
      res.status(500).json({ error: error.message || "Failed to create experiment" });
    }
  }
);

// PUT /api/admin/insight-feedback/experiments/:id - Update experiment (status, traffic_pct, etc.)
router.put(
  "/experiments/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      const id = req.params.id;

      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(["draft", "active", "completed", "archived"]).optional(),
        variant_system_prompt: z.string().min(1).optional(),
        variant_model: z.string().optional(),
        variant_temperature: z.number().min(0).max(2).optional(),
        variant_max_tokens: z.number().int().min(100).optional(),
        traffic_pct: z.number().int().min(0).max(100).optional(),
      });

      const data = updateSchema.parse(req.body);

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined) {
          setClauses.push(`${key} = $${paramIdx++}`);
          values.push(val);
        }
      }

      // If status is being set to 'completed', set completed_at
      if (data.status === "completed") {
        setClauses.push(`completed_at = $${paramIdx++}`);
        values.push(new Date().toISOString());
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      values.push(id);

      const result = await managementPool.query(
        `UPDATE prompt_experiments SET ${setClauses.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Experiment not found" });
      }

      res.json({ experiment: result.rows[0] });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("[Experiments] Error updating experiment:", error);
      res.status(500).json({ error: error.message || "Failed to update experiment" });
    }
  }
);

// POST /api/admin/insight-feedback/experiments/:id/promote - Promote experiment variant to production
router.post(
  "/experiments/:id/promote",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      const id = req.params.id;

      // Fetch the experiment
      const expResult = await managementPool.query(
        `SELECT id, prompt_id, variant_system_prompt, variant_model, variant_temperature, variant_max_tokens, status
         FROM prompt_experiments WHERE id = $1`,
        [id]
      );

      if (expResult.rows.length === 0) {
        return res.status(404).json({ error: "Experiment not found" });
      }

      const exp = expResult.rows[0];

      if (exp.status !== "active" && exp.status !== "completed") {
        return res.status(400).json({ error: "Can only promote active or completed experiments" });
      }

      // Update the production prompt config with the variant's system prompt
      const updateResult = await managementPool.query(
        `UPDATE ai_prompt_configs
         SET system_prompt = $1,
             model = COALESCE($2, model),
             temperature = COALESCE($3, temperature),
             max_tokens = COALESCE($4, max_tokens),
             updated_at = NOW()
         WHERE id = $5
         RETURNING id`,
        [
          exp.variant_system_prompt,
          exp.variant_model || null,
          exp.variant_temperature || null,
          exp.variant_max_tokens || null,
          exp.prompt_id,
        ]
      );

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: `Prompt config "${exp.prompt_id}" not found` });
      }

      // Mark experiment as completed
      await managementPool.query(
        `UPDATE prompt_experiments SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [id]
      );

      res.json({
        success: true,
        message: `Promoted experiment variant to production prompt "${exp.prompt_id}"`,
        promotedPromptId: exp.prompt_id,
      });
    } catch (error: any) {
      console.error("[Experiments] Error promoting experiment:", error);
      res.status(500).json({ error: error.message || "Failed to promote experiment" });
    }
  }
);

// DELETE /api/admin/insight-feedback/experiments/:id - Delete experiment
router.delete(
  "/experiments/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!managementPool) {
        return res.status(503).json({ error: "Management database not available" });
      }

      const id = req.params.id;

      const result = await managementPool.query(
        `DELETE FROM prompt_experiments WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Experiment not found" });
      }

      res.json({ success: true, deletedId: id });
    } catch (error: any) {
      console.error("[Experiments] Error deleting experiment:", error);
      res.status(500).json({ error: error.message || "Failed to delete experiment" });
    }
  }
);

export default router;

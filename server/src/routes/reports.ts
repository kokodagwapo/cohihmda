/**
 * Report Generation Routes
 *
 * Endpoints for generating PPTX/PDF reports from:
 * - Explicit ReportDefinition (from Report Builder UI)
 * - Canvas widget data (Quick Report from Canvas)
 * - AI-generated reports (Cohi generates full report)
 * - Report templates (pre-built mortgage industry templates)
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import {
  generatePptx,
  generatePdf,
  resolveReportData,
  canvasToReportDefinition,
  type ReportDefinition,
  type CanvasWidgetForReport,
} from "../services/export/reportGenerationService.js";
import { getLoanAccessContext } from "../services/userLoanAccessService.js";

const router = Router();

// ---------------------------------------------------------------------------
// Ensure report templates table exists
// ---------------------------------------------------------------------------
async function ensureReportTemplatesTable(
  pool: import("pg").Pool
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.workbench_report_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'custom',
      source TEXT DEFAULT 'custom',
      definition JSONB NOT NULL DEFAULT '{}'::jsonb,
      thumbnail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// ---------------------------------------------------------------------------
// POST /generate — Generate report from a full ReportDefinition
// ---------------------------------------------------------------------------
router.post(
  "/generate",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { definition, format = "pptx" } = req.body as {
        definition: ReportDefinition;
        format?: "pptx" | "pdf";
      };

      if (!definition || !definition.slides?.length) {
        return res
          .status(400)
          .json({ error: "Report definition with slides is required" });
      }

      // Get tenant pool for data resolution
      let tenantPool = null;
      let userAccessFilter = null;
      try {
        const ctx = getTenantContext(req);
        tenantPool = ctx.tenantPool;
        const accessCtx = await getLoanAccessContext(req as any, tenantPool);
        userAccessFilter = accessCtx.getFilter("l");
      } catch {
        // No tenant context - proceed without data resolution
      }

      // Resolve data sources
      const resolved = await resolveReportData(
        definition,
        tenantPool,
        userAccessFilter
      );

      // Generate output
      if (format === "pdf") {
        const buffer = await generatePdf(resolved);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${sanitizeFilename(definition.title)}.pdf"`
        );
        return res.send(buffer);
      }

      // Default: PPTX
      const buffer = await generatePptx(resolved);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${sanitizeFilename(definition.title)}.pptx"`
      );
      return res.send(buffer);
    } catch (err: any) {
      console.error("[Reports] Generate error:", err);
      return res
        .status(500)
        .json({ error: "Failed to generate report", details: err.message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /from-canvas — Generate report from current canvas widgets
// ---------------------------------------------------------------------------
router.post(
  "/from-canvas",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { widgetData, format = "pptx", options } = req.body as {
        widgetData: CanvasWidgetForReport[];
        format?: "pptx" | "pdf";
        options?: {
          title?: string;
          theme?: any;
          includeNotes?: boolean;
        };
      };

      if (!widgetData?.length) {
        return res
          .status(400)
          .json({ error: "Widget data is required for canvas report" });
      }

      // Convert canvas widgets to report definition
      const definition = canvasToReportDefinition(widgetData, {
        title: options?.title || "Canvas Report",
        theme: options?.theme,
      });

      // Generate output
      if (format === "pdf") {
        const buffer = await generatePdf(definition);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${sanitizeFilename(definition.title)}.pdf"`
        );
        return res.send(buffer);
      }

      const buffer = await generatePptx(definition);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${sanitizeFilename(definition.title)}.pptx"`
      );
      return res.send(buffer);
    } catch (err: any) {
      console.error("[Reports] Canvas report error:", err);
      return res
        .status(500)
        .json({ error: "Failed to generate canvas report", details: err.message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /ai-generate — AI generates a report definition (preview)
// ---------------------------------------------------------------------------
router.post(
  "/ai-generate",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { prompt, format, context } = req.body as {
        prompt: string;
        format?: "pptx" | "pdf";
        context?: { canvasState?: unknown; widgetData?: CanvasWidgetForReport[] };
      };

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      // For Phase 1, AI report generation is handled via the Cohi workbench
      // route which emits generate_report actions. This endpoint serves as
      // the direct API for programmatic report generation.
      // Full AI integration will be added when the generate_report action
      // handler is wired up.

      return res.status(501).json({
        error: "AI report generation endpoint pending full integration",
        message:
          'Use the Cohi workbench chat with prompts like "build me a pipeline report" to generate AI reports.',
      });
    } catch (err: any) {
      console.error("[Reports] AI generate error:", err);
      return res.status(500).json({ error: "Failed to generate AI report" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /templates — List available report templates
// ---------------------------------------------------------------------------
router.get(
  "/templates",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const templates: any[] = [];

      // Add built-in templates (metadata only, no full definition)
      const builtins = getBuiltinTemplatesList();
      templates.push(...builtins);

      // Add custom templates from DB
      try {
        const ctx = getTenantContext(req);
        await ensureReportTemplatesTable(ctx.tenantPool);
        const result = await ctx.tenantPool.query(
          `SELECT id, name, description, category, source, thumbnail, created_at
           FROM public.workbench_report_templates
           ORDER BY created_at DESC`
        );
        templates.push(
          ...result.rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            category: r.category,
            source: r.source,
            thumbnail: r.thumbnail,
            createdAt: r.created_at,
          }))
        );
      } catch {
        // No tenant context - return builtins only
      }

      return res.json({ templates });
    } catch (err: any) {
      console.error("[Reports] Templates list error:", err);
      return res.status(500).json({ error: "Failed to list templates" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /templates/:id — Get full template definition
// ---------------------------------------------------------------------------
router.get(
  "/templates/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      // Check if it's a builtin template
      const builtin = getBuiltinTemplate(id);
      if (builtin) {
        return res.json({ template: builtin });
      }

      // Check custom templates in DB
      try {
        const ctx = getTenantContext(req);
        await ensureReportTemplatesTable(ctx.tenantPool);
        const result = await ctx.tenantPool.query(
          `SELECT * FROM public.workbench_report_templates WHERE id = $1`,
          [id]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Template not found" });
        }
        return res.json({ template: result.rows[0] });
      } catch {
        return res.status(404).json({ error: "Template not found" });
      }
    } catch (err: any) {
      console.error("[Reports] Template get error:", err);
      return res.status(500).json({ error: "Failed to get template" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /templates — Save a custom report template
// ---------------------------------------------------------------------------
router.post(
  "/templates",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { name, description, category, definition, thumbnail } =
        req.body as {
          name: string;
          description?: string;
          category?: string;
          definition: any;
          thumbnail?: string;
        };

      if (!name || !definition) {
        return res
          .status(400)
          .json({ error: "Name and definition are required" });
      }

      const ctx = getTenantContext(req);
      await ensureReportTemplatesTable(ctx.tenantPool);

      const result = await ctx.tenantPool.query(
        `INSERT INTO public.workbench_report_templates
         (user_id, name, description, category, source, definition, thumbnail)
         VALUES ($1, $2, $3, $4, 'custom', $5, $6)
         RETURNING id, name, description, category, source, created_at`,
        [
          req.userId,
          name,
          description || "",
          category || "custom",
          JSON.stringify(definition),
          thumbnail || null,
        ]
      );

      return res.status(201).json({ template: result.rows[0] });
    } catch (err: any) {
      console.error("[Reports] Template save error:", err);
      return res.status(500).json({ error: "Failed to save template" });
    }
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFilename(name: string): string {
  return (name || "report").replace(/[^a-z0-9_\-\s]/gi, "").replace(/\s+/g, "_");
}

/**
 * Returns metadata for built-in templates (no full definitions for list view).
 */
function getBuiltinTemplatesList() {
  return [
    {
      id: "builtin-pipeline",
      name: "Pipeline Report",
      description:
        "Active pipeline analysis with status breakdown, LO distribution, and aging metrics",
      category: "pipeline",
      source: "builtin",
    },
    {
      id: "builtin-production",
      name: "Production Report",
      description:
        "Monthly closings, funded volume, LO rankings, and branch comparison",
      category: "production",
      source: "builtin",
    },
    {
      id: "builtin-executive",
      name: "Executive Summary",
      description:
        "High-level KPI dashboard with trend charts and key takeaways",
      category: "executive",
      source: "builtin",
    },
    {
      id: "builtin-pull-through",
      name: "Pull-Through Analysis",
      description:
        "Pull-through rates by LO, branch, channel, and loan type with trend analysis",
      category: "pull-through",
      source: "builtin",
    },
    {
      id: "builtin-turn-times",
      name: "Turn Time Report",
      description:
        "Average cycle times by stage, bottleneck identification, and branch comparison",
      category: "turn-times",
      source: "builtin",
    },
    {
      id: "builtin-lo-scorecard",
      name: "Loan Officer Scorecard",
      description:
        "Individual LO performance metrics, pipeline snapshot, and production trends",
      category: "scorecard",
      source: "builtin",
    },
  ];
}

/**
 * Returns the full definition of a built-in template.
 * Template definitions reference DataSource objects that get resolved at generation time.
 */
function getBuiltinTemplate(id: string): any | null {
  // Built-in template definitions are loaded from the frontend reportTemplates.ts
  // For the API, we return the template metadata and the frontend fetches the
  // full definition from its local template library.
  // This allows templates to be defined once in the frontend and reused.
  const templates = getBuiltinTemplatesList();
  const found = templates.find((t) => t.id === id);
  if (!found) return null;

  return {
    ...found,
    definition: null, // Frontend has the full definition
    note: "Built-in template definitions are loaded from the frontend template library",
  };
}

export default router;

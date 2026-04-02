/**
 * Tracked Insights Routes
 *
 * CRUD + history endpoints for the insight watchlist.
 * Users can pin insights and track how they evolve over time.
 *
 * POST   /                — Pin an insight to the watchlist
 * GET    /                — List user's tracked insights with latest snapshot
 * GET    /:id/history     — Get time-series snapshots for a tracked insight
 * PUT    /:id             — Update status, alert threshold, tags
 * DELETE /:id             — Untrack / remove
 */

import { Router } from "express";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { logError } from "../services/logger.js";
import {
  evaluateSingleTrackedInsight,
  type TrackedInsightEvaluationInput,
} from "../services/insights/trackedInsightEvaluator.js";
import { loadDashboardInsightForTracking } from "../services/dashboardInsights/storage.js";
import { deriveDashboardTrackedFromDetailData } from "../services/trackedInsights/dashboardTrackedDerivation.js";
import { inferTrackedMetricPolarity } from "../services/insights/trackedPolarityInference.js";

const router = Router();

type MetricPolarity = "higher_better" | "lower_better" | "neutral";

type NormalizedMetricSignature = {
  sql: string;
  keyFields: string[];
  comparisonKeyFields?: string[];
  polarities?: Record<string, MetricPolarity>;
  params?: unknown[];
  param_resolution?: "none" | "rolling_dashboard";
  refresh_kind?: "sql" | "handler";
  handler_id?: string;
};

function sanitizeMetricParams(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: unknown[] = [];
  for (const x of raw) {
    if (
      x === null ||
      typeof x === "string" ||
      typeof x === "number" ||
      typeof x === "boolean"
    ) {
      out.push(x);
    } else {
      return undefined;
    }
  }
  return out;
}

function deriveExplicitPolaritiesForKeyFields(
  keyFields: string[]
): Record<string, MetricPolarity> {
  const out: Record<string, MetricPolarity> = {};

  for (const rawKey of keyFields) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    const p = inferTrackedMetricPolarity(key);
    if (p !== "neutral") out[key] = p;
  }

  return out;
}

function normalizeMetricSignature(
  raw: unknown,
  opts: { allowEmptySql: boolean }
): NormalizedMetricSignature | null {
  if (!raw || typeof raw !== "object") return null;
  const sig = raw as Record<string, unknown>;
  const refreshKind = sig.refresh_kind === "handler" ? "handler" : "sql";
  const sql = typeof sig.sql === "string" ? sig.sql.trim() : "";

  if (refreshKind === "handler") {
    const handlerId =
      typeof sig.handler_id === "string" ? sig.handler_id.trim() : "";
    if (!handlerId) return null;
  } else if (!opts.allowEmptySql && !sql) {
    return null;
  }

  const keyFieldsRaw = sig.keyFields;
  if (!Array.isArray(keyFieldsRaw)) return null;
  const keyFields = keyFieldsRaw
    .filter((k) => typeof k === "string")
    .map((k) => String(k).trim())
    .filter((k) => k.length > 0);

  if (refreshKind === "handler" && keyFields.length === 0) return null;

  const explicitPolarities = deriveExplicitPolaritiesForKeyFields(keyFields);
  const normalized: NormalizedMetricSignature = { sql, keyFields };

  const ckRaw = sig.comparisonKeyFields;
  if (Array.isArray(ckRaw)) {
    const comparisonKeyFields = ckRaw
      .filter((k) => typeof k === "string")
      .map((k) => String(k).trim())
      .filter((k) => k.length > 0 && keyFields.includes(k));
    if (comparisonKeyFields.length > 0) {
      normalized.comparisonKeyFields = Array.from(new Set(comparisonKeyFields));
    }
  }

  if (refreshKind === "handler") {
    normalized.refresh_kind = "handler";
    normalized.handler_id = String(sig.handler_id).trim();
  }

  const params = sanitizeMetricParams(sig.params);
  if (params && params.length > 0) normalized.params = params;

  const pr = sig.param_resolution;
  if (pr === "none" || pr === "rolling_dashboard") {
    normalized.param_resolution = pr;
  }

  if (Object.keys(explicitPolarities).length > 0) {
    normalized.polarities = explicitPolarities;
  }
  if (
    sig.polarities &&
    typeof sig.polarities === "object" &&
    !Array.isArray(sig.polarities)
  ) {
    normalized.polarities = {
      ...(sig.polarities as NormalizedMetricSignature["polarities"]),
      ...explicitPolarities,
    };
  }
  return normalized;
}

function extractDisplayMetadataFromDetailData(detailData: unknown): {
  keyMetricDescriptions?: Record<string, string>;
  keyMetricFormats?: Record<string, string>;
} {
  if (!detailData || typeof detailData !== "object") return {};
  const dd = detailData as Record<string, unknown>;
  const descriptions =
    dd.keyMetricDescriptions &&
    typeof dd.keyMetricDescriptions === "object" &&
    !Array.isArray(dd.keyMetricDescriptions)
      ? (dd.keyMetricDescriptions as Record<string, string>)
      : undefined;
  const formats =
    dd.keyMetricFormats &&
    typeof dd.keyMetricFormats === "object" &&
    !Array.isArray(dd.keyMetricFormats)
      ? (dd.keyMetricFormats as Record<string, string>)
      : undefined;
  return {
    keyMetricDescriptions: descriptions,
    keyMetricFormats: formats,
  };
}

function addSourceContextToDisplayMetadata(
  base: unknown,
  ctx: {
    original_bucket?: string | null;
    original_priority?: string | null;
    original_severity_score?: number | null;
  }
): Record<string, unknown> {
  const merged: Record<string, unknown> =
    base && typeof base === "object" && !Array.isArray(base)
      ? { ...(base as Record<string, unknown>) }
      : {};
  if (ctx.original_bucket != null) merged.original_bucket = ctx.original_bucket;
  if (ctx.original_priority != null) merged.original_priority = ctx.original_priority;
  if (ctx.original_severity_score != null) {
    merged.original_severity_score = Number(ctx.original_severity_score);
  }
  return merged;
}

/** Same row shape as GET /api/insights/tracked for one id. */
async function fetchTrackedInsightRowWithSnapshot(
  pool: import("pg").Pool,
  userId: string,
  trackedInsightId: string,
  hasDisplayMetaCol: boolean
) {
  const displayMetaSelect = hasDisplayMetaCol ? "ti.display_metadata," : "NULL AS display_metadata,";
  const result = await pool.query(
    `SELECT
       ti.id, ti.headline, ti.understory, ti.status, ti.source_type,
       ti.source_insight_id, ti.tags, ti.created_at, ti.updated_at,
       ti.alert_threshold, ti.metric_signature,
       ${displayMetaSelect}
       s.metric_values AS latest_values,
       s.previous_values AS latest_previous,
       first_s.metric_values AS baseline_values,
       (SELECT COUNT(*)::int FROM tracked_insight_snapshots WHERE tracked_insight_id = ti.id) AS snapshot_count,
       s.change_summary AS latest_change,
       s.trend AS latest_trend,
       s.evaluated_at AS last_evaluated
     FROM tracked_insights ti
     LEFT JOIN LATERAL (
       SELECT metric_values, previous_values, change_summary, trend, evaluated_at
       FROM tracked_insight_snapshots
       WHERE tracked_insight_id = ti.id
       ORDER BY evaluated_at DESC
       LIMIT 1
     ) s ON true
     LEFT JOIN LATERAL (
       SELECT metric_values
       FROM tracked_insight_snapshots
       WHERE tracked_insight_id = ti.id
       ORDER BY evaluated_at ASC
       LIMIT 1
     ) first_s ON true
     WHERE ti.id = $1 AND ti.user_id = $2`,
    [trackedInsightId, userId]
  );
  return result.rows[0] ?? null;
}

// ============================================================================
// POST / — Pin an insight
// ============================================================================

router.post(
  "/",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const {
        headline,
        understory,
        metric_signature,
        source_insight_id,
        source_type: rawSourceType,
        tags,
        display_metadata,
      } = req.body;

      const source_type =
        typeof rawSourceType === "string" && rawSourceType.trim()
          ? String(rawSourceType).trim()
          : "pipeline";

      const isDashboardTrack =
        source_type === "dashboard_insights" && source_insight_id != null;
      const isAgentTrack = source_type === "agent";
      const isPipelineTrack = source_type === "pipeline";

      if (!headline) {
        return res.status(400).json({ error: "headline is required" });
      }

      let effectiveMetricSignature = metric_signature;
      let effectiveDisplayMetadata = display_metadata;

      /* Plan §0: dashboard tracking — server derives signature/metadata; client payload optional */
      if (isDashboardTrack) {
        const dashId = Number(source_insight_id);
        if (!Number.isFinite(dashId) || dashId <= 0) {
          return res.status(400).json({
            error: "source_insight_id must be a positive integer for dashboard_insights",
          });
        }
        const row = await loadDashboardInsightForTracking(
          ctx.tenantPool,
          dashId
        );
        if (!row) {
          return res.status(404).json({ error: "Dashboard insight not found" });
        }
        const derived = deriveDashboardTrackedFromDetailData(row.detail_data, {
          sentiment: row.sentiment,
          severity_score: row.severity_score,
          page_id: row.page_id,
          page_name: row.page_name,
          filter_context: row.filter_context,
        });
        effectiveMetricSignature = derived.metric_signature;
        effectiveDisplayMetadata = {
          ...(display_metadata && typeof display_metadata === "object"
            ? display_metadata
            : {}),
          ...derived.display_metadata,
        };
        if (!normalizeMetricSignature(effectiveMetricSignature, { allowEmptySql: true })) {
          return res.status(400).json({
            error: "Invalid metric_signature shape for dashboard insight",
          });
        }
      } else if ((isAgentTrack || isPipelineTrack) && source_insight_id != null) {
        const sourceId = Number(source_insight_id);
        if (!Number.isFinite(sourceId) || sourceId <= 0) {
          return res.status(400).json({
            error: "source_insight_id must be a positive integer",
          });
        }

        const sourceResult = await ctx.tenantPool.query(
          `SELECT id, detail_data, bucket, priority, severity_score
           FROM generated_insights
           WHERE id = $1
           LIMIT 1`,
          [sourceId]
        );
        if (sourceResult.rows.length === 0) {
          return res.status(404).json({ error: "Source insight not found" });
        }

        const sourceRow = sourceResult.rows[0] as {
          detail_data: unknown;
          bucket: string | null;
          priority: string | null;
          severity_score: number | null;
        };
        const sourceDetailData =
          sourceRow.detail_data && typeof sourceRow.detail_data === "object"
            ? (sourceRow.detail_data as Record<string, unknown>)
            : null;
        const sourceMeta = extractDisplayMetadataFromDetailData(
          sourceRow.detail_data
        );

        if (isAgentTrack) {
          const headlineValidated =
            sourceDetailData?.headlineMetricSignatureValidated === true;
          const headlineRaw = sourceDetailData?.headlineMetricSignature;
          const headlineSig =
            headlineValidated && headlineRaw
              ? normalizeMetricSignature(headlineRaw, { allowEmptySql: false })
              : null;
          const legacySig = normalizeMetricSignature(
            sourceDetailData?.metricSignature,
            { allowEmptySql: false }
          );
          const chosenAgentSig = headlineSig || legacySig;
          if (!chosenAgentSig) {
            return res.status(400).json({
              error:
                "Agent source insight is missing a valid detail_data.headlineMetricSignature (validated) or metricSignature",
            });
          }
          effectiveMetricSignature = chosenAgentSig;
          effectiveDisplayMetadata = addSourceContextToDisplayMetadata({
            ...(display_metadata && typeof display_metadata === "object"
              ? display_metadata
              : {}),
            ...sourceMeta,
          }, {
            original_bucket: sourceRow.bucket,
            original_priority: sourceRow.priority,
            original_severity_score: sourceRow.severity_score,
          });
        } else {
          // pipeline: prefer source derivation, fallback to payload if valid
          const sourceSigRaw = sourceDetailData?.metricSignature;
          const sourceSig = normalizeMetricSignature(sourceSigRaw, {
            allowEmptySql: false,
          });
          const fallbackSig = normalizeMetricSignature(metric_signature, {
            allowEmptySql: false,
          });
          const chosenSig = sourceSig || fallbackSig;
          if (!chosenSig) {
            return res.status(400).json({
              error:
                "metric_signature must include non-empty sql and keyFields for pipeline tracking",
            });
          }
          effectiveMetricSignature = chosenSig;
          effectiveDisplayMetadata = addSourceContextToDisplayMetadata({
            ...(display_metadata && typeof display_metadata === "object"
              ? display_metadata
              : {}),
            ...sourceMeta,
          }, {
            original_bucket: sourceRow.bucket,
            original_priority: sourceRow.priority,
            original_severity_score: sourceRow.severity_score,
          });
        }
      } else {
        const normalized = normalizeMetricSignature(metric_signature, {
          allowEmptySql: false,
        });
        if (!normalized) {
          return res.status(400).json({
            error:
              "metric_signature must include non-empty sql and keyFields array",
          });
        }
        effectiveMetricSignature = normalized;
      }

      // Check if display_metadata column exists (migration 097 guard)
      let hasDisplayMetaCol = false;
      try {
        const colCheck = await ctx.tenantPool.query(`
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tracked_insights' AND column_name = 'display_metadata'
        `);
        hasDisplayMetaCol = colCheck.rows.length > 0;
      } catch { /* pre-migration */ }

      const insertCols = hasDisplayMetaCol
        ? `(user_id, user_email, headline, understory, metric_signature, source_insight_id, source_type, tags, display_metadata)`
        : `(user_id, user_email, headline, understory, metric_signature, source_insight_id, source_type, tags)`;
      const insertVals = hasDisplayMetaCol
        ? `($1, $2, $3, $4, $5, $6, $7, $8, $9)`
        : `($1, $2, $3, $4, $5, $6, $7, $8)`;
      const params: any[] = [
        req.userId,
        req.userEmail,
        headline,
        understory || null,
        JSON.stringify(effectiveMetricSignature),
        source_insight_id || null,
        source_type,
        tags || [],
      ];
      if (hasDisplayMetaCol) {
        params.push(
          effectiveDisplayMetadata
            ? JSON.stringify(effectiveDisplayMetadata)
            : null
        );
      }

      const result = await ctx.tenantPool.query(
        `INSERT INTO tracked_insights ${insertCols} VALUES ${insertVals} RETURNING *`,
        params
      );

      const inserted = result.rows[0] as Record<string, unknown>;

      try {
        const parseJsonb = (v: unknown) =>
          typeof v === "string" ? JSON.parse(v) : v;
        const evalInput = {
          id: String(inserted.id),
          headline: String(inserted.headline ?? ""),
          understory: (inserted.understory as string) ?? "",
          source_type: String(inserted.source_type ?? "pipeline"),
          source_insight_id:
            inserted.source_insight_id != null
              ? Number(inserted.source_insight_id)
              : null,
          alert_threshold: (inserted.alert_threshold as object | null) ?? null,
          metric_signature: parseJsonb(inserted.metric_signature) as Record<
            string,
            unknown
          >,
          display_metadata:
            hasDisplayMetaCol && inserted.display_metadata != null
              ? (parseJsonb(inserted.display_metadata) as Record<string, unknown>)
              : null,
        };
        const baseline = await evaluateSingleTrackedInsight(
          ctx.tenantId,
          ctx.tenantPool,
          evalInput as TrackedInsightEvaluationInput
        );
        if (baseline.status === "error") {
          logError(
            `[TrackedInsights] Initial baseline failed for ${inserted.id}: ${baseline.message}`
          );
        }
      } catch (baselineErr: any) {
        logError("[TrackedInsights] Initial baseline exception:", baselineErr);
      }

      const responseRow = await fetchTrackedInsightRowWithSnapshot(
        ctx.tenantPool,
        req.userId,
        String(inserted.id),
        hasDisplayMetaCol
      );
      res.status(201).json(responseRow ?? inserted);
    } catch (err: any) {
      logError("[TrackedInsights] POST / failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// GET / — List user's tracked insights with latest snapshot
// ============================================================================

router.get(
  "/",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const userId = req.userId;

      // Check if display_metadata column exists (migration 097 guard)
      let hasDisplayMetaCol = false;
      try {
        const colCheck = await ctx.tenantPool.query(`
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tracked_insights' AND column_name = 'display_metadata'
        `);
        hasDisplayMetaCol = colCheck.rows.length > 0;
      } catch { /* pre-migration */ }

      const displayMetaSelect = hasDisplayMetaCol ? "ti.display_metadata," : "NULL AS display_metadata,";

      const result = await ctx.tenantPool.query(
        `SELECT
           ti.id, ti.headline, ti.understory, ti.status, ti.source_type,
           ti.source_insight_id, ti.tags, ti.created_at, ti.updated_at,
           ti.alert_threshold, ti.metric_signature,
           ${displayMetaSelect}
           s.metric_values AS latest_values,
           s.previous_values AS latest_previous,
           first_s.metric_values AS baseline_values,
           (SELECT COUNT(*)::int FROM tracked_insight_snapshots WHERE tracked_insight_id = ti.id) AS snapshot_count,
           s.change_summary AS latest_change,
           s.trend AS latest_trend,
           s.evaluated_at AS last_evaluated
         FROM tracked_insights ti
         LEFT JOIN LATERAL (
           SELECT metric_values, previous_values, change_summary, trend, evaluated_at
           FROM tracked_insight_snapshots
           WHERE tracked_insight_id = ti.id
           ORDER BY evaluated_at DESC
           LIMIT 1
         ) s ON true
         LEFT JOIN LATERAL (
           SELECT metric_values
           FROM tracked_insight_snapshots
           WHERE tracked_insight_id = ti.id
           ORDER BY evaluated_at ASC
           LIMIT 1
         ) first_s ON true
         WHERE ti.user_id = $1
         ORDER BY
           CASE ti.status WHEN 'active' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
           ti.created_at DESC`,
        [userId]
      );

      res.json(result.rows);
    } catch (err: any) {
      logError("[TrackedInsights] GET / failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// POST /reevaluate — Run tracked insight evaluator (platform staff only)
// ============================================================================

router.post(
  "/reevaluate",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    const role = req.userRole || "";
    const allowed =
      req.isSuperAdmin === true ||
      ["super_admin", "platform_admin", "support"].includes(role);
    if (!allowed) {
      return res.status(403).json({ error: "Platform staff access required" });
    }
    try {
      const ctx = getTenantContext(req);
      const { evaluateTrackedInsights } = await import(
        "../services/insights/trackedInsightEvaluator.js"
      );
      const result = await evaluateTrackedInsights(ctx.tenantId, ctx.tenantPool);
      res.json(result);
    } catch (err: any) {
      logError("[TrackedInsights] POST /reevaluate failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// GET /:id/history — Time-series snapshots
// ============================================================================

router.get(
  "/:id/history",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      // Verify ownership
      const ownerCheck = await ctx.tenantPool.query(
        `SELECT id FROM tracked_insights WHERE id = $1 AND user_id = $2`,
        [id, req.userId]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(404).json({ error: "Tracked insight not found" });
      }

      const result = await ctx.tenantPool.query(
        `SELECT * FROM tracked_insight_snapshots
         WHERE tracked_insight_id = $1
         ORDER BY evaluated_at DESC
         LIMIT $2`,
        [id, limit]
      );

      res.json(result.rows);
    } catch (err: any) {
      logError("[TrackedInsights] GET /:id/history failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// PUT /:id — Update tracked insight
// ============================================================================

router.put(
  "/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const { id } = req.params;
      const { status, alert_threshold, tags } = req.body;

      const sets: string[] = ["updated_at = NOW()"];
      const vals: any[] = [];
      let pi = 1;

      if (status !== undefined) {
        sets.push(`status = $${pi++}`);
        vals.push(status);
      }
      if (alert_threshold !== undefined) {
        sets.push(`alert_threshold = $${pi++}`);
        vals.push(JSON.stringify(alert_threshold));
      }
      if (tags !== undefined) {
        sets.push(`tags = $${pi++}`);
        vals.push(tags);
      }

      vals.push(id, req.userId);

      const result = await ctx.tenantPool.query(
        `UPDATE tracked_insights SET ${sets.join(", ")}
         WHERE id = $${pi++} AND user_id = $${pi++}
         RETURNING *`,
        vals
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Tracked insight not found" });
      }

      res.json(result.rows[0]);
    } catch (err: any) {
      logError("[TrackedInsights] PUT /:id failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// DELETE /:id — Untrack
// ============================================================================

router.delete(
  "/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const { id } = req.params;

      const result = await ctx.tenantPool.query(
        `DELETE FROM tracked_insights WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, req.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Tracked insight not found" });
      }

      res.json({ deleted: true });
    } catch (err: any) {
      logError("[TrackedInsights] DELETE /:id failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;

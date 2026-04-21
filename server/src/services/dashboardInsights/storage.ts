/**
 * Dashboard Insights — persistence helpers
 *
 * saveDashboardInsights: insert batch for a page+filter combo (replaces previous for same combo).
 * loadDashboardInsights: fetch most recent insights for pageId + filter subset.
 * loadEscalatedDashboardInsights: fetch all escalated insights for Cohi.
 */

import pg from "pg";
import type { DashboardInsight } from "./types.js";
import { DASHBOARD_PAGE_CATEGORY_MAP } from "./types.js";
import { buildUnderstoryBullets } from "../insights/understoryBullets.js";

const MAX_INSIGHTS_PER_PAGE_FILTER = 10;

/**
 * Save a batch of dashboard insights for a given page and filter context.
 * Appends a new generation batch; does not delete older rows.
 */
export async function saveDashboardInsights(
  tenantPool: pg.Pool,
  pageId: string,
  pageName: string,
  insights: DashboardInsight[],
  generationBatch: string,
): Promise<void> {
  if (insights.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const ins of insights) {
    const ph = Array.from({ length: 23 }, () => `$${paramIdx++}`);
    const persistedBullets =
      Array.isArray(ins.understory_bullets) && ins.understory_bullets.length > 0
        ? ins.understory_bullets
        : await buildUnderstoryBullets(ins.understory ?? "", { headline: ins.headline });
    placeholders.push(`(${ph.join(", ")})`);
    values.push(
      pageId,
      pageName,
      ins.headline,
      ins.understory ?? null,
      ins.sentiment,
      ins.severity_score,
      ins.scope,
      ins.escalate,
      ins.what_changed ?? null,
      ins.why ?? null,
      ins.business_impact ?? null,
      ins.risk_if_ignored ?? null,
      ins.recommended_action ?? null,
      ins.owner ?? null,
      JSON.stringify(ins.filter_context),
      JSON.stringify(ins.evidence_refs),
      JSON.stringify(ins.cited_numbers ?? []),
      ins.supporting_data != null ? JSON.stringify(ins.supporting_data) : null,
      ins.detail_data != null ? JSON.stringify(ins.detail_data) : null,
      ins.functional_category ?? DASHBOARD_PAGE_CATEGORY_MAP[pageId] ?? null,
      JSON.stringify(persistedBullets),
      generationBatch,
      new Date().toISOString(),
    );
  }

  const columns = `(page_id, page_name, headline, understory, sentiment, severity_score, scope, escalate,
    what_changed, why, business_impact, risk_if_ignored, recommended_action, owner,
    filter_context, evidence_refs, cited_numbers, supporting_data, detail_data, functional_category, understory_bullets, generation_batch, generated_at)`;
  await tenantPool.query(
    `INSERT INTO dashboard_generated_insights ${columns} VALUES ${placeholders.join(", ")}`,
    values,
  );
}

/**
 * Load the most recent dashboard insights for a page and filter subset.
 * When filterContext is empty: returns latest insights for the page (page-level insights, independent of time period).
 * When filterContext has keys: uses JSONB containment so stored filter_context must contain the requested keys/values.
 */
export async function loadDashboardInsights(
  tenantPool: pg.Pool,
  pageId: string,
  filterContext: Record<string, unknown>,
): Promise<{ insights: DashboardInsight[]; generatedAt: string | null }> {
  const isPageLevel = Object.keys(filterContext).length === 0;

  // Only show insights from the most recently generated generation_batch for this page+filter slice.
  //
  // Tracked insights may be older than this generation batch; those are added by the GET endpoint
  // after loading the "generated-only" set.
  const latestBatchResult = isPageLevel
    ? await tenantPool.query(
        `SELECT generation_batch
         FROM dashboard_generated_insights
         WHERE page_id = $1
         ORDER BY generated_at DESC
         LIMIT 1`,
        [pageId],
      )
    : await tenantPool.query(
        `SELECT generation_batch
         FROM dashboard_generated_insights
         WHERE page_id = $1 AND filter_context @> $2::jsonb
         ORDER BY generated_at DESC
         LIMIT 1`,
        [pageId, JSON.stringify(filterContext)],
      );

  const latestBatch = latestBatchResult.rows?.[0]?.generation_batch as
    | string
    | undefined;
  if (!latestBatch) {
    return { insights: [], generatedAt: null };
  }

  const result = isPageLevel
    ? await tenantPool.query(
        `SELECT id, page_id, page_name, headline, understory, understory_bullets, sentiment, severity_score, scope, escalate,
                what_changed, why, business_impact, risk_if_ignored, recommended_action, owner,
                filter_context, evidence_refs, cited_numbers, supporting_data, detail_data, functional_category, generation_batch, generated_at
         FROM dashboard_generated_insights
         WHERE page_id = $1
           AND generation_batch = $2
         ORDER BY generated_at DESC
         LIMIT $3`,
        [pageId, latestBatch, MAX_INSIGHTS_PER_PAGE_FILTER],
      )
    : await tenantPool.query(
        `SELECT id, page_id, page_name, headline, understory, understory_bullets, sentiment, severity_score, scope, escalate,
                what_changed, why, business_impact, risk_if_ignored, recommended_action, owner,
                filter_context, evidence_refs, cited_numbers, supporting_data, detail_data, functional_category, generation_batch, generated_at
         FROM dashboard_generated_insights
         WHERE page_id = $1
           AND generation_batch = $2
           AND filter_context @> $3::jsonb
         ORDER BY generated_at DESC
         LIMIT $4`,
        [
          pageId,
          latestBatch,
          JSON.stringify(filterContext),
          MAX_INSIGHTS_PER_PAGE_FILTER,
        ],
      );

  const rows = result.rows as Array<{
    id: number;
    page_id: string;
    page_name: string;
    headline: string;
    understory: string | null;
    understory_bullets: unknown;
    sentiment: string;
    severity_score: number | null;
    scope: string;
    escalate: boolean;
    what_changed: string | null;
    why: string | null;
    business_impact: string | null;
    risk_if_ignored: string | null;
    recommended_action: string | null;
    owner: string | null;
    filter_context: Record<string, unknown>;
    evidence_refs: unknown;
    cited_numbers: unknown;
    supporting_data: unknown;
    detail_data: unknown;
    functional_category: string | null;
    generation_batch: string;
    generated_at: Date;
  }>;

  function normalizeCitedNumbers(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item: unknown) => {
      if (typeof item === "string") return item;
      if (item != null && typeof item === "object") {
        const o = item as Record<string, unknown>;
        if (typeof o.value === "string") return o.value;
        if (typeof o.label === "string") return o.label;
        return JSON.stringify(o);
      }
      return String(item);
    });
  }

  const insights: DashboardInsight[] = await Promise.all(rows.map(async (r) => ({
    id: r.id,
    headline: r.headline,
    understory: r.understory ?? "",
    understory_bullets:
      Array.isArray(r.understory_bullets) && r.understory_bullets.length > 0
        ? (r.understory_bullets as string[])
        : await buildUnderstoryBullets(r.understory ?? "", { headline: r.headline }),
    sentiment: r.sentiment as DashboardInsight["sentiment"],
    severity_score: r.severity_score ?? 0,
    cited_numbers: normalizeCitedNumbers(r.cited_numbers),
    what_changed: r.what_changed ?? "",
    why: r.why ?? "",
    business_impact: r.business_impact ?? "",
    risk_if_ignored: r.risk_if_ignored ?? "",
    recommended_action: r.recommended_action ?? "",
    owner: r.owner ?? "",
    scope: (r.scope === "widget" ? "widget" : "page") as "page" | "widget",
    filter_context: r.filter_context as DashboardInsight["filter_context"],
    evidence_refs: Array.isArray(r.evidence_refs)
      ? (r.evidence_refs as DashboardInsight["evidence_refs"])
      : [],
    escalate: r.escalate,
    sourcePageId: r.page_id,
    sourcePageName: r.page_name,
    functional_category:
      r.functional_category ?? DASHBOARD_PAGE_CATEGORY_MAP[r.page_id],
    supporting_data: r.supporting_data as DashboardInsight["supporting_data"],
    detail_data: r.detail_data as DashboardInsight["detail_data"],
  })));

  const generatedAt =
    rows.length > 0 && rows[0].generated_at
      ? new Date(rows[0].generated_at).toISOString()
      : null;

  return { insights, generatedAt };
}

/**
 * Load active tracked dashboard insights for this user and page.
 *
 * Tracked insights should appear on their source dashboard regardless of the currently
 * requested filter_context (datePeriod/channelGroup/etc).
 */
export async function loadTrackedDashboardInsightsForPage(
  tenantPool: pg.Pool,
  userId: number,
  pageId: string,
): Promise<DashboardInsight[]> {
  const result = await tenantPool.query(
    `SELECT dgi.id AS id, dgi.page_id, dgi.page_name, dgi.headline, dgi.understory, dgi.understory_bullets, dgi.sentiment, dgi.severity_score, dgi.scope, dgi.escalate,
            what_changed, why, business_impact, risk_if_ignored, recommended_action, owner,
            dgi.filter_context, dgi.evidence_refs, dgi.cited_numbers, dgi.supporting_data, dgi.detail_data, dgi.generated_at
     FROM tracked_insights ti
     JOIN dashboard_generated_insights dgi ON dgi.id = ti.source_insight_id
     WHERE ti.user_id = $1
       AND ti.status = 'active'
       AND ti.source_type = 'dashboard_insights'
       AND dgi.page_id = $2
     ORDER BY dgi.generated_at DESC`,
    [userId, pageId],
  );

  const rows = result.rows as Array<{
    id: number;
    page_id: string;
    page_name: string;
    headline: string;
    understory: string | null;
    understory_bullets: unknown;
    sentiment: string;
    severity_score: number | null;
    scope: string;
    escalate: boolean;
    what_changed: string | null;
    why: string | null;
    business_impact: string | null;
    risk_if_ignored: string | null;
    recommended_action: string | null;
    owner: string | null;
    filter_context: Record<string, unknown>;
    evidence_refs: unknown;
    cited_numbers: unknown;
    supporting_data: unknown;
    detail_data: unknown;
    generated_at: Date;
  }>;

  function normalizeCitedNumbers(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item: unknown) => {
      if (typeof item === "string") return item;
      if (item != null && typeof item === "object") {
        const o = item as Record<string, unknown>;
        if (typeof o.value === "string") return o.value;
        if (typeof o.label === "string") return o.label;
        return JSON.stringify(o);
      }
      return String(item);
    });
  }

  return Promise.all(rows.map(async (r) => ({
    id: r.id,
    headline: r.headline,
    understory: r.understory ?? "",
    understory_bullets:
      Array.isArray(r.understory_bullets) && r.understory_bullets.length > 0
        ? (r.understory_bullets as string[])
        : await buildUnderstoryBullets(r.understory ?? "", { headline: r.headline }),
    sentiment: r.sentiment as DashboardInsight["sentiment"],
    severity_score: r.severity_score ?? 0,
    cited_numbers: normalizeCitedNumbers(r.cited_numbers),
    what_changed: r.what_changed ?? "",
    why: r.why ?? "",
    business_impact: r.business_impact ?? "",
    risk_if_ignored: r.risk_if_ignored ?? "",
    recommended_action: r.recommended_action ?? "",
    owner: r.owner ?? "",
    scope: (r.scope === "widget" ? "widget" : "page") as "page" | "widget",
    filter_context: r.filter_context as DashboardInsight["filter_context"],
    evidence_refs: Array.isArray(r.evidence_refs)
      ? (r.evidence_refs as DashboardInsight["evidence_refs"])
      : [],
    escalate: r.escalate,
    sourcePageId: r.page_id,
    sourcePageName: r.page_name,
    supporting_data: r.supporting_data as DashboardInsight["supporting_data"],
    detail_data: r.detail_data as DashboardInsight["detail_data"],
  })));
}

/**
 * Load a single dashboard insight by id (for details API).
 */
export async function loadDashboardInsightById(
  tenantPool: pg.Pool,
  insightId: number,
): Promise<{
  id: number;
  page_id: string;
  page_name: string;
  headline: string;
  understory: string | null;
  generated_at: Date;
  detail_data: unknown;
  what_changed: string | null;
  why: string | null;
  business_impact: string | null;
  risk_if_ignored: string | null;
  recommended_action: string | null;
  owner: string | null;
  filter_context: Record<string, unknown>;
  evidence_refs: unknown;
  cited_numbers: unknown;
  supporting_data: unknown;
} | null> {
  const result = await tenantPool.query(
    `SELECT id, page_id, page_name, headline, understory, generated_at, detail_data,
            what_changed, why, business_impact, risk_if_ignored, recommended_action, owner,
            filter_context, evidence_refs, cited_numbers, supporting_data
     FROM dashboard_generated_insights
     WHERE id = $1`,
    [insightId],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0] as any;
}

/**
 * Load dashboard row fields needed for tracked-insight derivation (plan §0).
 */
export async function loadDashboardInsightForTracking(
  tenantPool: pg.Pool,
  insightId: number,
): Promise<{
  id: number;
  page_id: string;
  page_name: string;
  headline: string;
  understory: string | null;
  sentiment: string;
  severity_score: number | null;
  detail_data: unknown;
  filter_context: Record<string, unknown>;
} | null> {
  const result = await tenantPool.query(
    `SELECT id, page_id, page_name, headline, understory, understory_bullets, sentiment, severity_score, detail_data, filter_context
     FROM dashboard_generated_insights
     WHERE id = $1`,
    [insightId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as any;
  return {
    ...row,
    filter_context:
      row.filter_context && typeof row.filter_context === "object"
        ? (row.filter_context as Record<string, unknown>)
        : {},
  };
}

/**
 * Load all escalated dashboard insights (for Cohi Critical Issues bucket).
 */
export async function loadEscalatedDashboardInsights(
  tenantPool: pg.Pool,
): Promise<DashboardInsight[]> {
  const result = await tenantPool.query(
    `WITH latest_batch_per_page AS (
       SELECT DISTINCT ON (page_id)
         page_id,
         generation_batch
       FROM dashboard_generated_insights
       ORDER BY page_id, generated_at DESC
     )
     SELECT dgi.id, dgi.page_id, dgi.page_name, dgi.headline, dgi.understory, dgi.sentiment, dgi.severity_score, dgi.scope, dgi.escalate,
            dgi.what_changed, dgi.why, dgi.business_impact, dgi.risk_if_ignored, dgi.recommended_action, dgi.owner,
            dgi.filter_context, dgi.evidence_refs, dgi.cited_numbers, dgi.supporting_data, dgi.detail_data, dgi.functional_category, dgi.generation_batch, dgi.generated_at
     FROM dashboard_generated_insights dgi
     JOIN latest_batch_per_page lb
       ON lb.page_id = dgi.page_id
      AND lb.generation_batch = dgi.generation_batch
     WHERE dgi.escalate = true
     ORDER BY dgi.generated_at DESC`,
  );

  const rows = result.rows as Array<{
    id: number;
    page_id: string;
    page_name: string;
    headline: string;
    understory: string | null;
    understory_bullets: unknown;
    sentiment: string;
    severity_score: number | null;
    scope: string;
    escalate: boolean;
    what_changed: string | null;
    why: string | null;
    business_impact: string | null;
    risk_if_ignored: string | null;
    recommended_action: string | null;
    owner: string | null;
    filter_context: Record<string, unknown>;
    evidence_refs: unknown;
    cited_numbers: unknown;
    supporting_data: unknown;
    detail_data: unknown;
    functional_category: string | null;
  }>;

  function normalizeCitedNumbers(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item: unknown) => {
      if (typeof item === "string") return item;
      if (item != null && typeof item === "object") {
        const o = item as Record<string, unknown>;
        if (typeof o.value === "string") return o.value;
        if (typeof o.label === "string") return o.label;
        return JSON.stringify(o);
      }
      return String(item);
    });
  }

  return Promise.all(rows.map(async (r) => ({
    id: r.id,
    headline: r.headline,
    understory: r.understory ?? "",
    understory_bullets:
      Array.isArray(r.understory_bullets) && r.understory_bullets.length > 0
        ? (r.understory_bullets as string[])
        : await buildUnderstoryBullets(r.understory ?? "", { headline: r.headline }),
    sentiment: r.sentiment as DashboardInsight["sentiment"],
    severity_score: r.severity_score ?? 0,
    cited_numbers: normalizeCitedNumbers(r.cited_numbers),
    what_changed: r.what_changed ?? "",
    why: r.why ?? "",
    business_impact: r.business_impact ?? "",
    risk_if_ignored: r.risk_if_ignored ?? "",
    recommended_action: r.recommended_action ?? "",
    owner: r.owner ?? "",
    scope: (r.scope === "widget" ? "widget" : "page") as "page" | "widget",
    filter_context: r.filter_context as DashboardInsight["filter_context"],
    evidence_refs: Array.isArray(r.evidence_refs)
      ? (r.evidence_refs as DashboardInsight["evidence_refs"])
      : [],
    escalate: r.escalate,
    sourcePageId: r.page_id,
    sourcePageName: r.page_name,
    functional_category:
      r.functional_category ?? DASHBOARD_PAGE_CATEGORY_MAP[r.page_id],
    supporting_data: r.supporting_data as DashboardInsight["supporting_data"],
    detail_data: r.detail_data as DashboardInsight["detail_data"],
  })));
}

/**
 * User interest profile — aggregates existing behavioral signals for My Insights.
 * No new instrumentation in Phase 1; reads management analytics + tenant tables.
 */

import crypto from "crypto";
import pg from "pg";
import { pool as managementPool } from "../../config/managementDatabase.js";
import { logInfo, logWarn } from "../logger.js";

const ACTIVITY_STALE_DAYS = 7;
const PROFILE_LOOKBACK_DAYS = 30;
/** Max rows in page_engagement (raw views + dwell_ms); inclusion ordered by attention score. */
const PAGE_ENGAGEMENT_ROW_CAP = 50;
const DASHBOARD_FILTER_EVENTS_CAP = 800;

/** Pathname before `?` — used for exclusions and grouping keys. */
export function profilePathnameFromPagePath(pagePath: string): string {
  const t = String(pagePath || "").trim();
  if (!t) return "";
  const q = t.indexOf("?");
  return q >= 0 ? t.slice(0, q) : t;
}

/** Exclude admin / feedback / research from My Insights personalization signals. */
export function isExcludedProfilePathname(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return (
    p.startsWith("/admin") || p.startsWith("/feedback") || p.startsWith("/research")
  );
}

export interface UserInterestProfilePayload {
  /** Plain-text block for the insight planner */
  profileText: string;
  /** Structured signals for hashing / debugging */
  profileJson: Record<string, unknown>;
  contentHash: string;
  lastActivityAt: Date | null;
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify((obj as any)[k])).join(",")}}`;
}

function hashPayload(profileJson: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(stableStringify(profileJson)).digest("hex");
}

async function fetchAnalyticsSummary(
  tenantId: string,
  userId: string
): Promise<{
  topPaths: string[];
  lastSessionAt: Date | null;
}> {
  if (!managementPool) {
    return { topPaths: [], lastSessionAt: null };
  }
  try {
    const since = new Date();
    since.setDate(since.getDate() - PROFILE_LOOKBACK_DAYS);

    const pathsRes = await managementPool.query(
      `SELECT page_path, COUNT(*)::int AS c
       FROM public.analytics_events
       WHERE tenant_id = $1 AND user_id = $2::uuid
         AND created_at >= $3
         AND event_type = 'page_view'
         AND page_path IS NOT NULL AND TRIM(page_path) <> ''
         AND NOT (
           SPLIT_PART(TRIM(page_path), '?', 1) LIKE '/admin%'
           OR SPLIT_PART(TRIM(page_path), '?', 1) LIKE '/feedback%'
           OR SPLIT_PART(TRIM(page_path), '?', 1) LIKE '/research%'
         )
       GROUP BY page_path
       ORDER BY c DESC
       LIMIT 12`,
      [tenantId, userId, since.toISOString()]
    );
    const topPaths = pathsRes.rows.map((r: any) => String(r.page_path));

    const sessRes = await managementPool.query(
      `SELECT GREATEST(
          COALESCE(MAX(ended_at), 'epoch'::timestamptz),
          COALESCE(MAX(started_at), 'epoch'::timestamptz)
        ) AS last_ts
       FROM public.analytics_sessions
       WHERE tenant_id = $1 AND user_id = $2::uuid`,
      [tenantId, userId]
    );
    const lastSessionAt = sessRes.rows[0]?.last_ts
      ? new Date(sessRes.rows[0].last_ts)
      : null;

    return { topPaths, lastSessionAt };
  } catch (e: any) {
    logWarn("[UserInterestProfile] analytics summary failed", { message: e.message });
    return { topPaths: [], lastSessionAt: null };
  }
}

export interface PageEngagementRow {
  page_path: string;
  views: number;
  dwell_ms: number;
}

/**
 * Raw page_view counts and summed page_leave duration per page_path (management DB).
 * Excludes /admin, /feedback, /research. Rows ordered by attention heuristic for cap only.
 */
async function fetchPageEngagement(
  tenantId: string,
  userId: string
): Promise<PageEngagementRow[]> {
  if (!managementPool) return [];
  try {
    const since = new Date();
    since.setDate(since.getDate() - PROFILE_LOOKBACK_DAYS);
    const r = await managementPool.query(
      `WITH per_path AS (
         SELECT
           TRIM(page_path) AS page_path,
           SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END)::int AS views,
           COALESCE(SUM(CASE WHEN event_type = 'page_leave' THEN COALESCE(duration_ms, 0) ELSE 0 END), 0)::bigint AS dwell_ms
         FROM public.analytics_events
         WHERE tenant_id = $1 AND user_id = $2::uuid
           AND created_at >= $3
           AND page_path IS NOT NULL AND TRIM(page_path) <> ''
         GROUP BY TRIM(page_path)
       )
       SELECT page_path, views, dwell_ms::double precision AS dwell_ms
       FROM per_path
       WHERE NOT (
         SPLIT_PART(page_path, '?', 1) LIKE '/admin%'
         OR SPLIT_PART(page_path, '?', 1) LIKE '/feedback%'
         OR SPLIT_PART(page_path, '?', 1) LIKE '/research%'
       )
         AND (views > 0 OR dwell_ms > 0)
       ORDER BY (views::float + COALESCE(dwell_ms, 0)::float / 60000.0) DESC
       LIMIT $4`,
      [tenantId, userId, since.toISOString(), PAGE_ENGAGEMENT_ROW_CAP]
    );
    return r.rows.map((row: any) => ({
      page_path: String(row.page_path || ""),
      views: Number(row.views) || 0,
      dwell_ms: Math.round(Number(row.dwell_ms) || 0),
    }));
  } catch (e: any) {
    logWarn("[UserInterestProfile] page engagement failed", { message: e.message });
    return [];
  }
}

/**
 * Roll up cohi_dashboard_filters custom events into structured habits (open-ended filter keys).
 */
async function fetchDashboardFilterHabits(
  tenantId: string,
  userId: string
): Promise<Record<string, unknown>> {
  if (!managementPool) return {};
  try {
    const since = new Date();
    since.setDate(since.getDate() - PROFILE_LOOKBACK_DAYS);
    const r = await managementPool.query(
      `SELECT page_path, metadata, created_at
       FROM public.analytics_events
       WHERE tenant_id = $1 AND user_id = $2::uuid
         AND created_at >= $3
         AND event_type = 'custom'
         AND event_name = 'cohi_dashboard_filters'
       ORDER BY created_at DESC
       LIMIT $4`,
      [tenantId, userId, since.toISOString(), DASHBOARD_FILTER_EVENTS_CAP]
    );

    /** page_key -> filterKey -> valueStr -> count */
    const byPage = new Map<string, Map<string, Map<string, number>>>();

    for (const row of r.rows) {
      const pagePath = String(row.page_path || "");
      const pn = profilePathnameFromPagePath(pagePath);
      if (!pn || isExcludedProfilePathname(pn)) continue;
      const meta = (row.metadata as Record<string, unknown>) || {};
      const pageKey = typeof meta.page_key === "string" ? meta.page_key.trim() : "";
      if (!pageKey) continue;
      const filters = meta.filters;
      if (!filters || typeof filters !== "object" || Array.isArray(filters)) continue;
      const fObj = filters as Record<string, unknown>;
      let pageMap = byPage.get(pageKey);
      if (!pageMap) {
        pageMap = new Map();
        byPage.set(pageKey, pageMap);
      }
      for (const [fk, rawVal] of Object.entries(fObj)) {
        if (!fk || rawVal === undefined || rawVal === null || rawVal === "") continue;
        const valStr =
          typeof rawVal === "object" ? JSON.stringify(rawVal) : String(rawVal);
        const safeVal = valStr.length > 120 ? valStr.slice(0, 117) + "…" : valStr;
        let km = pageMap.get(fk);
        if (!km) {
          km = new Map();
          pageMap.set(fk, km);
        }
        km.set(safeVal, (km.get(safeVal) || 0) + 1);
      }
    }

    const out: Record<string, unknown> = {};
    for (const [pk, fmap] of byPage) {
      const keys: Record<string, unknown> = {};
      for (const [filterKey, valCounts] of fmap) {
        const top = [...valCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([value, count]) => ({ value, count }));
        if (top.length) keys[filterKey] = top;
      }
      if (Object.keys(keys).length) out[pk] = keys;
    }
    return out;
  } catch (e: any) {
    logWarn("[UserInterestProfile] dashboard filter habits failed", { message: e.message });
    return {};
  }
}

async function fetchTenantSignals(
  tenantPool: pg.Pool,
  userId: string
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const since = new Date();
  since.setDate(since.getDate() - PROFILE_LOOKBACK_DAYS);

  try {
    const rs = await tenantPool.query(
      `SELECT topic, primary_category, updated_at
       FROM public.research_sessions
       WHERE user_id = $1 AND updated_at >= $2
       ORDER BY updated_at DESC
       LIMIT 15`,
      [userId, since.toISOString()]
    );
    out.research_topics = rs.rows.map((r: any) => ({
      topic: r.topic,
      category: r.primary_category,
    }));
  } catch {
    out.research_topics = [];
  }

  try {
    const wb = await tenantPool.query(
      `SELECT title, updated_at
       FROM public.workbench_canvases
       WHERE user_id = $1 AND updated_at >= $2
       ORDER BY updated_at DESC
       LIMIT 10`,
      [userId, since.toISOString()]
    );
    out.workbench_titles = wb.rows.map((r: any) => r.title).filter(Boolean);
  } catch {
    out.workbench_titles = [];
  }

  try {
    const ch = await tenantPool.query(
      `SELECT LEFT(content, 200) AS snippet, created_at
       FROM public.chat_history
       WHERE user_id = $1 AND role = 'user' AND created_at >= $2
       ORDER BY created_at DESC
       LIMIT 12`,
      [userId, since.toISOString()]
    );
    out.chat_snippets = ch.rows.map((r: any) => String(r.snippet || "").trim()).filter(Boolean);
  } catch {
    out.chat_snippets = [];
  }

  try {
    const uc = await tenantPool.query(
      `SELECT title, updated_at
       FROM public.unified_chat_conversations
       WHERE user_id = $1 AND updated_at >= $2
       ORDER BY updated_at DESC
       LIMIT 8`,
      [userId, since.toISOString()]
    );
    out.unified_chat_titles = uc.rows.map((r: any) => r.title).filter(Boolean);
  } catch {
    out.unified_chat_titles = [];
  }

  try {
    const ti = await tenantPool.query(
      `SELECT COUNT(*)::int AS n,
              array_agg(headline ORDER BY updated_at DESC) FILTER (WHERE headline IS NOT NULL) AS headlines
       FROM public.tracked_insights
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    const row = ti.rows[0];
    out.tracked_insight_count = row?.n ?? 0;
    out.tracked_headlines_sample = (row?.headlines || []).slice(0, 5);
  } catch {
    out.tracked_insight_count = 0;
    out.tracked_headlines_sample = [];
  }

  try {
    const fb = await tenantPool.query(
      `SELECT
          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::int AS up,
          SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END)::int AS down
       FROM public.insight_feedback
       WHERE user_id = $1 AND created_at >= $2`,
      [userId, since.toISOString()]
    );
    out.insight_feedback_up = fb.rows[0]?.up ?? 0;
    out.insight_feedback_down = fb.rows[0]?.down ?? 0;
  } catch {
    out.insight_feedback_up = 0;
    out.insight_feedback_down = 0;
  }

  return out;
}

function buildProfileText(
  tenantSignals: Record<string, unknown>,
  topPaths: string[],
  lastActivityAt: Date | null,
  pageEngagement: PageEngagementRow[] = [],
  dashboardFilterHabits: Record<string, unknown> = {}
): string {
  const lines: string[] = [];
  if (lastActivityAt) {
    lines.push(`Last observed activity: ${lastActivityAt.toISOString().slice(0, 10)}.`);
  }
  if (topPaths.length) {
    lines.push(`Frequently viewed areas (app paths): ${topPaths.slice(0, 8).join("; ")}.`);
  }
  if (pageEngagement.length > 0) {
    lines.push(
      `Page engagement (last ${PROFILE_LOOKBACK_DAYS}d; raw counts, not pre-ranked as ratios only):`
    );
    lines.push(
      `Each row is one app path. "views" = count of page_view events. "dwell_ms" = sum of time-on-page from page_leave events in this window (a lower bound if the browser closed without a leave event).`
    );
    lines.push(
      `How to use: higher "views" and higher total "dwell_ms" for a path indicate stronger user attention to that area — when generating My Insights, prioritize mortgage and operations topics aligned with paths that score higher on these two signals; compare rows relatively across the table.`
    );
    lines.push(`page_engagement JSON: ${JSON.stringify(pageEngagement)}`);
  }
  if (Object.keys(dashboardFilterHabits).length > 0) {
    lines.push(
      `Dashboard filter habits (from cohi_dashboard_filters; per page_key, top filter values by frequency): ${JSON.stringify(dashboardFilterHabits)}`
    );
  }
  const topics = (tenantSignals.research_topics as any[]) || [];
  if (topics.length) {
    const t = topics
      .slice(0, 6)
      .map((x) => x.topic || x.category)
      .filter(Boolean)
      .join("; ");
    if (t) lines.push(`Recent Research Lab themes: ${t}.`);
  }
  const wb = (tenantSignals.workbench_titles as string[]) || [];
  if (wb.length) {
    lines.push(`Workbench canvases: ${wb.slice(0, 5).join("; ")}.`);
  }
  const chat = (tenantSignals.chat_snippets as string[]) || [];
  if (chat.length) {
    lines.push(`Recent data-chat questions (abridged): ${chat.slice(0, 4).join(" | ")}.`);
  }
  const ut = (tenantSignals.unified_chat_titles as string[]) || [];
  if (ut.length) {
    lines.push(`Recent unified chat threads: ${ut.slice(0, 4).join("; ")}.`);
  }
  const th = (tenantSignals.tracked_headlines_sample as string[]) || [];
  const tc = Number(tenantSignals.tracked_insight_count || 0);
  if (tc > 0 && th.length) {
    lines.push(`User tracks ${tc} metric(s); examples: ${th.slice(0, 4).join("; ")}.`);
  } else if (tc > 0) {
    lines.push(`User tracks ${tc} metric bookmark(s).`);
  }
  const up = Number(tenantSignals.insight_feedback_up || 0);
  const down = Number(tenantSignals.insight_feedback_down || 0);
  if (up + down > 0) {
    lines.push(`Insight feedback (last ${PROFILE_LOOKBACK_DAYS}d): ${up} positive, ${down} negative.`);
  }
  if (lines.length === 0) {
    return "Limited behavioral history in the lookback window; generate a balanced executive briefing relevant to a typical mortgage operator.";
  }
  return lines.join("\n");
}

/**
 * True if `at` is within the last ACTIVITY_STALE_DAYS (used for My Insights login recency gate).
 */
export function isUserRecentlyActive(at: Date | null): boolean {
  if (!at || Number.isNaN(at.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ACTIVITY_STALE_DAYS);
  return at >= cutoff;
}

/** Tenant `users.last_login_at` for My Insights eligibility (Cognito/password login updates this). */
export async function getUserLastLoginAt(
  tenantPool: pg.Pool,
  userId: string
): Promise<Date | null> {
  try {
    const r = await tenantPool.query(
      `SELECT last_login_at FROM public.users WHERE id = $1::uuid`,
      [userId]
    );
    const raw = r.rows[0]?.last_login_at;
    if (raw == null) return null;
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** Platform super admins use management `coheus_users`; they often have no tenant `last_login_at`. */
async function isCoheusSuperAdmin(userId: string): Promise<boolean> {
  if (!managementPool) return false;
  try {
    const r = await managementPool.query(
      `SELECT 1 FROM public.coheus_users
       WHERE id = $1::uuid AND is_active = true AND role = 'super_admin'
       LIMIT 1`,
      [userId]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * My Insights eligibility: active `super_admin` in management DB or tenant `users` skips login recency;
 * otherwise requires `users.last_login_at` within {@link ACTIVITY_STALE_DAYS}.
 */
export async function passesMyInsightsLoginRecencyGate(
  tenantPool: pg.Pool,
  userId: string
): Promise<boolean> {
  if (await isCoheusSuperAdmin(userId)) return true;
  try {
    const r = await tenantPool.query(
      `SELECT 1 FROM public.users
       WHERE id = $1::uuid AND is_active = true AND role = 'super_admin'
       LIMIT 1`,
      [userId]
    );
    if (r.rows.length > 0) return true;
  } catch {
    /* ignore */
  }
  const lastLoginAt = await getUserLastLoginAt(tenantPool, userId);
  return isUserRecentlyActive(lastLoginAt);
}

/**
 * Compute profile from source tables and upsert into user_interest_profiles.
 */
export async function computeAndPersistUserInterestProfile(
  tenantId: string,
  tenantPool: pg.Pool,
  userId: string
): Promise<UserInterestProfilePayload> {
  const { topPaths, lastSessionAt } = await fetchAnalyticsSummary(tenantId, userId);
  const tenantSignals = await fetchTenantSignals(tenantPool, userId);
  const pageEngagement = await fetchPageEngagement(tenantId, userId);
  const dashboardFilterHabits = await fetchDashboardFilterHabits(tenantId, userId);

  const tenantDates: Date[] = [];
  for (const key of ["research_topics", "workbench_titles"]) {
    /* no dates in simplified payload */
  }
  let lastActivityAt = lastSessionAt;

  try {
    const r = await tenantPool.query(
      `SELECT MAX(updated_at) AS m FROM public.research_sessions WHERE user_id = $1`,
      [userId]
    );
    if (r.rows[0]?.m) tenantDates.push(new Date(r.rows[0].m));
  } catch {
    /* ignore */
  }
  try {
    const r = await tenantPool.query(
      `SELECT MAX(updated_at) AS m FROM public.workbench_canvases WHERE user_id = $1`,
      [userId]
    );
    if (r.rows[0]?.m) tenantDates.push(new Date(r.rows[0].m));
  } catch {
    /* ignore */
  }
  try {
    const r = await tenantPool.query(
      `SELECT MAX(created_at) AS m FROM public.chat_history WHERE user_id = $1`,
      [userId]
    );
    if (r.rows[0]?.m) tenantDates.push(new Date(r.rows[0].m));
  } catch {
    /* ignore */
  }
  try {
    const r = await tenantPool.query(
      `SELECT MAX(updated_at) AS m FROM public.unified_chat_conversations WHERE user_id = $1`,
      [userId]
    );
    if (r.rows[0]?.m) tenantDates.push(new Date(r.rows[0].m));
  } catch {
    /* ignore */
  }

  for (const d of tenantDates) {
    if (!lastActivityAt || d > lastActivityAt) lastActivityAt = d;
  }

  const profileJson: Record<string, unknown> = {
    top_paths: topPaths,
    ...tenantSignals,
    page_engagement: pageEngagement,
    ...(Object.keys(dashboardFilterHabits).length > 0
      ? { dashboard_filter_habits: dashboardFilterHabits }
      : {}),
    computed_at: new Date().toISOString(),
  };
  const contentHash = hashPayload(profileJson);
  const profileText = buildProfileText(
    tenantSignals,
    topPaths,
    lastActivityAt,
    pageEngagement,
    dashboardFilterHabits
  );

  try {
    await tenantPool.query(
      `INSERT INTO public.user_interest_profiles (
         user_id, profile_json, content_hash, computed_at, signals_through, last_activity_at
       ) VALUES ($1, $2::jsonb, $3, NOW(), NOW(), $4)
       ON CONFLICT (user_id) DO UPDATE SET
         profile_json = EXCLUDED.profile_json,
         content_hash = EXCLUDED.content_hash,
         computed_at = NOW(),
         signals_through = NOW(),
         last_activity_at = EXCLUDED.last_activity_at`,
      [userId, JSON.stringify(profileJson), contentHash, lastActivityAt]
    );
  } catch (e: any) {
    logWarn("[UserInterestProfile] persist failed", { userId, message: e.message });
  }

  logInfo("[UserInterestProfile] computed", { userId, contentHash: contentHash.slice(0, 12), lastActivityAt });

  return { profileText, profileJson, contentHash, lastActivityAt };
}

/**
 * Rebuild planner-facing profile text from the last persisted row (for insight-only regeneration).
 */
export async function loadPersistedUserInterestProfilePayload(
  tenantPool: pg.Pool,
  userId: string
): Promise<UserInterestProfilePayload | null> {
  try {
    const r = await tenantPool.query(
      `SELECT profile_json, content_hash, last_activity_at
       FROM public.user_interest_profiles WHERE user_id = $1::uuid`,
      [userId]
    );
    const row = r.rows[0];
    if (!row?.profile_json || !row.content_hash) return null;
    const pj = row.profile_json as Record<string, unknown>;
    if (!pj || typeof pj !== "object") return null;
    const topPaths = Array.isArray(pj.top_paths)
      ? (pj.top_paths as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];
    const { top_paths: _tp, computed_at: _ca, page_engagement: _pe, dashboard_filter_habits: _df, ...tenantSignals } =
      pj;
    const pageEngagement: PageEngagementRow[] = Array.isArray(pj.page_engagement)
      ? (pj.page_engagement as unknown[]).map((row: unknown) => {
          const o = row as Record<string, unknown>;
          return {
            page_path: String(o.page_path || ""),
            views: Number(o.views) || 0,
            dwell_ms: Math.round(Number(o.dwell_ms) || 0),
          };
        })
      : [];
    const dashboardFilterHabits =
      pj.dashboard_filter_habits &&
      typeof pj.dashboard_filter_habits === "object" &&
      !Array.isArray(pj.dashboard_filter_habits)
        ? (pj.dashboard_filter_habits as Record<string, unknown>)
        : {};
    const lastActivityAt = row.last_activity_at
      ? row.last_activity_at instanceof Date
        ? row.last_activity_at
        : new Date(row.last_activity_at)
      : null;
    const profileText = buildProfileText(
      tenantSignals,
      topPaths,
      lastActivityAt,
      pageEngagement,
      dashboardFilterHabits
    );
    return {
      profileText,
      profileJson: pj,
      contentHash: String(row.content_hash),
      lastActivityAt,
    };
  } catch {
    return null;
  }
}

export async function loadCachedProfileHash(
  tenantPool: pg.Pool,
  userId: string
): Promise<string | null> {
  try {
    const r = await tenantPool.query(
      `SELECT content_hash FROM public.user_interest_profiles WHERE user_id = $1`,
      [userId]
    );
    return r.rows[0]?.content_hash ?? null;
  } catch {
    return null;
  }
}

export async function updateLastGenerationMeta(
  tenantPool: pg.Pool,
  userId: string,
  profileHash: string
): Promise<void> {
  try {
    await tenantPool.query(
      `UPDATE public.user_interest_profiles
       SET last_generation_at = NOW(), last_generation_profile_hash = $2
       WHERE user_id = $1`,
      [userId, profileHash]
    );
  } catch {
    /* table may not exist yet */
  }
}

export async function shouldSkipGenerationForUnchangedProfile(
  tenantPool: pg.Pool,
  userId: string,
  currentProfileHash: string
): Promise<boolean> {
  try {
    const r = await tenantPool.query(
      `SELECT content_hash, last_generation_profile_hash
       FROM public.user_interest_profiles WHERE user_id = $1`,
      [userId]
    );
    const row = r.rows[0];
    if (!row?.last_generation_profile_hash) return false;
    return (
      row.last_generation_profile_hash === currentProfileHash &&
      row.content_hash === currentProfileHash
    );
  } catch {
    return false;
  }
}

export { ACTIVITY_STALE_DAYS, PROFILE_LOOKBACK_DAYS };

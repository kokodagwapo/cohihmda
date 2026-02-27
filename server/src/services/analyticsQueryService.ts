/**
 * Analytics query service for reporting: page views, funnels, heatmaps, user journeys, active users.
 * All queries are scoped by tenant_id for multi-tenant isolation.
 */

import { pool } from "../config/managementDatabase.js";
import { logError } from "./logger.js";

export interface DateRange {
  start: string; // ISO date
  end: string;
}

/**
 * Aggregated page view counts per day (or per page_path if groupByPath).
 */
export async function getPageViews(
  tenantId: string,
  dateRange: DateRange,
  groupByPath = false
): Promise<{ date?: string; page_path?: string; views: number }[]> {
  try {
    if (groupByPath) {
      const r = await pool.query(
        `SELECT page_path, COUNT(*)::int AS views
         FROM analytics_events
         WHERE tenant_id = $1 AND event_type = 'page_view'
           AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
         GROUP BY page_path
         ORDER BY views DESC`,
        [tenantId, dateRange.start, dateRange.end]
      );
      return r.rows.map((row) => ({
        page_path: row.page_path ?? "",
        views: Number(row.views),
      }));
    }
    const r = await pool.query(
      `SELECT date_trunc('day', created_at)::date AS date, COUNT(*)::int AS views
       FROM analytics_events
       WHERE tenant_id = $1 AND event_type = 'page_view'
         AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
       GROUP BY date_trunc('day', created_at)
       ORDER BY date`,
      [tenantId, dateRange.start, dateRange.end]
    );
    return r.rows.map((row) => ({
      date: row.date,
      views: Number(row.views),
    }));
  } catch (err) {
    logError("getPageViews error", err as Error, { tenantId });
    return [];
  }
}

/**
 * Most visited pages for a tenant in a date range.
 */
export async function getTopPages(
  tenantId: string,
  dateRange: DateRange,
  limit = 20
): Promise<{ page_path: string; views: number; avg_duration_ms: number | null }[]> {
  try {
    const r = await pool.query(
      `SELECT
         page_path,
         COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS views,
         (AVG(duration_ms) FILTER (WHERE event_type = 'page_leave'))::int AS avg_duration_ms
       FROM analytics_events
       WHERE tenant_id = $1
         AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
         AND (event_type = 'page_view' OR event_type = 'page_leave')
       GROUP BY page_path
       ORDER BY views DESC
       LIMIT $4`,
      [tenantId, dateRange.start, dateRange.end, limit]
    );
    return r.rows.map((row) => ({
      page_path: row.page_path ?? "",
      views: Number(row.views),
      avg_duration_ms: row.avg_duration_ms != null ? Number(row.avg_duration_ms) : null,
    }));
  } catch (err) {
    logError("getTopPages error", err as Error, { tenantId });
    return [];
  }
}

/**
 * Ordered event sequence for a user (optionally for a single session).
 */
export async function getUserJourney(
  tenantId: string,
  userId: string,
  sessionId?: string | null
): Promise<
  {
    session_id: string;
    event_type: string;
    event_name: string | null;
    page_path: string | null;
    created_at: string;
    metadata: Record<string, unknown>;
  }[]
> {
  try {
    let sql = `
      SELECT session_id, event_type, event_name, page_path, created_at, metadata
      FROM analytics_events
      WHERE tenant_id = $1 AND user_id = $2
    `;
    const params: (string | number)[] = [tenantId, userId];
    if (sessionId) {
      params.push(sessionId);
      sql += ` AND session_id = $3`;
    }
    sql += ` ORDER BY created_at ASC`;
    const r = await pool.query(sql, params);
    return r.rows.map((row) => ({
      session_id: row.session_id,
      event_type: row.event_type,
      event_name: row.event_name,
      page_path: row.page_path,
      created_at: new Date(row.created_at).toISOString(),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }));
  } catch (err) {
    logError("getUserJourney error", err as Error, { tenantId, userId });
    return [];
  }
}

/**
 * Funnel analysis: step-by-step conversion. steps are ordered page paths or event names.
 * Returns counts at each step and drop-off.
 */
export interface FunnelStep {
  step: number;
  name: string;
  count: number;
  conversion_from_previous: number | null;
}

export async function getFunnelAnalysis(
  tenantId: string,
  steps: string[],
  dateRange: DateRange
): Promise<FunnelStep[]> {
  if (steps.length === 0) return [];
  try {
    // Count distinct sessions per step (sessions that had that step at least once).
    const result: FunnelStep[] = [];
    let prevCount: number | null = null;
    for (let i = 0; i < steps.length; i++) {
      const stepName = steps[i];
      const r = await pool.query(
        `SELECT COUNT(DISTINCT session_id)::int AS count
         FROM analytics_events
         WHERE tenant_id = $1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
           AND ((event_type = 'page_view' AND page_path = $4) OR event_name = $4)`,
        [tenantId, dateRange.start, dateRange.end, stepName]
      );
      const count = Number(r.rows[0]?.count ?? 0);
      result.push({
        step: i + 1,
        name: stepName,
        count,
        conversion_from_previous:
          prevCount != null && prevCount > 0 ? Math.round((count / prevCount) * 100) : null,
      });
      prevCount = count;
    }
    return result;
  } catch (err) {
    logError("getFunnelAnalysis error", err as Error, { tenantId });
    return [];
  }
}

/**
 * Click coordinates for a page (heatmap data).
 */
export async function getClickHeatmapData(
  tenantId: string,
  pagePath: string,
  dateRange: DateRange
): Promise<{ x: number; y: number; count: number }[]> {
  try {
    const r = await pool.query(
      `SELECT click_x AS x, click_y AS y, COUNT(*)::int AS count
       FROM analytics_events
       WHERE tenant_id = $1 AND event_type = 'click' AND page_path = $2
         AND created_at >= $3::timestamptz AND created_at < $4::timestamptz
         AND click_x IS NOT NULL AND click_y IS NOT NULL
       GROUP BY click_x, click_y
       ORDER BY count DESC`,
      [tenantId, pagePath, dateRange.start, dateRange.end]
    );
    return r.rows.map((row) => ({
      x: Number(row.x),
      y: Number(row.y),
      count: Number(row.count),
    }));
  } catch (err) {
    logError("getClickHeatmapData error", err as Error, { tenantId, pagePath });
    return [];
  }
}

export interface SessionListItem {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  page_count: number;
  event_count: number;
  entry_page: string | null;
  exit_page: string | null;
  duration_ms: number | null;
  has_replay: boolean;
}

/**
 * List sessions for a tenant with optional filters.
 */
export async function getSessionList(
  tenantId: string,
  filters: { userId?: string; start?: string; end?: string; limit?: number }
): Promise<SessionListItem[]> {
  try {
    let sql = `
      SELECT s.id, s.user_id, s.started_at, s.ended_at, s.page_count, s.event_count,
             s.entry_page, s.exit_page, s.duration_ms,
             EXISTS (SELECT 1 FROM analytics_session_replays r WHERE r.session_id = s.id) AS has_replay
      FROM analytics_sessions s
      WHERE s.tenant_id = $1
    `;
    const params: (string | number)[] = [tenantId];
    let idx = 2;
    if (filters.userId) {
      params.push(filters.userId);
      sql += ` AND s.user_id = $${idx++}`;
    }
    if (filters.start) {
      params.push(filters.start);
      sql += ` AND s.started_at >= $${idx++}::timestamptz`;
    }
    if (filters.end) {
      params.push(filters.end);
      sql += ` AND s.started_at < $${idx++}::timestamptz`;
    }
    sql += ` ORDER BY s.started_at DESC`;
    params.push(filters.limit ?? 50);
    sql += ` LIMIT $${idx}`;
    const r = await pool.query(sql, params);
    return r.rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      started_at: new Date(row.started_at).toISOString(),
      ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
      page_count: Number(row.page_count),
      event_count: Number(row.event_count),
      entry_page: row.entry_page,
      exit_page: row.exit_page,
      duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
      has_replay: Boolean(row.has_replay),
    }));
  } catch (err) {
    logError("getSessionList error", err as Error, { tenantId });
    return [];
  }
}

/**
 * DAU / WAU / MAU for a tenant. Returns one row per period (day/week/month) with distinct user count.
 */
export async function getActiveUsers(
  tenantId: string,
  period: "day" | "week" | "month"
): Promise<{ date: string; count: number }[]> {
  try {
    const rangeInterval = period === "day" ? "90 days" : period === "week" ? "52 weeks" : "12 months";
    const r = await pool.query(
      `SELECT date_trunc($2, created_at)::date AS date, COUNT(DISTINCT user_id)::int AS count
       FROM analytics_events
       WHERE tenant_id = $1 AND created_at >= NOW() - $3::interval
       GROUP BY date_trunc($2, created_at)
       ORDER BY date`,
      [tenantId, period, rangeInterval]
    );
    return r.rows.map((row) => ({
      date: String(row.date),
      count: Number(row.count),
    }));
  } catch (err) {
    logError("getActiveUsers error", err as Error, { tenantId });
    return [];
  }
}

/**
 * Feature usage: event_name (and page_path) counts for custom / click events.
 */
export async function getFeatureUsage(
  tenantId: string,
  dateRange: DateRange,
  limit = 50
): Promise<{ event_name: string | null; page_path: string | null; count: number }[]> {
  try {
    const r = await pool.query(
      `SELECT event_name, page_path, COUNT(*)::int AS count
       FROM analytics_events
       WHERE tenant_id = $1
         AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
         AND (event_type = 'custom' OR event_type = 'click')
       GROUP BY event_name, page_path
       ORDER BY count DESC
       LIMIT $4`,
      [tenantId, dateRange.start, dateRange.end, limit]
    );
    return r.rows.map((row) => ({
      event_name: row.event_name,
      page_path: row.page_path,
      count: Number(row.count),
    }));
  } catch (err) {
    logError("getFeatureUsage error", err as Error, { tenantId });
    return [];
  }
}

/**
 * Single session detail with replay chunk indices (for loading replay).
 */
export async function getSessionDetail(
  tenantId: string,
  sessionId: string
): Promise<{
  session: SessionListItem | null;
  replayChunkIndices: number[];
}> {
  try {
    const sessionRow = await pool.query(
      `SELECT s.id, s.user_id, s.started_at, s.ended_at, s.page_count, s.event_count,
              s.entry_page, s.exit_page, s.duration_ms,
              EXISTS (SELECT 1 FROM analytics_session_replays r WHERE r.session_id = s.id) AS has_replay
       FROM analytics_sessions s
       WHERE s.tenant_id = $1 AND s.id = $2`,
      [tenantId, sessionId]
    );
    if (sessionRow.rows.length === 0) {
      return { session: null, replayChunkIndices: [] };
    }
    const row = sessionRow.rows[0];
    const session: SessionListItem = {
      id: row.id,
      user_id: row.user_id,
      started_at: new Date(row.started_at).toISOString(),
      ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
      page_count: Number(row.page_count),
      event_count: Number(row.event_count),
      entry_page: row.entry_page,
      exit_page: row.exit_page,
      duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
      has_replay: Boolean(row.has_replay),
    };
    const chunks = await pool.query(
      `SELECT chunk_index FROM analytics_session_replays
       WHERE tenant_id = $1 AND session_id = $2
       ORDER BY chunk_index`,
      [tenantId, sessionId]
    );
    const replayChunkIndices = chunks.rows.map((r) => Number(r.chunk_index));
    return { session, replayChunkIndices };
  } catch (err) {
    logError("getSessionDetail error", err as Error, { tenantId, sessionId });
    return { session: null, replayChunkIndices: [] };
  }
}

/**
 * Load one replay chunk for playback.
 */
export async function getReplayChunk(
  tenantId: string,
  sessionId: string,
  chunkIndex: number
): Promise<unknown[] | null> {
  try {
    const r = await pool.query(
      `SELECT events_data FROM analytics_session_replays
       WHERE tenant_id = $1 AND session_id = $2 AND chunk_index = $3`,
      [tenantId, sessionId, chunkIndex]
    );
    if (r.rows.length === 0) return null;
    const data = r.rows[0].events_data;
    return Array.isArray(data) ? data : (data as { events?: unknown[] })?.events ?? [];
  } catch (err) {
    logError("getReplayChunk error", err as Error, { tenantId, sessionId, chunkIndex });
    return null;
  }
}

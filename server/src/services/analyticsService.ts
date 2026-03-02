/**
 * Analytics ingestion service.
 * Writes user behavior events, session upserts, and replay chunks to the management DB.
 * Uses fire-and-forget pattern so analytics never blocks the request.
 */

import { pool } from "../config/managementDatabase.js";
import { logError, logWarn } from "./logger.js";

export interface AnalyticsSessionPayload {
  id: string;
  userId: string;
  tenantId: string;
  startedAt: string;
  endedAt?: string | null;
  pageCount?: number;
  eventCount?: number;
  deviceType?: string | null;
  browser?: string | null;
  os?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  entryPage?: string | null;
  exitPage?: string | null;
  durationMs?: number | null;
}

export interface AnalyticsEventPayload {
  sessionId: string;
  userId: string;
  tenantId: string;
  eventType: string;
  eventName?: string | null;
  pageUrl?: string | null;
  pagePath?: string | null;
  referrerPath?: string | null;
  elementTag?: string | null;
  elementId?: string | null;
  elementText?: string | null;
  elementSelector?: string | null;
  clickX?: number | null;
  clickY?: number | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  metadata?: Record<string, unknown> | null;
  durationMs?: number | null;
  createdAt?: string | null;
}

/**
 * Bulk insert events. Non-blocking; errors are logged but not thrown.
 */
export async function ingestEvents(events: AnalyticsEventPayload[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    const cols = 19;
    let idx = 1;
    for (const e of events) {
      const row: string[] = [];
      for (let i = 0; i < cols; i++) row.push(`$${idx++}`);
      placeholders.push(`(${row.join(", ")})`);
      values.push(
        e.sessionId,
        e.userId,
        e.tenantId,
        e.eventType,
        e.eventName ?? null,
        e.pageUrl ?? null,
        e.pagePath ?? null,
        e.referrerPath ?? null,
        e.elementTag ?? null,
        e.elementId ?? null,
        (e.elementText ?? "").slice(0, 512),
        e.elementSelector ?? null,
        e.clickX ?? null,
        e.clickY ?? null,
        e.viewportWidth ?? null,
        e.viewportHeight ?? null,
        e.metadata ? JSON.stringify(e.metadata) : "{}",
        e.durationMs ?? null,
        e.createdAt ? new Date(e.createdAt) : null
      );
    }
    const sql = `
      INSERT INTO public.analytics_events (
        session_id, user_id, tenant_id, event_type, event_name,
        page_url, page_path, referrer_path,
        element_tag, element_id, element_text, element_selector,
        click_x, click_y, viewport_width, viewport_height,
        metadata, duration_ms, created_at
      ) VALUES ${placeholders.join(", ")}
    `;
    await pool.query(sql, values);
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string };
    const isTimeout =
      error?.message?.includes("timeout") || error?.code === "ETIMEDOUT";
    if (isTimeout) {
      logWarn("Analytics ingest skipped (timeout)", {
        eventCount: events.length,
      });
    } else {
      logError("Analytics ingest error", err as Error, { eventCount: events.length });
    }
  }
}

/**
 * Upsert session: insert or update ended_at, page_count, event_count, exit_page, duration_ms.
 */
export async function upsertSession(session: AnalyticsSessionPayload): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.analytics_sessions (
        id, user_id, tenant_id, started_at, ended_at, page_count, event_count,
        device_type, browser, os, screen_width, screen_height, entry_page, exit_page, duration_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO UPDATE SET
        ended_at = COALESCE(EXCLUDED.ended_at, analytics_sessions.ended_at),
        page_count = GREATEST(analytics_sessions.page_count, COALESCE(EXCLUDED.page_count, 0)),
        event_count = GREATEST(analytics_sessions.event_count, COALESCE(EXCLUDED.event_count, 0)),
        exit_page = COALESCE(EXCLUDED.exit_page, analytics_sessions.exit_page),
        duration_ms = COALESCE(EXCLUDED.duration_ms, analytics_sessions.duration_ms)`,
      [
        session.id,
        session.userId,
        session.tenantId,
        new Date(session.startedAt),
        session.endedAt ? new Date(session.endedAt) : null,
        session.pageCount ?? 0,
        session.eventCount ?? 0,
        session.deviceType ?? null,
        session.browser ?? null,
        session.os ?? null,
        session.screenWidth ?? null,
        session.screenHeight ?? null,
        session.entryPage ?? null,
        session.exitPage ?? null,
        session.durationMs ?? null,
      ]
    );
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string };
    const isTimeout =
      error?.message?.includes("timeout") || error?.code === "ETIMEDOUT";
    if (isTimeout) {
      logWarn("Analytics session upsert skipped (timeout)", { sessionId: session.id });
    } else {
      logError("Analytics session upsert error", err as Error, { sessionId: session.id });
    }
  }
}

/**
 * Store one rrweb replay chunk. Non-blocking.
 */
export async function storeReplayChunk(
  sessionId: string,
  userId: string,
  tenantId: string,
  chunkIndex: number,
  eventsData: unknown[]
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.analytics_session_replays (
        session_id, user_id, tenant_id, chunk_index, events_data
      ) VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, userId, tenantId, chunkIndex, JSON.stringify(eventsData)]
    );
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string };
    const isTimeout =
      error?.message?.includes("timeout") || error?.code === "ETIMEDOUT";
    if (isTimeout) {
      logWarn("Analytics replay chunk store skipped (timeout)", { sessionId, chunkIndex });
    } else {
      logError("Analytics replay chunk store error", err as Error, {
        sessionId,
        chunkIndex,
      });
    }
  }
}

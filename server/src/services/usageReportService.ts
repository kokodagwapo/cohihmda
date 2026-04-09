/**
 * Cross-tenant platform usage report service.
 *
 * Aggregates session counts, active users, feature/module usage, and recency
 * across all tenants from the management-DB analytics tables, plus per-tenant
 * user/loan counts from each tenant database.
 */

import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { listTenants } from "./tenantProvisioningService.js";
/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TenantUsageSummary {
  tenant_id: string;
  tenant_name: string;
  total_sessions: number;
  total_users: number;
  total_loans: number;
  active_users_30d: number;
  sessions_by_month: Record<string, number>;
  avg_session_duration_ms: number | null;
  last_session_at: string | null;
  days_since_last_session: number | null;
}

export interface UserUsageRow {
  tenant_name: string;
  user_id: string;
  user_email: string | null;
  total_sessions: number;
  avg_session_duration_ms: number | null;
  last_session_at: string | null;
  days_since_last_session: number | null;
  top_pages: string[];
}

export interface PageUsageRow {
  tenant_name: string;
  page_path: string;
  total_views: number;
  unique_users: number;
  last_viewed_at: string | null;
  activity_range: string;
}

export interface UsageReportData {
  generated_at: string;
  date_range: { start: string; end: string };
  tenants: TenantUsageSummary[];
  users: UserUsageRow[];
  pages: PageUsageRow[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function activityRange(daysAgo: number | null): string {
  if (daysAgo == null) return "No Activity";
  if (daysAgo <= 7) return "< 7 Days";
  if (daysAgo <= 30) return "< 30 Days";
  if (daysAgo <= 60) return "31-60 Days";
  if (daysAgo <= 90) return "61-90 Days";
  return "> 90 Days";
}

/* ------------------------------------------------------------------ */
/*  Core query                                                         */
/* ------------------------------------------------------------------ */

/**
 * All three tabs now derive from analytics_events as the primary source of
 * truth, since analytics_sessions may be empty (the session upsert fires
 * separately and can lag or fail). We count distinct session_ids from events
 * to approximate session counts, and use page_view events for activity.
 * analytics_sessions is only used as a supplement for duration data when
 * available.
 */
export async function generateUsageReport(
  days = 120,
): Promise<UsageReportData> {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString();
  const endStr = now.toISOString();

  const tenants = await listTenants();
  const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));

  // 1) Per-tenant aggregates from analytics_events
  const tenantEventsQuery = await managementPool.query(
    `SELECT
       tenant_id,
       COUNT(DISTINCT session_id)::int AS total_sessions,
       COUNT(DISTINCT user_id)::int AS active_users,
       MAX(created_at) AS last_activity_at,
       EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS days_since_last
     FROM analytics_events
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
     GROUP BY tenant_id`,
    [startStr, endStr],
  );

  // 2) Sessions by month per tenant (from events)
  const monthlyQuery = await managementPool.query(
    `SELECT
       tenant_id,
       TO_CHAR(created_at, 'YYYY-MM') AS month,
       COUNT(DISTINCT session_id)::int AS sessions
     FROM analytics_events
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
     GROUP BY tenant_id, TO_CHAR(created_at, 'YYYY-MM')
     ORDER BY tenant_id, month`,
    [startStr, endStr],
  );

  const monthlyMap = new Map<string, Record<string, number>>();
  for (const row of monthlyQuery.rows) {
    const tid = String(row.tenant_id);
    if (!monthlyMap.has(tid)) monthlyMap.set(tid, {});
    monthlyMap.get(tid)![row.month] = Number(row.sessions);
  }

  // 3) Avg session duration from analytics_sessions (supplement, may be empty)
  const durationQuery = await managementPool.query(
    `SELECT tenant_id, AVG(duration_ms)::int AS avg_duration_ms
     FROM analytics_sessions
     WHERE started_at >= $1::timestamptz AND started_at < $2::timestamptz
       AND duration_ms IS NOT NULL
     GROUP BY tenant_id`,
    [startStr, endStr],
  );
  const durationMap = new Map(
    durationQuery.rows.map((r: any) => [String(r.tenant_id), Number(r.avg_duration_ms)]),
  );

  // 4) Per-user usage from analytics_events
  const userQuery = await managementPool.query(
    `SELECT
       tenant_id,
       user_id,
       COUNT(DISTINCT session_id)::int AS total_sessions,
       COUNT(*)::int AS total_events,
       MAX(created_at) AS last_activity_at,
       EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS days_since_last
     FROM analytics_events
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
     GROUP BY tenant_id, user_id
     ORDER BY total_sessions DESC`,
    [startStr, endStr],
  );

  // 5) Per-user avg duration from analytics_sessions (supplement)
  const userDurationQuery = await managementPool.query(
    `SELECT tenant_id, user_id, AVG(duration_ms)::int AS avg_duration_ms
     FROM analytics_sessions
     WHERE started_at >= $1::timestamptz AND started_at < $2::timestamptz
       AND duration_ms IS NOT NULL
     GROUP BY tenant_id, user_id`,
    [startStr, endStr],
  );
  const userDurationMap = new Map(
    userDurationQuery.rows.map((r: any) => [
      `${r.tenant_id}:${r.user_id}`,
      Number(r.avg_duration_ms),
    ]),
  );

  // 6) Top pages per user (top 3)
  const topPagesQuery = await managementPool.query(
    `SELECT tenant_id, user_id, page_path, COUNT(*)::int AS views
     FROM analytics_events
     WHERE event_type = 'page_view'
       AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
       AND page_path IS NOT NULL
     GROUP BY tenant_id, user_id, page_path
     ORDER BY tenant_id, user_id, views DESC`,
    [startStr, endStr],
  );

  const userTopPages = new Map<string, string[]>();
  for (const row of topPagesQuery.rows) {
    const key = `${row.tenant_id}:${row.user_id}`;
    if (!userTopPages.has(key)) userTopPages.set(key, []);
    const arr = userTopPages.get(key)!;
    if (arr.length < 3 && row.page_path) arr.push(row.page_path);
  }

  // 7) Page-level usage across tenants
  const pageQuery = await managementPool.query(
    `SELECT
       tenant_id,
       page_path,
       COUNT(*)::int AS total_views,
       COUNT(DISTINCT user_id)::int AS unique_users,
       MAX(created_at) AS last_viewed_at,
       EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS days_since_last
     FROM analytics_events
     WHERE event_type = 'page_view'
       AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
     GROUP BY tenant_id, page_path
     ORDER BY total_views DESC`,
    [startStr, endStr],
  );

  // 8) Per-tenant user & loan counts (from tenant DBs)
  const tenantCounts = new Map<string, { users: number; loans: number }>();
  await Promise.all(
    tenants.map(async (tenant) => {
      try {
        const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
        const [uRes, lRes] = await Promise.all([
          tenantPool.query("SELECT COUNT(*)::int AS c FROM users"),
          tenantPool.query("SELECT COUNT(*)::int AS c FROM loans"),
        ]);
        tenantCounts.set(tenant.id, {
          users: Number(uRes.rows[0]?.c ?? 0),
          loans: Number(lRes.rows[0]?.c ?? 0),
        });
      } catch {
        tenantCounts.set(tenant.id, { users: 0, loans: 0 });
      }
    }),
  );

  // 9) Resolve user emails from tenant DBs
  const userIds = new Set(userQuery.rows.map((r: any) => String(r.user_id)));
  const userEmailMap = new Map<string, string>();
  if (userIds.size > 0) {
    await Promise.all(
      tenants.map(async (tenant) => {
        try {
          const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
          const res = await tenantPool.query(
            `SELECT id::text, email FROM users WHERE id::text = ANY($1)`,
            [Array.from(userIds)],
          );
          for (const row of res.rows) {
            userEmailMap.set(String(row.id), row.email);
          }
        } catch {
          // skip
        }
      }),
    );
  }

  // Assemble tenant summaries
  const eventsMap = new Map(
    tenantEventsQuery.rows.map((r: any) => [String(r.tenant_id), r]),
  );

  const tenantSummaries: TenantUsageSummary[] = tenants
    .filter((t) => t.status === "active")
    .map((t) => {
      const e = eventsMap.get(t.id);
      const counts = tenantCounts.get(t.id) ?? { users: 0, loans: 0 };
      return {
        tenant_id: t.id,
        tenant_name: t.name,
        total_sessions: Number(e?.total_sessions ?? 0),
        total_users: counts.users,
        total_loans: counts.loans,
        active_users_30d: Number(e?.active_users ?? 0),
        sessions_by_month: monthlyMap.get(t.id) ?? {},
        avg_session_duration_ms: durationMap.get(t.id) ?? null,
        last_session_at: e?.last_activity_at ? new Date(e.last_activity_at).toISOString() : null,
        days_since_last_session: e?.days_since_last != null ? Number(e.days_since_last) : null,
      };
    })
    .sort((a, b) => b.total_sessions - a.total_sessions);

  // Assemble user rows
  const users: UserUsageRow[] = userQuery.rows.map((r: any) => {
    const key = `${r.tenant_id}:${r.user_id}`;
    return {
      tenant_name: tenantMap.get(String(r.tenant_id)) ?? String(r.tenant_id),
      user_id: String(r.user_id),
      user_email: userEmailMap.get(String(r.user_id)) ?? null,
      total_sessions: Number(r.total_sessions),
      avg_session_duration_ms: userDurationMap.get(key) ?? null,
      last_session_at: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
      days_since_last_session: r.days_since_last != null ? Number(r.days_since_last) : null,
      top_pages: userTopPages.get(key) ?? [],
    };
  });

  // Assemble page rows
  const pages: PageUsageRow[] = pageQuery.rows.map((r: any) => ({
    tenant_name: tenantMap.get(String(r.tenant_id)) ?? String(r.tenant_id),
    page_path: r.page_path ?? "",
    total_views: Number(r.total_views),
    unique_users: Number(r.unique_users),
    last_viewed_at: r.last_viewed_at ? new Date(r.last_viewed_at).toISOString() : null,
    activity_range: activityRange(r.days_since_last != null ? Number(r.days_since_last) : null),
  }));

  return {
    generated_at: now.toISOString(),
    date_range: { start: startStr, end: endStr },
    tenants: tenantSummaries,
    users,
    pages,
  };
}

/* ------------------------------------------------------------------ */
/*  CSV export                                                         */
/* ------------------------------------------------------------------ */

function esc(cell: string | number | null | undefined): string {
  const s = String(cell ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row: (string | number | null | undefined)[]): string {
  return row.map(esc).join(",");
}

export function usageReportToCsv(report: UsageReportData): string {
  const lines: string[] = [];

  // ---- Sheet 1: Tenants ----
  lines.push("=== Usage by Client ===");
  lines.push("");

  // Collect all months across tenants
  const allMonths = new Set<string>();
  for (const t of report.tenants) {
    for (const m of Object.keys(t.sessions_by_month)) allMonths.add(m);
  }
  const sortedMonths = Array.from(allMonths).sort();

  const tenantHeaders = [
    "Client",
    "Total Sessions",
    "Active Users (30d)",
    "Total Users",
    "Total Loans",
    ...sortedMonths,
    "Avg Session (min)",
    "Last Session",
    "Days Ago",
    "Activity Range",
  ];
  lines.push(rowToCsv(tenantHeaders));

  for (const t of report.tenants) {
    const avgMin =
      t.avg_session_duration_ms != null
        ? (t.avg_session_duration_ms / 60000).toFixed(1)
        : "";
    const lastDate = t.last_session_at
      ? new Date(t.last_session_at).toISOString().split("T")[0]
      : "";
    lines.push(
      rowToCsv([
        t.tenant_name,
        t.total_sessions,
        t.active_users_30d,
        t.total_users,
        t.total_loans,
        ...sortedMonths.map((m) => t.sessions_by_month[m] ?? 0),
        avgMin,
        lastDate,
        t.days_since_last_session,
        activityRange(t.days_since_last_session),
      ]),
    );
  }

  lines.push("");
  lines.push("");

  // ---- Sheet 2: Users ----
  lines.push("=== Usage by User ===");
  lines.push("");
  lines.push(
    rowToCsv([
      "Client",
      "User Email",
      "Total Sessions",
      "Avg Session (min)",
      "Last Session",
      "Days Ago",
      "Activity Range",
      "Top Pages",
    ]),
  );

  for (const u of report.users) {
    const avgMin =
      u.avg_session_duration_ms != null
        ? (u.avg_session_duration_ms / 60000).toFixed(1)
        : "";
    const lastDate = u.last_session_at
      ? new Date(u.last_session_at).toISOString().split("T")[0]
      : "";
    lines.push(
      rowToCsv([
        u.tenant_name,
        u.user_email ?? u.user_id,
        u.total_sessions,
        avgMin,
        lastDate,
        u.days_since_last_session,
        activityRange(u.days_since_last_session),
        u.top_pages.join(" | "),
      ]),
    );
  }

  lines.push("");
  lines.push("");

  // ---- Sheet 3: Pages ----
  lines.push("=== Pages by Client ===");
  lines.push("");
  lines.push(
    rowToCsv([
      "Client",
      "Page",
      "Total Views",
      "Unique Users",
      "Last Viewed",
      "Activity Range",
    ]),
  );

  for (const p of report.pages) {
    const lastDate = p.last_viewed_at
      ? new Date(p.last_viewed_at).toISOString().split("T")[0]
      : "";
    lines.push(
      rowToCsv([
        p.tenant_name,
        p.page_path,
        p.total_views,
        p.unique_users,
        lastDate,
        p.activity_range,
      ]),
    );
  }

  return lines.join("\n");
}

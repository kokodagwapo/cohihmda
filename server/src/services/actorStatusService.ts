import type pg from "pg";
import {
  buildActorNotMissingClause,
  buildChannelWhereClause,
  getActorColumnForChannel,
  getActorSqlExpression,
} from "../utils/scorecard-utils.js";

export type ActorStatus = "Active" | "Inactive" | "Unknown";
export type ActorStatusFilter = "all" | "active" | "inactive";
export type ActorMatchType = "id" | "name" | "unknown" | "branch";

export interface ActorStatusMetadata {
  actorStatus: ActorStatus;
  lastLogin: string | null;
  actorStatusMatchType: ActorMatchType;
  encompassUserId: string | null;
}

export interface ActorStatusIndex {
  byId: Map<string, ActorStatusMetadata>;
  byName: Map<string, ActorStatusMetadata>;
}

export interface ActorStatusSummary {
  totalActors: number;
  matchedActors: number;
  unmatchedActors: number;
  activeActors: number;
  inactiveActors: number;
  unknownActors: number;
}

type ActorStatusUserRow = {
  encompass_user_id?: string | null;
  username?: string | null;
  full_name?: string | null;
  is_enabled?: boolean | null;
  encompass_last_login?: string | Date | null;
};

export function normalizeActorLookupKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatLastLogin(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function metadataFromUser(row: ActorStatusUserRow): ActorStatusMetadata {
  return {
    actorStatus: row.is_enabled === false ? "Inactive" : "Active",
    lastLogin: formatLastLogin(row.encompass_last_login),
    actorStatusMatchType: "id",
    encompassUserId: row.encompass_user_id ?? null,
  };
}

export function buildActorStatusIndex(rows: ActorStatusUserRow[]): ActorStatusIndex {
  const byId = new Map<string, ActorStatusMetadata>();
  const byName = new Map<string, ActorStatusMetadata>();

  for (const row of rows) {
    const metadata = metadataFromUser(row);
    const idKey = normalizeActorLookupKey(row.encompass_user_id);
    if (idKey) byId.set(idKey, metadata);

    for (const value of [row.full_name, row.username]) {
      const nameKey = normalizeActorLookupKey(value);
      if (nameKey && !byName.has(nameKey)) {
        byName.set(nameKey, { ...metadata, actorStatusMatchType: "name" });
      }
    }
  }

  return { byId, byName };
}

export async function loadActorStatusIndex(tenantPool: pg.Pool): Promise<ActorStatusIndex> {
  try {
    const result = await tenantPool.query<ActorStatusUserRow>(`
      SELECT encompass_user_id, username, full_name, is_enabled, encompass_last_login
      FROM public.encompass_users
    `);
    return buildActorStatusIndex(result.rows);
  } catch (error: any) {
    if (error?.code !== "42P01" && error?.code !== "42703") {
      console.warn("[ActorStatus] Failed to load encompass_users", {
        code: error?.code,
        message: error?.message,
      });
    }
    return { byId: new Map(), byName: new Map() };
  }
}

export function resolveActorStatus(
  index: ActorStatusIndex,
  actor: { actorId?: unknown; actorName?: unknown; actorKind?: string },
): ActorStatusMetadata {
  if (actor.actorKind === "branch") {
    return {
      actorStatus: "Unknown",
      lastLogin: null,
      actorStatusMatchType: "branch",
      encompassUserId: null,
    };
  }

  const idKey = normalizeActorLookupKey(actor.actorId);
  if (idKey && index.byId.has(idKey)) {
    return { ...index.byId.get(idKey)!, actorStatusMatchType: "id" };
  }

  const nameKey = normalizeActorLookupKey(actor.actorName);
  if (nameKey && index.byName.has(nameKey)) {
    return { ...index.byName.get(nameKey)!, actorStatusMatchType: "name" };
  }

  return {
    actorStatus: "Unknown",
    lastLogin: null,
    actorStatusMatchType: "unknown",
    encompassUserId: null,
  };
}

export async function enrichActorsWithStatus<T extends Record<string, any>>(
  tenantPool: pg.Pool,
  actors: T[],
  options: {
    actorKind?: string;
    getActorId?: (actor: T) => unknown;
    getActorName?: (actor: T) => unknown;
  } = {},
): Promise<Array<T & ActorStatusMetadata>> {
  const index = await loadActorStatusIndex(tenantPool);
  return actors.map((actor) => ({
    ...actor,
    ...resolveActorStatus(index, {
      actorId: options.getActorId?.(actor),
      actorName: options.getActorName?.(actor) ?? actor.name ?? actor.groupKey,
      actorKind: options.actorKind,
    }),
  }));
}

export function normalizeActorStatusFilter(value: unknown): ActorStatusFilter {
  const normalized = String(value ?? "all").trim().toLowerCase();
  if (normalized === "active" || normalized === "active-only" || normalized === "active_only") return "active";
  if (normalized === "inactive" || normalized === "inactive-only" || normalized === "inactive_only") return "inactive";
  return "all";
}

export function filterActorsByStatus<T extends { actorStatus?: ActorStatus }>(
  actors: T[],
  filter: ActorStatusFilter,
): T[] {
  if (filter === "active") return actors.filter((actor) => actor.actorStatus === "Active");
  if (filter === "inactive") return actors.filter((actor) => actor.actorStatus === "Inactive");
  return actors;
}

export function buildActorStatusSummary(actors: Array<{ actorStatus?: ActorStatus }>): ActorStatusSummary {
  const activeActors = actors.filter((actor) => actor.actorStatus === "Active").length;
  const inactiveActors = actors.filter((actor) => actor.actorStatus === "Inactive").length;
  const unknownActors = actors.filter((actor) => actor.actorStatus === "Unknown" || !actor.actorStatus).length;
  return {
    totalActors: actors.length,
    matchedActors: activeActors + inactiveActors,
    unmatchedActors: unknownActors,
    activeActors,
    inactiveActors,
    unknownActors,
  };
}

/** Distinct loan-book actors vs Encompass coverage (for admin reconciliation UI). */
export type LoanActorReportingCoverage = ActorStatusSummary & {
  actorColumn: string;
  distinctLoanActors: number;
};

/**
 * Summarize how many distinct loan-side actors (LO or AE) match synced Encompass users.
 * Uses the same column rules as scorecards; branch is not evaluated here.
 */
export async function summarizeLoanActorReportingCoverage(
  tenantPool: pg.Pool,
  options?: { channelGroup?: string },
): Promise<LoanActorReportingCoverage> {
  const actorColumn = getActorColumnForChannel(options?.channelGroup);
  const actorSql = getActorSqlExpression(options?.channelGroup, "l");
  const rawCol =
    actorColumn === "loan_officer" ? "l.loan_officer" : "l.account_executive";
  const notMissing = buildActorNotMissingClause(rawCol, "extended");
  const channelSql = buildChannelWhereClause(options?.channelGroup, "l");
  const idAgg =
    actorColumn === "loan_officer"
      ? `MIN(NULLIF(TRIM(l.loan_officer_id), ''))`
      : `NULL::text`;

  const query = `
    SELECT ${actorSql} AS actor_name,
           ${idAgg} AS actor_id
    FROM public.loans l
    WHERE 1=1
      ${channelSql}
      AND ${notMissing}
    GROUP BY ${actorSql}
  `;

  try {
    const { rows } = await tenantPool.query<{ actor_name: string; actor_id: string | null }>(
      query,
    );
    const index = await loadActorStatusIndex(tenantPool);
    const enriched = rows.map((r) => ({
      actorStatus: resolveActorStatus(index, {
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorKind: actorColumn,
      }).actorStatus,
    }));
    return {
      ...buildActorStatusSummary(enriched),
      actorColumn,
      distinctLoanActors: rows.length,
    };
  } catch (error: any) {
    if (error?.code === "42P01" || error?.code === "42703") {
      return {
        totalActors: 0,
        matchedActors: 0,
        unmatchedActors: 0,
        activeActors: 0,
        inactiveActors: 0,
        unknownActors: 0,
        actorColumn,
        distinctLoanActors: 0,
      };
    }
    throw error;
  }
}

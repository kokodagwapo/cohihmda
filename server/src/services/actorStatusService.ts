import type pg from "pg";
import {
  buildActorNotMissingClause,
  buildChannelWhereClause,
  getActorColumnForChannel,
  getActorSqlExpression,
} from "../utils/scorecard-utils.js";

export type ActorStatus = "Active" | "Inactive" | "Removed" | "Unknown";
export type ActorStatusFilter = "all" | "active" | "inactive";
export type ActorMatchType = "id" | "name" | "removed" | "unknown" | "branch";

export interface ActorStatusMetadata {
  actorStatus: ActorStatus;
  lastLogin: string | null;
  actorStatusMatchType: ActorMatchType;
  encompassUserId: string | null;
}

export interface ActorStatusIndex {
  byId: Map<string, ActorStatusMetadata>;
  byName: Map<string, ActorStatusMetadata>;
  hasSyncedUsers: boolean;
}

export interface ActorStatusSummary {
  totalActors: number;
  matchedActors: number;
  unmatchedActors: number;
  activeActors: number;
  inactiveActors: number;
  removedActors: number;
  unknownActors: number;
}

type ActorStatusUserRow = {
  encompass_user_id?: string | null;
  username?: string | null;
  full_name?: string | null;
  encompass_full_name?: string | null;
  is_enabled?: boolean | null;
  encompass_last_login?: string | Date | null;
};

export function normalizeActorLookupKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

export function buildActorNameLookupKeys(value: unknown): string[] {
  const fullNameKey = normalizeActorLookupKey(value);
  if (!fullNameKey) return [];

  const keys = [fullNameKey];
  const tokens = fullNameKey
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  if (tokens.length >= 3) {
    const firstLastKey = normalizeActorLookupKey(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    if (firstLastKey && !keys.includes(firstLastKey)) {
      keys.push(firstLastKey);
    }
  }

  return keys;
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

    for (const value of [row.encompass_full_name, row.full_name, row.username]) {
      const nameKey = normalizeActorLookupKey(value);
      if (nameKey && !byName.has(nameKey)) {
        byName.set(nameKey, { ...metadata, actorStatusMatchType: "name" });
      }
    }
  }

  return { byId, byName, hasSyncedUsers: rows.length > 0 };
}

export async function loadActorStatusIndex(tenantPool: pg.Pool): Promise<ActorStatusIndex> {
  try {
    const result = await tenantPool.query<ActorStatusUserRow>(`
      SELECT encompass_user_id,
             username,
             full_name,
             encompass_full_name,
             is_enabled,
             encompass_last_login
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
    return { byId: new Map(), byName: new Map(), hasSyncedUsers: false };
  }
}

export interface ActorMatchTrace {
  normalizedActorId: string;
  normalizedActorName: string;
  triedIdLookup: boolean;
  idHit: boolean;
  triedNameLookup: boolean;
  nameHit: boolean;
  branchActor: boolean;
}

export function resolveActorStatusWithTrace(
  index: ActorStatusIndex,
  actor: { actorId?: unknown; actorName?: unknown; actorKind?: string },
): { metadata: ActorStatusMetadata; trace: ActorMatchTrace } {
  const normalizedActorId = normalizeActorLookupKey(actor.actorId);
  const nameKeys = buildActorNameLookupKeys(actor.actorName);
  const normalizedActorName = nameKeys[0] ?? "";
  const branchActor = actor.actorKind === "branch";

  if (branchActor) {
    return {
      metadata: {
        actorStatus: "Unknown",
        lastLogin: null,
        actorStatusMatchType: "branch",
        encompassUserId: null,
      },
      trace: {
        normalizedActorId,
        normalizedActorName,
        triedIdLookup: false,
        idHit: false,
        triedNameLookup: false,
        nameHit: false,
        branchActor: true,
      },
    };
  }

  const triedIdLookup = Boolean(normalizedActorId);
  const idHit = triedIdLookup && index.byId.has(normalizedActorId);
  if (idHit) {
    return {
      metadata: { ...index.byId.get(normalizedActorId)!, actorStatusMatchType: "id" },
      trace: {
        normalizedActorId,
        normalizedActorName,
        triedIdLookup,
        idHit: true,
        triedNameLookup: false,
        nameHit: false,
        branchActor: false,
      },
    };
  }

  const triedNameLookup = nameKeys.length > 0;
  const matchedNameKey = nameKeys.find((key) => index.byName.has(key));
  const nameHit = Boolean(matchedNameKey);
  if (nameHit) {
    return {
      metadata: { ...index.byName.get(matchedNameKey!)!, actorStatusMatchType: "name" },
      trace: {
        normalizedActorId,
        normalizedActorName,
        triedIdLookup,
        idHit: false,
        triedNameLookup: true,
        nameHit: true,
        branchActor: false,
      },
    };
  }

  const removed = index.hasSyncedUsers && (triedIdLookup || triedNameLookup);
  return {
    metadata: {
      actorStatus: removed ? "Removed" : "Unknown",
      lastLogin: null,
      actorStatusMatchType: removed ? "removed" : "unknown",
      encompassUserId: null,
    },
    trace: {
      normalizedActorId,
      normalizedActorName,
      triedIdLookup,
      idHit: false,
      triedNameLookup,
      nameHit: false,
      branchActor: false,
    },
  };
}

export function resolveActorStatus(
  index: ActorStatusIndex,
  actor: { actorId?: unknown; actorName?: unknown; actorKind?: string },
): ActorStatusMetadata {
  return resolveActorStatusWithTrace(index, actor).metadata;
}

export interface EncompassUsersSyncHealth {
  totalEncompassUsers: number;
  disabledCount: number;
  lastSyncedAt: string | null;
}

export async function fetchEncompassUsersSyncHealth(
  tenantPool: pg.Pool,
): Promise<EncompassUsersSyncHealth | null> {
  try {
    const { rows } = await tenantPool.query<{
      total: string;
      disabled: string;
      last_synced_at: Date | null;
    }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE is_enabled = false)::text AS disabled,
              MAX(last_synced_at) AS last_synced_at
       FROM public.encompass_users`,
    );
    const r = rows[0];
    if (!r) return null;
    return {
      totalEncompassUsers: Number(r.total) || 0,
      disabledCount: Number(r.disabled) || 0,
      lastSyncedAt: r.last_synced_at
        ? new Date(r.last_synced_at).toISOString()
        : null,
    };
  } catch (error: any) {
    if (error?.code === "42P01" || error?.code === "42703") {
      return null;
    }
    throw error;
  }
}

export type ActorMatchDebugSuggestion = {
  encompass_user_id: string;
  username: string | null;
  full_name: string | null;
  is_enabled: boolean | null;
};

function suggestTokensFromActorName(actorNameRaw: string): string[] {
  return String(actorNameRaw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 2);
}

export async function fetchNameMatchSuggestions(
  tenantPool: pg.Pool,
  actorNameRaw: string,
  limit = 8,
): Promise<ActorMatchDebugSuggestion[]> {
  const tokens = suggestTokensFromActorName(actorNameRaw);
  if (tokens.length === 0) return [];
  try {
    for (const token of tokens) {
      const pattern = `%${token}%`;
      const { rows } = await tenantPool.query<ActorMatchDebugSuggestion>(
        `SELECT encompass_user_id,
                username,
                COALESCE(encompass_full_name, full_name) AS full_name,
                is_enabled
         FROM public.encompass_users
         WHERE LOWER(TRIM(COALESCE(encompass_full_name, full_name, ''))) LIKE $1
            OR LOWER(TRIM(COALESCE(username, ''))) LIKE $1
            OR LOWER(TRIM(COALESCE(email, ''))) LIKE $1
         LIMIT $2`,
        [pattern, limit],
      );
      if (rows.length > 0) return rows;
    }
    return [];
  } catch (error: any) {
    if (error?.code === "42P01" || error?.code === "42703") {
      return [];
    }
    throw error;
  }
}

export interface ActorMatchDebugResponse {
  resolved: ActorStatusMetadata;
  trace: ActorMatchTrace;
  encompassSyncHealth: EncompassUsersSyncHealth | null;
  nameSuggestions: ActorMatchDebugSuggestion[];
}

/** Admin / tooling: why a loan-book actor did or did not match `encompass_users`. */
export async function explainActorMatch(
  tenantPool: pg.Pool,
  input: {
    actorName?: string | null;
    actorId?: string | null;
    actorKind?: string | null;
  },
): Promise<ActorMatchDebugResponse> {
  const index = await loadActorStatusIndex(tenantPool);
  const { metadata, trace } = resolveActorStatusWithTrace(index, {
    actorId: input.actorId,
    actorName: input.actorName,
    actorKind: input.actorKind ?? undefined,
  });
  const encompassSyncHealth = await fetchEncompassUsersSyncHealth(tenantPool);
  let nameSuggestions: ActorMatchDebugSuggestion[] = [];
  if (metadata.actorStatusMatchType === "unknown") {
    const rawName = String(input.actorName ?? "").trim();
    if (rawName) {
      nameSuggestions = await fetchNameMatchSuggestions(tenantPool, rawName, 8);
    }
  }
  return { resolved: metadata, trace, encompassSyncHealth, nameSuggestions };
}

export type UnknownLoanActorDebugEntry = {
  actor_name: string;
  actor_id: string | null;
  loan_count: number;
  resolved: ActorStatusMetadata;
  trace: ActorMatchTrace;
  nameSuggestions: ActorMatchDebugSuggestion[];
};

/**
 * Top removed/unknown loan-book actors (by loan count) with match trace and fuzzy name hints.
 * Uses the same loan grouping rules as `summarizeLoanActorReportingCoverage`.
 */
export async function listUnknownLoanActorsDebug(
  tenantPool: pg.Pool,
  options?: { channelGroup?: string; limit?: number },
): Promise<{
  encompassSyncHealth: EncompassUsersSyncHealth | null;
  actorColumn: string;
  entries: UnknownLoanActorDebugEntry[];
}> {
  const limit = Math.min(Math.max(Number(options?.limit) || 30, 1), 200);
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
           ${idAgg} AS actor_id,
           COUNT(*)::int AS loan_count
    FROM public.loans l
    WHERE 1=1
      ${channelSql}
      AND ${notMissing}
    GROUP BY ${actorSql}
    ORDER BY loan_count DESC
  `;

  try {
    const { rows } = await tenantPool.query<{
      actor_name: string;
      actor_id: string | null;
      loan_count: number;
    }>(query);
    const index = await loadActorStatusIndex(tenantPool);
    const encompassSyncHealth = await fetchEncompassUsersSyncHealth(tenantPool);

    const entries: UnknownLoanActorDebugEntry[] = [];
    for (const row of rows) {
      const { metadata, trace } = resolveActorStatusWithTrace(index, {
        actorId: row.actor_id,
        actorName: row.actor_name,
        actorKind: actorColumn,
      });
      if (metadata.actorStatus !== "Unknown" && metadata.actorStatus !== "Removed") continue;

      const nameSuggestions = await fetchNameMatchSuggestions(
        tenantPool,
        String(row.actor_name ?? "").trim(),
        5,
      );
      entries.push({
        actor_name: row.actor_name,
        actor_id: row.actor_id,
        loan_count: row.loan_count,
        resolved: metadata,
        trace,
        nameSuggestions,
      });
      if (entries.length >= limit) break;
    }
    return {
      encompassSyncHealth,
      actorColumn,
      entries,
    };
  } catch (error: any) {
    if (error?.code === "42P01" || error?.code === "42703") {
      return {
        encompassSyncHealth: null,
        actorColumn,
        entries: [],
      };
    }
    throw error;
  }
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
  if (filter === "inactive") {
    return actors.filter((actor) => actor.actorStatus === "Inactive" || actor.actorStatus === "Removed");
  }
  return actors;
}

export function buildActorStatusSummary(actors: Array<{ actorStatus?: ActorStatus }>): ActorStatusSummary {
  const activeActors = actors.filter((actor) => actor.actorStatus === "Active").length;
  const inactiveActors = actors.filter((actor) => actor.actorStatus === "Inactive").length;
  const removedActors = actors.filter((actor) => actor.actorStatus === "Removed").length;
  const unknownActors = actors.filter((actor) => actor.actorStatus === "Unknown" || !actor.actorStatus).length;
  return {
    totalActors: actors.length,
    matchedActors: activeActors + inactiveActors,
    unmatchedActors: removedActors + unknownActors,
    activeActors,
    inactiveActors,
    removedActors,
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
        removedActors: 0,
        unknownActors: 0,
        actorColumn,
        distinctLoanActors: 0,
      };
    }
    throw error;
  }
}

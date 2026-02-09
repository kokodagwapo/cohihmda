/**
 * Schema Context Service
 *
 * Dynamically introspects tenant database schemas via information_schema.columns
 * and merges with the METRICS_CATALOG to build an accurate, per-tenant schema
 * context string for LLM prompts.
 *
 * Key features:
 *   - Per-tenant caching with configurable TTL (default 1 hour)
 *   - Falls back to the hardcoded LOAN_FIELD_SCHEMA when introspection fails
 *   - Combines real column metadata with calculated metric definitions
 */

import pg from "pg";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import {
  METRICS_CATALOG,
  MetricDefinition,
} from "../metrics/metricsService.js";

// ============================================================================
// Types
// ============================================================================

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface CachedSchema {
  context: string;
  columns: ColumnInfo[];
  enumValues: Record<string, string[]>;
  fetchedAt: number;
}

// Columns that likely contain enum-like categorical values
// We'll query DISTINCT values for these to give the LLM better context
const ENUM_LIKE_COLUMNS = [
  "loan_type",
  "loan_purpose",
  "current_loan_status",
  "property_type",
  "occupancy_type",
  "property_state",
  "channel",
  "loan_program",
];

// ============================================================================
// Fallback – kept in sync with the old hardcoded LOAN_FIELD_SCHEMA
// ============================================================================

const FALLBACK_LOAN_FIELDS: {
  category: string;
  title: string;
  fields: { name: string; type: string; description: string }[];
}[] = [
  {
    category: "core",
    title: "Core Fields",
    fields: [
      { name: "loan_id", type: "TEXT", description: "Unique loan identifier" },
      { name: "loan_number", type: "TEXT", description: "Loan number" },
      { name: "loan_amount", type: "DECIMAL", description: "Total loan amount" },
      {
        name: "loan_type",
        type: "TEXT",
        description: "Type of loan (Conventional, FHA, VA, USDA, etc.)",
      },
      {
        name: "loan_purpose",
        type: "TEXT",
        description: "Purpose (Purchase, Refinance, Cash-Out Refinance)",
      },
      { name: "loan_program", type: "TEXT", description: "Loan program name" },
      {
        name: "current_loan_status",
        type: "TEXT",
        description: "Current status (Active Loan, Originated, Withdrawn, Denied)",
      },
      {
        name: "current_milestone",
        type: "TEXT",
        description: "Current milestone in pipeline",
      },
      {
        name: "channel",
        type: "TEXT",
        description: "Channel (Retail, Wholesale, Correspondent, TPO)",
      },
    ],
  },
  {
    category: "personnel",
    title: "Personnel Fields",
    fields: [
      { name: "loan_officer", type: "TEXT", description: "Loan officer name" },
      { name: "loan_officer_id", type: "TEXT", description: "Loan officer ID" },
      { name: "processor", type: "TEXT", description: "Processor name" },
      { name: "underwriter", type: "TEXT", description: "Underwriter name" },
      { name: "closer", type: "TEXT", description: "Closer name" },
      { name: "branch", type: "TEXT", description: "Branch name/code" },
    ],
  },
  {
    category: "property",
    title: "Property Fields",
    fields: [
      { name: "property_city", type: "TEXT", description: "Property city" },
      {
        name: "property_state",
        type: "TEXT",
        description: "Property state (2-letter code)",
      },
      { name: "property_county", type: "TEXT", description: "Property county" },
      {
        name: "property_type",
        type: "TEXT",
        description: "Property type (Single Family, Condo, etc.)",
      },
      {
        name: "occupancy_type",
        type: "TEXT",
        description: "Occupancy type (Primary, Investment, Second Home)",
      },
    ],
  },
  {
    category: "financial",
    title: "Financial Fields",
    fields: [
      {
        name: "interest_rate",
        type: "DECIMAL",
        description: "Interest rate percentage",
      },
      {
        name: "cltv",
        type: "DECIMAL",
        description: "Combined loan-to-value ratio",
      },
      { name: "ltv_ratio", type: "DECIMAL", description: "Loan-to-value ratio" },
      {
        name: "be_dti_ratio",
        type: "DECIMAL",
        description: "Back-end debt-to-income ratio",
      },
      { name: "fico_score", type: "INTEGER", description: "Credit score" },
      {
        name: "rate_lock_buy_side_base_price_rate",
        type: "DECIMAL",
        description: "Base buy rate (for revenue calc)",
      },
      {
        name: "orig_fee_borr_pd",
        type: "DECIMAL",
        description: "Origination fee paid by borrower",
      },
      {
        name: "orig_fees_seller",
        type: "DECIMAL",
        description: "Origination fees from seller",
      },
      {
        name: "cd_lender_credits",
        type: "DECIMAL",
        description: "Lender credits on closing disclosure",
      },
    ],
  },
  {
    category: "dates",
    title: "Key Dates",
    fields: [
      { name: "application_date", type: "DATE", description: "Application date" },
      { name: "started_date", type: "DATE", description: "Started date" },
      { name: "lock_date", type: "DATE", description: "Rate lock date" },
      { name: "closing_date", type: "DATE", description: "Closing date" },
      { name: "funding_date", type: "DATE", description: "Funding date" },
      {
        name: "investor_purchase_date",
        type: "DATE",
        description: "Investor purchase date",
      },
      { name: "credit_pull_date", type: "DATE", description: "Credit pull date" },
    ],
  },
];

// ============================================================================
// Cache
// ============================================================================

const schemaCache = new Map<string, CachedSchema>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ============================================================================
// Postgres type → friendly type mapping
// ============================================================================

function pgTypeToFriendly(pgType: string): string {
  const t = pgType.toLowerCase();
  if (t.includes("int")) return "INTEGER";
  if (t.includes("numeric") || t.includes("decimal") || t.includes("double") || t.includes("float") || t.includes("real"))
    return "DECIMAL";
  if (t.includes("bool")) return "BOOLEAN";
  if (t.includes("date") && !t.includes("time")) return "DATE";
  if (t.includes("timestamp")) return "TIMESTAMP";
  if (t.includes("time")) return "TIME";
  if (t.includes("text") || t.includes("char") || t.includes("varchar") || t.includes("uuid"))
    return "TEXT";
  if (t.includes("json")) return "JSON";
  return pgType.toUpperCase();
}

// ============================================================================
// Category heuristic – group columns by name pattern
// ============================================================================

function categoriseColumn(name: string): string {
  const n = name.toLowerCase();
  // Dates
  if (n.endsWith("_date") || n.endsWith("_at") || n === "created" || n === "updated") return "dates";
  // Personnel
  if (
    n.includes("officer") ||
    n.includes("processor") ||
    n.includes("underwriter") ||
    n.includes("closer") ||
    n.includes("branch") ||
    n.includes("funder") ||
    n.includes("shipper")
  )
    return "personnel";
  // Property
  if (n.includes("property") || n.includes("occupancy") || n === "county" || n === "state" || n === "city")
    return "property";
  // Financial
  if (
    n.includes("amount") ||
    n.includes("rate") ||
    n.includes("fico") ||
    n.includes("ltv") ||
    n.includes("dti") ||
    n.includes("price") ||
    n.includes("fee") ||
    n.includes("credit") ||
    n.includes("revenue") ||
    n.includes("cost") ||
    n.includes("margin") ||
    n.includes("value") ||
    n.includes("income") ||
    n.includes("debt")
  )
    return "financial";
  // Core / catch-all
  return "core";
}

const CATEGORY_TITLES: Record<string, string> = {
  core: "Core Fields",
  personnel: "Personnel Fields",
  property: "Property Fields",
  financial: "Financial Fields",
  dates: "Key Dates",
  other: "Other Fields",
};

// ============================================================================
// Fetch distinct enum values for categorical columns
// ============================================================================

async function fetchEnumValues(
  pool: pg.Pool,
  availableColumns: string[]
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};

  // Only query columns that actually exist in this tenant's table
  const columnsToQuery = ENUM_LIKE_COLUMNS.filter((c) =>
    availableColumns.includes(c)
  );

  // Run all queries in parallel for speed
  const queries = columnsToQuery.map(async (col) => {
    try {
      const res = await pool.query(
        `SELECT DISTINCT ${col} FROM public.loans
         WHERE ${col} IS NOT NULL AND ${col} != ''
         ORDER BY ${col}
         LIMIT 25`
      );
      const values = res.rows
        .map((r: any) => r[col])
        .filter((v: any) => v != null && String(v).trim() !== "");
      if (values.length > 0 && values.length <= 25) {
        result[col] = values.map((v: any) => String(v));
      }
    } catch {
      // Skip columns that error (e.g., don't exist in older schemas)
    }
  });

  await Promise.all(queries);
  return result;
}

// ============================================================================
// Build schema context string
// ============================================================================

function buildSchemaContextFromColumns(
  columns: ColumnInfo[],
  enumValues: Record<string, string[]> = {}
): string {
  const sections: string[] = [];

  // Group columns by category
  const grouped: Record<string, ColumnInfo[]> = {};
  for (const col of columns) {
    const cat = categoriseColumn(col.column_name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(col);
  }

  sections.push("## Available Loan Fields (Columns in loans table)\n");

  const order = ["core", "personnel", "property", "financial", "dates", "other"];
  for (const cat of order) {
    const cols = grouped[cat];
    if (!cols || cols.length === 0) continue;
    sections.push(`### ${CATEGORY_TITLES[cat] || cat}`);
    for (const col of cols) {
      const friendly = pgTypeToFriendly(col.data_type);
      const nullable = col.is_nullable === "YES" ? " (nullable)" : "";
      const vals = enumValues[col.column_name];
      const valHint = vals
        ? ` — Values: ${vals.join(", ")}`
        : "";
      sections.push(`- ${col.column_name} (${friendly})${nullable}${valHint}`);
    }
    sections.push("");
  }

  // Append metrics from METRICS_CATALOG
  sections.push(...buildMetricsSection());

  // Append quick reference
  sections.push(...buildQuickReference());

  return sections.join("\n");
}

function buildFallbackSchemaContext(): string {
  const sections: string[] = [];

  sections.push("## Available Loan Fields (Columns in loans table)\n");

  for (const category of FALLBACK_LOAN_FIELDS) {
    sections.push(`### ${category.title}`);
    for (const field of category.fields) {
      sections.push(`- ${field.name} (${field.type}): ${field.description}`);
    }
    sections.push("");
  }

  sections.push(...buildMetricsSection());
  sections.push(...buildQuickReference());

  return sections.join("\n");
}

function buildMetricsSection(): string[] {
  const sections: string[] = [];

  sections.push("## CALCULATED METRICS (from METRICS_CATALOG)\n");
  sections.push(
    "IMPORTANT: These are NOT columns. You must use the SQL formulas below to calculate them.\n"
  );

  const metricsByCategory: Record<string, MetricDefinition[]> = {};
  for (const metric of Object.values(METRICS_CATALOG)) {
    if (!metricsByCategory[metric.category]) {
      metricsByCategory[metric.category] = [];
    }
    metricsByCategory[metric.category].push(metric);
  }

  const categoryTitles: Record<string, string> = {
    status: "Status Metrics",
    turn_time: "Turn Time Metrics",
    revenue: "Revenue Metrics",
    pull_through: "Pull-Through Metrics",
    volume: "Volume Metrics",
    count: "Count Metrics",
  };

  for (const [categoryId, metrics] of Object.entries(metricsByCategory)) {
    sections.push(`### ${categoryTitles[categoryId] || categoryId}`);
    for (const metric of metrics) {
      sections.push(`**${metric.name}** (${metric.id})`);
      sections.push(`- Description: ${metric.description}`);
      sections.push(`- Formula: ${metric.formula}`);
      if (metric.defaultDateField) {
        sections.push(`- Default date field: ${metric.defaultDateField}`);
      }
      if (metric.ignoreDateFilter) {
        sections.push(
          `- Note: This is a current state metric - do NOT filter by date range`
        );
      }
      if (metric.sqlQuery) {
        const cleanSql = metric.sqlQuery.replace(/\s+/g, " ").trim();
        sections.push(
          `- SQL: \`${cleanSql.substring(0, 300)}${
            cleanSql.length > 300 ? "..." : ""
          }\``
        );
      }
      if (metric.notes) {
        sections.push(`- Notes: ${metric.notes}`);
      }
      sections.push("");
    }
  }

  return sections;
}

function buildQuickReference(): string[] {
  return [
    "## Quick Reference - Status Indicators",
    "- Funded: funding_date IS NOT NULL",
    "- Active: current_loan_status = 'Active Loan'",
    "- Locked: lock_date IS NOT NULL",
    "- Originated: current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%'",
  ];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the LLM-ready schema context for a given tenant.
 * Uses information_schema introspection with per-tenant caching.
 * Falls back to the hardcoded LOAN_FIELD_SCHEMA on any error.
 */
export async function getSchemaForTenant(tenantId: string): Promise<string> {
  // Check cache
  const cached = schemaCache.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.context;
  }

  try {
    const pool = await tenantDbManager.getTenantPool(tenantId);

    // Query information_schema for the loans table columns
    const result = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'loans'
      ORDER BY ordinal_position
    `);

    if (result.rows.length === 0) {
      console.warn(
        `[SchemaContext] No columns found for tenant ${tenantId} loans table – using fallback`
      );
      const fallback = buildFallbackSchemaContext();
      schemaCache.set(tenantId, {
        context: fallback,
        columns: [],
        enumValues: {},
        fetchedAt: Date.now(),
      });
      return fallback;
    }

    // Fetch distinct values for enum-like columns (parallel, non-blocking)
    const availableColumnNames = result.rows.map((r) => r.column_name);
    let enumValues: Record<string, string[]> = {};
    try {
      enumValues = await fetchEnumValues(pool, availableColumnNames);
    } catch (err: any) {
      console.warn(
        `[SchemaContext] Failed to fetch enum values for tenant ${tenantId}: ${err.message}`
      );
    }

    const context = buildSchemaContextFromColumns(result.rows, enumValues);

    schemaCache.set(tenantId, {
      context,
      columns: result.rows,
      enumValues,
      fetchedAt: Date.now(),
    });

    const enumCount = Object.keys(enumValues).length;
    console.log(
      `[SchemaContext] Built dynamic schema for tenant ${tenantId}: ${result.rows.length} columns, ${enumCount} enum columns with sample values`
    );
    return context;
  } catch (error: any) {
    console.error(
      `[SchemaContext] Failed to introspect schema for tenant ${tenantId}:`,
      error.message
    );
    // Return fallback
    return buildFallbackSchemaContext();
  }
}

/**
 * Get raw column metadata for a tenant (for schema explorer / teaching).
 * Returns the cached columns if available, otherwise introspects.
 */
export async function getColumnsForTenant(
  tenantId: string
): Promise<{ name: string; type: string; nullable: boolean }[]> {
  // Ensure cache is populated
  await getSchemaForTenant(tenantId);

  const cached = schemaCache.get(tenantId);
  if (cached && cached.columns.length > 0) {
    return cached.columns.map((c) => ({
      name: c.column_name,
      type: pgTypeToFriendly(c.data_type),
      nullable: c.is_nullable === "YES",
    }));
  }

  // Return fallback field list
  return FALLBACK_LOAN_FIELDS.flatMap((cat) =>
    cat.fields.map((f) => ({
      name: f.name,
      type: f.type,
      nullable: false,
    }))
  );
}

/**
 * Invalidate the cached schema for a tenant (e.g. after a migration).
 */
export function invalidateSchemaCache(tenantId?: string): void {
  if (tenantId) {
    schemaCache.delete(tenantId);
  } else {
    schemaCache.clear();
  }
}

/**
 * Get the static fallback schema context (no DB access).
 * Used as a synchronous alternative when tenant ID is not available.
 */
export function getFallbackSchemaContext(): string {
  return buildFallbackSchemaContext();
}

/**
 * Tenant Schema Resolver
 *
 * Dynamically introspects tenant database column names and provides
 * safe SQL expression builders that adapt to the actual schema.
 * Prevents hardcoded column references from breaking across tenants
 * whose schemas may have different column names (e.g. cltv vs ltv_ratio).
 *
 * Usage:
 *   const loans = await createSchemaResolver(tenantPool, 'loans');
 *   loans.selectExpr('ltv', 'l')   // "l.cltv AS ltv"  (or NULL fallback)
 *   loans.whereExpr('ltv', 'l')    // "l.cltv"          (or NULL fallback)
 *   loans.castExpr('ltv', 'DECIMAL', 'l') // "CAST(l.cltv AS DECIMAL)"
 */

import pg from "pg";

// ============================================================================
// Column Aliases — logical name → resolution order (first match wins)
// ============================================================================

const COLUMN_ALIASES: Record<string, string[]> = {
  ltv: ["cltv", "ltv_ratio", "ltv"],
  dti: ["dti", "be_dti_ratio", "dti_ratio"],
  fico_score: ["fico_score", "fico"],
  loan_officer: ["loan_officer", "lo_name"],
  loan_officer_id: ["loan_officer_id", "lo_id"],
};

/**
 * Default SQL type for each logical column.
 * Used when a column doesn't exist and we need a typed NULL fallback.
 */
const COLUMN_TYPES: Record<string, string> = {
  ltv: "DECIMAL",
  dti: "DECIMAL",
  fico_score: "INTEGER",
  loan_officer: "TEXT",
  loan_officer_id: "TEXT",
};

// ============================================================================
// Cache — per-pool, per-table, with 1-hour TTL
// ============================================================================

interface CachedTableSchema {
  columns: Set<string>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// WeakMap keyed by pool reference — auto-cleans when pool is GC'd
const schemaCache = new WeakMap<
  pg.Pool,
  Map<string, CachedTableSchema>
>();

/**
 * Load (or return cached) column names for a table in the given tenant pool.
 */
async function loadColumns(
  pool: pg.Pool,
  table: string
): Promise<Set<string>> {
  // Check cache
  let poolCache = schemaCache.get(pool);
  if (poolCache) {
    const cached = poolCache.get(table);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.columns;
    }
  }

  // Introspect information_schema
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );

  const columns = new Set<string>(
    result.rows.map((r: any) => r.column_name as string)
  );

  // Store in cache
  if (!poolCache) {
    poolCache = new Map();
    schemaCache.set(pool, poolCache);
  }
  poolCache.set(table, { columns, fetchedAt: Date.now() });

  console.log(
    `[SchemaResolver] Introspected "${table}" table: ${columns.size} columns`
  );
  return columns;
}

// ============================================================================
// SchemaResolver class — sync API after construction
// ============================================================================

export class SchemaResolver {
  private columns: Set<string>;

  /** @internal — use createSchemaResolver() factory instead */
  constructor(columns: Set<string>) {
    this.columns = columns;
  }

  // --------------------------------------------------------------------------
  // Core resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a logical column name to the actual column name in this schema.
   * Checks aliases if the logical name itself is not found.
   * Returns `null` if the column (and all aliases) don't exist.
   */
  resolveColumn(logicalName: string): string | null {
    if (this.columns.has(logicalName)) {
      return logicalName;
    }
    const aliases = COLUMN_ALIASES[logicalName];
    if (aliases) {
      for (const alias of aliases) {
        if (this.columns.has(alias)) {
          return alias;
        }
      }
    }
    return null;
  }

  /**
   * Check whether a specific column exists (no alias resolution).
   */
  hasColumn(columnName: string): boolean {
    return this.columns.has(columnName);
  }

  // --------------------------------------------------------------------------
  // SQL expression builders
  // --------------------------------------------------------------------------

  /**
   * Generate a SELECT expression.
   *
   * If the column exists:   `l.cltv AS ltv`  (aliased when resolved name differs)
   * If it doesn't exist:    `NULL::DECIMAL AS ltv`
   *
   * @param logicalName  The logical/expected column name (e.g. "ltv")
   * @param tableAlias   Optional table alias prefix (e.g. "l")
   */
  selectExpr(logicalName: string, tableAlias?: string): string {
    const resolved = this.resolveColumn(logicalName);
    const prefix = tableAlias ? `${tableAlias}.` : "";

    if (resolved) {
      return resolved !== logicalName
        ? `${prefix}${resolved} AS ${logicalName}`
        : `${prefix}${resolved}`;
    }

    const sqlType = COLUMN_TYPES[logicalName] || "TEXT";
    return `NULL::${sqlType} AS ${logicalName}`;
  }

  /**
   * Generate a column reference for WHERE / CASE / JOIN clauses.
   *
   * If the column exists:   `l.cltv`
   * If it doesn't exist:    `NULL::DECIMAL`  (safe — evaluates to NULL in any comparison)
   *
   * @param logicalName  The logical/expected column name
   * @param tableAlias   Optional table alias prefix
   */
  whereExpr(logicalName: string, tableAlias?: string): string {
    const resolved = this.resolveColumn(logicalName);
    const prefix = tableAlias ? `${tableAlias}.` : "";

    if (resolved) {
      return `${prefix}${resolved}`;
    }

    const sqlType = COLUMN_TYPES[logicalName] || "TEXT";
    return `NULL::${sqlType}`;
  }

  /**
   * Generate a CAST expression for WHERE / CASE comparisons.
   *
   * If the column exists:   `CAST(l.cltv AS DECIMAL)`
   * If it doesn't exist:    `NULL::DECIMAL`
   *
   * @param logicalName  The logical/expected column name
   * @param castType     SQL type to cast to (e.g. "INTEGER", "DECIMAL")
   * @param tableAlias   Optional table alias prefix
   */
  castExpr(
    logicalName: string,
    castType: string,
    tableAlias?: string
  ): string {
    const resolved = this.resolveColumn(logicalName);
    const prefix = tableAlias ? `${tableAlias}.` : "";

    if (resolved) {
      return `CAST(${prefix}${resolved} AS ${castType})`;
    }

    return `NULL::${castType}`;
  }
}

// ============================================================================
// Factory — the recommended entry point
// ============================================================================

/**
 * Create a SchemaResolver for a specific table in a tenant database.
 * Performs a single `information_schema` query (cached for 1 hour),
 * then returns a resolver with all-sync methods.
 *
 * @example
 *   const loans = await createSchemaResolver(tenantPool, 'loans');
 *   const q = `SELECT ${loans.selectExpr('ltv', 'l')} FROM public.loans l`;
 */
export async function createSchemaResolver(
  pool: pg.Pool,
  table: string
): Promise<SchemaResolver> {
  const columns = await loadColumns(pool, table);
  return new SchemaResolver(columns);
}

/**
 * Invalidate cached schema for a pool (optionally for a specific table).
 * Call after migrations or schema changes.
 */
export function invalidateResolverCache(
  pool: pg.Pool,
  table?: string
): void {
  if (table) {
    const poolCache = schemaCache.get(pool);
    if (poolCache) {
      poolCache.delete(table);
    }
  } else {
    schemaCache.delete(pool);
  }
}

import { z } from "zod";

/**
 * Canonical active pipeline (matches ACTIVE_SQL in estimatedClosingsRiskService) + unfunded.
 * Pie ECD drill filters must use this so filtered counts match the chart.
 */
const ACTIVE_PIPELINE_UNFUNDED = `
  l.current_loan_status = 'Active Loan'
  AND l.application_date IS NOT NULL
  AND l.application_date::text != ''
  AND (l.is_archived IS DISTINCT FROM TRUE)
  AND l.funding_date IS NULL
`;

export const ECD_SLICE_KEYS = new Set(["empty_ecd", "past_ecd", "remaining_to_fund", "after_this_month"]);
export const COMPLEXITY_BUCKET_KEYS = new Set(["gte_130", "gte_120", "gte_110", "all_rest"]);

export const ESTIMATED_CLOSINGS_DETAIL_FILTER_COLUMN_IDS = new Set([
  "loanNumber",
  "complexityGroup",
  "complexity",
  "closingProjectionGroup",
  "units",
  "volume",
  "occupancyType",
  "fico",
  "ltv",
  "beDti",
  "borrowerSelfEmployed",
  "qmLoanType",
  "propertyType",
  "loanProgram",
  "appToDispositionDays",
  "currentLoanStatus",
  "currentStatusDate",
  "lastCompletedMilestone",
  "loanFolder",
  "applicationDate",
  "fundingDate",
  "lockDate",
  "investorLockDate",
  "estimatedClosingDate",
  "ctcDate",
  "uwFinalApprovalDate",
  "deniedDate",
  "conditionalApprovalDate",
  "branch",
  "loanOfficer",
  "processor",
  "underwriter",
]);

const columnFilterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), selectedValues: z.array(z.string()) }),
  z.object({
    kind: z.literal("number"),
    mode: z.enum(["all", "range", "min", "max"]),
    selectedValues: z.array(z.string()),
    min: z.string().optional(),
    max: z.string().optional(),
    value: z.string().optional(),
  }),
  z.object({
    kind: z.literal("date"),
    from: z.string().optional(),
    to: z.string().optional(),
    shortcut: z.string().optional(),
  }),
  z.object({
    kind: z.literal("boolean"),
    value: z.enum(["all", "yes", "no"]),
  }),
]);

export type EstimatedClosingsParsedColumnFilter = z.infer<typeof columnFilterSchema>;
export type EstimatedClosingsDetailFilterMap = Record<string, EstimatedClosingsParsedColumnFilter>;

const detailFiltersSchema = z.record(z.string(), columnFilterSchema);

type TextFilter = { kind: "text"; selectedValues: string[] };
type NumberFilter = {
  kind: "number";
  mode: "all" | "range" | "min" | "max";
  selectedValues: string[];
  min?: string;
  max?: string;
  value?: string;
};
type DateFilter = { kind: "date"; from?: string; to?: string; shortcut?: string };
type BooleanFilter = { kind: "boolean"; value: "all" | "yes" | "no" };

export function parseEstimatedClosingsDetailFiltersJson(
  raw: string | undefined,
): EstimatedClosingsDetailFilterMap | undefined {
  if (raw == null || String(raw).trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return undefined;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const out = detailFiltersSchema.safeParse(parsed);
  if (!out.success) return undefined;
  const cleaned: EstimatedClosingsDetailFilterMap = {};
  for (const [key, filter] of Object.entries(out.data)) {
    if (!ESTIMATED_CLOSINGS_DETAIL_FILTER_COLUMN_IDS.has(key)) continue;
    if (!isFilterActive(filter)) continue;
    cleaned[key] = filter;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function isFilterActive(filter: EstimatedClosingsParsedColumnFilter): boolean {
  if (filter.kind === "text") return filter.selectedValues.length > 0;
  if (filter.kind === "number") {
    if (filter.mode === "all") return filter.selectedValues.length > 0;
    if (filter.mode === "range") return Boolean(filter.min?.trim() || filter.max?.trim());
    return Boolean(filter.value?.trim());
  }
  if (filter.kind === "date") {
    return Boolean(filter.shortcut?.trim() || filter.from?.trim() || filter.to?.trim());
  }
  return filter.value !== "all";
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Calendar window for ECD pie slices — same values as `bounds` CTE but inline so this
 * fragment is valid inside subqueries that use `bounds b3` (or no bounds row alias `b`).
 */
const ECD_BOUNDS_TODAY = `CURRENT_DATE::date`;
const ECD_BOUNDS_MONTH_START = `date_trunc('month', CURRENT_DATE)::date`;
const ECD_BOUNDS_MONTH_END = `(date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date`;

/** Pie slice: active + unfunded loans in that ECD bucket. */
export function buildEcdSliceSql(sliceKey: string): string {
  if (!ECD_SLICE_KEYS.has(sliceKey)) return "";
  if (sliceKey === "empty_ecd") {
    return `(
      ${ACTIVE_PIPELINE_UNFUNDED}
      AND l.estimated_closing_date IS NULL
    )`;
  }
  if (sliceKey === "past_ecd") {
    return `(
      ${ACTIVE_PIPELINE_UNFUNDED}
      AND l.estimated_closing_date IS NOT NULL
      AND l.estimated_closing_date::date < ${ECD_BOUNDS_TODAY}
      AND NOT (
        l.estimated_closing_date::date BETWEEN ${ECD_BOUNDS_MONTH_START} AND ${ECD_BOUNDS_MONTH_END}
      )
    )`;
  }
  if (sliceKey === "remaining_to_fund") {
    return `(
      ${ACTIVE_PIPELINE_UNFUNDED}
      AND l.estimated_closing_date IS NOT NULL
      AND l.estimated_closing_date::date <= ${ECD_BOUNDS_MONTH_END}
    )`;
  }
  return `(
    ${ACTIVE_PIPELINE_UNFUNDED}
    AND l.estimated_closing_date IS NOT NULL
    AND l.estimated_closing_date::date > ${ECD_BOUNDS_MONTH_END}
  )`;
}

export function buildComplexityBucketSql(bucketKey: string, bucketExprSql: string): string {
  if (!COMPLEXITY_BUCKET_KEYS.has(bucketKey)) return "";
  const lit = escapeSqlString(bucketKey);
  return `${bucketExprSql} = '${lit}'`;
}

export function buildExactExprMatchSql(exprSql: string, rawValue: string, maxLen = 400): string {
  const t = rawValue.trim();
  if (!t || t.length > maxLen) return "";
  return `${exprSql} = '${escapeSqlString(t)}'`;
}

function parseFiniteNumber(s: string): number | null {
  const cleaned = s.replace(/[$,%\s,]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function sqlLowerTrimExpr(expr: string): string {
  return `LOWER(TRIM(COALESCE(${expr}::text, '')))`;
}

const EMPTY_FILTER_TOKEN = "__EMPTY__";

function buildTextFilterSql(exprSql: string, filter: TextFilter): string {
  const parts: string[] = [];
  for (const v of filter.selectedValues) {
    if (v === EMPTY_FILTER_TOKEN) {
      parts.push(`(${exprSql} IS NULL OR TRIM(COALESCE(${exprSql}::text, '')) = '' OR TRIM(COALESCE(${exprSql}::text, '')) = '-')`);
    } else {
      const lit = escapeSqlString(v.trim().toLowerCase());
      parts.push(`${sqlLowerTrimExpr(exprSql)} = '${lit}'`);
    }
  }
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

function buildNumberFilterSql(exprSql: string, filter: NumberFilter): string {
  if (filter.mode === "all") {
    const parts: string[] = [];
    for (const v of filter.selectedValues) {
      if (v === EMPTY_FILTER_TOKEN) {
        parts.push(`(${exprSql} IS NULL)`);
        continue;
      }
      const n = parseFiniteNumber(v);
      if (n != null) parts.push(`(${exprSql})::numeric = ${n}`);
    }
    if (parts.length === 0) return "";
    return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
  }
  if (filter.mode === "range") {
    const lo = filter.min?.trim() ? parseFiniteNumber(filter.min) : null;
    const hi = filter.max?.trim() ? parseFiniteNumber(filter.max) : null;
    if (lo == null && hi == null) return "";
    const inner: string[] = [];
    if (lo != null) inner.push(`(${exprSql})::numeric >= ${lo}`);
    if (hi != null) inner.push(`(${exprSql})::numeric <= ${hi}`);
    return inner.join(" AND ");
  }
  const t = parseFiniteNumber(filter.value ?? "");
  if (t == null) return "";
  if (filter.mode === "min") return `(${exprSql})::numeric >= ${t}`;
  return `(${exprSql})::numeric <= ${t}`;
}

function resolveShortcutRangeIso(shortcut: string): { start: string; end: string } | null {
  const token = shortcut.trim().toLowerCase();
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (token === "last 30 days" || token === "last-30-days") {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    return { start: iso(start), end: iso(end) };
  }
  if (token === "mtd") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return { start: iso(start), end: iso(end) };
  }
  if (token === "ytd") {
    const start = new Date(today.getFullYear(), 0, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return { start: iso(start), end: iso(end) };
  }
  if (token === "last-month") {
    const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(firstThis.getTime() - 86400000);
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    return { start: iso(start), end: iso(end) };
  }
  return null;
}

function buildDateFilterSql(dateExprSql: string, filter: DateFilter): string {
  let from = filter.from?.trim() || "";
  let to = filter.to?.trim() || "";
  if (filter.shortcut?.trim()) {
    const r = resolveShortcutRangeIso(filter.shortcut);
    if (r) {
      from = r.start;
      to = r.end;
    }
  }
  if (!from && !to) return "";
  const parts: string[] = [];
  if (from) parts.push(`${dateExprSql} >= '${escapeSqlString(from)}'::date`);
  if (to) parts.push(`${dateExprSql} <= '${escapeSqlString(to)}'::date`);
  return parts.join(" AND ");
}

function buildBooleanFilterSql(exprSql: string, filter: BooleanFilter): string {
  if (filter.value === "all") return "";
  const yesExpr = `(
    ${exprSql} IS TRUE
    OR LOWER(TRIM(COALESCE(${exprSql}::text, ''))) IN ('true', 't', '1', 'yes', 'y')
  )`;
  if (filter.value === "yes") return yesExpr;
  return `(NOT (${yesExpr}) OR ${exprSql} IS NULL)`;
}

/** Matches page-slice `remaining_complexity_group` SQL: exact CASE label equality (no LOWER/TRIM). */
function buildComplexityGroupDetailTextFilterSql(complexityGroupExpr: string, filter: TextFilter): string {
  const parts: string[] = [];
  for (const v of filter.selectedValues) {
    if (v === EMPTY_FILTER_TOKEN) {
      parts.push(
        `(${complexityGroupExpr} IS NULL OR TRIM(COALESCE(${complexityGroupExpr}::text, '')) = '' OR TRIM(COALESCE(${complexityGroupExpr}::text, '')) = '-')`,
      );
    } else {
      const frag = buildExactExprMatchSql(complexityGroupExpr, v);
      if (frag) parts.push(`(${frag})`);
    }
  }
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

export function buildDetailColumnFiltersSql(
  filters: EstimatedClosingsDetailFilterMap | undefined,
  ctx: {
    complexityGroupExpr: string;
    closingProjectionExpr: string;
    appToDispositionDaysExpr: string;
  },
): string {
  if (!filters) return "";
  const pieces: string[] = [];
  for (const [columnId, filter] of Object.entries(filters)) {
    if (!filter || !isFilterActive(filter)) continue;
    let exprSql: string;
    let dateExpr: string | null = null;
    switch (columnId) {
      case "loanNumber":
        exprSql = "l.loan_number";
        break;
      case "complexityGroup":
        exprSql = ctx.complexityGroupExpr;
        break;
      case "complexity":
        exprSql = "l.complexity_score";
        break;
      case "closingProjectionGroup":
        exprSql = ctx.closingProjectionExpr;
        break;
      case "units":
        exprSql = "1";
        break;
      case "volume":
        exprSql = "l.loan_amount";
        break;
      case "occupancyType":
        exprSql = "l.occupancy_type";
        break;
      case "fico":
        exprSql = "l.fico_score";
        break;
      case "ltv":
        exprSql = "l.ltv_ratio";
        break;
      case "beDti":
        exprSql = "l.be_dti_ratio";
        break;
      case "borrowerSelfEmployed":
        exprSql = "l.borr_self_employed";
        break;
      case "qmLoanType":
        exprSql = "l.qm_loan_type";
        break;
      case "propertyType":
        exprSql = "l.property_type";
        break;
      case "loanProgram":
        exprSql = "l.loan_program";
        break;
      case "appToDispositionDays":
        exprSql = ctx.appToDispositionDaysExpr;
        break;
      case "currentLoanStatus":
        exprSql = "l.current_loan_status";
        break;
      case "currentStatusDate":
        dateExpr = "l.current_status_date::date";
        exprSql = "l.current_status_date";
        break;
      case "lastCompletedMilestone":
        exprSql = "l.current_milestone";
        break;
      case "loanFolder":
        exprSql = "l.loan_folder";
        break;
      case "applicationDate":
        dateExpr = "l.application_date::date";
        exprSql = "l.application_date";
        break;
      case "fundingDate":
        dateExpr = "l.funding_date::date";
        exprSql = "l.funding_date";
        break;
      case "lockDate":
        dateExpr = "l.lock_date::date";
        exprSql = "l.lock_date";
        break;
      case "investorLockDate":
        dateExpr = "l.investor_lock_date::date";
        exprSql = "l.investor_lock_date";
        break;
      case "estimatedClosingDate":
        dateExpr = "l.estimated_closing_date::date";
        exprSql = "l.estimated_closing_date";
        break;
      case "ctcDate":
        dateExpr = "l.ctc_date::date";
        exprSql = "l.ctc_date";
        break;
      case "uwFinalApprovalDate":
        dateExpr = "l.uw_final_approval_date::date";
        exprSql = "l.uw_final_approval_date";
        break;
      case "deniedDate":
        dateExpr = "COALESCE(l.uw_denied_date, l.denial_date)::date";
        exprSql = "COALESCE(l.uw_denied_date, l.denial_date)";
        break;
      case "conditionalApprovalDate":
        dateExpr = "l.conditional_approval_date::date";
        exprSql = "l.conditional_approval_date";
        break;
      case "branch":
        exprSql = "l.branch";
        break;
      case "loanOfficer":
        exprSql = "l.loan_officer";
        break;
      case "processor":
        exprSql = "l.processor";
        break;
      case "underwriter":
        exprSql = "l.underwriter";
        break;
      default:
        continue;
    }

    let sqlPiece = "";
    if (columnId === "complexityGroup" && filter.kind === "text") {
      sqlPiece = buildComplexityGroupDetailTextFilterSql(ctx.complexityGroupExpr, filter as TextFilter);
    } else if (filter.kind === "text") sqlPiece = buildTextFilterSql(exprSql, filter as TextFilter);
    else if (filter.kind === "number") sqlPiece = buildNumberFilterSql(exprSql, filter as NumberFilter);
    else if (filter.kind === "boolean") sqlPiece = buildBooleanFilterSql(exprSql, filter as BooleanFilter);
    else if (filter.kind === "date") sqlPiece = buildDateFilterSql(dateExpr ?? `${exprSql}::date`, filter as DateFilter);

    if (sqlPiece) pieces.push(`(${sqlPiece})`);
  }
  if (pieces.length === 0) return "";
  return pieces.join(" AND ");
}

export function buildEstimatedClosingsPageFilterSql(parts: string[]): string {
  const inner = parts.map((p) => p.trim()).filter(Boolean);
  if (inner.length === 0) return "";
  return inner.length === 1 ? inner[0] : `(${inner.join(" AND ")})`;
}

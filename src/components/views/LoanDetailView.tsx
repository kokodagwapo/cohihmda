/**
 * Loan Detail view – table of all loans with requested columns.
 * Only DB-backed columns are populated; calculated columns left blank.
 * Uses @tanstack/react-virtual for row virtualization (smooth scroll with large lists).
 */

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useLoanDetailData,
  type LoanDetailRow,
  type LoanDetailListResponse,
} from "@/hooks/useLoanDetailData";
import { useAdditionalFieldColumns } from "@/hooks/useAdditionalFieldColumns";
import { useTenantStore } from "@/stores/tenantStore";
import { useTheme } from "@/components/theme-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, ArrowUp, ArrowDown } from "lucide-react";

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 40;
const TOTALS_ROW_HEIGHT = 40;
const OVERSCAN = 10;
const MIN_COL_WIDTH = 80;
/** Approx px per character when sizing columns to content */
const CHARS_TO_PX = 8;
/** Max width per column so one outlier doesn't make table huge; content still fits up to this */
const MAX_COL_WIDTH = 800;

export interface LoanDetailViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
  /** When provided (e.g. workbench widget), use these instead of fetching; no Export to Excel. */
  data?: LoanDetailListResponse | null;
  loading?: boolean;
  error?: string | null;
  /** When true (e.g. workbench widget), fill container height and use flex layout so table scroll area is visible. */
  fillHeight?: boolean;
  /** When set (workbench only), subtitle shows "Loans from {periodLabel}." instead of default. */
  periodLabel?: string | null;
  /** When set (workbench only), comma-separated filter labels for subtitle: "filtered by _____, _____". */
  filterSummary?: string | null;
  /** When set (workbench only), use these columns instead of default. Enables per-widget column editor. */
  columns?: ColumnDef[] | null;
}

export type ColumnDef = {
  id: string;
  label: string;
  /** DB field key (e.g. loan_amount, fico_score) or null for calculated/blank */
  field: string | null;
  /** Optional min width (px) for columns with long content (e.g. names, addresses) */
  minWidth?: number;
};

/** Default column set for Loan Detail table. Workbench can override via columns prop. */
export const DEFAULT_LOAN_DETAIL_COLUMNS: ColumnDef[] = [
  { id: "loan_number", label: "Loan number", field: "loan_number" },
  { id: "units", label: "Units", field: null },
  { id: "volume", label: "Volume", field: "loan_amount" },
  { id: "wac", label: "WAC", field: null },
  { id: "fico", label: "FICO", field: "fico_score" },
  { id: "ltv", label: "LTV", field: "ltv_ratio" },
  { id: "be_dti", label: "BE DTI", field: "be_dti_ratio" },
  { id: "channel", label: "Channel", field: "channel" },
  { id: "branch", label: "Branch", field: "branch" },
  { id: "loan_officer", label: "Loan Officer", field: "loan_officer", minWidth: 200 },
  { id: "processor", label: "Processor", field: "processor", minWidth: 200 },
  { id: "underwriter", label: "Underwriter", field: "underwriter", minWidth: 200 },
  { id: "closer", label: "Closer", field: "closer", minWidth: 200 },
  { id: "investor", label: "Investor", field: "investor", minWidth: 180 },
  { id: "property_street", label: "Property Street", field: "property_street", minWidth: 220 },
  { id: "property_city", label: "Property City", field: "property_city" },
  { id: "property_state", label: "Property State", field: "property_state" },
  { id: "property_county", label: "Property County", field: "property_county" },
  { id: "property_zip", label: "Property Zip", field: "property_zip" },
  { id: "loan_term", label: "Loan Term", field: "loan_term" },
  { id: "current_loan_status", label: "Current Loan Status", field: "current_loan_status", minWidth: 180 },
  { id: "current_milestone", label: "Current Milestone", field: "current_milestone", minWidth: 180 },
  { id: "loan_folder", label: "Loan Folder", field: "loan_folder" },
  { id: "loan_type", label: "Loan Type", field: "loan_type" },
  { id: "loan_program", label: "Loan Program", field: "loan_program" },
  { id: "loan_purpose", label: "Loan Purpose", field: "loan_purpose" },
  { id: "occupancy_type", label: "Occupancy Type", field: "occupancy_type" },
  { id: "property_type", label: "Property Type", field: "property_type" },
  { id: "lien_position", label: "Lien Position", field: "lien_position" },
  { id: "started_date", label: "Started Date", field: "started_date" },
  { id: "credit_pull_date", label: "Credit Pull Date", field: "credit_pull_date" },
  { id: "application_date", label: "Application Date", field: "application_date" },
  { id: "loan_estimate_sent", label: "Loan Estimate Sent", field: "loan_estimate_sent_date" },
  { id: "loan_estimate_received", label: "Loan Estimate Received", field: "loan_estimate_received_date" },
  { id: "uw_final_approval_date", label: "UW Final Approval Date", field: "uw_final_approval_date" },
  { id: "uw_suspended_date", label: "UW Suspended Date", field: "uw_suspended_date" },
  { id: "uw_denied_date", label: "UW Denied Date", field: "uw_denied_date" },
  { id: "investor_lock_date", label: "Investor Lock Date", field: "investor_lock_date" },
  { id: "locked_flag", label: "Locked Flag", field: null },
  { id: "lock_expiration_date", label: "Lock Expiration Date", field: "lock_expiration_date" },
  { id: "locked_days", label: "Locked Days", field: "lock_days" },
  { id: "estimated_closing_date", label: "Estimated Closing Date", field: "estimated_closing_date" },
  { id: "ctc_date", label: "CTC Date", field: "ctc_date" },
  { id: "closing_disclosure_sent", label: "Closing Disclosure Sent", field: "closing_disclosure_sent_date" },
  { id: "closing_disclosure_received", label: "Closing Disclosure Received", field: "closing_disclosure_received_date" },
  { id: "closing_date", label: "Closing Date", field: "closing_date" },
  { id: "funding_date", label: "Funding Date", field: "funding_date" },
  { id: "investor_purchase_date", label: "Investor Purchase Date", field: "investor_purchase_date" },
];

const COLUMNS = DEFAULT_LOAN_DETAIL_COLUMNS;

/** Build effective column list: base columns (default or custom) + additional fields from additional_field_definitions, appended after. */
function buildEffectiveColumns(
  baseColumns: ColumnDef[],
  additionalColumns: ColumnDef[],
): ColumnDef[] {
  const baseIds = new Set(baseColumns.map((c) => c.field).filter(Boolean));
  const extra = additionalColumns.filter((c) => c.field && !baseIds.has(c.field));
  return baseColumns.concat(extra);
}

/** Column headers that are not populated from the database (calculated or not in schema) */
export const UNPOPULATED_LOAN_DETAIL_COLUMNS = COLUMNS.filter((c) => c.field === null).map(
  (c) => c.label,
);

const BLANK_PLACEHOLDER = "-";

/** Format volume (loan amount) with commas and 2 decimals (e.g. 3,093,200.00). Used only for volume column. */
function formatVolumeWithCommas(value: number | string | null): string {
  if (value === null || value === undefined) return BLANK_PLACEHOLDER;
  const num = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
  if (Number.isNaN(num)) return BLANK_PLACEHOLDER;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return BLANK_PLACEHOLDER;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return BLANK_PLACEHOLDER;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return value;
  }
  return String(value);
}

/** True when cell should be shown bold+red: LTV > 110 or DTI > 70. */
function shouldHighlightCellAsAlert(col: ColumnDef, row: LoanDetailRow): boolean {
  if (col.field === "ltv_ratio") {
    const v = (row as unknown as Record<string, unknown>).ltv_ratio;
    const n = v != null ? Number(v) : NaN;
    return !Number.isNaN(n) && n > 110;
  }
  if (col.field === "be_dti_ratio") {
    const v = (row as unknown as Record<string, unknown>).be_dti_ratio;
    const n = v != null ? Number(v) : NaN;
    return !Number.isNaN(n) && n > 70;
  }
  return false;
}

/** True when cell should be shown red only (no bold): FICO < 580 and not 0. */
function shouldHighlightFicoLow(col: ColumnDef, row: LoanDetailRow): boolean {
  if (col.field === "fico_score") {
    const v = (row as unknown as Record<string, unknown>).fico_score;
    const n = v != null ? Number(v) : NaN;
    return !Number.isNaN(n) && n > 0 && n < 580;
  }
  return false;
}

/** True when cell should be shown red only (no bold): LTV > 97 and ≤ 110. (LTV > 110 uses alert style.) */
function shouldHighlightLtvWarning(col: ColumnDef, row: LoanDetailRow): boolean {
  if (col.field === "ltv_ratio") {
    const v = (row as unknown as Record<string, unknown>).ltv_ratio;
    const n = v != null ? Number(v) : NaN;
    return !Number.isNaN(n) && n > 97 && n <= 110;
  }
  return false;
}

/** True when cell should be shown red only (no bold): DTI >= 50 and ≤ 70. (DTI > 70 uses alert style.) */
function shouldHighlightDtiWarning(col: ColumnDef, row: LoanDetailRow): boolean {
  if (col.field === "be_dti_ratio") {
    const v = (row as unknown as Record<string, unknown>).be_dti_ratio;
    const n = v != null ? Number(v) : NaN;
    return !Number.isNaN(n) && n >= 50 && n <= 70;
  }
  return false;
}

/** Locked Flag = Yes when lock date exists and lock expiration date is after today; No when before today. */
function isLockedFlagYes(row: LoanDetailRow): boolean {
  const lockDate = row.investor_lock_date;
  if (lockDate == null || String(lockDate).trim() === "") return false;
  const exp = row.lock_expiration_date;
  if (exp == null || String(exp).trim() === "") return false;
  const expDate = new Date(String(exp).trim().slice(0, 10));
  if (Number.isNaN(expDate.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expDate.setHours(0, 0, 0, 0);
  return expDate > today;
}

/** WAC = Sum(Loan Amount * Interest Rate) / Sum(Loan Amount), formatted as #,##0.000 (Qlik formula). Same value for every row. */
function computeWacFormatted(loans: LoanDetailRow[]): string {
  if (loans.length === 0) return "";
  let sumProduct = 0;
  let sumAmount = 0;
  for (let i = 0; i < loans.length; i++) {
    const amt = Number(loans[i].loan_amount) || 0;
    const rate = Number(loans[i].interest_rate) || 0;
    sumProduct += amt * rate;
    sumAmount += amt;
  }
  if (sumAmount === 0) return "";
  const wac = sumProduct / sumAmount;
  return wac.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

/** Display value for a cell: handles Units (1), WAC (interest rate per row / aggregate in total), Locked Flag (Yes/No), Volume (comma-separated), and Fees Loan Discount Fee % */
function formatInterestRate(val: number | null | undefined): string {
  if (val == null || Number.isNaN(Number(val))) return BLANK_PLACEHOLDER;
  return Number(val).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function getCellDisplay(
  col: ColumnDef,
  row: LoanDetailRow,
  wacFormatted: string,
): string {
  if (col.id === "units") return "1";
  if (col.id === "wac") return formatInterestRate(row.interest_rate ?? null);
  if (col.field === "loan_amount") return formatVolumeWithCommas(row.loan_amount);
  if (col.id === "locked_flag") return isLockedFlagYes(row) ? "Yes" : "No";
  if (col.id === "fees_loan_discount_fee_pct" && col.field) {
    const raw = (row as unknown as Record<string, unknown>)[col.field];
    if (raw != null && typeof raw === "number")
      return `${Number(raw).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    return raw != null && String(raw).trim() !== "" ? String(raw) : BLANK_PLACEHOLDER;
  }
  if (col.field) {
    const val = (row as unknown as Record<string, unknown>)[col.field];
    return formatCellValue(val);
  }
  return BLANK_PLACEHOLDER;
}

/** Value used for sorting: number, string, or null (blank). Enables correct numeric/date/string order. */
function getSortValue(
  col: ColumnDef,
  row: LoanDetailRow,
  wacFormatted: string,
): number | string | null {
  if (col.id === "units") return 1;
  if (col.id === "wac") {
    const r = row.interest_rate;
    return r != null && !Number.isNaN(Number(r)) ? Number(r) : null;
  }
  if (col.id === "locked_flag") return isLockedFlagYes(row) ? "Yes" : "No";
  if (col.id === "fees_loan_discount_fee_pct" && col.field) {
    const raw = (row as unknown as Record<string, unknown>)[col.field];
    return raw != null && typeof raw === "number" ? raw : null;
  }
  if (!col.field) return null;
  const raw = (row as unknown as Record<string, unknown>)[col.field];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

function sortLoans(
  loans: LoanDetailRow[],
  columnId: string,
  direction: "asc" | "desc",
  wacFormatted: string,
  columns: ColumnDef[],
): LoanDetailRow[] {
  const col = columns.find((c) => c.id === columnId);
  if (!col) return [...loans];
  const mult = direction === "asc" ? 1 : -1;
  return [...loans].sort((a, b) => {
    const va = getSortValue(col, a, wacFormatted);
    const vb = getSortValue(col, b, wacFormatted);
    const aNull = va === null;
    const bNull = vb === null;
    if (aNull && bNull) return 0;
    if (aNull) return mult * 1;
    if (bNull) return mult * -1;
    if (typeof va === "number" && typeof vb === "number") return mult * (va - vb);
    const sa = String(va);
    const sb = String(vb);
    return mult * sa.localeCompare(sb, undefined, { numeric: true });
  });
}

/** Column ids that get no total (leave blank) */
const TOTALS_BLANK_COLUMN_IDS = new Set([
  "loan_term",
  "locked_days",
  "fees_va_fund_fee_borr",
  "fees_loan_discount_fee_borr",
  "borr_info_points_paid",
  "income_total_mo_income",
]);

function getColumnTotal(
  col: ColumnDef,
  loans: LoanDetailRow[],
  wacFormatted: string,
): string {
  if (loans.length === 0) return col.id === "loan_number" ? "Totals" : BLANK_PLACEHOLDER;
  if (col.id === "loan_number") return "Totals";
  if (col.id === "units") return String(loans.length);
  if (col.id === "wac") return wacFormatted || BLANK_PLACEHOLDER;
  if (TOTALS_BLANK_COLUMN_IDS.has(col.id)) return BLANK_PLACEHOLDER;

  // Volume: sum of loan_amount (ensure numeric) – match by field for custom "volume" label
  if (col.field === "loan_amount") {
    let sum = 0;
    for (let i = 0; i < loans.length; i++) {
      const v = loans[i].loan_amount;
      const n = v != null ? Number(v) : NaN;
      if (!Number.isNaN(n)) sum += n;
    }
    return sum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Averages: FICO, LTV, BE DTI (by field for custom columns)
  if (col.field === "fico_score") {
    let sum = 0; let n = 0;
    for (let i = 0; i < loans.length; i++) {
      const v = (loans[i] as unknown as Record<string, unknown>).fico_score;
      const num = v != null ? Number(v) : NaN;
      if (!Number.isNaN(num)) { sum += num; n++; }
    }
    return n === 0 ? BLANK_PLACEHOLDER : (sum / n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (col.field === "ltv_ratio") {
    let sum = 0; let n = 0;
    for (let i = 0; i < loans.length; i++) {
      const v = (loans[i] as unknown as Record<string, unknown>).ltv_ratio;
      const num = v != null ? Number(v) : NaN;
      if (!Number.isNaN(num)) { sum += num; n++; }
    }
    return n === 0 ? BLANK_PLACEHOLDER : (sum / n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (col.field === "be_dti_ratio") {
    let sum = 0; let n = 0;
    for (let i = 0; i < loans.length; i++) {
      const v = (loans[i] as unknown as Record<string, unknown>).be_dti_ratio;
      const num = v != null ? Number(v) : NaN;
      if (!Number.isNaN(num)) { sum += num; n++; }
    }
    return n === 0 ? BLANK_PLACEHOLDER : (sum / n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return BLANK_PLACEHOLDER;
}

/** Compute column width from header + all cell values so nothing is cut off */
function getColumnWidthFromContent(
  col: ColumnDef,
  loans: LoanDetailRow[],
  wacFormatted: string,
): number {
  const headerWidth = col.label.length * CHARS_TO_PX;
  let dataMaxLen = 0;
  if (col.id === "loan_number") dataMaxLen = Math.max(6, dataMaxLen); // "Totals"
  if (col.id === "units") dataMaxLen = Math.max(dataMaxLen, 1);
  else if (col.id === "wac" && loans.length > 0) {
    for (let i = 0; i < loans.length; i++) {
      const s = formatInterestRate(loans[i].interest_rate ?? null);
      dataMaxLen = Math.max(dataMaxLen, String(s).length);
    }
    dataMaxLen = Math.max(dataMaxLen, wacFormatted.length); // totals row
  } else if (col.id === "locked_flag") dataMaxLen = Math.max(dataMaxLen, 3); // "Yes"
  if (col.field && loans.length > 0) {
    for (let i = 0; i < loans.length; i++) {
      const s = getCellDisplay(col, loans[i], wacFormatted);
      dataMaxLen = Math.max(dataMaxLen, String(s).length);
    }
  }
  // Include totals row so column expands to fit "Totals", volume sum, averages, etc.
  const totalStr = getColumnTotal(col, loans, wacFormatted);
  dataMaxLen = Math.max(dataMaxLen, totalStr.length);
  const contentWidth = Math.max(headerWidth, dataMaxLen * CHARS_TO_PX);
  const minW = Math.max(MIN_COL_WIDTH, col.minWidth ?? 0);
  return Math.max(minW, Math.min(contentWidth, MAX_COL_WIDTH));
}

export function LoanDetailView({
  selectedTenantId: selectedTenantIdProp,
  data: dataProp,
  loading: loadingProp,
  error: errorProp,
  fillHeight = false,
  periodLabel,
  filterSummary,
  columns: columnsProp,
}: LoanDetailViewProps) {
  const { theme } = useTheme();
  const { selectedTenantId: storeTenantId } = useTenantStore();
  const tenantId = selectedTenantIdProp ?? storeTenantId;
  const { columns: additionalColumns } = useAdditionalFieldColumns(tenantId);
  const isDarkMode = theme === "dark";
  const fetched = useLoanDetailData(selectedTenantIdProp ?? storeTenantId);
  const isControlled = dataProp !== undefined;
  const data = isControlled ? dataProp ?? null : fetched.data;
  const loading = isControlled ? (loadingProp ?? false) : fetched.loading;
  const error = isControlled ? (errorProp ?? null) : fetched.error;
  const baseColumns = columnsProp && columnsProp.length > 0 ? columnsProp : COLUMNS;
  const columnsToUse = useMemo(
    () => buildEffectiveColumns(baseColumns, additionalColumns),
    [baseColumns, additionalColumns],
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [, setScrollReady] = useState(0);

  // Standalone page: useLoanDetailData auto-fetches when tenantId changes

  // Callback ref: when the scroll container mounts, trigger re-render so virtualizer can measure it
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el;
    if (el) setScrollReady((n) => n + 1);
  }, []);

  const loans = data?.loans ?? [];
  const total = data?.total ?? 0;

  const [sortColumnId, setSortColumnId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // WAC = sum of (Loan Amount * Interest Rate), formatted as #,##0.000
  const wacFormatted = useMemo(() => computeWacFormatted(loans), [loans]);

  const sortedLoans = useMemo(
    () =>
      sortColumnId
        ? sortLoans(loans, sortColumnId, sortDirection, wacFormatted, columnsToUse)
        : loans,
    [loans, sortColumnId, sortDirection, wacFormatted, columnsToUse],
  );

  const handleSort = useCallback((columnId: string) => {
    setSortColumnId((prev) => {
      if (prev === columnId) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return columnId;
      }
      setSortDirection("asc");
      return columnId;
    });
  }, []);

  // Size each column to fit header + all cell content (no truncation)
  const { gridColsStyle, totalTableWidth } = useMemo(() => {
    const widths = columnsToUse.map((c) => getColumnWidthFromContent(c, loans, wacFormatted));
    return {
      gridColsStyle: {
        gridTemplateColumns: widths.map((w) => `${w}px`).join(" "),
      },
      totalTableWidth: widths.reduce((a, b) => a + b, 0),
    };
  }, [loans, wacFormatted, columnsToUse]);
  // Match sales scorecard details table: gray header row, horizontal row lines only (no vertical column lines)
  const borderTh = isDarkMode ? "border-slate-700" : "border-slate-200";
  const bgTh = isDarkMode ? "bg-slate-800/50 text-slate-300" : "bg-slate-50 text-slate-600";
  const borderRow = isDarkMode ? "border-slate-700" : "border-slate-100";
  const textTd = isDarkMode ? "text-slate-200" : "text-slate-900";

  // Virtualize only data rows; header is rendered separately and made sticky
  const rowCount = sortedLoans.length;
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const bodyHeight = rowVirtualizer.getTotalSize();
  const totalScrollHeight = HEADER_HEIGHT + TOTALS_ROW_HEIGHT + bodyHeight;

  const totalsByColumn = useMemo(
    () => columnsToUse.map((c) => getColumnTotal(c, loans, wacFormatted)),
    [loans, wacFormatted, columnsToUse],
  );

  const exportToExcel = useCallback(() => {
    const escapeCsv = (v: string) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows: string[][] = [];
    rows.push(columnsToUse.map((c) => escapeCsv(c.label)));
    if (sortedLoans.length > 0) {
      rows.push(columnsToUse.map((c) => escapeCsv(getColumnTotal(c, loans, wacFormatted))));
      for (let i = 0; i < sortedLoans.length; i++) {
        rows.push(
          columnsToUse.map((c) => escapeCsv(getCellDisplay(c, sortedLoans[i], wacFormatted))),
        );
      }
    }
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `loan-detail-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [loans, sortedLoans, wacFormatted, columnsToUse]);

  return (
    <div className={fillHeight ? "flex flex-1 flex-col min-h-0 min-w-0 h-full" : "space-y-4"}>
      <Card className={`rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800/50 shadow-sm overflow-hidden ${fillHeight ? "flex-1 flex flex-col min-h-0" : ""}`}>
        <div className={`flex items-center gap-4 flex-wrap p-4 border-b border-slate-200/60 dark:border-slate-700/60 ${fillHeight ? "shrink-0 mb-0" : "mb-4"}`}>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Loan Detail
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {(() => {
                const base = periodLabel ? `Loans from ${periodLabel}` : 'All loans';
                const withFilters = filterSummary ? `${base}, filtered by ${filterSummary}` : base;
                return `${withFilters}. Click on a column header to sort by that column.`;
              })()}
            </p>
          </div>
          {!isControlled && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportToExcel}
              disabled={loans.length === 0}
              className="ml-auto gap-2 border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              Export to Excel
            </Button>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {loading && loans.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
          </div>
        ) : loans.length === 0 ? (
          <div
            className={`flex items-center justify-center py-12 text-sm ${textTd}`}
            style={{ minHeight: 200 }}
          >
            No loans found.
          </div>
        ) : (
          <div
            ref={setScrollRef}
            className={fillHeight ? "flex-1 min-h-0 overflow-auto" : "overflow-auto h-[70vh] min-h-[400px]"}
            style={fillHeight ? undefined : { contain: "strict" }}
          >
            <div
              style={{
                height: `${totalScrollHeight}px`,
                width: totalTableWidth,
                minWidth: "100%",
              }}
            >
              {/* Sticky header – stays at top when scrolling; click to sort */}
              <div
                className={`sticky top-0 z-10 border-b ${borderTh} ${bgTh} grid items-center shrink-0`}
                style={{
                  ...gridColsStyle,
                  width: totalTableWidth,
                  minWidth: "100%",
                  height: HEADER_HEIGHT,
                }}
                role="row"
              >
                {columnsToUse.map((col) => {
                  const isSorted = sortColumnId === col.id;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => handleSort(col.id)}
                      className={`whitespace-nowrap py-2.5 px-4 text-xs font-semibold text-left flex items-center gap-1 w-full min-w-0 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}
                      role="columnheader"
                      aria-sort={isSorted ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                    >
                      <span className="truncate">{col.label}</span>
                      {isSorted &&
                        (sortDirection === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        ))}
                    </button>
                  );
                })}
              </div>
              {/* Sticky totals row */}
              <div
                className={`sticky z-10 border-b ${borderRow} grid items-center font-medium ${isDarkMode ? "bg-slate-800/70 text-slate-200" : "bg-slate-100/90 text-slate-800"}`}
                style={{
                  top: HEADER_HEIGHT,
                  ...gridColsStyle,
                  width: totalTableWidth,
                  minWidth: "100%",
                  height: TOTALS_ROW_HEIGHT,
                }}
                role="row"
                aria-label="Totals"
              >
                {columnsToUse.map((col, idx) => (
                  <div
                    key={col.id}
                    className={`whitespace-nowrap py-2 px-4 text-sm ${textTd}`}
                    role="cell"
                  >
                    {idx === 0 ? "Totals" : totalsByColumn[idx]}
                  </div>
                ))}
              </div>
              {/* Virtualized body */}
              <div
                style={{
                  height: `${bodyHeight}px`,
                  width: totalTableWidth,
                  minWidth: "100%",
                  position: "relative",
                }}
              >
                {virtualItems.map((virtualRow) => {
                  const row = sortedLoans[virtualRow.index];
                  if (!row) return null;
                  return (
                    <div
                      key={row.loan_id}
                      className={`absolute left-0 border-b ${borderRow} hover:bg-slate-50 dark:hover:bg-slate-800/50 grid items-center transition-colors`}
                      style={{
                        ...gridColsStyle,
                        top: 0,
                        left: 0,
                        width: totalTableWidth,
                        minWidth: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      role="row"
                    >
                      {columnsToUse.map((col) => {
                        const display = getCellDisplay(col, row, wacFormatted);
                        const isAlert = shouldHighlightCellAsAlert(col, row);
                        const isFicoLow = shouldHighlightFicoLow(col, row);
                        const isLtvWarning = shouldHighlightLtvWarning(col, row);
                        const isDtiWarning = shouldHighlightDtiWarning(col, row);
                        const cellClass =
                          isAlert
                            ? "font-bold text-red-600 dark:text-red-400"
                            : isFicoLow || isLtvWarning || isDtiWarning
                              ? "text-red-600 dark:text-red-400"
                              : textTd;
                        return (
                          <div
                            key={col.id}
                            className={`whitespace-nowrap py-3 px-4 text-sm ${cellClass}`}
                            role="cell"
                          >
                            {display}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className={`flex items-center justify-between gap-4 px-4 py-3 border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30 ${fillHeight ? "shrink-0" : ""}`}>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {total.toLocaleString()} loans
          </p>
        </div>
      </Card>
    </div>
  );
}

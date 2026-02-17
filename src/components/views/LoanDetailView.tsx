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
} from "@/hooks/useLoanDetailData";
import { useTheme } from "@/components/theme-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "lucide-react";

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
}

type ColumnDef = {
  id: string;
  label: string;
  field: keyof LoanDetailRow | null;
  /** Optional min width (px) for columns with long content (e.g. names, addresses) */
  minWidth?: number;
};

/** Column definition: label for header, DB field key on LoanDetailRow or null for blank */
const COLUMNS: ColumnDef[] = [
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
  { id: "application_mtd", label: "Application MTD", field: null },
  { id: "application_mtd_previous", label: "Application MTD Previous", field: null },
  { id: "application_month_previous", label: "Application Month Previous", field: null },
  { id: "loan_estimate_sent", label: "Loan Estimate Sent", field: "loan_estimate_sent_date" },
  { id: "loan_estimate_received", label: "Loan Estimate Received", field: "loan_estimate_received_date" },
  { id: "uw_final_approval_date", label: "UW Final Approval Date", field: "uw_final_approval_date" },
  { id: "uw_suspended_date", label: "UW Suspended Date", field: "uw_suspended_date" },
  { id: "uw_denied_date", label: "UW Denied Date", field: "uw_denied_date" },
  { id: "investor_lock_date", label: "Investor Lock Date", field: "investor_lock_date" },
  { id: "investor_lock_mtd", label: "Investor Lock MTD", field: null },
  { id: "investor_lock_mtd_previous", label: "Investor Lock MTDPrevious", field: null },
  { id: "investor_lock_month_previous", label: "Investor Lock MonthPrevious", field: null },
  { id: "locked_flag", label: "Locked Flag", field: null },
  { id: "lock_expiration_date", label: "Lock Expiration Date", field: "lock_expiration_date" },
  { id: "locked_days", label: "Locked Days", field: "lock_days" },
  { id: "estimated_closing_date", label: "Estimated Closing Date", field: "estimated_closing_date" },
  { id: "ctc_date", label: "CTC Date", field: "ctc_date" },
  { id: "closing_disclosure_sent", label: "Closing Disclosure Sent", field: "closing_disclosure_sent_date" },
  { id: "closing_disclosure_received", label: "Closing Disclosure Received", field: "closing_disclosure_received_date" },
  { id: "closing_date", label: "Closing Date", field: "closing_date" },
  { id: "closing_mtd", label: "Closing MTD", field: null },
  { id: "closing_mtd_previous", label: "Closing MTD Previous", field: null },
  { id: "closing_month_previous", label: "Closing Month Previous", field: null },
  { id: "funding_date", label: "Funding Date", field: "funding_date" },
  { id: "investor_purchase_date", label: "Investor Purchase Date", field: "investor_purchase_date" },
  { id: "investor_purchase_mtd", label: "Investor Purchase MTD", field: null },
  { id: "investor_purchase_mtd_previous", label: "Investor Purchase MTD Previous", field: null },
  { id: "investor_purchase_month_previous", label: "Investor Purchase Month Previous", field: null },
  { id: "shipped_date", label: "Shipped Date", field: "shipped_date" },
  { id: "subject_property_type_fannie_mae", label: "Subject Property Type Fannie Mae", field: "subject_property_type_fannie_mae" },
  { id: "fees_va_fund_fee_borr", label: "Fees VA Fund Fee Borr", field: "fees_va_fund_fee_borr" },
  { id: "mers_min", label: "Mers Min #", field: "mers_min" },
  { id: "fha_lender_id", label: "FHA Lender ID", field: "fha_lender_id" },
  { id: "fees_loan_discount_fee_pct", label: "Fees Loan Discount Fee %", field: "fees_loan_discount_fee" },
  { id: "fees_loan_discount_fee_borr", label: "Fees Loan Discount Fee Borr", field: "fees_loan_discount_fee_borr" },
  { id: "subject_property_street", label: "Subject Property Street", field: "property_street", minWidth: 220 },
  { id: "loan_amt", label: "Loan Amt", field: "loan_amount" },
  { id: "loan_type_2", label: "Loan Type", field: "loan_type" },
  { id: "interest_only_mos", label: "Interest Only Mos", field: "number_of_months_interest_only_payments" },
  { id: "borr_info_points_paid", label: "Borr Info Points Paid", field: "origination_points" },
  { id: "income_total_mo_income", label: "Income Total Mo Income (Borr/Co-Borr)", field: "income_total_mo_income", minWidth: 260 },
  { id: "subject_property_county", label: "Subject Property County", field: "property_county" },
  { id: "rush_closing_on_file", label: "Rush Closing on File", field: "rush_closing_on_file" },
  { id: "scrub_rating_of_file", label: "Scrub Rating of File", field: "scrub_rating_of_file" },
];

/** Column headers that are not populated from the database (calculated or not in schema) */
export const UNPOPULATED_LOAN_DETAIL_COLUMNS = COLUMNS.filter((c) => c.field === null).map(
  (c) => c.label,
);

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return value;
  }
  return String(value);
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

/** Display value for a cell: handles Units (1), WAC (aggregate), Locked Flag (Yes/No), and Fees Loan Discount Fee % */
function getCellDisplay(
  col: ColumnDef,
  row: LoanDetailRow,
  wacFormatted: string,
): string {
  if (col.id === "units") return "1";
  if (col.id === "wac") return wacFormatted;
  if (col.id === "locked_flag")
    return row.investor_lock_date != null && String(row.investor_lock_date).trim() !== ""
      ? "Yes"
      : "No";
  if (col.id === "fees_loan_discount_fee_pct" && col.field) {
    const raw = row[col.field as keyof LoanDetailRow];
    if (raw != null && typeof raw === "number")
      return `${Number(raw).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    return raw != null ? String(raw) : "";
  }
  if (col.field) return formatCellValue(row[col.field as keyof LoanDetailRow]);
  return "";
}

/** Column ids that get no total (leave blank) */
const TOTALS_BLANK_COLUMN_IDS = new Set([
  "loan_term",
  "locked_days",
  "fees_va_fund_fee_borr",
  "fees_loan_discount_fee_borr",
  "loan_amt",
  "borr_info_points_paid",
  "income_total_mo_income",
]);

function getColumnTotal(
  col: ColumnDef,
  loans: LoanDetailRow[],
  wacFormatted: string,
): string {
  if (loans.length === 0) return "";
  if (col.id === "loan_number") return "Totals";
  if (col.id === "units") return String(loans.length);
  if (col.id === "wac") return wacFormatted;
  if (TOTALS_BLANK_COLUMN_IDS.has(col.id)) return "";

  // Volume: sum of loan_amount (ensure numeric)
  if (col.id === "volume") {
    let sum = 0;
    for (let i = 0; i < loans.length; i++) {
      const v = loans[i].loan_amount;
      const n = v != null ? Number(v) : NaN;
      if (!Number.isNaN(n)) sum += n;
    }
    return sum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Averages: FICO, LTV, BE DTI
  const avgFields: Record<string, keyof LoanDetailRow> = {
    fico: "fico_score",
    ltv: "ltv_ratio",
    be_dti: "be_dti_ratio",
  };
  const field = avgFields[col.id];
  if (field) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < loans.length; i++) {
      const v = loans[i][field];
      const num = v != null ? Number(v) : NaN;
      if (!Number.isNaN(num)) {
        sum += num;
        n++;
      }
    }
    if (n === 0) return "";
    return (sum / n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return "";
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
  else if (col.id === "wac") dataMaxLen = Math.max(dataMaxLen, wacFormatted.length);
  else if (col.id === "locked_flag") dataMaxLen = Math.max(dataMaxLen, 3); // "Yes"
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

export function LoanDetailView({ selectedTenantId }: LoanDetailViewProps) {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";
  const { data, loading, error, fetchAll } = useLoanDetailData(selectedTenantId);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [, setScrollReady] = useState(0);

  useEffect(() => {
    fetchAll();
  }, [selectedTenantId, fetchAll]);

  // Callback ref: when the scroll container mounts, trigger re-render so virtualizer can measure it
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el;
    if (el) setScrollReady((n) => n + 1);
  }, []);

  const loans = data?.loans ?? [];
  const total = data?.total ?? 0;

  // WAC = sum of (Loan Amount * Interest Rate), formatted as #,##0.000
  const wacFormatted = useMemo(() => computeWacFormatted(loans), [loans]);

  // Size each column to fit header + all cell content (no truncation)
  const { gridColsStyle, totalTableWidth } = useMemo(() => {
    const widths = COLUMNS.map((c) => getColumnWidthFromContent(c, loans, wacFormatted));
    return {
      gridColsStyle: {
        gridTemplateColumns: widths.map((w) => `${w}px`).join(" "),
      },
      totalTableWidth: widths.reduce((a, b) => a + b, 0),
    };
  }, [loans, wacFormatted]);
  // Match sales scorecard details table: gray header row, horizontal row lines only (no vertical column lines)
  const borderTh = isDarkMode ? "border-slate-700" : "border-slate-200";
  const bgTh = isDarkMode ? "bg-slate-800/50 text-slate-300" : "bg-slate-50 text-slate-600";
  const borderRow = isDarkMode ? "border-slate-700" : "border-slate-100";
  const textTd = isDarkMode ? "text-slate-200" : "text-slate-900";

  // Virtualize only data rows; header is rendered separately and made sticky
  const rowCount = loans.length;
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
    () => COLUMNS.map((c) => getColumnTotal(c, loans, wacFormatted)),
    [loans, wacFormatted],
  );

  const exportToExcel = useCallback(() => {
    const escapeCsv = (v: string) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows: string[][] = [];
    rows.push(COLUMNS.map((c) => escapeCsv(c.label)));
    if (loans.length > 0) {
      rows.push(COLUMNS.map((c) => escapeCsv(getColumnTotal(c, loans, wacFormatted))));
      for (let i = 0; i < loans.length; i++) {
        rows.push(
          COLUMNS.map((c) => escapeCsv(getCellDisplay(c, loans[i], wacFormatted))),
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
  }, [loans, wacFormatted]);

  return (
    <div className="space-y-4">
      <Card className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800/50 shadow-sm overflow-hidden">
        <div className="flex items-center gap-4 mb-4 flex-wrap p-4 border-b border-slate-200/60 dark:border-slate-700/60">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Loan Detail
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              All loans. Columns not from the database are left blank. Virtualized for performance.
            </p>
          </div>
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
            className="overflow-auto h-[70vh] min-h-[400px]"
            style={{ contain: "strict" }}
          >
            <div
              style={{
                height: `${totalScrollHeight}px`,
                width: totalTableWidth,
                minWidth: "100%",
              }}
            >
              {/* Sticky header – stays at top when scrolling */}
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
                {COLUMNS.map((col) => (
                  <div
                    key={col.id}
                    className="whitespace-nowrap py-2.5 px-4 text-xs font-semibold"
                    role="columnheader"
                  >
                    {col.label}
                  </div>
                ))}
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
                {COLUMNS.map((col, idx) => (
                  <div
                    key={col.id}
                    className={`whitespace-nowrap py-2 px-4 text-sm ${textTd}`}
                    role="cell"
                  >
                    {totalsByColumn[idx]}
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
                  const row = loans[virtualRow.index];
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
                      {COLUMNS.map((col) => {
                        const display = getCellDisplay(col, row, wacFormatted);
                        return (
                          <div
                            key={col.id}
                            className={`whitespace-nowrap py-3 px-4 text-sm ${textTd}`}
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

        <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {total.toLocaleString()} loans
          </p>
        </div>
      </Card>
    </div>
  );
}

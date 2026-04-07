/**
 * Loan Detail view – table of all loans with requested columns.
 * Only DB-backed columns are populated; calculated columns left blank.
 * Uses @tanstack/react-virtual for row virtualization (smooth scroll with large lists).
 */

import { useEffect, useRef, useCallback, useState, useMemo, useTransition, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useLoanDetailData,
  type LoanDetailRow,
  type LoanDetailListResponse,
  type LoanDetailFilters,
} from "@/hooks/useLoanDetailData";
import { useAdditionalFieldColumns } from "@/hooks/useAdditionalFieldColumns";
import { useTenantStore } from "@/stores/tenantStore";
import { useTheme } from "@/components/theme-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router-dom";
import {
  type ColumnFilterState,
  type ColumnFilter,
  type BooleanColumnFilter,
  type DateColumnFilter,
  type LoanDetailFilterKind,
  type NumberColumnFilter,
  type NumericFilterMode,
  type TextColumnFilter,
  EMPTY_FILTER_TOKEN,
  DATE_FILTER_BLANK_LABEL,
  DATE_FILTER_BLANK_SHORTCUT,
  areFilterStatesEquivalent,
  normalizeFilterState,
  parseFilterDate,
  parseNumericValue,
  evaluateLoanDetailFilters,
  isFilterActive,
  isDateFilterBlankOnlyShortcut,
  isLoanDetailDateMissing,
} from "@/utils/loanDetailFilters";
import { useLoanDetailFilterBookmarks, type LoanDetailFilterBookmark } from "@/hooks/useLoanDetailFilterBookmarks";
import { Loader2, Download, ArrowUp, ArrowDown, Filter, X, Check, Bookmark, Pencil, Trash2, Share2, SlidersHorizontal } from "lucide-react";
import { LoanDetailColumnsModal } from "@/components/widgets/components/LoanDetailColumnsModal";
import {
  useLoanDetailColumnsStore,
  type SavedLoanDetailColumn,
  savedColumnsToColumnDefs,
  LOAN_DETAIL_STANDALONE_COLUMNS_STORE_ID,
} from "@/stores/loanDetailColumnsStore";
import { computePresetDateRange, getPeriodPresetMeta, type PeriodPreset } from "@/components/ui/DatePeriodPicker";
import {
  useLoanDetailViewState,
  normalizeLoanDetailViewState,
  type LoanDetailViewStateV1,
} from "@/hooks/useLoanDetailViewState";

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 40;
const TOTALS_ROW_HEIGHT = 40;
const OVERSCAN = 10;
const MIN_COL_WIDTH = 80;
/** Approx px per character when sizing columns to content */
const CHARS_TO_PX = 8;
/** Max width per column so one outlier doesn't make table huge; content still fits up to this */
const MAX_COL_WIDTH = 800;
const LOAN_NUMBER_FILTER_MAX_OPTIONS = 200;

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
  /**
   * When set (e.g. standalone Loan Detail page), load/save column layout under this id in loanDetailColumnsStore
   * and show Edit Columns in the header. Independent from workbench widget keys.
   */
  columnsStoreId?: string;
  /** Standalone page uses URL query params for shareable filters. Workbench widgets should disable this. */
  syncFiltersToUrl?: boolean;
  /** Workbench-only: persisted column filter + bookmark selection state (stored in widget config). */
  persistedWorkbenchState?: {
    appliedFilters: ColumnFilterState;
    selectedBookmarkId: string | null;
    selectedBookmarkTitle: string | null;
  } | null;
  /** Workbench-only: callback to persist filter + bookmark selection state. */
  onPersistedWorkbenchStateChange?: (next: {
    appliedFilters: ColumnFilterState;
    selectedBookmarkId: string | null;
    selectedBookmarkTitle: string | null;
  }) => void;
}

export type ColumnDef = {
  id: string;
  label: string;
  /** DB field key (e.g. loan_amount, fico_score) or null for calculated/blank */
  field: string | null;
  /** Optional explicit type discriminator used by filter UI. */
  type?: LoanDetailFilterKind;
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
const NUMERIC_FIELD_SET = new Set([
  "loan_amount",
  "interest_rate",
  "fico_score",
  "ltv_ratio",
  "be_dti_ratio",
  "loan_term",
  "lock_days",
  "number_of_months_interest_only_payments",
  "income_total_mo_income",
  "origination_points",
  "orig_fee_borr_pd",
  "fees_va_fund_fee_borr",
  "fees_loan_discount_fee",
  "fees_loan_discount_fee_borr",
]);
const NUMERIC_COLUMN_ID_SET = new Set(["units", "wac", "volume", "fico", "ltv", "be_dti", "loan_term", "locked_days"]);
const BOOLEAN_COLUMN_ID_SET = new Set(["locked_flag"]);

function getColumnFilterKind(col: ColumnDef): LoanDetailFilterKind {
  if (col.type) return col.type;
  if (BOOLEAN_COLUMN_ID_SET.has(col.id)) return "boolean";
  if (NUMERIC_COLUMN_ID_SET.has(col.id) || (col.field != null && NUMERIC_FIELD_SET.has(col.field))) return "number";
  if (col.id.includes("date") || (col.field != null && col.field.includes("date"))) return "date";
  return "text";
}

function cloneFilter(filter: ColumnFilter | undefined): ColumnFilter | undefined {
  if (!filter) return undefined;
  if (filter.kind === "text") return { ...filter, selectedValues: [...filter.selectedValues] };
  if (filter.kind === "number") return { ...filter, selectedValues: [...filter.selectedValues] };
  return { ...filter };
}

/** Green row preview while the popover is open: list/cell picks only, not typed bounds (range / greater / less). */
function shouldPreviewDraftOnCells(filter: ColumnFilter | undefined): boolean {
  if (!filter || !isFilterActive(filter)) return false;
  if (filter.kind === "number" && filter.mode !== "all") return false;
  return true;
}

function makeBookmarkId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bookmark_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function encodeFilterStateToQuery(filters: ColumnFilterState): string {
  return encodeURIComponent(JSON.stringify(normalizeFilterState(filters)));
}

function decodeFilterStateFromQuery(serialized: string | null): ColumnFilterState | null {
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(serialized));
    if (typeof parsed !== "object" || parsed == null) return null;
    return parsed as ColumnFilterState;
  } catch {
    return null;
  }
}

const SaveBookmarkDialog = memo(function SaveBookmarkDialog({
  open,
  onOpenChange,
  initialName,
  filterSummaryItems,
  onSave,
}: {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  initialName: string;
  filterSummaryItems: string[];
  onSave: (name: string) => Promise<void>;
}) {
  const [nameDraft, setNameDraft] = useState(initialName);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNameDraft(initialName);
    }
  }, [open, initialName]);

  const handleSave = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(trimmed);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, nameDraft, onOpenChange, onSave]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Bookmark</DialogTitle>
          <DialogDescription>Save the current active filters as a bookmark.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded border border-slate-200 dark:border-slate-700 p-3 space-y-1 max-h-44 overflow-auto">
            {filterSummaryItems.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No active filters.</p>
            ) : (
              filterSummaryItems.map((line) => (
                <p key={`save-${line}`} className="text-xs text-slate-600 dark:text-slate-400">{line}</p>
              ))
            )}
          </div>
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Bookmark name"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={!nameDraft.trim() || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

function isEmptyTokenMatch(token: string, rawValue: unknown): boolean {
  if (token !== EMPTY_FILTER_TOKEN) return false;
  return rawValue == null || String(rawValue).trim() === "";
}

function matchesAppliedTextFilter(filter: TextColumnFilter, token: string, rawValue: unknown): boolean {
  if (filter.selectedValues.length === 0) return false;
  if (filter.selectedValues.includes(EMPTY_FILTER_TOKEN) && isEmptyTokenMatch(EMPTY_FILTER_TOKEN, rawValue)) {
    return true;
  }
  return filter.selectedValues.some((value) => value !== EMPTY_FILTER_TOKEN && value === token);
}

function matchesAppliedNumberFilter(filter: NumberColumnFilter, token: string, rawValue: unknown): boolean {
  const num = parseNumericValue(rawValue);
  if (filter.mode === "all") {
    if (filter.selectedValues.length === 0) return false;
    if (filter.selectedValues.includes(EMPTY_FILTER_TOKEN) && isEmptyTokenMatch(EMPTY_FILTER_TOKEN, rawValue)) {
      return true;
    }
    return filter.selectedValues.some((value) => value !== EMPTY_FILTER_TOKEN && value === token);
  }
  if (num == null) return false;
  if (filter.mode === "range") {
    const min = parseNumericValue(filter.min);
    const max = parseNumericValue(filter.max);
    if (min != null && num < min) return false;
    if (max != null && num > max) return false;
    return min != null || max != null;
  }
  const target = parseNumericValue(filter.value);
  if (target == null) return false;
  return filter.mode === "min" ? num >= target : num <= target;
}

function matchesAppliedDateFilter(filter: DateColumnFilter, rawValue: unknown): boolean {
  const hasDateFilter = Boolean(filter.shortcut?.trim() || filter.from?.trim() || filter.to?.trim());
  if (!hasDateFilter) return false;
  if (isDateFilterBlankOnlyShortcut(filter.shortcut)) {
    return isLoanDetailDateMissing(rawValue);
  }
  const valueDate = parseFilterDate(rawValue);
  if (!valueDate) return false;
  valueDate.setHours(0, 0, 0, 0);

  if (filter.shortcut?.trim()) {
    const token = filter.shortcut.trim().toLowerCase();
    // Support Loan Detail shortcut tokens (including DatePeriodPicker presets).
    if (/^\d{4}$/.test(token)) {
      const year = Number(token);
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      return valueDate >= start && valueDate <= end;
    }

    const presetToken =
      token === "last 30 days"
        ? ("last-30-days" as const) // back-compat
        : (token as PeriodPreset);
    const supportedPresets: PeriodPreset[] = ["last-30-days", "mtd", "ytd", "last-month", "rolling-13", "rolling-12"];
    if (!supportedPresets.includes(presetToken)) return false;

    const range = computePresetDateRange(presetToken);
    const start = new Date(range.start);
    const end = new Date(range.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return valueDate >= start && valueDate <= end;
  }
  const from = parseFilterDate(filter.from);
  const to = parseFilterDate(filter.to);
  if (from) {
    from.setHours(0, 0, 0, 0);
    if (valueDate < from) return false;
  }
  if (to) {
    to.setHours(0, 0, 0, 0);
    if (valueDate > to) return false;
  }
  return Boolean(from || to);
}

function matchesAppliedBooleanFilter(filter: BooleanColumnFilter, rawValue: unknown): boolean {
  if (filter.value === "all") return false;
  const yes = String(rawValue ?? "").trim().toLowerCase() === "yes" || rawValue === true;
  return filter.value === "yes" ? yes : !yes;
}

function dateFilterSummaryLabel(filter: DateColumnFilter): string {
  if (isDateFilterBlankOnlyShortcut(filter.shortcut)) return DATE_FILTER_BLANK_LABEL;
  return filter.shortcut || `${filter.from || ""} to ${filter.to || ""}`;
}

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

function getColumnTotal(
  col: ColumnDef,
  loans: LoanDetailRow[],
  wacFormatted: string,
): string {
  if (loans.length === 0) return col.id === "loan_number" ? "Totals" : BLANK_PLACEHOLDER;
  if (col.id === "loan_number") return "Totals";

  // Totals row is intentionally narrow for performance:
  // Units, Volume (loan_amount), WAC, and averages for FICO/LTV/BE DTI only.
  const shouldCompute =
    col.id === "units" ||
    col.id === "wac" ||
    col.field === "loan_amount" ||
    col.field === "fico_score" ||
    col.field === "ltv_ratio" ||
    col.field === "be_dti_ratio";
  if (!shouldCompute) return BLANK_PLACEHOLDER;

  if (col.id === "units") return String(loans.length);
  if (col.id === "wac") return wacFormatted || BLANK_PLACEHOLDER;

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
  selectedChannel,
  data: dataProp,
  loading: loadingProp,
  error: errorProp,
  fillHeight = false,
  periodLabel,
  filterSummary,
  columns: columnsProp,
  columnsStoreId,
  syncFiltersToUrl = true,
  persistedWorkbenchState = null,
  onPersistedWorkbenchStateChange,
}: LoanDetailViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme } = useTheme();
  const { selectedTenantId: storeTenantId } = useTenantStore();
  const tenantId = selectedTenantIdProp ?? storeTenantId;
  const { columns: additionalColumns } = useAdditionalFieldColumns(tenantId);
  const isDarkMode = theme === "dark";

  const channelFilters = useMemo<LoanDetailFilters | null>(() => {
    if (!selectedChannel || selectedChannel === "All") return null;
    return { dimensionFilters: [{ column: "channel_group", value: selectedChannel }] };
  }, [selectedChannel]);

  const isControlled = dataProp !== undefined;
  const fetched = useLoanDetailData(tenantId, channelFilters, {
    enabled: !isControlled,
  });
  const data = isControlled ? dataProp ?? null : fetched.data;
  const loading = isControlled ? (loadingProp ?? false) : fetched.loading;
  const error = isControlled ? (errorProp ?? null) : fetched.error;

  const savedColumnsFromStore = useLoanDetailColumnsStore((s) =>
    columnsStoreId ? s.byItem[columnsStoreId] : undefined,
  );
  const setColumnsInStore = useLoanDetailColumnsStore((s) => s.setColumns);
  const storeColumnDefs = useMemo(
    () => savedColumnsToColumnDefs(savedColumnsFromStore),
    [savedColumnsFromStore],
  );
  const baseColumns = useMemo((): ColumnDef[] => {
    if (columnsProp && columnsProp.length > 0) return columnsProp;
    if (storeColumnDefs && storeColumnDefs.length > 0) {
      return storeColumnDefs as ColumnDef[];
    }
    return COLUMNS;
  }, [columnsProp, storeColumnDefs]);

  // When the user is in "edited columns" mode (workbench `columns` or standalone saved columns),
  // the table must reflect *exactly* what they selected in the editor.
  //
  // Otherwise `buildEffectiveColumns(baseColumns, additionalColumns)` will re-append any
  // additional fields the user deleted, making it look like "remove" doesn't work.
  const hasUserSelectedColumns = Boolean((columnsProp && columnsProp.length > 0) || (storeColumnDefs && storeColumnDefs.length > 0));

  const columnsToUse = useMemo(
    () => (hasUserSelectedColumns ? baseColumns : buildEffectiveColumns(baseColumns, additionalColumns)),
    [baseColumns, additionalColumns, hasUserSelectedColumns],
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
  const [showFilters, setShowFilters] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<ColumnFilterState>({});
  const [draftFilters, setDraftFilters] = useState<ColumnFilterState>({});
  const [openFilterColumnId, setOpenFilterColumnId] = useState<string | null>(null);
  const [flashState, setFlashState] = useState<{ columnId: string; values: string[]; nonce: number } | null>(null);
  const [isApplyingFilters, startFilterTransition] = useTransition();
  const [filterFeedback, setFilterFeedback] = useState<{ message: string; nonce: number } | null>(null);
  const [filterSearchByColumn, setFilterSearchByColumn] = useState<Record<string, string>>({});
  const [debouncedFilterSearchByColumn, setDebouncedFilterSearchByColumn] = useState<Record<string, string>>({});
  const searchDebounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [bookmarksModalOpen, setBookmarksModalOpen] = useState(false);
  const [loanDetailColumnsModalOpen, setLoanDetailColumnsModalOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [overwriteModalOpen, setOverwriteModalOpen] = useState(false);
  const [saveModalInitialName, setSaveModalInitialName] = useState("");
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingBookmarkName, setEditingBookmarkName] = useState("");
  const [copiedBookmarkState, setCopiedBookmarkState] = useState<{ id: string; fading: boolean } | null>(null);
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null);
  const [sharedBookmarkTitle, setSharedBookmarkTitle] = useState<string | null>(null);
  const isStandalonePersistenceEnabled = Boolean(
    syncFiltersToUrl &&
      columnsStoreId === LOAN_DETAIL_STANDALONE_COLUMNS_STORE_ID &&
      tenantId,
  );
  const standaloneViewState = useLoanDetailViewState({
    tenantId,
    scope: "standalone",
  });
  const hydratedStandalonePreferenceKeyRef = useRef<string | null>(null);
  const {
    bookmarks,
    isLoading: bookmarksLoading,
    saveAll: saveAllBookmarks,
  } = useLoanDetailFilterBookmarks();

  // Workbench widgets can re-render frequently due to canvas interactions, which can keep transitions pending.
  // When URL sync is disabled, apply filter updates synchronously so "Applying filter..." always settles.
  const runFilterUpdate = useCallback((fn: () => void) => {
    if (syncFiltersToUrl) startFilterTransition(fn);
    else fn();
  }, [syncFiltersToUrl, startFilterTransition]);

  // Workbench persistence loop protection: avoid echoing our own persisted state back into hydration.
  const lastPersistedWorkbenchStateJsonRef = useRef<string | null>(null);
  const lastHydratedWorkbenchStateJsonRef = useRef<string | null>(null);

  const getFilterRawValue = useCallback((row: LoanDetailRow, col: ColumnDef): unknown => {
    if (col.id === "units") return 1;
    if (col.id === "wac") return row.interest_rate;
    if (col.id === "locked_flag") return isLockedFlagYes(row) ? "Yes" : "No";
    if (col.field) return (row as unknown as Record<string, unknown>)[col.field];
    return null;
  }, []);

  const filteredLoans = useMemo(
    () => evaluateLoanDetailFilters(loans, appliedFilters, (row, columnId) => {
      const col = columnsToUse.find((item) => item.id === columnId);
      return col ? getFilterRawValue(row, col) : null;
    }),
    [loans, appliedFilters, columnsToUse, getFilterRawValue],
  );

  const hasActiveFilters = useMemo(
    () => Object.values(appliedFilters).some((filter) => isFilterActive(filter)),
    [appliedFilters],
  );
  const activeFilterColumnIds = useMemo(() => (
    new Set(
      Object.entries(appliedFilters)
        .filter(([, filter]) => isFilterActive(filter))
        .map(([columnId]) => columnId),
    )
  ), [appliedFilters]);
  const filteredCount = filteredLoans.length;
  const baseCount = loans.length;
  // WAC = sum of (Loan Amount * Interest Rate), formatted as #,##0.000
  const wacFormatted = useMemo(() => computeWacFormatted(filteredLoans), [filteredLoans]);

  const sortedLoans = useMemo(
    () =>
      sortColumnId
        ? sortLoans(filteredLoans, sortColumnId, sortDirection, wacFormatted, columnsToUse)
        : filteredLoans,
    [filteredLoans, sortColumnId, sortDirection, wacFormatted, columnsToUse],
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

  // Lazy distinct-values cache: compute only for the column whose filter UI is opened.
  // (Previously we computed distinct values for *all* columns on every relevant change.)
  const [distinctCache, setDistinctCache] = useState<
    Record<string, { values: string[]; hasBlank: boolean; version: number }>
  >({});
  const distinctCacheRef = useRef(distinctCache);
  useEffect(() => {
    distinctCacheRef.current = distinctCache;
  }, [distinctCache]);

  const loansVersionRef = useRef(0);
  useEffect(() => {
    loansVersionRef.current += 1;
    setDistinctCache({});
  }, [loans]);

  useEffect(() => {
    if (!openFilterColumnId) return;
    const col = columnsToUse.find((c) => c.id === openFilterColumnId);
    if (!col) return;

    const version = loansVersionRef.current;
    const cached = distinctCacheRef.current[openFilterColumnId];
    if (cached && cached.version === version) return;

    const values = new Set<string>();
    let hasBlank = false;
    for (const row of loans) {
      const raw = getFilterRawValue(row, col);
      if (raw == null) {
        hasBlank = true;
        continue;
      }
      const v = String(raw).trim();
      if (!v) {
        hasBlank = true;
        continue;
      }
      values.add(v);
    }
    const sorted = Array.from(values).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    setDistinctCache((prev) => ({
      ...prev,
      [openFilterColumnId]: { values: sorted, hasBlank, version },
    }));
  }, [openFilterColumnId, columnsToUse, loans, getFilterRawValue]);

  const beginDraft = useCallback((columnId: string) => {
    setDraftFilters((prev) => {
      if (prev[columnId] !== undefined) return prev;
      return { ...prev, [columnId]: cloneFilter(appliedFilters[columnId]) };
    });
  }, [appliedFilters]);

  const setDraftFilter = useCallback((columnId: string, next: ColumnFilterState[string]) => {
    setDraftFilters((prev) => ({ ...prev, [columnId]: next }));
  }, []);

  const clearDraftFilter = useCallback((columnId: string) => {
    setDraftFilters((prev) => {
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  }, []);

  const clearFilterSearch = useCallback((columnId: string) => {
    const timers = searchDebounceTimersRef.current;
    if (timers[columnId]) {
      clearTimeout(timers[columnId]);
      delete timers[columnId];
    }
    setFilterSearchByColumn((prev) => {
      if (!(columnId in prev)) return prev;
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
    setDebouncedFilterSearchByColumn((prev) => {
      if (!(columnId in prev)) return prev;
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  }, []);

  const discardDraft = useCallback((columnId: string) => {
    setDraftFilters((prev) => {
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
    setOpenFilterColumnId((current) => (current === columnId ? null : current));
    clearFilterSearch(columnId);
  }, [clearFilterSearch]);

  const closePopoverWithoutDiscard = useCallback((columnId: string) => {
    setOpenFilterColumnId((current) => (current === columnId ? null : current));
    clearFilterSearch(columnId);
  }, [clearFilterSearch]);

  const commitDraft = useCallback((columnId: string) => {
    let committedFilter: ColumnFilter | undefined;
    setFilterFeedback({ message: "Applying filter...", nonce: Date.now() });
    runFilterUpdate(() => {
      setAppliedFilters((prev) => {
        const draft = draftFilters[columnId];
        if (!draft || !isFilterActive(draft)) {
          committedFilter = undefined;
          const next = { ...prev };
          delete next[columnId];
          return next;
        }
        committedFilter = cloneFilter(draft);
        return { ...prev, [columnId]: committedFilter };
      });
    });
    setDraftFilters((prev) => {
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
    setOpenFilterColumnId((current) => (current === columnId ? null : current));
    clearFilterSearch(columnId);
    if (committedFilter && (committedFilter.kind === "text" || (committedFilter.kind === "number" && committedFilter.mode === "all"))) {
      const values = committedFilter.selectedValues;
      setFlashState({ columnId, values, nonce: Date.now() });
    }
  }, [draftFilters, runFilterUpdate, clearFilterSearch]);

  useEffect(() => {
    if (!flashState) return;
    const timer = window.setTimeout(() => setFlashState(null), 650);
    return () => window.clearTimeout(timer);
  }, [flashState]);

  useEffect(() => {
    if (!filterFeedback) return;
    if (isApplyingFilters) return;
    setFilterFeedback(null);
  }, [isApplyingFilters, filterFeedback]);

  useEffect(() => {
    return () => {
      const timers = searchDebounceTimersRef.current;
      for (const timer of Object.values(timers)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const updateFilterSearch = useCallback((columnId: string, value: string) => {
    setFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }));
    const timers = searchDebounceTimersRef.current;
    if (timers[columnId]) clearTimeout(timers[columnId]);
    timers[columnId] = setTimeout(() => {
      setDebouncedFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }));
    }, 200);
  }, []);

  const selectedBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === selectedBookmarkId) ?? null,
    [bookmarks, selectedBookmarkId],
  );
  const hasBookmarkSelection = Boolean(selectedBookmark);
  const bookmarkInSync = useMemo(
    () => (selectedBookmark ? areFilterStatesEquivalent(appliedFilters, selectedBookmark.filters) : false),
    [appliedFilters, selectedBookmark],
  );
  const saveStatusLabel = bookmarkInSync ? "Saved" : "Save";
  const saveStatusClass = bookmarkInSync
    ? "bg-emerald-600 hover:bg-emerald-600 text-white"
    : "bg-sky-600 hover:bg-sky-700 text-white";

  const toPersistedColumns = useCallback(
    (columns: SavedLoanDetailColumn[] | undefined): SavedLoanDetailColumn[] => {
      if (!columns?.length) return [];
      return columns.map((col) => ({
        id: col.id,
        label: col.label,
        field: col.field,
      }));
    },
    [],
  );

  const saveStandaloneViewState = useCallback(async () => {
    if (!isStandalonePersistenceEnabled) return;
    if (isApplyingFilters) return;
    const payload: LoanDetailViewStateV1 = normalizeLoanDetailViewState({
      version: 1,
      appliedFilters: normalizeFilterState(appliedFilters),
      selectedBookmarkId,
      selectedBookmarkTitle: selectedBookmark?.name ?? sharedBookmarkTitle ?? null,
      columns: toPersistedColumns(savedColumnsFromStore),
      sortColumnId,
      sortDirection,
      showFilters,
    });
    await standaloneViewState.save(payload);
  }, [
    isStandalonePersistenceEnabled,
    isApplyingFilters,
    appliedFilters,
    selectedBookmarkId,
    selectedBookmark?.name,
    sharedBookmarkTitle,
    savedColumnsFromStore,
    sortColumnId,
    sortDirection,
    showFilters,
    toPersistedColumns,
    standaloneViewState,
  ]);

  const filterSummaryItems = useMemo(() => {
    const summarize = (state: ColumnFilterState): string[] => {
      const lines: string[] = [];
      for (const col of columnsToUse) {
        const filter = state[col.id];
        if (!filter || !isFilterActive(filter)) continue;
        if (filter.kind === "text") {
          lines.push(`${col.label}: ${filter.selectedValues.map((v) => (v === EMPTY_FILTER_TOKEN ? "(Blank)" : v)).join(", ")}`);
          continue;
        }
        if (filter.kind === "number") {
          if (filter.mode === "all") {
            lines.push(`${col.label}: ${filter.selectedValues.map((v) => (v === EMPTY_FILTER_TOKEN ? "(Blank)" : v)).join(", ")}`);
          } else if (filter.mode === "range") {
            lines.push(`${col.label}: ${filter.min || ""} - ${filter.max || ""}`);
          } else {
            lines.push(`${col.label}: ${filter.mode === "min" ? ">=" : "<="} ${filter.value || ""}`);
          }
          continue;
        }
        if (filter.kind === "date") {
          lines.push(`${col.label}: ${dateFilterSummaryLabel(filter)}`);
          continue;
        }
        lines.push(`${col.label}: ${filter.value === "yes" ? "Yes" : "No"}`);
      }
      return lines;
    };
    return summarize(appliedFilters);
  }, [appliedFilters, columnsToUse]);

  const summarizeFilterState = useCallback((state: ColumnFilterState): string[] => {
    const lines: string[] = [];
    for (const col of columnsToUse) {
      const filter = state[col.id];
      if (!filter || !isFilterActive(filter)) continue;
      if (filter.kind === "text") {
        lines.push(`${col.label}: ${filter.selectedValues.map((v) => (v === EMPTY_FILTER_TOKEN ? "(Blank)" : v)).join(", ")}`);
        continue;
      }
      if (filter.kind === "number") {
        if (filter.mode === "all") {
          lines.push(`${col.label}: ${filter.selectedValues.map((v) => (v === EMPTY_FILTER_TOKEN ? "(Blank)" : v)).join(", ")}`);
        } else if (filter.mode === "range") {
          lines.push(`${col.label}: ${filter.min || ""} - ${filter.max || ""}`);
        } else {
          lines.push(`${col.label}: ${filter.mode === "min" ? ">=" : "<="} ${filter.value || ""}`);
        }
        continue;
      }
      if (filter.kind === "date") {
        lines.push(`${col.label}: ${dateFilterSummaryLabel(filter)}`);
        continue;
      }
      lines.push(`${col.label}: ${filter.value === "yes" ? "Yes" : "No"}`);
    }
    return lines;
  }, [columnsToUse]);

  const saveBookmarksAndMaybeSelect = useCallback(async (
    nextBookmarks: LoanDetailFilterBookmark[],
    selectedId?: string | null,
  ) => {
    await saveAllBookmarks(nextBookmarks);
    if (selectedId !== undefined) setSelectedBookmarkId(selectedId);
  }, [saveAllBookmarks]);

  const handleCreateBookmark = useCallback(async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const now = new Date().toISOString();
    const bookmark: LoanDetailFilterBookmark = {
      id: makeBookmarkId(),
      name: trimmedName,
      filters: normalizeFilterState(appliedFilters),
      createdAt: now,
      updatedAt: now,
    };
    await saveBookmarksAndMaybeSelect([...bookmarks, bookmark], bookmark.id);
    setSharedBookmarkTitle(null);
  }, [appliedFilters, bookmarks, saveBookmarksAndMaybeSelect]);

  const handleOverwriteSelectedBookmark = useCallback(async () => {
    if (!selectedBookmark) return;
    const now = new Date().toISOString();
    const next = bookmarks.map((bookmark) =>
      bookmark.id === selectedBookmark.id
        ? { ...bookmark, filters: normalizeFilterState(appliedFilters), updatedAt: now }
        : bookmark,
    );
    await saveBookmarksAndMaybeSelect(next, selectedBookmark.id);
    setOverwriteModalOpen(false);
    setSharedBookmarkTitle(null);
  }, [selectedBookmark, bookmarks, appliedFilters, saveBookmarksAndMaybeSelect]);

  const applyBookmark = useCallback((bookmark: LoanDetailFilterBookmark) => {
    setFilterFeedback({ message: "Applying filter...", nonce: Date.now() });
    runFilterUpdate(() => {
      setAppliedFilters(normalizeFilterState(bookmark.filters));
      setDraftFilters({});
      setOpenFilterColumnId(null);
      setSelectedBookmarkId(bookmark.id);
      // Keep a fallback title so the badge can restore even if the bookmark list changes.
      setSharedBookmarkTitle(bookmark.name);
    });
    setBookmarksModalOpen(false);
  }, [runFilterUpdate]);

  const handleDeleteBookmark = useCallback(async (bookmarkId: string) => {
    const next = bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
    const nextSelected = selectedBookmarkId === bookmarkId ? null : selectedBookmarkId;
    await saveBookmarksAndMaybeSelect(next, nextSelected);
  }, [bookmarks, selectedBookmarkId, saveBookmarksAndMaybeSelect]);

  const handleRenameBookmark = useCallback(async (bookmarkId: string, nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const existing = bookmarks.find((bookmark) => bookmark.id === bookmarkId);
    if (existing && existing.name.trim() === trimmed) {
      setEditingBookmarkId(null);
      setEditingBookmarkName("");
      return;
    }
    const now = new Date().toISOString();
    const next = bookmarks.map((bookmark) =>
      bookmark.id === bookmarkId ? { ...bookmark, name: trimmed, updatedAt: now } : bookmark,
    );
    await saveBookmarksAndMaybeSelect(next);
    setEditingBookmarkId(null);
    setEditingBookmarkName("");
  }, [bookmarks, saveBookmarksAndMaybeSelect]);

  const clearAppliedBookmarkView = useCallback(() => {
    setFilterFeedback({ message: "Removing filters...", nonce: Date.now() });
    runFilterUpdate(() => {
      setAppliedFilters({});
      setDraftFilters({});
      setOpenFilterColumnId(null);
      setSelectedBookmarkId(null);
      setSharedBookmarkTitle(null);
    });
  }, [runFilterUpdate]);

  const copyBookmarkLink = useCallback(async (bookmark: LoanDetailFilterBookmark) => {
    const params = new URLSearchParams(searchParams);
    params.set("ldFilters", encodeFilterStateToQuery(bookmark.filters));
    params.set("bookmarkName", bookmark.name);
    const path = `${window.location.pathname}?${params.toString()}`;
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setFilterFeedback({ message: `Copied link for "${bookmark.name}"`, nonce: Date.now() });
      setCopiedBookmarkState({ id: bookmark.id, fading: false });
      window.setTimeout(() => {
        setCopiedBookmarkState((current) => (current && current.id === bookmark.id ? { ...current, fading: true } : current));
      }, 1000);
      window.setTimeout(() => {
        setCopiedBookmarkState((current) => (current && current.id === bookmark.id ? null : current));
      }, 1500);
    } catch {
      // ignore clipboard errors
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isStandalonePersistenceEnabled) return;
    const preferenceKey = standaloneViewState.preferenceKey;
    if (!preferenceKey) return;
    if (hydratedStandalonePreferenceKeyRef.current === preferenceKey) return;
    let cancelled = false;
    const hasUrlFilters = Boolean(searchParams.get("ldFilters") || searchParams.get("bookmarkName"));
    void standaloneViewState.load().then((loaded) => {
      if (cancelled || !loaded) return;
      if (loaded.columns.length > 0 && columnsStoreId) {
        setColumnsInStore(columnsStoreId, loaded.columns);
      }
      if (!hasUrlFilters) {
        setAppliedFilters(normalizeFilterState(loaded.appliedFilters));
        setSelectedBookmarkId(loaded.selectedBookmarkId);
        setSharedBookmarkTitle(loaded.selectedBookmarkTitle);
      }
      setSortColumnId(loaded.sortColumnId);
      setSortDirection(loaded.sortDirection);
      setShowFilters(loaded.showFilters);
      hydratedStandalonePreferenceKeyRef.current = preferenceKey;
    }).catch(() => {
      hydratedStandalonePreferenceKeyRef.current = preferenceKey;
    });
    return () => {
      cancelled = true;
    };
  }, [
    isStandalonePersistenceEnabled,
    searchParams,
    standaloneViewState,
    columnsStoreId,
    setColumnsInStore,
  ]);

  useEffect(() => {
    if (!syncFiltersToUrl) return;
    const fromUrl = decodeFilterStateFromQuery(searchParams.get("ldFilters"));
    if (fromUrl && Object.keys(fromUrl).length > 0) {
      setAppliedFilters(normalizeFilterState(fromUrl));
    }
    const bookmarkName = searchParams.get("bookmarkName");
    if (bookmarkName) setSharedBookmarkTitle(bookmarkName);
    // one-time hydration from initial route state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!syncFiltersToUrl) return;
    const next = new URLSearchParams(searchParams);
    if (Object.values(appliedFilters).some((filter) => isFilterActive(filter))) {
      next.set("ldFilters", encodeFilterStateToQuery(appliedFilters));
    } else {
      next.delete("ldFilters");
    }
    const nameForUrl = selectedBookmark?.name ?? sharedBookmarkTitle;
    if (nameForUrl) next.set("bookmarkName", nameForUrl);
    else next.delete("bookmarkName");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [appliedFilters, searchParams, selectedBookmark, sharedBookmarkTitle, setSearchParams, syncFiltersToUrl]);

  // Workbench hydration from persisted widget config.
  useEffect(() => {
    if (syncFiltersToUrl) return;
    if (!persistedWorkbenchState) return;
    // Don't hydrate over an in-flight transition (commit/apply bookmark).
    if (isApplyingFilters) return;
    const nextFilters = normalizeFilterState(persistedWorkbenchState.appliedFilters ?? {});
    const incomingJson = JSON.stringify({
      appliedFilters: nextFilters,
      selectedBookmarkId: persistedWorkbenchState.selectedBookmarkId ?? null,
      selectedBookmarkTitle: persistedWorkbenchState.selectedBookmarkTitle ?? null,
    });
    // If this is the state we just persisted, ignore it to prevent feedback loops.
    if (lastPersistedWorkbenchStateJsonRef.current === incomingJson) return;
    // If we've already hydrated this exact persisted state, don't re-run on every render.
    if (lastHydratedWorkbenchStateJsonRef.current === incomingJson) return;
    lastHydratedWorkbenchStateJsonRef.current = incomingJson;
    // Avoid clobbering in-session edits unless the incoming state truly differs.
    if (!areFilterStatesEquivalent(appliedFilters, nextFilters)) {
      setAppliedFilters(nextFilters);
      setDraftFilters({});
      setOpenFilterColumnId(null);
    }
    if (persistedWorkbenchState.selectedBookmarkId !== selectedBookmarkId) {
      setSelectedBookmarkId(persistedWorkbenchState.selectedBookmarkId);
    }
    if ((persistedWorkbenchState.selectedBookmarkTitle ?? null) !== (sharedBookmarkTitle ?? null)) {
      setSharedBookmarkTitle(persistedWorkbenchState.selectedBookmarkTitle ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFiltersToUrl, persistedWorkbenchState, isApplyingFilters, appliedFilters, selectedBookmarkId, sharedBookmarkTitle]);

  // Workbench persistence to widget config (do not touch URL).
  useEffect(() => {
    if (syncFiltersToUrl) return;
    if (!onPersistedWorkbenchStateChange) return;
    // Don't persist while a transition is in flight; we only want settled appliedFilters.
    if (isApplyingFilters) return;
    const normalized = normalizeFilterState(appliedFilters);
    const payload = {
      appliedFilters: normalized,
      selectedBookmarkId,
      selectedBookmarkTitle: selectedBookmark?.name ?? sharedBookmarkTitle ?? null,
    };
    const json = JSON.stringify(payload);
    if (lastPersistedWorkbenchStateJsonRef.current === json) return;
    lastPersistedWorkbenchStateJsonRef.current = json;
    onPersistedWorkbenchStateChange(payload);
  }, [
    syncFiltersToUrl,
    appliedFilters,
    selectedBookmarkId,
    selectedBookmark?.name,
    sharedBookmarkTitle,
    onPersistedWorkbenchStateChange,
    isApplyingFilters,
  ]);

  useEffect(() => {
    if (!isStandalonePersistenceEnabled) return;
    const preferenceKey = standaloneViewState.preferenceKey;
    if (!preferenceKey) return;
    if (standaloneViewState.isLoading) return;
    if (hydratedStandalonePreferenceKeyRef.current !== preferenceKey) return;
    void saveStandaloneViewState();
  }, [isStandalonePersistenceEnabled, saveStandaloneViewState, standaloneViewState]);

  const toggleDraftValue = useCallback((columnId: string, value: string, kind: LoanDetailFilterKind) => {
    setDraftFilters((prev) => {
      const current = prev[columnId];
      if (kind === "number") {
        const selected = current?.kind === "number" ? current.selectedValues : [];
        const selectedValues = selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value];
        return {
          ...prev,
          [columnId]: { kind: "number", mode: "all", selectedValues },
        };
      }
      const selected = current?.kind === "text" ? current.selectedValues : [];
      const selectedValues = selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value];
      return { ...prev, [columnId]: { kind: "text", selectedValues } };
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilterFeedback({ message: "Removing filters...", nonce: Date.now() });
    runFilterUpdate(() => {
      setAppliedFilters({});
      setDraftFilters({});
      setOpenFilterColumnId(null);
    });
  }, [runFilterUpdate]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    for (const col of columnsToUse) {
      const filter = appliedFilters[col.id];
      if (!isFilterActive(filter)) continue;
      if (!filter) continue;
      if (filter.kind === "text") {
        for (const value of filter.selectedValues) {
          chips.push({
            key: `${col.id}:text:${value}`,
            label: `${col.label}: ${value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}`,
            onRemove: () => {
              setFilterFeedback({ message: "Removing filter...", nonce: Date.now() });
              runFilterUpdate(() => {
                setAppliedFilters((prev) => {
                  const current = prev[col.id];
                  if (!current || current.kind !== "text") return prev;
                  const selectedValues = current.selectedValues.filter((item) => item !== value);
                  const next = { ...prev };
                  if (selectedValues.length === 0) delete next[col.id];
                  else next[col.id] = { ...current, selectedValues };
                  return next;
                });
              });
            },
          });
        }
        continue;
      }
      if (filter.kind === "number") {
        if (filter.mode === "all") {
          for (const value of filter.selectedValues) {
            chips.push({
              key: `${col.id}:number:${value}`,
              label: `${col.label}: ${value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}`,
              onRemove: () => {
                setFilterFeedback({ message: "Removing filter...", nonce: Date.now() });
                runFilterUpdate(() => {
                  setAppliedFilters((prev) => {
                    const current = prev[col.id];
                    if (!current || current.kind !== "number" || current.mode !== "all") return prev;
                    const selectedValues = current.selectedValues.filter((item) => item !== value);
                    const next = { ...prev };
                    if (selectedValues.length === 0) delete next[col.id];
                    else next[col.id] = { ...current, selectedValues };
                    return next;
                  });
                });
              },
            });
          }
        } else if (filter.mode === "range") {
          chips.push({
            key: `${col.id}:range`,
            label: `${col.label}: ${filter.min || ""}-${filter.max || ""}`,
            onRemove: () => {
              setFilterFeedback({ message: "Removing filter...", nonce: Date.now() });
              runFilterUpdate(() => {
                setAppliedFilters((prev) => {
                  const next = { ...prev };
                  delete next[col.id];
                  return next;
                });
              });
            },
          });
        } else {
          chips.push({
            key: `${col.id}:${filter.mode}`,
            label: `${col.label}: ${filter.mode === "min" ? "Greater Than" : "Less Than"} ${filter.value || ""}`,
            onRemove: () => {
              setFilterFeedback({ message: "Removing filter...", nonce: Date.now() });
              runFilterUpdate(() => {
                setAppliedFilters((prev) => {
                  const next = { ...prev };
                  delete next[col.id];
                  return next;
                });
              });
            },
          });
        }
        continue;
      }
      if (filter.kind === "date") {
        chips.push({
          key: `${col.id}:date`,
          label: `${col.label}: ${dateFilterSummaryLabel(filter)}`,
          onRemove: () => {
            setFilterFeedback({ message: "Removing filter...", nonce: Date.now() });
            runFilterUpdate(() => {
              setAppliedFilters((prev) => {
                const next = { ...prev };
                delete next[col.id];
                return next;
              });
            });
          },
        });
        continue;
      }
      chips.push({
        key: `${col.id}:boolean`,
        label: `${col.label}: ${filter.value === "yes" ? "Yes" : "No"}`,
        onRemove: () => {
          setFilterFeedback({ message: "Removing filter...", nonce: Date.now() });
          runFilterUpdate(() => {
            setAppliedFilters((prev) => {
              const next = { ...prev };
              delete next[col.id];
              return next;
            });
          });
        },
      });
    }
    return chips;
  }, [columnsToUse, appliedFilters, runFilterUpdate]);

  // Use a fixed column width to avoid expensive full-dataset width scans.
  const { gridColsStyle, totalTableWidth } = useMemo(() => {
    const widths = columnsToUse.map(() => 180);
    return {
      gridColsStyle: {
        gridTemplateColumns: widths.map((w) => `${w}px`).join(" "),
      },
      totalTableWidth: widths.reduce((a, b) => a + b, 0),
    };
  }, [columnsToUse]);
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
    () => columnsToUse.map((c) => getColumnTotal(c, sortedLoans, wacFormatted)),
    [sortedLoans, wacFormatted, columnsToUse],
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
      rows.push(columnsToUse.map((c) => escapeCsv(getColumnTotal(c, sortedLoans, wacFormatted))));
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
  }, [sortedLoans, wacFormatted, columnsToUse]);

  const renderFilterContent = useCallback((col: ColumnDef) => {
    const filterKind = getColumnFilterKind(col);
    const cached = distinctCache[col.id];
    const allValues = cached?.values ?? [];
    const hasBlank = cached?.hasBlank ?? false;
    const valuesForList = hasBlank ? [EMPTY_FILTER_TOKEN, ...allValues] : allValues;
    const search = (debouncedFilterSearchByColumn[col.id] ?? "").toLowerCase();
    const isLoanNumberColumn = col.id === "loan_number";
    const filteredOptions = search
      ? valuesForList.filter((value) => {
        if (value === EMPTY_FILTER_TOKEN) return "(blank)".includes(search);
        const normalized = value.toLowerCase();
        return isLoanNumberColumn
          ? normalized.startsWith(search)
          : normalized.includes(search);
      })
      : valuesForList;
    const filter = draftFilters[col.id] ?? cloneFilter(appliedFilters[col.id]);
    const selectedValues =
      filter?.kind === "text"
        ? filter.selectedValues
        : filter?.kind === "number" && filter.mode === "all"
          ? filter.selectedValues
          : [];
    const orderedOptions = [...filteredOptions].sort((a, b) => {
      const aSelected = selectedValues.includes(a) ? 1 : 0;
      const bSelected = selectedValues.includes(b) ? 1 : 0;
      if (aSelected !== bSelected) return bSelected - aSelected;
      if (a === EMPTY_FILTER_TOKEN) return -1;
      if (b === EMPTY_FILTER_TOKEN) return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    const displayedOptions = isLoanNumberColumn
      ? orderedOptions.slice(0, LOAN_NUMBER_FILTER_MAX_OPTIONS)
      : orderedOptions;

    if (filterKind === "boolean") {
      const value = filter?.kind === "boolean" ? filter.value : "all";
      return (
        <div className="space-y-2">
          {(["all", "yes", "no"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={value === option ? "default" : "outline"}
              className="w-full justify-start"
              onClick={() => setDraftFilter(col.id, { kind: "boolean", value: option })}
            >
              {option === "all" ? "All" : option === "yes" ? "Yes" : "No"}
            </Button>
          ))}
        </div>
      );
    }

    if (filterKind === "date") {
      const dateFilter = filter?.kind === "date" ? filter : { kind: "date" as const };
      const yearToken = String(new Date().getFullYear());
      const fixedYears = ["2025", "2024", "2023"];
      const dateShortcutOptions: Array<{ token: string; label: string; kind: "preset" | "year" | "ytd" }> = [
        { token: "last-30-days", label: "Last 30 Days", kind: "preset" },
        { token: "mtd", label: "MTD", kind: "preset" },
        { token: "last-month", label: "Last Month", kind: "preset" },
        { token: "ytd", label: `${yearToken} YTD`, kind: "ytd" },
        ...fixedYears.map((y) => ({ token: y, label: y, kind: "year" as const })),
        { token: "rolling-13", label: getPeriodPresetMeta("rolling-13").label, kind: "preset" }, // L13M
        { token: "rolling-12", label: getPeriodPresetMeta("rolling-12").label, kind: "preset" }, // L12M
      ];
      return (
        <div className="space-y-3">
          <Button
            type="button"
            size="sm"
            variant={isDateFilterBlankOnlyShortcut(dateFilter.shortcut) ? "default" : "outline"}
            className="w-full justify-start"
            onClick={() =>
              setDraftFilter(col.id, {
                kind: "date",
                shortcut: DATE_FILTER_BLANK_SHORTCUT,
                from: "",
                to: "",
              })
            }
          >
            {DATE_FILTER_BLANK_LABEL}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={dateFilter.from ?? ""}
              onChange={(e) =>
                setDraftFilter(col.id, { kind: "date", from: e.target.value, to: dateFilter.to, shortcut: undefined })
              }
            />
            <Input
              type="date"
              value={dateFilter.to ?? ""}
              onChange={(e) =>
                setDraftFilter(col.id, { kind: "date", from: dateFilter.from, to: e.target.value, shortcut: undefined })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {dateShortcutOptions.map((opt) => (
              <Button
                key={opt.token}
                type="button"
                size="sm"
                variant={dateFilter.shortcut === opt.token ? "default" : "outline"}
                onClick={() => {
                  if (opt.kind === "year") {
                    const from = `${opt.token}-01-01`;
                    const to = `${opt.token}-12-31`;
                    setDraftFilter(col.id, { kind: "date", shortcut: opt.token, from, to });
                    return;
                  }
                  if (opt.kind === "ytd") {
                    const range = computePresetDateRange("ytd");
                    setDraftFilter(col.id, { kind: "date", shortcut: "ytd", from: range.start, to: range.end });
                    return;
                  }
                  const preset = opt.token as PeriodPreset;
                  const range = computePresetDateRange(preset);
                  setDraftFilter(col.id, { kind: "date", shortcut: opt.token, from: range.start, to: range.end });
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(col.id)}>
            Clear Selection
          </Button>
        </div>
      );
    }

    if (filterKind === "number") {
      const numberFilter = filter?.kind === "number" ? filter : { kind: "number" as const, mode: "all" as NumericFilterMode, selectedValues: [] };
      return (
        <Tabs
          value={numberFilter.mode}
          onValueChange={(mode) => setDraftFilter(col.id, { kind: "number", mode: mode as NumericFilterMode, selectedValues: [] })}
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="range">Range</TabsTrigger>
            <TabsTrigger value="min">Greater Than</TabsTrigger>
            <TabsTrigger value="max">Less Than</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="space-y-2">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder={`Search ${col.label}`}
                value={filterSearchByColumn[col.id] ?? ""}
                onValueChange={(value) => updateFilterSearch(col.id, value)}
              />
              <CommandList>
                <CommandEmpty>No values found.</CommandEmpty>
                {displayedOptions.map((value) => {
                  const isDraftSelected = numberFilter.selectedValues.includes(value);
                  return (
                  <CommandItem
                    key={value}
                    onSelect={() => toggleDraftValue(col.id, value, "number")}
                    className={cn(
                      "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                      isDraftSelected
                        ? "!bg-accent !text-accent-foreground hover:!bg-accent hover:!text-accent-foreground data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                        : "",
                    )}
                  >
                    <span className="mr-2">
                      {isDraftSelected ? "✓" : ""}
                    </span>
                    {value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}
                  </CommandItem>
                )})}
              </CommandList>
            </Command>
            {isLoanNumberColumn && orderedOptions.length > displayedOptions.length && (
              <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
                Showing first {LOAN_NUMBER_FILTER_MAX_OPTIONS} matches. Keep typing to narrow results.
              </p>
            )}
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(col.id)}>
              Clear Selection
            </Button>
          </TabsContent>
          <TabsContent value="range" className="space-y-2">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={numberFilter.min ?? ""}
                onChange={(e) => setDraftFilter(col.id, { kind: "number", mode: "range", selectedValues: [], min: e.target.value, max: numberFilter.max })}
              />
              <span>-</span>
              <Input
                type="number"
                placeholder="Max"
                value={numberFilter.max ?? ""}
                onChange={(e) => setDraftFilter(col.id, { kind: "number", mode: "range", selectedValues: [], min: numberFilter.min, max: e.target.value })}
              />
            </div>
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(col.id)}>
              Clear Selection
            </Button>
          </TabsContent>
          <TabsContent value="min" className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">{">="}</span>
              <Input
                type="number"
                placeholder="Value"
                value={numberFilter.value ?? ""}
                onChange={(e) => setDraftFilter(col.id, { kind: "number", mode: "min", selectedValues: [], value: e.target.value })}
              />
            </div>
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(col.id)}>
              Clear Selection
            </Button>
          </TabsContent>
          <TabsContent value="max" className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">{"<="}</span>
              <Input
                type="number"
                placeholder="Value"
                value={numberFilter.value ?? ""}
                onChange={(e) => setDraftFilter(col.id, { kind: "number", mode: "max", selectedValues: [], value: e.target.value })}
              />
            </div>
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(col.id)}>
              Clear Selection
            </Button>
          </TabsContent>
        </Tabs>
      );
    }

    const textFilter = filter?.kind === "text" ? filter : { kind: "text" as const, selectedValues: [] };
    return (
      <div className="space-y-2">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Search ${col.label}`}
            value={filterSearchByColumn[col.id] ?? ""}
            onValueChange={(value) => updateFilterSearch(col.id, value)}
          />
          <CommandList>
            <CommandEmpty>No values found.</CommandEmpty>
            {displayedOptions.map((value) => {
              const isDraftSelected = textFilter.selectedValues.includes(value);
              return (
              <CommandItem
                key={value}
                onSelect={() => toggleDraftValue(col.id, value, "text")}
                className={cn(
                  "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                  isDraftSelected
                    ? "!bg-accent !text-accent-foreground hover:!bg-accent hover:!text-accent-foreground data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                    : "",
                )}
              >
                <span className="mr-2">{isDraftSelected ? "✓" : ""}</span>
                {value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}
              </CommandItem>
            )})}
          </CommandList>
        </Command>
        {isLoanNumberColumn && orderedOptions.length > displayedOptions.length && (
          <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
            Showing first {LOAN_NUMBER_FILTER_MAX_OPTIONS} matches. Keep typing to narrow results.
          </p>
        )}
        <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(col.id)}>
          Clear Selection
        </Button>
      </div>
    );
  }, [appliedFilters, draftFilters, distinctCache, debouncedFilterSearchByColumn, filterSearchByColumn, setDraftFilter, clearDraftFilter, toggleDraftValue, updateFilterSearch]);

  const getValueToken = useCallback((row: LoanDetailRow, col: ColumnDef): string => {
    const raw = getFilterRawValue(row, col);
    if (getColumnFilterKind(col) === "date" && isLoanDetailDateMissing(raw)) return EMPTY_FILTER_TOKEN;
    if (raw == null || String(raw).trim() === "") return EMPTY_FILTER_TOKEN;
    return String(raw).trim();
  }, [getFilterRawValue]);

  const handleCellClickToDraft = useCallback((row: LoanDetailRow, col: ColumnDef) => {
    const kind = getColumnFilterKind(col);
    const token = getValueToken(row, col);
    setShowFilters(true);
    beginDraft(col.id);
    setOpenFilterColumnId(col.id);

    if (kind === "number") {
      toggleDraftValue(col.id, token, "number");
      return;
    }
    if (kind === "text") {
      toggleDraftValue(col.id, token, "text");
      return;
    }
    if (kind === "boolean") {
      const option = token.toLowerCase() === "yes" ? "yes" : "no";
      setDraftFilters((prev) => {
        const current = prev[col.id];
        const currentValue = current?.kind === "boolean" ? current.value : "all";
        return {
          ...prev,
          [col.id]: { kind: "boolean", value: currentValue === option ? "all" : option },
        };
      });
      return;
    }
    if (token === EMPTY_FILTER_TOKEN) {
      setDraftFilters((prev) => {
        const current = prev[col.id];
        if (current?.kind === "date" && isDateFilterBlankOnlyShortcut(current.shortcut)) {
          return { ...prev, [col.id]: { kind: "date" } };
        }
        return {
          ...prev,
          [col.id]: { kind: "date", shortcut: DATE_FILTER_BLANK_SHORTCUT, from: "", to: "" },
        };
      });
      return;
    }
    setDraftFilters((prev) => {
      const current = prev[col.id];
      const currentFrom = current?.kind === "date" ? current.from : undefined;
      const currentTo = current?.kind === "date" ? current.to : undefined;
      if (currentFrom === token && currentTo === token) {
        return { ...prev, [col.id]: { kind: "date" } };
      }
      return { ...prev, [col.id]: { kind: "date", from: token, to: token, shortcut: undefined } };
    });
  }, [beginDraft, getValueToken, toggleDraftValue]);

  const isCellSelectedByFilter = useCallback((row: LoanDetailRow, col: ColumnDef, filter: ColumnFilter | undefined): boolean => {
    if (!filter || !isFilterActive(filter)) return false;
    const rawValue = getFilterRawValue(row, col);
    const token = getValueToken(row, col);
    if (filter.kind === "text") return matchesAppliedTextFilter(filter, token, rawValue);
    if (filter.kind === "number") return matchesAppliedNumberFilter(filter, token, rawValue);
    if (filter.kind === "date") return matchesAppliedDateFilter(filter, rawValue);
    return matchesAppliedBooleanFilter(filter, rawValue);
  }, [getFilterRawValue, getValueToken]);

  const isCellSelected = useCallback(
    (row: LoanDetailRow, col: ColumnDef): boolean => {
      const draft = draftFilters[col.id];
      if (shouldPreviewDraftOnCells(draft)) {
        return isCellSelectedByFilter(row, col, draft);
      }
      return isCellSelectedByFilter(row, col, appliedFilters[col.id]);
    },
    [appliedFilters, draftFilters, isCellSelectedByFilter],
  );

  const loanDetailVirtualizedRows = useMemo(
    () => (
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
              className={`absolute left-0 border-b ${borderRow} hover:bg-slate-50 dark:hover:bg-slate-800/50 grid items-center`}
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
                const token = getValueToken(row, col);
                const hasFlash =
                  flashState?.columnId === col.id &&
                  flashState.values.includes(token);
                const isSelectedCell = isCellSelected(row, col);
                const cellClass =
                  isAlert
                    ? "font-bold text-red-600 dark:text-red-400"
                    : isFicoLow || isLtvWarning || isDtiWarning
                      ? "text-red-600 dark:text-red-400"
                      : textTd;
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => handleCellClickToDraft(row, col)}
                    className={cn(
                      `whitespace-nowrap py-3 px-4 text-sm text-left ${cellClass}`,
                      isSelectedCell && "bg-emerald-100/60 dark:bg-emerald-900/30",
                      hasFlash && "bg-emerald-100/70 dark:bg-emerald-900/40",
                    )}
                    role="cell"
                  >
                    {display}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    ),
    [
      bodyHeight,
      totalTableWidth,
      gridColsStyle,
      borderRow,
      virtualItems,
      sortedLoans,
      wacFormatted,
      textTd,
      getValueToken,
      flashState,
      isCellSelected,
      handleCellClickToDraft,
      columnsToUse,
    ],
  );

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
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((prev) => !prev)}
              className="gap-2 border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              <Filter className="h-4 w-4" />
              {showFilters ? "Hide Filters" : "Show Filters"}
            </Button>
            {columnsStoreId && (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setLoanDetailColumnsModalOpen(true)}
                className="gap-2 border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Edit Columns
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBookmarksModalOpen(true)}
              className="gap-2 border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              <Bookmark className="h-4 w-4" />
              Bookmarks
            </Button>
            {(selectedBookmark?.name || sharedBookmarkTitle) && (
              <Badge className="bg-sky-600 text-white border-transparent gap-1 pr-1">
                <span>{selectedBookmark?.name ?? sharedBookmarkTitle}</span>
                <button
                  type="button"
                  onClick={clearAppliedBookmarkView}
                  className="rounded-sm p-0.5 hover:bg-sky-500/70"
                  aria-label="Clear applied bookmark filters"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          {!isControlled && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportToExcel}
                disabled={sortedLoans.length === 0}
                className="gap-2 border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              Export to Excel
            </Button>
          )}
        </div>
        </div>
        {(hasActiveFilters || hasBookmarkSelection || sharedBookmarkTitle || isApplyingFilters || filterFeedback) && (
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 border-b border-slate-200/60 dark:border-slate-700/60">
            {hasActiveFilters && activeFilterChips.map((chip) => (
              <Badge key={chip.key} variant="outline" className="gap-1 border-emerald-300/80 bg-emerald-50 text-emerald-700 dark:border-emerald-700/80 dark:bg-emerald-900/30 dark:text-emerald-300">
                <span>{chip.label}</span>
                <button type="button" onClick={chip.onRemove} className="rounded-sm hover:bg-emerald-200/40 dark:hover:bg-emerald-800/50">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {hasActiveFilters && (
              <Button type="button" size="sm" variant="ghost" onClick={clearAllFilters} className="h-7 px-2">
                Clear All Filters
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (selectedBookmark && !bookmarkInSync) {
                  setOverwriteModalOpen(true);
                  return;
                }
                if (selectedBookmark && bookmarkInSync) return;
                setSaveModalInitialName(selectedBookmark?.name ?? "");
                setSaveModalOpen(true);
              }}
              disabled={isApplyingFilters || (selectedBookmark != null && bookmarkInSync)}
              className={cn("h-7 px-3", saveStatusClass)}
            >
              {saveStatusLabel}
            </Button>
            {bookmarksLoading && (
              <div className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading bookmarks...
              </div>
            )}
            {(isApplyingFilters || filterFeedback) && (
              <div className="inline-flex items-center gap-2 text-xs text-slate-900 dark:text-slate-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
                <span>{filterFeedback?.message ?? "Applying filter..."}</span>
              </div>
            )}
          </div>
        )}

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
                    <div
                      key={col.id}
                      className={cn(
                        "whitespace-nowrap py-2 px-2 text-xs font-semibold text-left flex items-center gap-1 w-full min-w-0 hover:bg-slate-200/50 dark:hover:bg-slate-700/50",
                        isDarkMode ? "text-slate-300" : "text-slate-600",
                        activeFilterColumnIds.has(col.id) && "border-b-2 border-emerald-500",
                      )}
                      role="columnheader"
                      aria-sort={isSorted ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(col.id)}
                        className="flex items-center gap-1 min-w-0 flex-1 px-2"
                    >
                      <span className="truncate">{col.label}</span>
                      {isSorted &&
                        (sortDirection === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        ))}
                    </button>
                      {showFilters && (
                        <Popover
                          open={openFilterColumnId === col.id}
                          onOpenChange={(open) => {
                            if (open) {
                              beginDraft(col.id);
                              setOpenFilterColumnId(col.id);
                            } else {
                              closePopoverWithoutDiscard(col.id);
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "inline-flex items-center justify-center rounded p-1",
                                activeFilterColumnIds.has(col.id)
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100",
                              )}
                              aria-label={`Filter ${col.label}`}
                            >
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className={cn(
                              "p-3",
                              getColumnFilterKind(col) === "number" ? "w-[420px]" : "w-80",
                            )}
                            onInteractOutside={(event) => event.preventDefault()}
                            onPointerDownOutside={(event) => event.preventDefault()}
                            onEscapeKeyDown={(event) => event.preventDefault()}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div>
                                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                  {col.label}
                                </div>
                                <div className="text-[11px] text-slate-400 dark:text-slate-500">
                                  Select one or more values from the list below.
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => discardDraft(col.id)}
                                  aria-label={`Cancel ${col.label} filter changes`}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => commitDraft(col.id)}
                                  aria-label={`Apply ${col.label} filter changes`}
                                >
                                  Apply Filters
                                </Button>
                              </div>
                            </div>
                            {renderFilterContent(col)}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
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
              {loanDetailVirtualizedRows}
            </div>
          </div>
        )}

        <div className={`flex items-center justify-between gap-4 px-4 py-3 border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30 ${fillHeight ? "shrink-0" : ""}`}>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {hasActiveFilters
              ? `${filteredCount.toLocaleString()} of ${baseCount.toLocaleString()} loans`
              : `${total.toLocaleString()} loans`}
          </p>
        </div>
      </Card>

      <Dialog open={bookmarksModalOpen} onOpenChange={setBookmarksModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bookmarks</DialogTitle>
            <DialogDescription>Saved Loan Detail filter bookmarks.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto space-y-2">
            {bookmarks.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No bookmarks saved yet.</p>
            ) : (
              bookmarks.map((bookmark) => (
                <div
                  key={bookmark.id}
                  className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    {editingBookmarkId === bookmark.id ? (
                      <Input
                        value={editingBookmarkName}
                        onChange={(e) => setEditingBookmarkName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameBookmark(bookmark.id, editingBookmarkName);
                          if (e.key === "Escape") {
                            setEditingBookmarkId(null);
                            setEditingBookmarkName("");
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{bookmark.name}</p>
                    )}
                    <div className="flex items-center gap-1">
                      {copiedBookmarkState?.id === bookmark.id && (
                        <span
                          className={cn(
                            "text-xs text-slate-600 dark:text-slate-300 mr-1 transition-opacity duration-500",
                            copiedBookmarkState.fading ? "opacity-0" : "opacity-100",
                          )}
                        >
                          Link copied
                        </span>
                      )}
                      <Button type="button" size="sm" variant="outline" onClick={() => applyBookmark(bookmark)}>
                        Apply
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => copyBookmarkLink(bookmark)}
                        aria-label={`Copy link for ${bookmark.name}`}
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                      {editingBookmarkId === bookmark.id ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => handleRenameBookmark(bookmark.id, editingBookmarkName)}
                          aria-label={`Save ${bookmark.name} name`}
                        >
                          <Check className="h-4 w-4 text-emerald-600" />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditingBookmarkId(bookmark.id);
                            setEditingBookmarkName(bookmark.name);
                          }}
                          aria-label={`Rename ${bookmark.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteBookmark(bookmark.id)}
                        aria-label={`Delete ${bookmark.name}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                          </div>
                    </div>
                  <ul className="space-y-1">
                    {summarizeFilterState(bookmark.filters).map((line) => (
                      <li key={`${bookmark.id}-${line}`} className="text-xs text-slate-600 dark:text-slate-400">
                        {line}
                      </li>
                    ))}
                  </ul>
              </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBookmarksModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SaveBookmarkDialog
        open={saveModalOpen}
        onOpenChange={setSaveModalOpen}
        initialName={saveModalInitialName}
        filterSummaryItems={filterSummaryItems}
        onSave={handleCreateBookmark}
      />

      <Dialog open={overwriteModalOpen} onOpenChange={setOverwriteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Bookmark?</DialogTitle>
            <DialogDescription>
              Filters changed from the selected bookmark. Update current bookmark or create a new one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => {
              setOverwriteModalOpen(false);
              setSaveModalOpen(true);
            }}>
              Create New Bookmark
            </Button>
            <Button type="button" onClick={handleOverwriteSelectedBookmark}>
              Update {selectedBookmark?.name ?? "Bookmark"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {columnsStoreId && (
        <LoanDetailColumnsModal
          open={loanDetailColumnsModalOpen}
          onClose={() => setLoanDetailColumnsModalOpen(false)}
          canvasItemId={columnsStoreId}
          tenantId={tenantId}
        />
      )}
    </div>
  );
}

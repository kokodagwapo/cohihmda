import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Download, Filter, X } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  DATE_FILTER_BLANK_LABEL,
  DATE_FILTER_BLANK_SHORTCUT,
  EMPTY_FILTER_TOKEN,
  evaluateLoanDetailFilters,
  isDateFilterBlankOnlyShortcut,
  isFilterActive,
  normalizeFilterState,
  type ColumnFilter,
  type ColumnFilterState,
  type DateColumnFilter,
  type LoanDetailFilterKind,
  type NumberColumnFilter,
  type NumericFilterMode,
  type TextColumnFilter,
} from "@/utils/loanDetailFilters";
import { computePresetDateRange, type PeriodPreset } from "@/components/ui/DatePeriodPicker";

type AggregationType = "average" | "median";
type DayCalcType = "calendar_days" | "business_days";
type SortDirection = "asc" | "desc";
type DrillSortKey = "label" | "activeFiles" | "daysActive";

interface ActiveWorkloadViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

type LoanRecord = {
  loanId: string;
  loanNumber: string;
  channel: string;
  currentMilestone: string;
  loanFolder: string;
  loanType: string;
  loanPurpose: string;
  loanProgram: string;
  applicationDate: string;
  loanEstimateSentDate: string;
  conditionalApprovalDate: string;
  uwFinalApprovalDate: string;
  ctcDate: string;
  estimatedClosingDate: string;
  closingDate: string;
  fundingDate: string;
  currentLoanStatus: string;
  isArchived: boolean;
  investorLockDate: string;
  lockExpirationDate: string;
  lienPosition: string;
  processor: string;
  underwriter: string;
  closer: string;
  brokerLenderName: string;
  loanOfficer: string;
  accountExecutive: string;
  accountManager: string;
  branch: string;
  tpoCompanyName: string;
  investor: string;
  retailBranchId: string;
  retailLo: string;
  originatorLoanOfficerName: string;
  originatorLoanProcessorName: string;
  correspondentSalesRepAE: string;
  correspondentLenderName: string;
  salesRepAE: string;
  warehouseCoName: string;
  warehouseBankName: string;
};

type DrillLevel = "actor" | "loanType" | "loanPurpose";

type DrillRow = {
  id: string;
  parentId: string | null;
  level: DrillLevel;
  label: string;
  activeFiles: number;
  daysActive: number;
};

type DrilldownSlice = {
  actorValues: string[];
  loanTypes: string[];
  loanPurposes: string[];
};

const emptyDrilldownSlice = (): DrilldownSlice => ({ actorValues: [], loanTypes: [], loanPurposes: [] });

type ActiveFilterPill = {
  key: string;
  label: string;
  kind: "milestone" | "drillActor" | "drillType" | "drillPurpose" | "detail";
  columnKey?: string;
  onRemove: () => void;
};
type PillEditorKind = "milestone" | "drillActor" | "drillType" | "drillPurpose" | `detail:${string}` | null;

const ACTOR_OPTIONS = [
  "Channel",
  "Processor",
  "Closer",
  "Underwriter",
  "Loan Officer",
  "Account Executive",
  "Account Manager",
  "Broker Lender Name",
  "Branch",
  "TPO Company Name",
  "Investor",
  "Retail Branch ID",
  "Retail LO",
  "Originator Loan Officer Name",
  "Originator Loan Processor Name",
  "Correspondent Sales Rep/AE",
  "Correspondent Lender Name",
  "Sales Rep/AE",
  "Warehouse Co Name",
  "Warehouse Bank Name",
] as const;

const DATE_COLUMN_KEYS = new Set([
  "applicationDate",
  "loanEstimateSentDate",
  "conditionalApprovalDate",
  "uwFinalApprovalDate",
  "ctcDate",
  "estimatedClosingDate",
  "closingDate",
  "investorLockDate",
  "lockExpirationDate",
]);
const NUMERIC_COLUMN_KEYS = new Set(["daysActive"]);

const toCsvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
};

const downloadCsv = (filename: string, headers: string[], rows: unknown[][]) => {
  const csv = [headers.map(toCsvCell).join(","), ...rows.map((row) => row.map(toCsvCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const calculateBusinessDays = (startIso: string, endDate: Date): number => {
  const start = new Date(startIso);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (start > end) return 0;
  let count = 0;
  // Count weekdays in (start, end] so 4/22 -> 4/29 = 5.
  const current = new Date(start);
  current.setDate(current.getDate() + 1);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count += 1;
    current.setDate(current.getDate() + 1);
  }
  return count;
};

const calculateCalendarDays = (startIso: string, endDate: Date): number => {
  const start = new Date(startIso);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (start > end) return 0;
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
};

const ACTOR_TO_FIELD: Record<(typeof ACTOR_OPTIONS)[number], keyof LoanRecord> = {
  Channel: "channel",
  Processor: "processor",
  Closer: "closer",
  Underwriter: "underwriter",
  "Loan Officer": "loanOfficer",
  "Account Executive": "accountExecutive",
  "Account Manager": "accountManager",
  "Broker Lender Name": "brokerLenderName",
  Branch: "branch",
  "TPO Company Name": "tpoCompanyName",
  Investor: "investor",
  "Retail Branch ID": "retailBranchId",
  "Retail LO": "retailLo",
  "Originator Loan Officer Name": "originatorLoanOfficerName",
  "Originator Loan Processor Name": "originatorLoanProcessorName",
  "Correspondent Sales Rep/AE": "correspondentSalesRepAE",
  "Correspondent Lender Name": "correspondentLenderName",
  "Sales Rep/AE": "salesRepAE",
  "Warehouse Co Name": "warehouseCoName",
  "Warehouse Bank Name": "warehouseBankName",
};

const toText = (value: unknown) => (value == null || String(value).trim() === "" ? "Unknown" : String(value).trim());
const hasDateValue = (value: unknown): boolean => value != null && String(value).trim() !== "";
const isArchivedFlag = (value: unknown): boolean => {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
};
const formatDateOnly = (value: string): string => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "-";
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed.slice(0, 10);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${month}/${day}/${year}`;
};

const STORAGE_PREFIX = "cohi-active-workload-view-state:";
const pillBadgeTriggerClass =
  "inline-flex max-w-[min(340px,calc(100vw-6rem))] cursor-pointer items-center gap-1 rounded-full border border-blue-200/80 bg-white px-2.5 py-0.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80";

function ActiveWorkloadStringFilterPopover({
  title,
  open,
  onOpenChange,
  trigger,
  options,
  draftSelected,
  onToggleDraftValue,
  onApply,
  onClearSelection,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  options: string[];
  draftSelected: string[];
  onToggleDraftValue: (value: string) => void;
  onApply: () => void;
  onClearSelection: () => void;
}) {
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const q = search.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const ordered = [...filtered].sort((a, b) => {
    const asel = draftSelected.includes(a) ? 1 : 0;
    const bsel = draftSelected.includes(b) ? 1 : 0;
    if (asel !== bsel) return bsel - asel;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-3"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 pr-2">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{title}</div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">Select one or more values from the list below.</div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                onApply();
                onOpenChange(false);
              }}
            >
              Apply Filters
            </Button>
          </div>
        </div>
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Search ${title}`} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No values found.</CommandEmpty>
            {ordered.map((value) => {
              const sel = draftSelected.includes(value);
              return (
                <CommandItem
                  key={value}
                  value={value}
                  onSelect={() => onToggleDraftValue(value)}
                  className={cn(
                    "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                    sel
                      ? "!bg-accent !text-accent-foreground hover:!bg-accent data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                      : "",
                  )}
                >
                  <span className="mr-2">{sel ? "✓" : ""}</span>
                  {value}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
        <Button type="button" size="sm" variant="ghost" className="mt-2 w-full" onClick={onClearSelection}>
          Clear Selection
        </Button>
      </PopoverContent>
    </Popover>
  );
}

const normalizeLoan = (row: Record<string, unknown>): LoanRecord | null => {
  const applicationDate = (row.application_date as string | null) ?? null;
  if (!hasDateValue(applicationDate)) return null;
  return {
    loanId: toText(row.loan_id),
    loanNumber: toText(row.loan_number ?? row.loan_id),
    channel: toText(row.channel),
    currentMilestone: toText(row.current_milestone),
    loanFolder: toText(row.loan_folder),
    loanType: toText(row.loan_type),
    loanPurpose: toText(row.loan_purpose),
    loanProgram: toText(row.loan_program),
    applicationDate: String(applicationDate).trim(),
    loanEstimateSentDate: String(row.loan_estimate_sent_date ?? ""),
    conditionalApprovalDate: String(row.conditional_approval_date ?? ""),
    uwFinalApprovalDate: String(row.uw_final_approval_date ?? ""),
    ctcDate: String(row.ctc_date ?? ""),
    estimatedClosingDate: String(row.estimated_closing_date ?? ""),
    closingDate: String(row.closing_date ?? ""),
    fundingDate: String(row.funding_date ?? ""),
    currentLoanStatus: toText(row.current_loan_status),
    isArchived: isArchivedFlag(row.is_archived),
    investorLockDate: String(row.investor_lock_date ?? ""),
    lockExpirationDate: String(row.lock_expiration_date ?? ""),
    lienPosition: toText(row.lien_position),
    processor: toText(row.processor),
    underwriter: toText(row.underwriter),
    closer: toText(row.closer),
    brokerLenderName: toText(row.broker_lender_name),
    loanOfficer: toText(row.loan_officer),
    accountExecutive: toText(row.account_executive),
    accountManager: toText(row.account_manager),
    branch: toText(row.branch),
    tpoCompanyName: toText(row.tpo_company_name),
    investor: toText(row.investor),
    retailBranchId: toText(row.retail_branch_id),
    retailLo: toText(row.retail_lo),
    originatorLoanOfficerName: toText(row.originator_loan_officer_name),
    originatorLoanProcessorName: toText(row.originator_loan_processor_name),
    correspondentSalesRepAE: toText(row.correspondent_sales_rep_ae),
    correspondentLenderName: toText(row.correspondent_lender_name),
    salesRepAE: toText(row.sales_rep_ae),
    warehouseCoName: toText(row.warehouse_co_name),
    warehouseBankName: toText(row.warehouse_bank_name),
  };
};

export function ActiveWorkloadView({ selectedTenantId, selectedChannel }: ActiveWorkloadViewProps) {
  const [actor, setActor] = useState<(typeof ACTOR_OPTIONS)[number]>("Processor");
  const [aggregation, setAggregation] = useState<AggregationType>("average");
  const [dayCalcType, setDayCalcType] = useState<DayCalcType>("calendar_days");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sliceMilestones, setSliceMilestones] = useState<string[]>([]);
  const [sliceDrilldown, setSliceDrilldown] = useState<DrilldownSlice>(emptyDrilldownSlice());
  const [showDetailColumnFilters, setShowDetailColumnFilters] = useState(false);
  const [openDetailFilterColumnId, setOpenDetailFilterColumnId] = useState<string | null>(null);
  const [pillEditor, setPillEditor] = useState<PillEditorKind>(null);
  const [appliedDetailFilters, setAppliedDetailFilters] = useState<ColumnFilterState>({});
  const [draftDetailFilters, setDraftDetailFilters] = useState<ColumnFilterState>({});
  const [draftMilestoneSlice, setDraftMilestoneSlice] = useState<string[]>([]);
  const [draftDrilldownSlice, setDraftDrilldownSlice] = useState<DrilldownSlice>(emptyDrilldownSlice());
  const [filterSearchByColumn, setFilterSearchByColumn] = useState<Record<string, string>>({});
  const [sourceRows, setSourceRows] = useState<LoanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suppressNextChartClickRef = useRef(false);
  const [detailSort, setDetailSort] = useState<{ key: keyof LoanRecord | "daysActive"; direction: SortDirection }>({
    key: "applicationDate",
    direction: "asc",
  });
  const [drillSort, setDrillSort] = useState<{ key: DrillSortKey; direction: SortDirection }>({
    key: "activeFiles",
    direction: "desc",
  });
  const [renderStage, setRenderStage] = useState<"kpi" | "charts" | "detail">("kpi");
  const [detailRowsRenderLimit, setDetailRowsRenderLimit] = useState(250);
  const detailTableScrollRef = useRef<HTMLDivElement | null>(null);

  const isTpoTenant = (selectedChannel ?? "").toLowerCase().includes("tpo");
  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}${selectedTenantId ?? "none"}:${selectedChannel ?? "All"}`,
    [selectedTenantId, selectedChannel],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        actor?: (typeof ACTOR_OPTIONS)[number];
        aggregation?: AggregationType;
        dayCalcType?: DayCalcType;
        sliceMilestones?: string[];
        sliceDrilldown?: DrilldownSlice;
        appliedDetailFilters?: ColumnFilterState;
        showDetailColumnFilters?: boolean;
        detailSort?: { key: keyof LoanRecord | "daysActive"; direction: SortDirection };
      };
      if (parsed.actor && ACTOR_OPTIONS.includes(parsed.actor)) setActor(parsed.actor);
      if (parsed.aggregation === "average" || parsed.aggregation === "median") setAggregation(parsed.aggregation);
      if (parsed.dayCalcType === "calendar_days" || parsed.dayCalcType === "business_days") setDayCalcType(parsed.dayCalcType);
      setSliceMilestones(Array.isArray(parsed.sliceMilestones) ? parsed.sliceMilestones : []);
      setSliceDrilldown(parsed.sliceDrilldown ?? emptyDrilldownSlice());
      setAppliedDetailFilters(parsed.appliedDetailFilters ?? {});
      setShowDetailColumnFilters(Boolean(parsed.showDetailColumnFilters));
      if (parsed.detailSort) setDetailSort(parsed.detailSort);
    } catch {
      // Ignore invalid persisted data.
    }
  }, [storageKey]);

  useEffect(() => {
    const payload = {
      actor,
      aggregation,
      dayCalcType,
      sliceMilestones,
      sliceDrilldown,
      appliedDetailFilters,
      showDetailColumnFilters,
      detailSort,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [
    storageKey,
    actor,
    aggregation,
    dayCalcType,
    sliceMilestones,
    sliceDrilldown,
    appliedDetailFilters,
    showDetailColumnFilters,
    detailSort,
  ]);

  useEffect(() => {
    if (!selectedTenantId) {
      setSourceRows([]);
      return;
    }
    let active = true;
    const fetchLoans = async () => {
      setLoading(true);
      setError(null);
      try {
        const limit = 5000;
        let offset = 0;
        let total = 0;
        const all: LoanRecord[] = [];
        do {
          const params = new URLSearchParams();
          params.set("tenant_id", selectedTenantId);
          params.set("limit", String(limit));
          params.set("offset", String(offset));
          if (selectedChannel && selectedChannel !== "All") params.set("channel_group", selectedChannel);
          const response = await api.request<{ loans: Array<Record<string, unknown>>; total: number }>(
            `/api/loans/active-detail-list?${params.toString()}`,
          );
          total = response.total ?? 0;
          all.push(...(response.loans ?? []).map(normalizeLoan).filter((row): row is LoanRecord => row != null));
          offset += limit;
          if (!active) return;
        } while (offset < total);
        if (active) setSourceRows(all);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load active workload data.");
        setSourceRows([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchLoans();
    return () => {
      active = false;
    };
  }, [selectedTenantId, selectedChannel]);

  const now = new Date();
  const dayDiff = (appDate: string) =>
    dayCalcType === "business_days" ? calculateBusinessDays(appDate, now) : calculateCalendarDays(appDate, now);

  // Canonical active-loan formula (same definition used by Active Loans KPI):
  // current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND is_archived IS DISTINCT FROM TRUE.
  const isCanonicalActiveLoan = (loan: LoanRecord) =>
    loan.currentLoanStatus.trim().toUpperCase() === "ACTIVE LOAN" &&
    hasDateValue(loan.applicationDate) &&
    !loan.isArchived;

  const activeLoans = useMemo(() => {
    return sourceRows
      .filter(isCanonicalActiveLoan)
      .map((loan) => ({ ...loan, daysActive: dayDiff(loan.applicationDate) }));
  }, [sourceRows, dayCalcType]);

  const getCellDisplayValue = useMemo(
    () =>
      (loan: LoanRecord & { daysActive?: number }, key: keyof LoanRecord | "daysActive"): string => {
        if (key === "daysActive") return String(Math.round(Number(loan.daysActive ?? 0)));
        const raw = String(loan[key] ?? "");
        if (DATE_COLUMN_KEYS.has(String(key))) return formatDateOnly(raw);
        return raw.trim() || "Unknown";
      },
    [],
  );

  const getFilterKindForColumn = (key: keyof LoanRecord | "daysActive"): LoanDetailFilterKind => {
    if (NUMERIC_COLUMN_KEYS.has(String(key))) return "number";
    if (DATE_COLUMN_KEYS.has(String(key))) return "date";
    return "text";
  };

  const getFilterRawValue = (loan: LoanRecord & { daysActive?: number }, key: keyof LoanRecord | "daysActive"): unknown => {
    if (key === "daysActive") return loan.daysActive ?? 0;
    return loan[key];
  };

  const cloneFilter = (filter: ColumnFilter | undefined): ColumnFilter | undefined => {
    if (!filter) return undefined;
    if (filter.kind === "text") return { kind: "text", selectedValues: [...filter.selectedValues] };
    if (filter.kind === "number") {
      return {
        kind: "number",
        mode: filter.mode,
        selectedValues: [...filter.selectedValues],
        min: filter.min,
        max: filter.max,
        value: filter.value,
      };
    }
    if (filter.kind === "date") return { kind: "date", from: filter.from, to: filter.to, shortcut: filter.shortcut };
    return { kind: "boolean", value: filter.value };
  };

  const arraysEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  const drilldownEqual = (a: DrilldownSlice, b: DrilldownSlice) =>
    arraysEqual(a.actorValues, b.actorValues) &&
    arraysEqual(a.loanTypes, b.loanTypes) &&
    arraysEqual(a.loanPurposes, b.loanPurposes);
  const extractSharedValuesFromFilter = (filter: ColumnFilter | undefined): string[] => {
    if (!filter || !isFilterActive(filter)) return [];
    if (filter.kind === "text") {
      return filter.selectedValues.filter((v) => v !== EMPTY_FILTER_TOKEN);
    }
    if (filter.kind === "number" && filter.mode === "all") {
      return [...filter.selectedValues];
    }
    return [];
  };

  useEffect(() => {
    const actorColumnId = String(ACTOR_TO_FIELD[actor]);
    const normalized = normalizeFilterState(appliedDetailFilters);
    const nextDetail: ColumnFilterState = { ...normalized };
    let detailChanged = false;
    let nextMilestones: string[] | null = null;
    let nextDrilldown: DrilldownSlice | null = null;

    const milestoneValues = extractSharedValuesFromFilter(nextDetail.currentMilestone);
    if (milestoneValues.length > 0) {
      nextMilestones = milestoneValues;
      delete nextDetail.currentMilestone;
      detailChanged = true;
    }

    const actorValues = extractSharedValuesFromFilter(nextDetail[actorColumnId]);
    if (actorValues.length > 0) {
      nextDrilldown = { actorValues, loanTypes: [], loanPurposes: [] };
      delete nextDetail[actorColumnId];
      detailChanged = true;
    } else {
      const loanTypeValues = extractSharedValuesFromFilter(nextDetail.loanType);
      if (loanTypeValues.length > 0) {
        nextDrilldown = { actorValues: [], loanTypes: loanTypeValues, loanPurposes: [] };
        delete nextDetail.loanType;
        detailChanged = true;
      } else {
        const loanPurposeValues = extractSharedValuesFromFilter(nextDetail.loanPurpose);
        if (loanPurposeValues.length > 0) {
          nextDrilldown = { actorValues: [], loanTypes: [], loanPurposes: loanPurposeValues };
          delete nextDetail.loanPurpose;
          detailChanged = true;
        }
      }
    }

    if (nextMilestones && !arraysEqual(nextMilestones, sliceMilestones)) {
      setSliceMilestones(nextMilestones);
    }
    if (nextDrilldown && !drilldownEqual(nextDrilldown, sliceDrilldown)) {
      setSliceDrilldown(nextDrilldown);
    }
    if (detailChanged) {
      setAppliedDetailFilters(nextDetail);
    }
  }, [actor, appliedDetailFilters, sliceMilestones, sliceDrilldown]);

  const toggleMilestoneSlice = (milestone: string) => {
    if (!milestone) return;
    setSliceMilestones((prev) => (prev.includes(milestone) ? prev.filter((v) => v !== milestone) : [...prev, milestone]));
  };

  const handleMilestoneChartClick = (state: unknown) => {
    if (suppressNextChartClickRef.current) {
      suppressNextChartClickRef.current = false;
      return;
    }
    const activeLabel =
      typeof state === "object" && state != null && "activeLabel" in state
        ? String((state as { activeLabel?: string }).activeLabel ?? "")
        : "";
    if (activeLabel) toggleMilestoneSlice(activeLabel);
  };

  const handleMilestoneBarClick = (data: unknown, index?: number) => {
    suppressNextChartClickRef.current = true;
    const fromPayload =
      typeof data === "object" && data != null
        ? String(
            (data as { payload?: { name?: string }; name?: string }).payload?.name ??
              (data as { payload?: { name?: string }; name?: string }).name ??
              "",
          )
        : "";
    if (fromPayload) {
      toggleMilestoneSlice(fromPayload);
      return;
    }
    if (typeof index === "number") {
      const row = milestoneData[index];
      if (row?.name) toggleMilestoneSlice(row.name);
    }
  };

  const milestoneTick = (props: { x?: number; y?: number; payload?: { value?: string } }) => {
    const value = String(props.payload?.value ?? "");
    const maxCharsPerLine = 28;
    const words = value.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        currentLine = candidate;
      } else if (!currentLine) {
        lines.push(word.slice(0, maxCharsPerLine));
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    const safeLines = lines.length > 0 ? lines : [value];
    return (
      <g transform={`translate(${props.x ?? 0},${props.y ?? 0})`}>
        <text
          x={-8}
          y={0}
          dy={safeLines.length > 1 ? -(safeLines.length - 1) * 6 : 4}
          textAnchor="end"
          className="fill-slate-700 dark:fill-slate-300"
          style={{ cursor: "pointer" }}
          onClick={() => toggleMilestoneSlice(value)}
        >
          {safeLines.map((line, index) => (
            <tspan key={`${line}-${index}`} x={-8} dy={index === 0 ? 0 : 12}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  };

  const toggleDrilldownSlice = (row: DrillRow) => {
    setSliceDrilldown((prev) => {
      if (row.level === "actor") {
        return prev.actorValues.length === 1 && prev.actorValues[0] === row.label
          ? emptyDrilldownSlice()
          : { actorValues: [row.label], loanTypes: [], loanPurposes: [] };
      }
      if (row.level === "loanType") {
        return prev.loanTypes.length === 1 && prev.loanTypes[0] === row.label
          ? emptyDrilldownSlice()
          : { actorValues: [], loanTypes: [row.label], loanPurposes: [] };
      }
      return prev.loanPurposes.length === 1 && prev.loanPurposes[0] === row.label
        ? emptyDrilldownSlice()
        : { actorValues: [], loanTypes: [], loanPurposes: [row.label] };
    });
  };

  const loansAfterSliceFilters = useMemo(() => {
    return activeLoans.filter((loan) => {
      if (sliceMilestones.length > 0 && !sliceMilestones.includes(loan.currentMilestone)) return false;
      const actorValue = String(loan[ACTOR_TO_FIELD[actor]] ?? "Unknown");
      if (sliceDrilldown.actorValues.length > 0 && !sliceDrilldown.actorValues.includes(actorValue)) return false;
      if (sliceDrilldown.loanTypes.length > 0 && !sliceDrilldown.loanTypes.includes(loan.loanType)) return false;
      if (sliceDrilldown.loanPurposes.length > 0 && !sliceDrilldown.loanPurposes.includes(loan.loanPurpose)) return false;
      return true;
    });
  }, [activeLoans, sliceMilestones, sliceDrilldown, actor]);

  const filteredActiveLoans = useMemo(
    () => evaluateLoanDetailFilters(loansAfterSliceFilters, appliedDetailFilters, (loan, columnId) => getFilterRawValue(loan, columnId as keyof LoanRecord | "daysActive")),
    [loansAfterSliceFilters, appliedDetailFilters],
  );

  useEffect(() => {
    setRenderStage("kpi");
    const frameId = window.requestAnimationFrame(() => setRenderStage("charts"));
    const timeoutId = window.setTimeout(() => setRenderStage("detail"), 80);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [filteredActiveLoans, detailSort, actor, aggregation, dayCalcType]);

  const aggregateDays = (days: number[]) => {
    if (days.length === 0) return 0;
    if (aggregation === "median") return median(days);
    return days.reduce((sum, value) => sum + value, 0) / days.length;
  };

  const kpis = useMemo(() => {
    const days = filteredActiveLoans.map((loan) => loan.daysActive);
    return {
      activeFiles: filteredActiveLoans.length,
      daysActive: aggregateDays(days),
    };
  }, [filteredActiveLoans, aggregation]);

  const drillRows = useMemo<DrillRow[]>(() => {
    if (renderStage === "kpi") return [];
    const actorField = ACTOR_TO_FIELD[actor];
    const rows: DrillRow[] = [];
    const group = new Map<string, typeof filteredActiveLoans>();

    for (const loan of filteredActiveLoans) {
      const actorValue = String(loan[actorField] ?? "Unknown");
      const list = group.get(actorValue) ?? [];
      list.push(loan);
      group.set(actorValue, list);
    }

    for (const [actorName, actorLoans] of group.entries()) {
      const actorId = `actor:${actorName}`;
      rows.push({
        id: actorId,
        parentId: null,
        level: "actor",
        label: actorName,
        activeFiles: actorLoans.length,
        daysActive: aggregateDays(actorLoans.map((loan) => loan.daysActive)),
      });

      const typeMap = new Map<string, typeof actorLoans>();
      for (const loan of actorLoans) {
        const list = typeMap.get(loan.loanType) ?? [];
        list.push(loan);
        typeMap.set(loan.loanType, list);
      }

      for (const [loanType, typeLoans] of typeMap.entries()) {
        const typeId = `${actorId}|type:${loanType}`;
        rows.push({
          id: typeId,
          parentId: actorId,
          level: "loanType",
          label: loanType,
          activeFiles: typeLoans.length,
          daysActive: aggregateDays(typeLoans.map((loan) => loan.daysActive)),
        });

        const purposeMap = new Map<string, typeof typeLoans>();
        for (const loan of typeLoans) {
          const list = purposeMap.get(loan.loanPurpose) ?? [];
          list.push(loan);
          purposeMap.set(loan.loanPurpose, list);
        }

        for (const [purpose, purposeLoans] of purposeMap.entries()) {
          rows.push({
            id: `${typeId}|purpose:${purpose}`,
            parentId: typeId,
            level: "loanPurpose",
            label: purpose,
            activeFiles: purposeLoans.length,
            daysActive: aggregateDays(purposeLoans.map((loan) => loan.daysActive)),
          });
        }
      }
    }
    return rows;
  }, [filteredActiveLoans, actor, aggregation, renderStage]);

  const drillRowsByParent = useMemo(() => {
    const map = new Map<string | null, DrillRow[]>();
    for (const row of drillRows) {
      const list = map.get(row.parentId) ?? [];
      list.push(row);
      map.set(row.parentId, list);
    }
    // Keep deterministic ordering within each sibling group.
    const sortDirection = drillSort.direction === "asc" ? 1 : -1;
    for (const [parentId, siblings] of map.entries()) {
      map.set(
        parentId,
        [...siblings].sort((a, b) => {
          if (drillSort.key === "label") {
            const cmp = a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
            if (cmp !== 0) return cmp * sortDirection;
            if (b.activeFiles !== a.activeFiles) return b.activeFiles - a.activeFiles;
            return a.daysActive - b.daysActive;
          }
          if (drillSort.key === "activeFiles") {
            const cmp = (a.activeFiles - b.activeFiles) * sortDirection;
            if (cmp !== 0) return cmp;
            const labelCmp = a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
            if (labelCmp !== 0) return labelCmp;
            return a.daysActive - b.daysActive;
          }
          const cmp = (a.daysActive - b.daysActive) * sortDirection;
          if (cmp !== 0) return cmp;
          const labelCmp = a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
          if (labelCmp !== 0) return labelCmp;
          return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
        }),
      );
    }
    return map;
  }, [drillRows, drillSort]);

  const visibleDrillRows = useMemo(() => {
    const out: DrillRow[] = [];
    const walk = (parentId: string | null) => {
      const children = drillRowsByParent.get(parentId) ?? [];
      children.forEach((child) => {
        out.push(child);
        if (expanded.has(child.id)) walk(child.id);
      });
    };
    walk(null);
    return out;
  }, [drillRowsByParent, expanded]);

  const milestoneData = useMemo(() => {
    if (renderStage === "kpi") return [];
    const byMilestone = new Map<string, number[]>();
    for (const loan of filteredActiveLoans) {
      const list = byMilestone.get(loan.currentMilestone) ?? [];
      list.push(loan.daysActive);
      byMilestone.set(loan.currentMilestone, list);
    }
    return [...byMilestone.entries()].map(([name, days]) => ({
      name,
      activeFiles: days.length,
      daysActive: aggregateDays(days),
    }));
  }, [filteredActiveLoans, aggregation, renderStage]);
  const milestoneAxisWidth = useMemo(() => {
    const longest = milestoneData.reduce((max, row) => Math.max(max, row.name.length), 0);
    return Math.min(360, Math.max(140, longest * 8 + 28));
  }, [milestoneData]);

  const sortedDetailRows = useMemo(() => {
    if (renderStage !== "detail") return [];
    const dir = detailSort.direction === "asc" ? 1 : -1;
    return [...filteredActiveLoans].sort((a, b) => {
      const av = detailSort.key === "daysActive" ? a.daysActive : a[detailSort.key];
      const bv = detailSort.key === "daysActive" ? b.daysActive : b[detailSort.key];
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
      return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { sensitivity: "base" }) * dir;
    });
  }, [filteredActiveLoans, detailSort, renderStage]);
  const visibleDetailRows = useMemo(
    () => sortedDetailRows.slice(0, detailRowsRenderLimit),
    [sortedDetailRows, detailRowsRenderLimit],
  );

  useEffect(() => {
    setDetailRowsRenderLimit(250);
  }, [sortedDetailRows]);

  const loadMoreDetailRows = useCallback(() => {
    setDetailRowsRenderLimit((prev) =>
      Math.min(sortedDetailRows.length, prev + 250),
    );
  }, [sortedDetailRows.length]);

  const handleDetailTableScroll = useCallback(() => {
    const el = detailTableScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 180;
    if (nearBottom && detailRowsRenderLimit < sortedDetailRows.length) {
      loadMoreDetailRows();
    }
  }, [detailRowsRenderLimit, sortedDetailRows.length, loadMoreDetailRows]);

  const toggleSort = (key: keyof LoanRecord | "daysActive") => {
    setDetailSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const SortIcon = ({ columnKey }: { columnKey: keyof LoanRecord | "daysActive" }) => {
    if (detailSort.key !== columnKey) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
    return detailSort.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  const toggleDrillSort = (key: DrillSortKey) => {
    setDrillSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: key === "label" ? "asc" : "desc" };
    });
  };

  const DrillSortIcon = ({ columnKey }: { columnKey: DrillSortKey }) => {
    if (drillSort.key !== columnKey) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
    return drillSort.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  const actorRowIds = useMemo(() => drillRows.filter((r) => r.level === "actor").map((r) => r.id), [drillRows]);
  const loanTypeRowIds = useMemo(() => drillRows.filter((r) => r.level === "loanType").map((r) => r.id), [drillRows]);
  const drilldownTotals = useMemo(() => {
    const topLevel = drillRows.filter((row) => row.parentId === null);
    if (topLevel.length === 0) return null;
    const activeFiles = topLevel.reduce((sum, row) => sum + row.activeFiles, 0);
    const weightedDays =
      activeFiles > 0
        ? topLevel.reduce((sum, row) => sum + row.daysActive * row.activeFiles, 0) / activeFiles
        : 0;
    return { activeFiles, daysActive: weightedDays };
  }, [drillRows]);

  const detailColumns = useMemo(
    () =>
      [
        { key: "loanNumber", label: "Loan Number" },
        { key: "channel", label: "Channel" },
        { key: "currentMilestone", label: "Current Milestone" },
        { key: "loanFolder", label: "Loan Folder" },
        { key: "daysActive", label: `${aggregation === "average" ? "Average" : "Median"} Days Active` },
        { key: "loanType", label: "Loan Type" },
        { key: "loanPurpose", label: "Loan Purpose" },
        { key: "loanProgram", label: "Loan Program" },
        { key: "applicationDate", label: "Application Date" },
        { key: "loanEstimateSentDate", label: "Loan Estimate Sent Date" },
        { key: "conditionalApprovalDate", label: "Conditional Approval Date" },
        { key: "uwFinalApprovalDate", label: "UW Final Approval Date" },
        { key: "ctcDate", label: "CTC Date" },
        { key: "estimatedClosingDate", label: "Estimated Closing Date" },
        { key: "closingDate", label: "Closing Date" },
        { key: "investorLockDate", label: "Investor Lock Date" },
        { key: "lockExpirationDate", label: "Lock Expiration Date" },
        { key: "lienPosition", label: "Lien Position" },
        { key: "processor", label: "Processor" },
        { key: "underwriter", label: "Underwriter" },
        { key: "closer", label: "Closer" },
        ...(isTpoTenant
          ? [
              { key: "brokerLenderName", label: "Broker Lender Name" },
              { key: "accountExecutive", label: "Account Executive" },
              { key: "originatorLoanOfficerName", label: "Originator Loan Officer Name" },
              { key: "salesRepAE", label: "Sales Rep/AE" },
            ]
          : []),
        { key: "loanOfficer", label: "Loan Officer" },
      ] as Array<{ key: keyof LoanRecord | "daysActive"; label: string }>,
    [aggregation, isTpoTenant],
  );

  const detailFilterOptionsByColumn = useMemo(() => {
    const detailFilterUiActive =
      openDetailFilterColumnId != null ||
      (typeof pillEditor === "string" && pillEditor.startsWith("detail:"));
    if (!detailFilterUiActive) return {};
    const map: Record<string, string[]> = {};
    const actorFieldKey = String(ACTOR_TO_FIELD[actor]);
    const actorField = ACTOR_TO_FIELD[actor];

    const matchesSlices = (
      loan: LoanRecord & { daysActive?: number },
      ignored: "milestone" | "actor" | "loanType" | "loanPurpose" | null,
    ) => {
      if (ignored !== "milestone" && sliceMilestones.length > 0 && !sliceMilestones.includes(loan.currentMilestone)) {
        return false;
      }
      const actorValue = String(loan[actorField] ?? "Unknown");
      if (ignored !== "actor" && sliceDrilldown.actorValues.length > 0 && !sliceDrilldown.actorValues.includes(actorValue)) {
        return false;
      }
      if (ignored !== "loanType" && sliceDrilldown.loanTypes.length > 0 && !sliceDrilldown.loanTypes.includes(loan.loanType)) {
        return false;
      }
      if (ignored !== "loanPurpose" && sliceDrilldown.loanPurposes.length > 0 && !sliceDrilldown.loanPurposes.includes(loan.loanPurpose)) {
        return false;
      }
      return true;
    };

    for (const col of detailColumns) {
      const colKey = String(col.key);
      const ignored =
        colKey === "currentMilestone"
          ? "milestone"
          : colKey === actorFieldKey
            ? "actor"
            : colKey === "loanType"
              ? "loanType"
              : colKey === "loanPurpose"
                ? "loanPurpose"
                : null;
      const values = new Set<string>();
      const optionSource = ignored
        ? activeLoans.filter((loan) => matchesSlices(loan, ignored))
        : loansAfterSliceFilters;
      for (const loan of optionSource) {
        values.add(getCellDisplayValue(loan, col.key));
      }
      map[col.key] = [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    }
    return map;
  }, [detailColumns, activeLoans, loansAfterSliceFilters, getCellDisplayValue, actor, sliceMilestones, sliceDrilldown, openDetailFilterColumnId, pillEditor]);

  const toggleDraftValue = (columnId: string, value: string, kind: "text" | "number") => {
    setDraftDetailFilters((prev) => {
      const current = prev[columnId];
      if (kind === "number") {
        const filter: NumberColumnFilter =
          current?.kind === "number" ? current : { kind: "number", mode: "all", selectedValues: [] };
        const selectedValues = filter.selectedValues.includes(value)
          ? filter.selectedValues.filter((v) => v !== value)
          : [...filter.selectedValues, value];
        return { ...prev, [columnId]: { ...filter, mode: "all", selectedValues } };
      }
      const filter: TextColumnFilter = current?.kind === "text" ? current : { kind: "text", selectedValues: [] };
      const selectedValues = filter.selectedValues.includes(value)
        ? filter.selectedValues.filter((v) => v !== value)
        : [...filter.selectedValues, value];
      return { ...prev, [columnId]: { kind: "text", selectedValues } };
    });
  };

  const clearDraftFilter = (columnId: string) => {
    setDraftDetailFilters((prev) => {
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  };

  const applyDraftFilter = (columnId: string) => {
    const actorColumnId = String(ACTOR_TO_FIELD[actor]);
    const draft = draftDetailFilters[columnId];
    const hasActiveDraft = Boolean(draft && isFilterActive(draft));

    setAppliedDetailFilters((prev) => {
      const next = { ...prev };
      if (hasActiveDraft && draft) next[columnId] = draft;
      else delete next[columnId];
      return next;
    });

    // Shared dimensions are promoted to slice filters. When the detail-popover
    // draft is cleared and applied, clear the linked slice filter too.
    if (!hasActiveDraft) {
      if (columnId === "currentMilestone") {
        setSliceMilestones([]);
      } else if (
        columnId === actorColumnId ||
        columnId === "loanType" ||
        columnId === "loanPurpose"
      ) {
        setSliceDrilldown(emptyDrilldownSlice());
      }
    }
  };

  const getLinkedColumnFilter = (columnId: string): ColumnFilter | undefined => {
    if (columnId === "currentMilestone" && sliceMilestones.length > 0) {
      return { kind: "text", selectedValues: [...sliceMilestones] };
    }
    const actorColumnId = String(ACTOR_TO_FIELD[actor]);
    if (columnId === actorColumnId && sliceDrilldown.actorValues.length > 0) {
      return { kind: "text", selectedValues: [...sliceDrilldown.actorValues] };
    }
    if (columnId === "loanType" && sliceDrilldown.loanTypes.length > 0) {
      return { kind: "text", selectedValues: [...sliceDrilldown.loanTypes] };
    }
    if (columnId === "loanPurpose" && sliceDrilldown.loanPurposes.length > 0) {
      return { kind: "text", selectedValues: [...sliceDrilldown.loanPurposes] };
    }
    return undefined;
  };

  const getEffectiveColumnFilter = (columnId: string): ColumnFilter | undefined =>
    cloneFilter(appliedDetailFilters[columnId]) ?? getLinkedColumnFilter(columnId);

  const summarizeSelectedValues = (label: string, values: string[], listWhenLessThan: number): string =>
    `${label}: ${values.length < listWhenLessThan ? values.join(", ") : `${values.length} selected`}`;

  const summarizeFilter = (columnId: string, filter: ColumnFilter): string => {
    const label = detailColumns.find((c) => String(c.key) === columnId)?.label ?? columnId;
    if (filter.kind === "date") {
      if (isDateFilterBlankOnlyShortcut(filter.shortcut)) return `${label}: ${DATE_FILTER_BLANK_LABEL}`;
      return `${label}: ${filter.shortcut || `${filter.from || ""} to ${filter.to || ""}`}`;
    }
    if (filter.kind === "number") {
      if (filter.mode === "all") return summarizeSelectedValues(label, filter.selectedValues, 5);
      if (filter.mode === "range") return `${label}: ${filter.min || ""} - ${filter.max || ""}`;
      return `${label}: ${filter.mode === "min" ? ">=" : "<="} ${filter.value || ""}`;
    }
    if (filter.kind === "text") return summarizeSelectedValues(label, filter.selectedValues, 5);
    return `${label}: ${filter.value}`;
  };

  const milestoneOptions = useMemo(
    () =>
      [...new Set(activeLoans.map((loan) => loan.currentMilestone))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
      ),
    [activeLoans],
  );

  const drillActorOptions = useMemo(
    () =>
      [...new Set(activeLoans.map((loan) => String(loan[ACTOR_TO_FIELD[actor]] ?? "Unknown")))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
      ),
    [activeLoans, actor],
  );

  const drillTypeOptions = useMemo(
    () => [...new Set(activeLoans.map((loan) => loan.loanType))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })),
    [activeLoans],
  );

  const drillPurposeOptions = useMemo(
    () =>
      [...new Set(activeLoans.map((loan) => loan.loanPurpose))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
      ),
    [activeLoans],
  );

  const hasActiveFilters =
    sliceMilestones.length > 0 ||
    sliceDrilldown.actorValues.length > 0 ||
    sliceDrilldown.loanTypes.length > 0 ||
    sliceDrilldown.loanPurposes.length > 0 ||
    Object.values(appliedDetailFilters).some((v) => isFilterActive(v));

  const milestonePillLabel =
    sliceMilestones.length === 0
      ? ""
      : summarizeSelectedValues("Milestone", sliceMilestones, 5);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Active Workload</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Explore operational throughput by Actor. What is the length of time Active Loans are sitting in each milestone? Investigate further by expanding table rows to look at Loan Type and Loan Purpose.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Actor Selector
            </div>
            <Select value={actor} onValueChange={(value) => setActor(value as (typeof ACTOR_OPTIONS)[number])}>
              <SelectTrigger><SelectValue placeholder="Select actor" /></SelectTrigger>
              <SelectContent>{ACTOR_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Calculation Selector
            </div>
            <Select value={aggregation} onValueChange={(value) => setAggregation(value as AggregationType)}>
              <SelectTrigger><SelectValue placeholder="Calculation selector" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="average">Average</SelectItem>
                <SelectItem value="median">Median</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Date Range Calculation Type
            </div>
            <Select value={dayCalcType} onValueChange={(value) => setDayCalcType(value as DayCalcType)}>
              <SelectTrigger><SelectValue placeholder="Date range calculation type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="calendar_days">Calendar Days</SelectItem>
                <SelectItem value="business_days">Business Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedTenantId && (
        <Card>
          <CardContent className="pt-6 text-sm text-amber-700 dark:text-amber-300">
            Select a tenant to load Active Workload data.
          </CardContent>
        </Card>
      )}
      {loading && (
        <Card>
          <CardContent className="pt-6 text-sm text-slate-600 dark:text-slate-300">
            Loading active workload data...
          </CardContent>
        </Card>
      )}
      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600 dark:text-red-400">
            {error}
          </CardContent>
        </Card>
      )}

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Active filters</span>
          {sliceMilestones.length > 0 && (
            <div className="flex items-center gap-0.5">
              <ActiveWorkloadStringFilterPopover
                title="Milestone"
                open={pillEditor === "milestone"}
                onOpenChange={(o) => {
                  if (o) {
                    setDraftMilestoneSlice([...sliceMilestones]);
                    setPillEditor("milestone");
                  } else setPillEditor(null);
                }}
                trigger={
                  <button type="button" className={pillBadgeTriggerClass}>
                    <span className="truncate">{milestonePillLabel}</span>
                  </button>
                }
                options={milestoneOptions}
                draftSelected={draftMilestoneSlice}
                onToggleDraftValue={(v) =>
                  setDraftMilestoneSlice((prev) => {
                    const s = new Set(prev);
                    if (s.has(v)) s.delete(v);
                    else s.add(v);
                    return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                  })
                }
                onApply={() => setSliceMilestones(draftMilestoneSlice)}
                onClearSelection={() => setDraftMilestoneSlice([])}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSliceMilestones([]);
                  setPillEditor(null);
                }}
                className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                aria-label="Remove milestone filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {sliceDrilldown.actorValues.length > 0 && (
            <div className="flex items-center gap-0.5">
              <ActiveWorkloadStringFilterPopover
                title={actor}
                open={pillEditor === "drillActor"}
                onOpenChange={(o) => {
                  if (o) {
                    setDraftDrilldownSlice({
                      actorValues: [...sliceDrilldown.actorValues],
                      loanTypes: [],
                      loanPurposes: [],
                    });
                    setPillEditor("drillActor");
                  } else setPillEditor(null);
                }}
                trigger={
                  <button type="button" className={pillBadgeTriggerClass}>
                    <span className="truncate">
                      {summarizeSelectedValues(actor, sliceDrilldown.actorValues, 5)}
                    </span>
                  </button>
                }
                options={drillActorOptions}
                draftSelected={draftDrilldownSlice.actorValues}
                onToggleDraftValue={(v) =>
                  setDraftDrilldownSlice((prev) => {
                    const s = new Set(prev.actorValues);
                    if (s.has(v)) s.delete(v);
                    else s.add(v);
                    return { actorValues: [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), loanTypes: [], loanPurposes: [] };
                  })
                }
                onApply={() => setSliceDrilldown({ actorValues: draftDrilldownSlice.actorValues, loanTypes: [], loanPurposes: [] })}
                onClearSelection={() => setDraftDrilldownSlice({ actorValues: [], loanTypes: [], loanPurposes: [] })}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSliceDrilldown(emptyDrilldownSlice());
                  setPillEditor(null);
                }}
                className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                aria-label={`Remove ${actor} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {sliceDrilldown.loanTypes.length > 0 && (
            <div className="flex items-center gap-0.5">
              <ActiveWorkloadStringFilterPopover
                title="Loan Type"
                open={pillEditor === "drillType"}
                onOpenChange={(o) => {
                  if (o) {
                    setDraftDrilldownSlice({ actorValues: [], loanTypes: [...sliceDrilldown.loanTypes], loanPurposes: [] });
                    setPillEditor("drillType");
                  } else setPillEditor(null);
                }}
                trigger={
                  <button type="button" className={pillBadgeTriggerClass}>
                    <span className="truncate">
                      {summarizeSelectedValues("Loan Type", sliceDrilldown.loanTypes, 5)}
                    </span>
                  </button>
                }
                options={drillTypeOptions}
                draftSelected={draftDrilldownSlice.loanTypes}
                onToggleDraftValue={(v) =>
                  setDraftDrilldownSlice((prev) => {
                    const s = new Set(prev.loanTypes);
                    if (s.has(v)) s.delete(v);
                    else s.add(v);
                    return { actorValues: [], loanTypes: [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), loanPurposes: [] };
                  })
                }
                onApply={() => setSliceDrilldown({ actorValues: [], loanTypes: draftDrilldownSlice.loanTypes, loanPurposes: [] })}
                onClearSelection={() => setDraftDrilldownSlice({ actorValues: [], loanTypes: [], loanPurposes: [] })}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSliceDrilldown(emptyDrilldownSlice());
                  setPillEditor(null);
                }}
                className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                aria-label="Remove loan type filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {sliceDrilldown.loanPurposes.length > 0 && (
            <div className="flex items-center gap-0.5">
              <ActiveWorkloadStringFilterPopover
                title="Loan Purpose"
                open={pillEditor === "drillPurpose"}
                onOpenChange={(o) => {
                  if (o) {
                    setDraftDrilldownSlice({ actorValues: [], loanTypes: [], loanPurposes: [...sliceDrilldown.loanPurposes] });
                    setPillEditor("drillPurpose");
                  } else setPillEditor(null);
                }}
                trigger={
                  <button type="button" className={pillBadgeTriggerClass}>
                    <span className="truncate">
                      {summarizeSelectedValues("Loan Purpose", sliceDrilldown.loanPurposes, 5)}
                    </span>
                  </button>
                }
                options={drillPurposeOptions}
                draftSelected={draftDrilldownSlice.loanPurposes}
                onToggleDraftValue={(v) =>
                  setDraftDrilldownSlice((prev) => {
                    const s = new Set(prev.loanPurposes);
                    if (s.has(v)) s.delete(v);
                    else s.add(v);
                    return { actorValues: [], loanTypes: [], loanPurposes: [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
                  })
                }
                onApply={() => setSliceDrilldown({ actorValues: [], loanTypes: [], loanPurposes: draftDrilldownSlice.loanPurposes })}
                onClearSelection={() => setDraftDrilldownSlice({ actorValues: [], loanTypes: [], loanPurposes: [] })}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSliceDrilldown(emptyDrilldownSlice());
                  setPillEditor(null);
                }}
                className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                aria-label="Remove loan purpose filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {Object.entries(appliedDetailFilters)
            .filter(([, filter]) => isFilterActive(filter))
            .map(([col, filter]) => (
              <div key={col} className="flex items-center gap-0.5">
                <Popover
                  open={pillEditor === `detail:${col}`}
                  onOpenChange={(o) => {
                    if (o) {
                      setDraftDetailFilters((prev) => ({ ...prev, [col]: cloneFilter(appliedDetailFilters[col]) }));
                      setPillEditor(`detail:${col}`);
                    } else setPillEditor(null);
                  }}
                >
                  <PopoverTrigger asChild>
                    <button type="button" className={pillBadgeTriggerClass}>
                      <span className="truncate">{summarizeFilter(col, filter!)}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[420px] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {detailColumns.find((c) => String(c.key) === col)?.label ?? col}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setPillEditor(null)}>Cancel</Button>
                        <Button type="button" size="sm" onClick={() => { applyDraftFilter(col); setPillEditor(null); }}>
                          Apply Filters
                        </Button>
                      </div>
                    </div>
                    {/** Reuse the same typed editor in pill and header popovers */}
                    {(() => {
                      const column = detailColumns.find((c) => String(c.key) === col);
                      if (!column) return null;
                      const columnId = String(column.key);
                      const kind = getFilterKindForColumn(column.key);
                      const current = draftDetailFilters[columnId];
                      const options = detailFilterOptionsByColumn[columnId] ?? [];
                      if (kind === "date") {
                        const dateFilter: DateColumnFilter = current?.kind === "date" ? current : { kind: "date" };
                        const yearToken = String(new Date().getFullYear());
                        const fixedYears = ["2025", "2024", "2023"];
                        const dateShortcutOptions: Array<{ token: string; label: string; kind: "preset" | "year" | "ytd" }> = [
                          { token: "last-30-days", label: "Last 30 Days", kind: "preset" },
                          { token: "mtd", label: "MTD", kind: "preset" },
                          { token: "last-month", label: "Last Month", kind: "preset" },
                          { token: "ytd", label: `${yearToken} YTD`, kind: "ytd" },
                          ...fixedYears.map((y) => ({ token: y, label: y, kind: "year" as const })),
                          { token: "rolling-13", label: "L13M", kind: "preset" },
                          { token: "rolling-12", label: "L12M", kind: "preset" },
                        ];
                        return (
                          <div className="space-y-3">
                            <Button type="button" size="sm" variant={isDateFilterBlankOnlyShortcut(dateFilter.shortcut) ? "default" : "outline"} className="w-full justify-start" onClick={() => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: DATE_FILTER_BLANK_SHORTCUT, from: "", to: "" } }))}>
                              {DATE_FILTER_BLANK_LABEL}
                            </Button>
                            <div className="grid grid-cols-2 gap-2">
                              <Input type="date" value={dateFilter.from ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", from: e.target.value, to: dateFilter.to, shortcut: undefined } }))} />
                              <Input type="date" value={dateFilter.to ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", from: dateFilter.from, to: e.target.value, shortcut: undefined } }))} />
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
                                      setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: opt.token, from: `${opt.token}-01-01`, to: `${opt.token}-12-31` } }));
                                      return;
                                    }
                                    const range = computePresetDateRange(opt.kind === "ytd" ? "ytd" : (opt.token as PeriodPreset));
                                    setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: opt.token, from: range.start, to: range.end } }));
                                  }}
                                >
                                  {opt.label}
                                </Button>
                              ))}
                            </div>
                            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button>
                          </div>
                        );
                      }
                      if (kind === "number") {
                        const numberFilter: NumberColumnFilter = current?.kind === "number" ? current : { kind: "number", mode: "all", selectedValues: [] };
                        const selected = numberFilter.mode === "all" ? numberFilter.selectedValues : [];
                        const ordered = [...options].sort((a, b) => {
                          const as = selected.includes(a) ? 1 : 0;
                          const bs = selected.includes(b) ? 1 : 0;
                          if (as !== bs) return bs - as;
                          return a.localeCompare(b, undefined, { numeric: true });
                        });
                        return (
                          <Tabs value={numberFilter.mode} onValueChange={(mode) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: mode as NumericFilterMode, selectedValues: [] } }))}>
                            <TabsList className="grid w-full grid-cols-4">
                              <TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="range">Range</TabsTrigger><TabsTrigger value="min">Greater Than</TabsTrigger><TabsTrigger value="max">Less Than</TabsTrigger>
                            </TabsList>
                            <TabsContent value="all" className="space-y-2">
                              <Command shouldFilter={false}>
                                <CommandInput placeholder={`Search ${column.label}`} value={filterSearchByColumn[columnId] ?? ""} onValueChange={(value) => setFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }))} />
                                <CommandList><CommandEmpty>No values found.</CommandEmpty>{ordered.filter((v) => v.toLowerCase().includes((filterSearchByColumn[columnId] ?? "").toLowerCase())).map((value) => {
                                  const isSelected = selected.includes(value);
                                  return <CommandItem key={value} onSelect={() => toggleDraftValue(columnId, value, "number")} className={cn("cursor-pointer", isSelected ? "!bg-accent !text-accent-foreground" : "")}><span className="mr-2">{isSelected ? "✓" : ""}</span>{value}</CommandItem>;
                                })}</CommandList>
                              </Command>
                              <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button>
                            </TabsContent>
                            <TabsContent value="range" className="space-y-2">
                              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"><Input type="number" placeholder="Min" value={numberFilter.min ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "range", selectedValues: [], min: e.target.value, max: numberFilter.max } }))} /><span>-</span><Input type="number" placeholder="Max" value={numberFilter.max ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "range", selectedValues: [], min: numberFilter.min, max: e.target.value } }))} /></div>
                              <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button>
                            </TabsContent>
                            <TabsContent value="min" className="space-y-2"><div className="flex items-center gap-2"><span className="text-sm">{">="}</span><Input type="number" placeholder="Value" value={numberFilter.value ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "min", selectedValues: [], value: e.target.value } }))} /></div><Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button></TabsContent>
                            <TabsContent value="max" className="space-y-2"><div className="flex items-center gap-2"><span className="text-sm">{"<="}</span><Input type="number" placeholder="Value" value={numberFilter.value ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "max", selectedValues: [], value: e.target.value } }))} /></div><Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button></TabsContent>
                          </Tabs>
                        );
                      }
                      const textFilter: TextColumnFilter = current?.kind === "text" ? current : { kind: "text", selectedValues: [] };
                      const ordered = [...options].sort((a, b) => {
                        const as = textFilter.selectedValues.includes(a) ? 1 : 0;
                        const bs = textFilter.selectedValues.includes(b) ? 1 : 0;
                        if (as !== bs) return bs - as;
                        return a.localeCompare(b, undefined, { numeric: true });
                      });
                      return (
                        <div className="space-y-2">
                          <Command shouldFilter={false}>
                            <CommandInput placeholder={`Search ${column.label}`} value={filterSearchByColumn[columnId] ?? ""} onValueChange={(value) => setFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }))} />
                            <CommandList>
                              <CommandEmpty>No values found.</CommandEmpty>
                              {ordered.filter((v) => v.toLowerCase().includes((filterSearchByColumn[columnId] ?? "").toLowerCase())).map((value) => {
                                const isSelected = textFilter.selectedValues.includes(value);
                                return <CommandItem key={value} onSelect={() => toggleDraftValue(columnId, value, "text")} className={cn("cursor-pointer", isSelected ? "!bg-accent !text-accent-foreground" : "")}><span className="mr-2">{isSelected ? "✓" : ""}</span>{value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}</CommandItem>;
                              })}
                            </CommandList>
                          </Command>
                          <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button>
                        </div>
                      );
                    })()}
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAppliedDetailFilters((prev) => {
                      const next = { ...prev };
                      delete next[col];
                      return next;
                    });
                    setPillEditor(null);
                  }}
                  className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                  aria-label={`Remove ${(detailColumns.find((c) => c.key === col)?.label ?? col)} filter`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSliceMilestones([]);
              setSliceDrilldown(emptyDrilldownSlice());
              setAppliedDetailFilters({});
            }}
          >
            Clear All Filters
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm">Active Files</CardTitle></CardHeader><CardContent className="text-5xl font-semibold text-cyan-700">{kpis.activeFiles.toLocaleString()}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm">{aggregation === "average" ? "Average Days Active" : "Median Days Active"}</CardTitle></CardHeader><CardContent className="text-5xl font-semibold text-cyan-700">{kpis.daysActive.toFixed(2)}</CardContent></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Drilldown</CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setExpanded(new Set([...actorRowIds, ...loanTypeRowIds]))}>Expand All</Button>
              <Button size="sm" variant="outline" onClick={() => setExpanded(new Set())}>Collapse All</Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv(
                    "active-workload-drilldown.csv",
                    [actor, "Active Files", `${aggregation === "average" ? "Average" : "Median"} Days Active`],
                    drillRows.map((r) => [`${"  ".repeat(r.level === "loanPurpose" ? 2 : r.level === "loanType" ? 1 : 0)}${r.label}`, r.activeFiles, r.daysActive.toFixed(2)]),
                  )
                }
              >
                <Download className="mr-1 h-4 w-4" /> Download
              </Button>
            </div>
          </CardHeader>
          <CardContent className="h-[720px]">
            <div className="h-full overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <colgroup>
                  <col />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "150px" }} />
                </colgroup>
                <thead>
                  <tr className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <th className="px-3 py-2 text-left">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleDrillSort("label")}>
                        {actor}
                        <DrillSortIcon columnKey="label" />
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">
                      <button type="button" className="inline-flex w-full items-center justify-end gap-1" onClick={() => toggleDrillSort("activeFiles")}>
                        Active Files
                        <DrillSortIcon columnKey="activeFiles" />
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">
                      <button type="button" className="inline-flex w-full items-center justify-end gap-1" onClick={() => toggleDrillSort("daysActive")}>
                        {aggregation === "average" ? "Average" : "Median"} Days Active
                        <DrillSortIcon columnKey="daysActive" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {drilldownTotals && (
                    <tr className="sticky top-[41px] z-20 border-b border-slate-200 bg-slate-50/95 dark:border-slate-700 dark:bg-slate-800/95">
                      <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">Total</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-800 dark:text-slate-200">
                        {drilldownTotals.activeFiles.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-800 dark:text-slate-200">
                        {drilldownTotals.daysActive.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {visibleDrillRows.map((row) => {
                    const hasChildren = (drillRowsByParent.get(row.id) ?? []).length > 0;
                    return (
                      <tr
                        key={row.id}
                        className={`cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/90 dark:hover:bg-slate-700/60 ${
                          (row.level === "actor" && sliceDrilldown.actorValues.includes(row.label)) ||
                          (row.level === "loanType" && sliceDrilldown.loanTypes.includes(row.label)) ||
                          (row.level === "loanPurpose" && sliceDrilldown.loanPurposes.includes(row.label))
                            ? "bg-blue-50/80 dark:bg-slate-800/80"
                            : ""
                        }`}
                        onClick={() => toggleDrilldownSlice(row)}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1" style={{ paddingLeft: `${row.level === "loanPurpose" ? 36 : row.level === "loanType" ? 18 : 0}px` }}>
                            {hasChildren ? (
                              <button
                                type="button"
                                className="rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setExpanded((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(row.id)) next.delete(row.id);
                                    else next.add(row.id);
                                    return next;
                                  });
                                }}
                              >
                                {expanded.has(row.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              </button>
                            ) : (
                              <span className="inline-block w-4" />
                            )}
                            <span className={row.level !== "loanPurpose" ? "font-semibold text-slate-800 dark:text-slate-200" : "text-slate-700 dark:text-slate-300"}>
                              {row.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{row.activeFiles.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{row.daysActive.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Active Loans by Current Milestone</CardTitle></CardHeader>
          <CardContent className="h-[720px]">
            {renderStage === "kpi" && (
              <div className="pb-2 text-xs text-slate-500 dark:text-slate-400">Loading chart...</div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={milestoneData}
                layout="vertical"
                margin={{ top: 24, left: 8, right: 16, bottom: 12 }}
                barCategoryGap="28%"
                onClick={handleMilestoneChartClick}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={milestoneAxisWidth} interval={0} tick={milestoneTick} />
                <Tooltip />
                <ReferenceLine
                  x={kpis.daysActive}
                  stroke="#0f766e"
                  strokeDasharray="6 4"
                  label={{
                    value: `${aggregation === "average" ? "Average" : "Median"} Days Active (${kpis.daysActive.toFixed(2)})`,
                    position: "top",
                    fill: "#0f766e",
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="activeFiles" fill="#3b82f6" name="Active Files" barSize={10} cursor="pointer" onClick={handleMilestoneBarClick}>
                  <LabelList dataKey="activeFiles" position="right" />
                </Bar>
                <Bar
                  dataKey="daysActive"
                  fill="#e11d48"
                  name={`${aggregation === "average" ? "Average" : "Median"} Days Active`}
                  barSize={10}
                  cursor="pointer"
                  onClick={handleMilestoneBarClick}
                >
                  <LabelList dataKey="daysActive" position="right" formatter={(value: number) => value.toFixed(2)} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#3b82f6]" />
                Loan Count
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#e11d48]" />
                {aggregation === "average" ? "Average Days Active" : "Median Days Active"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Active Loans Detail</CardTitle>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {sortedDetailRows.length.toLocaleString()} loans
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowDetailColumnFilters((s) => !s)}>
              <Filter className="mr-1 h-4 w-4" />
              {showDetailColumnFilters ? "Hide Filters" : "Show Filters"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadCsv(
                  "active-workload-detail.csv",
                  detailColumns.map((c) => c.label),
                  sortedDetailRows.map((loan) => detailColumns.map((c) => getCellDisplayValue(loan, c.key))),
                )
              }
            >
              <Download className="mr-1 h-4 w-4" /> Download
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={detailTableScrollRef}
            onScroll={handleDetailTableScroll}
            className="relative max-h-[520px] overflow-auto border-t border-slate-200 dark:border-slate-700"
          >
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-40 bg-slate-50 dark:bg-slate-800">
                <tr className="bg-slate-50 dark:bg-slate-800">
                  {detailColumns.map((column) => (
                    <th key={column.key} className="h-12 border-b border-slate-200 bg-slate-50 px-4 text-left align-middle font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1"
                          onClick={() => toggleSort(column.key as keyof LoanRecord | "daysActive")}
                        >
                          {column.label}
                          <SortIcon columnKey={column.key as keyof LoanRecord | "daysActive"} />
                        </button>
                        {showDetailColumnFilters && (
                          <Popover
                            open={openDetailFilterColumnId === String(column.key)}
                            onOpenChange={(open) => {
                              if (open) {
                                setOpenDetailFilterColumnId(String(column.key));
                                setDraftDetailFilters((prev) => ({
                                  ...prev,
                                  [String(column.key)]: getEffectiveColumnFilter(String(column.key)),
                                }));
                              } else {
                                setOpenDetailFilterColumnId((cur) => (cur === String(column.key) ? null : cur));
                              }
                            }}
                          >
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className={`rounded p-1 ${
                                  isFilterActive(getEffectiveColumnFilter(String(column.key)))
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                                }`}
                              >
                                <Filter className="h-3.5 w-3.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-[420px] p-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{column.label}</div>
                                <div className="flex items-center gap-2">
                                  <Button type="button" size="sm" variant="outline" onClick={() => setOpenDetailFilterColumnId(null)}>
                                    Cancel
                                  </Button>
                                  <Button type="button" size="sm" onClick={() => { applyDraftFilter(String(column.key)); setOpenDetailFilterColumnId(null); }}>
                                    Apply Filters
                                  </Button>
                                </div>
                              </div>
                              <div className="space-y-2">
                                {(() => {
                                  const columnId = String(column.key);
                                  const kind = getFilterKindForColumn(column.key);
                                  const current = draftDetailFilters[columnId];
                                  const options = detailFilterOptionsByColumn[columnId] ?? [];
                                  if (kind === "date") {
                                    const dateFilter: DateColumnFilter = current?.kind === "date" ? current : { kind: "date" };
                                    const yearToken = String(new Date().getFullYear());
                                    const fixedYears = ["2025", "2024", "2023"];
                                    const dateShortcutOptions: Array<{ token: string; label: string; kind: "preset" | "year" | "ytd" }> = [
                                      { token: "last-30-days", label: "Last 30 Days", kind: "preset" },
                                      { token: "mtd", label: "MTD", kind: "preset" },
                                      { token: "last-month", label: "Last Month", kind: "preset" },
                                      { token: "ytd", label: `${yearToken} YTD`, kind: "ytd" },
                                      ...fixedYears.map((y) => ({ token: y, label: y, kind: "year" as const })),
                                      { token: "rolling-13", label: "L13M", kind: "preset" },
                                      { token: "rolling-12", label: "L12M", kind: "preset" },
                                    ];
                                    return (
                                      <div className="space-y-3">
                                        <Button type="button" size="sm" variant={isDateFilterBlankOnlyShortcut(dateFilter.shortcut) ? "default" : "outline"} className="w-full justify-start" onClick={() => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: DATE_FILTER_BLANK_SHORTCUT, from: "", to: "" } }))}>
                                          {DATE_FILTER_BLANK_LABEL}
                                        </Button>
                                        <div className="grid grid-cols-2 gap-2">
                                          <Input type="date" value={dateFilter.from ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", from: e.target.value, to: dateFilter.to, shortcut: undefined } }))} />
                                          <Input type="date" value={dateFilter.to ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", from: dateFilter.from, to: e.target.value, shortcut: undefined } }))} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          {dateShortcutOptions.map((opt) => (
                                            <Button key={opt.token} type="button" size="sm" variant={dateFilter.shortcut === opt.token ? "default" : "outline"} onClick={() => {
                                              if (opt.kind === "year") { setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: opt.token, from: `${opt.token}-01-01`, to: `${opt.token}-12-31` } })); return; }
                                              const range = computePresetDateRange(opt.kind === "ytd" ? "ytd" : (opt.token as PeriodPreset));
                                              setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: opt.token, from: range.start, to: range.end } }));
                                            }}>{opt.label}</Button>
                                          ))}
                                        </div>
                                        <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button>
                                      </div>
                                    );
                                  }
                                  if (kind === "number") {
                                    const numberFilter: NumberColumnFilter = current?.kind === "number" ? current : { kind: "number", mode: "all", selectedValues: [] };
                                    const selected = numberFilter.mode === "all" ? numberFilter.selectedValues : [];
                                    const ordered = [...options].sort((a, b) => {
                                      const as = selected.includes(a) ? 1 : 0;
                                      const bs = selected.includes(b) ? 1 : 0;
                                      if (as !== bs) return bs - as;
                                      return a.localeCompare(b, undefined, { numeric: true });
                                    });
                                    return (
                                      <Tabs value={numberFilter.mode} onValueChange={(mode) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: mode as NumericFilterMode, selectedValues: [] } }))}>
                                        <TabsList className="grid w-full grid-cols-4"><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="range">Range</TabsTrigger><TabsTrigger value="min">Greater Than</TabsTrigger><TabsTrigger value="max">Less Than</TabsTrigger></TabsList>
                                        <TabsContent value="all" className="space-y-2"><Command shouldFilter={false}><CommandInput placeholder={`Search ${column.label}`} value={filterSearchByColumn[columnId] ?? ""} onValueChange={(value) => setFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }))} /><CommandList><CommandEmpty>No values found.</CommandEmpty>{ordered.filter((v) => v.toLowerCase().includes((filterSearchByColumn[columnId] ?? "").toLowerCase())).map((value) => { const isSelected = selected.includes(value); return <CommandItem key={value} onSelect={() => toggleDraftValue(columnId, value, "number")} className={cn("cursor-pointer", isSelected ? "!bg-accent !text-accent-foreground" : "")}><span className="mr-2">{isSelected ? "✓" : ""}</span>{value}</CommandItem>; })}</CommandList></Command><Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button></TabsContent>
                                        <TabsContent value="range" className="space-y-2"><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"><Input type="number" placeholder="Min" value={numberFilter.min ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "range", selectedValues: [], min: e.target.value, max: numberFilter.max } }))} /><span>-</span><Input type="number" placeholder="Max" value={numberFilter.max ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "range", selectedValues: [], min: numberFilter.min, max: e.target.value } }))} /></div><Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button></TabsContent>
                                        <TabsContent value="min" className="space-y-2"><div className="flex items-center gap-2"><span className="text-sm">{">="}</span><Input type="number" placeholder="Value" value={numberFilter.value ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "min", selectedValues: [], value: e.target.value } }))} /></div><Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button></TabsContent>
                                        <TabsContent value="max" className="space-y-2"><div className="flex items-center gap-2"><span className="text-sm">{"<="}</span><Input type="number" placeholder="Value" value={numberFilter.value ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "max", selectedValues: [], value: e.target.value } }))} /></div><Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button></TabsContent>
                                      </Tabs>
                                    );
                                  }
                                  const textFilter: TextColumnFilter = current?.kind === "text" ? current : { kind: "text", selectedValues: [] };
                                  const ordered = [...options].sort((a, b) => {
                                    const as = textFilter.selectedValues.includes(a) ? 1 : 0;
                                    const bs = textFilter.selectedValues.includes(b) ? 1 : 0;
                                    if (as !== bs) return bs - as;
                                    return a.localeCompare(b, undefined, { numeric: true });
                                  });
                                  return (
                                    <div className="space-y-2">
                                      <Command shouldFilter={false}>
                                        <CommandInput placeholder={`Search ${column.label}`} value={filterSearchByColumn[columnId] ?? ""} onValueChange={(value) => setFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }))} />
                                        <CommandList><CommandEmpty>No values found.</CommandEmpty>{ordered.filter((v) => v.toLowerCase().includes((filterSearchByColumn[columnId] ?? "").toLowerCase())).map((value) => { const isSelected = textFilter.selectedValues.includes(value); return <CommandItem key={value} onSelect={() => toggleDraftValue(columnId, value, "text")} className={cn("cursor-pointer", isSelected ? "!bg-accent !text-accent-foreground" : "")}><span className="mr-2">{isSelected ? "✓" : ""}</span>{value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}</CommandItem>; })}</CommandList>
                                      </Command>
                                      <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftFilter(columnId)}>Clear Selection</Button>
                                    </div>
                                  );
                                })()}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleDetailRows.map((loan) => (
                  <tr key={loan.loanNumber} className="border-b border-slate-200 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-700/40">
                    {detailColumns.map((column) => {
                      const display = getCellDisplayValue(loan, column.key);
                      const columnId = String(column.key);
                      const isFiltered = isFilterActive(getEffectiveColumnFilter(columnId));
                      return (
                        <td key={String(column.key)} className="p-4 align-middle">
                          <button
                            type="button"
                            className={`rounded px-1 py-0.5 -mx-1 -my-0.5 text-left transition-colors hover:bg-sky-100/80 dark:hover:bg-sky-900/40 ${
                              isFiltered ? "ring-1 ring-emerald-500" : ""
                            }`}
                            onClick={() =>
                              setAppliedDetailFilters((prev) => {
                                const key = String(column.key);
                                const next = { ...prev };
                                const kind = getFilterKindForColumn(column.key);
                                if (kind === "number") {
                                  const current = prev[key];
                                  const token = String(getFilterRawValue(loan, column.key));
                                  const selected =
                                    current?.kind === "number" && current.mode === "all" ? current.selectedValues : [];
                                  const nextSelected = selected.includes(token) ? selected.filter((v) => v !== token) : [token];
                                  if (nextSelected.length === 0) delete next[key];
                                  else next[key] = { kind: "number", mode: "all", selectedValues: nextSelected };
                                  return next;
                                }
                                if (kind === "date") {
                                  const raw = String(getFilterRawValue(loan, column.key) ?? "");
                                  const current = prev[key];
                                  if (current?.kind === "date" && current.from === raw && current.to === raw) delete next[key];
                                  else next[key] = { kind: "date", from: raw, to: raw, shortcut: undefined };
                                  return next;
                                }
                                const current = prev[key];
                                const selected = current?.kind === "text" ? current.selectedValues : [];
                                const nextSelected = selected.includes(display) ? selected.filter((v) => v !== display) : [display];
                                if (nextSelected.length === 0) delete next[key];
                                else next[key] = { kind: "text", selectedValues: nextSelected };
                                return next;
                              })
                            }
                          >
                            {display}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleDetailRows.length < sortedDetailRows.length && (
              <div className="px-4 py-2 text-center text-xs text-slate-500 dark:text-slate-400">
                Showing {visibleDetailRows.length.toLocaleString()} of{" "}
                {sortedDetailRows.length.toLocaleString()} loans
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

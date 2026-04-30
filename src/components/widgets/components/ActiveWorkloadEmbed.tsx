import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bar, CartesianGrid, ComposedChart, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import type { SectionFilters } from "@/stores/widgetSectionStore";
import type { WidgetRenderProps } from "../registry/types";
import {
  DATE_FILTER_BLANK_LABEL,
  DATE_FILTER_BLANK_SHORTCUT,
  EMPTY_FILTER_TOKEN,
  evaluateLoanDetailFilters,
  isDateFilterBlankOnlyShortcut,
  isFilterActive,
  normalizeFilterState,
  type ColumnFilterState,
  type DateColumnFilter,
  type NumberColumnFilter,
  type NumericFilterMode,
  type TextColumnFilter,
} from "@/utils/loanDetailFilters";
import { computePresetDateRange, type PeriodPreset } from "@/components/ui/DatePeriodPicker";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Download, Filter } from "lucide-react";

type Variant = "kpi-active-files" | "kpi-days-active" | "drilldown" | "milestone-chart" | "detail-table";
type AggregationType = "average" | "median";
type DayCalcType = "calendar_days" | "business_days";
type SortDirection = "asc" | "desc";
type DrillSortKey = "label" | "activeFiles" | "daysActive";
type DrillLevel = "actor" | "loanType" | "loanPurpose";
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
type DrillRow = {
  id: string;
  parentId: string | null;
  level: DrillLevel;
  label: string;
  activeFiles: number;
  daysActive: number;
};

const ACTOR_OPTIONS = [
  "Channel", "Processor", "Closer", "Underwriter", "Loan Officer", "Account Executive",
  "Account Manager", "Broker Lender Name", "Branch", "TPO Company Name", "Investor", "Retail Branch ID",
  "Retail LO", "Originator Loan Officer Name", "Originator Loan Processor Name", "Correspondent Sales Rep/AE",
  "Correspondent Lender Name", "Sales Rep/AE", "Warehouse Co Name", "Warehouse Bank Name",
] as const;
const ACTOR_TO_FIELD: Record<(typeof ACTOR_OPTIONS)[number], keyof LoanRecord> = {
  Channel: "channel", Processor: "processor", Closer: "closer", Underwriter: "underwriter", "Loan Officer": "loanOfficer",
  "Account Executive": "accountExecutive", "Account Manager": "accountManager", "Broker Lender Name": "brokerLenderName",
  Branch: "branch", "TPO Company Name": "tpoCompanyName", Investor: "investor", "Retail Branch ID": "retailBranchId",
  "Retail LO": "retailLo", "Originator Loan Officer Name": "originatorLoanOfficerName", "Originator Loan Processor Name": "originatorLoanProcessorName",
  "Correspondent Sales Rep/AE": "correspondentSalesRepAE", "Correspondent Lender Name": "correspondentLenderName",
  "Sales Rep/AE": "salesRepAE", "Warehouse Co Name": "warehouseCoName", "Warehouse Bank Name": "warehouseBankName",
};
const DATE_COLUMN_KEYS = new Set(["applicationDate", "loanEstimateSentDate", "conditionalApprovalDate", "uwFinalApprovalDate", "ctcDate", "estimatedClosingDate", "closingDate", "investorLockDate", "lockExpirationDate"]);
const NUMERIC_COLUMN_KEYS = new Set(["daysActive"]);

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
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}/${parsed.getFullYear()}`;
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
const normalizeLoan = (row: Record<string, unknown>): LoanRecord | null => {
  const applicationDate = (row.application_date as string | null) ?? null;
  if (!hasDateValue(applicationDate)) return null;
  return {
    loanId: toText(row.loan_id), loanNumber: toText(row.loan_number ?? row.loan_id), channel: toText(row.channel),
    currentMilestone: toText(row.current_milestone), loanFolder: toText(row.loan_folder), loanType: toText(row.loan_type),
    loanPurpose: toText(row.loan_purpose), loanProgram: toText(row.loan_program), applicationDate: String(applicationDate).trim(),
    loanEstimateSentDate: String(row.loan_estimate_sent_date ?? ""), conditionalApprovalDate: String(row.conditional_approval_date ?? ""),
    uwFinalApprovalDate: String(row.uw_final_approval_date ?? ""), ctcDate: String(row.ctc_date ?? ""), estimatedClosingDate: String(row.estimated_closing_date ?? ""),
    closingDate: String(row.closing_date ?? ""), fundingDate: String(row.funding_date ?? ""), currentLoanStatus: toText(row.current_loan_status), isArchived: isArchivedFlag(row.is_archived),
    investorLockDate: String(row.investor_lock_date ?? ""), lockExpirationDate: String(row.lock_expiration_date ?? ""), lienPosition: toText(row.lien_position),
    processor: toText(row.processor), underwriter: toText(row.underwriter), closer: toText(row.closer), brokerLenderName: toText(row.broker_lender_name),
    loanOfficer: toText(row.loan_officer), accountExecutive: toText(row.account_executive), accountManager: toText(row.account_manager), branch: toText(row.branch),
    tpoCompanyName: toText(row.tpo_company_name), investor: toText(row.investor), retailBranchId: toText(row.retail_branch_id), retailLo: toText(row.retail_lo),
    originatorLoanOfficerName: toText(row.originator_loan_officer_name), originatorLoanProcessorName: toText(row.originator_loan_processor_name),
    correspondentSalesRepAE: toText(row.correspondent_sales_rep_ae), correspondentLenderName: toText(row.correspondent_lender_name), salesRepAE: toText(row.sales_rep_ae),
    warehouseCoName: toText(row.warehouse_co_name), warehouseBankName: toText(row.warehouse_bank_name),
  };
};
const isCanonicalActiveLoan = (loan: LoanRecord) => loan.currentLoanStatus.trim().toUpperCase() === "ACTIVE LOAN" && hasDateValue(loan.applicationDate) && !loan.isArchived;

function ActiveWorkloadEmbedInner({ width, height, config }: WidgetRenderProps) {
  const variant = (config?.variant as Variant) ?? "kpi-active-files";
  const groupId = String(config?.groupId ?? "");
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);
  const section = useWidgetSectionStore((s) => (groupId ? s.sections[groupId] : undefined));
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const isTpoTenant = (selectedChannel ?? "").toLowerCase().includes("tpo");

  const actor = (section?.activeWorkloadActor as (typeof ACTOR_OPTIONS)[number]) ?? "Processor";
  const aggregation = (section?.activeWorkloadAggregation as AggregationType) ?? "average";
  const dayCalcType = (section?.activeWorkloadDayCalcType as DayCalcType) ?? "calendar_days";
  const sliceMilestones = section?.activeWorkloadSliceMilestones ?? [];
  const sliceDrilldown = section?.activeWorkloadSliceDrilldown ?? { actorValues: [], loanTypes: [], loanPurposes: [] };
  const appliedDetailFilters = section?.activeWorkloadDetailColumnFilters ?? {};
  const detailSort = (section?.activeWorkloadDetailSort as { key: keyof LoanRecord | "daysActive"; direction: SortDirection }) ?? { key: "applicationDate", direction: "asc" };
  const showDetailColumnFilters = Boolean(section?.activeWorkloadShowDetailColumnFilters);

  const [sourceRows, setSourceRows] = useState<LoanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drillSort, setDrillSort] = useState<{ key: DrillSortKey; direction: SortDirection }>({ key: "activeFiles", direction: "desc" });
  const [openDetailFilterColumnId, setOpenDetailFilterColumnId] = useState<string | null>(null);
  const [draftDetailFilters, setDraftDetailFilters] = useState<ColumnFilterState>({});
  const [filterSearchByColumn, setFilterSearchByColumn] = useState<Record<string, string>>({});
  const suppressNextChartClickRef = useRef(false);
  const [renderStage, setRenderStage] = useState<"kpi" | "charts" | "detail">("kpi");
  const [detailRowsRenderLimit, setDetailRowsRenderLimit] = useState(250);
  const detailTableScrollRef = useRef<HTMLDivElement | null>(null);

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
  const dayDiff = (appDate: string) => (dayCalcType === "business_days" ? calculateBusinessDays(appDate, now) : calculateCalendarDays(appDate, now));
  const activeLoans = useMemo(() => sourceRows.filter(isCanonicalActiveLoan).map((loan) => ({ ...loan, daysActive: dayDiff(loan.applicationDate) })), [sourceRows, dayCalcType]);
  const aggregateDays = (days: number[]) => (days.length === 0 ? 0 : aggregation === "median" ? median(days) : days.reduce((sum, value) => sum + value, 0) / days.length);

  const arraysEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  const drilldownEqual = (
    a: { actorValues?: string[]; loanTypes?: string[]; loanPurposes?: string[] },
    b: { actorValues?: string[]; loanTypes?: string[]; loanPurposes?: string[] },
  ) =>
    arraysEqual(a.actorValues ?? [], b.actorValues ?? []) &&
    arraysEqual(a.loanTypes ?? [], b.loanTypes ?? []) &&
    arraysEqual(a.loanPurposes ?? [], b.loanPurposes ?? []);
  const extractSharedValuesFromFilter = (filter: ColumnFilterState[string] | undefined): string[] => {
    if (!filter || !isFilterActive(filter)) return [];
    if (filter.kind === "text") return filter.selectedValues.filter((v) => v !== EMPTY_FILTER_TOKEN);
    if (filter.kind === "number" && filter.mode === "all") return [...filter.selectedValues];
    return [];
  };

  useEffect(() => {
    if (!groupId) return;
    const actorColumnId = String(ACTOR_TO_FIELD[actor]);
    const normalized = normalizeFilterState(appliedDetailFilters);
    const nextDetail: ColumnFilterState = { ...normalized };
    let detailChanged = false;
    const updates: Partial<SectionFilters> = {};

    const milestoneValues = extractSharedValuesFromFilter(nextDetail.currentMilestone);
    if (milestoneValues.length > 0) {
      if (!arraysEqual(milestoneValues, sliceMilestones)) {
        updates.activeWorkloadSliceMilestones = milestoneValues;
      }
      delete nextDetail.currentMilestone;
      detailChanged = true;
    }

    const actorValues = extractSharedValuesFromFilter(nextDetail[actorColumnId]);
    if (actorValues.length > 0) {
      const nextDrilldown = { actorValues, loanTypes: [], loanPurposes: [] };
      if (!drilldownEqual(nextDrilldown, sliceDrilldown)) {
        updates.activeWorkloadSliceDrilldown = nextDrilldown;
      }
      delete nextDetail[actorColumnId];
      detailChanged = true;
    } else {
      const loanTypeValues = extractSharedValuesFromFilter(nextDetail.loanType);
      if (loanTypeValues.length > 0) {
        const nextDrilldown = { actorValues: [], loanTypes: loanTypeValues, loanPurposes: [] };
        if (!drilldownEqual(nextDrilldown, sliceDrilldown)) {
          updates.activeWorkloadSliceDrilldown = nextDrilldown;
        }
        delete nextDetail.loanType;
        detailChanged = true;
      } else {
        const loanPurposeValues = extractSharedValuesFromFilter(nextDetail.loanPurpose);
        if (loanPurposeValues.length > 0) {
          const nextDrilldown = { actorValues: [], loanTypes: [], loanPurposes: loanPurposeValues };
          if (!drilldownEqual(nextDrilldown, sliceDrilldown)) {
            updates.activeWorkloadSliceDrilldown = nextDrilldown;
          }
          delete nextDetail.loanPurpose;
          detailChanged = true;
        }
      }
    }

    if (detailChanged) {
      updates.activeWorkloadDetailColumnFilters = nextDetail;
    }
    if (Object.keys(updates).length > 0) {
      updateFilters(groupId, updates);
    }
  }, [actor, appliedDetailFilters, groupId, sliceDrilldown, sliceMilestones, updateFilters]);

  const loansAfterSliceFilters = useMemo(() => activeLoans.filter((loan) => {
    if (sliceMilestones.length > 0 && !sliceMilestones.includes(loan.currentMilestone)) return false;
    const actorValue = String(loan[ACTOR_TO_FIELD[actor]] ?? "Unknown");
    if ((sliceDrilldown.actorValues ?? []).length > 0 && !(sliceDrilldown.actorValues ?? []).includes(actorValue)) return false;
    if ((sliceDrilldown.loanTypes ?? []).length > 0 && !(sliceDrilldown.loanTypes ?? []).includes(loan.loanType)) return false;
    if ((sliceDrilldown.loanPurposes ?? []).length > 0 && !(sliceDrilldown.loanPurposes ?? []).includes(loan.loanPurpose)) return false;
    return true;
  }), [activeLoans, sliceMilestones, sliceDrilldown, actor]);

  const getFilterRawValue = (loan: LoanRecord & { daysActive?: number }, key: keyof LoanRecord | "daysActive"): unknown => (key === "daysActive" ? loan.daysActive ?? 0 : loan[key]);
  const getCellDisplayValue = (loan: LoanRecord & { daysActive?: number }, key: keyof LoanRecord | "daysActive"): string => {
    if (key === "daysActive") return String(Math.round(Number(loan.daysActive ?? 0)));
    const raw = String(loan[key] ?? "");
    if (DATE_COLUMN_KEYS.has(String(key))) return formatDateOnly(raw);
    return raw.trim() || "Unknown";
  };
  const filteredActiveLoans = useMemo(
    () => evaluateLoanDetailFilters(loansAfterSliceFilters, appliedDetailFilters, (loan, columnId) => getFilterRawValue(loan, columnId as keyof LoanRecord | "daysActive")),
    [loansAfterSliceFilters, appliedDetailFilters],
  );
  const deferredFilteredActiveLoans = useDeferredValue(filteredActiveLoans);
  const needsChartOrDrill = variant === "milestone-chart" || variant === "drilldown";
  const needsDetail = variant === "detail-table";

  useEffect(() => {
    setRenderStage("kpi");
    const frameId = window.requestAnimationFrame(() => setRenderStage("charts"));
    const timeoutId = window.setTimeout(() => setRenderStage("detail"), 80);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [filteredActiveLoans, detailSort, actor, aggregation, dayCalcType, variant]);
  const kpis = useMemo(() => ({ activeFiles: filteredActiveLoans.length, daysActive: aggregateDays(filteredActiveLoans.map((loan) => loan.daysActive)) }), [filteredActiveLoans, aggregation]);

  const drillRows = useMemo<DrillRow[]>(() => {
    if (!needsChartOrDrill || renderStage === "kpi") return [];
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
      rows.push({ id: actorId, parentId: null, level: "actor", label: actorName, activeFiles: actorLoans.length, daysActive: aggregateDays(actorLoans.map((loan) => loan.daysActive)) });
      const typeMap = new Map<string, typeof actorLoans>();
      for (const loan of actorLoans) {
        const list = typeMap.get(loan.loanType) ?? [];
        list.push(loan);
        typeMap.set(loan.loanType, list);
      }
      for (const [loanType, typeLoans] of typeMap.entries()) {
        const typeId = `${actorId}|type:${loanType}`;
        rows.push({ id: typeId, parentId: actorId, level: "loanType", label: loanType, activeFiles: typeLoans.length, daysActive: aggregateDays(typeLoans.map((loan) => loan.daysActive)) });
        const purposeMap = new Map<string, typeof typeLoans>();
        for (const loan of typeLoans) {
          const list = purposeMap.get(loan.loanPurpose) ?? [];
          list.push(loan);
          purposeMap.set(loan.loanPurpose, list);
        }
        for (const [purpose, purposeLoans] of purposeMap.entries()) {
          rows.push({ id: `${typeId}|purpose:${purpose}`, parentId: typeId, level: "loanPurpose", label: purpose, activeFiles: purposeLoans.length, daysActive: aggregateDays(purposeLoans.map((loan) => loan.daysActive)) });
        }
      }
    }
    return rows;
  }, [filteredActiveLoans, actor, aggregation, needsChartOrDrill, renderStage]);

  const drillRowsByParent = useMemo(() => {
    const map = new Map<string | null, DrillRow[]>();
    for (const row of drillRows) {
      const list = map.get(row.parentId) ?? [];
      list.push(row);
      map.set(row.parentId, list);
    }
    const sortDirection = drillSort.direction === "asc" ? 1 : -1;
    for (const [parentId, siblings] of map.entries()) {
      map.set(parentId, [...siblings].sort((a, b) => {
        if (drillSort.key === "label") return a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }) * sortDirection;
        if (drillSort.key === "activeFiles") return (a.activeFiles - b.activeFiles) * sortDirection;
        return (a.daysActive - b.daysActive) * sortDirection;
      }));
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
    if (!needsChartOrDrill || renderStage === "kpi") return [];
    const byMilestone = new Map<string, number[]>();
    for (const loan of filteredActiveLoans) {
      const list = byMilestone.get(loan.currentMilestone) ?? [];
      list.push(loan.daysActive);
      byMilestone.set(loan.currentMilestone, list);
    }
    return [...byMilestone.entries()].map(([name, days]) => ({ name, activeFiles: days.length, daysActive: aggregateDays(days) }));
  }, [filteredActiveLoans, aggregation, needsChartOrDrill, renderStage]);
  const milestoneAxisWidth = useMemo(() => {
    const longest = milestoneData.reduce((max, row) => Math.max(max, row.name.length), 0);
    return Math.min(360, Math.max(140, longest * 8 + 28));
  }, [milestoneData]);

  const detailColumns = useMemo(() => [
    { key: "loanNumber", label: "Loan Number" }, { key: "channel", label: "Channel" }, { key: "currentMilestone", label: "Current Milestone" }, { key: "loanFolder", label: "Loan Folder" },
    { key: "daysActive", label: `${aggregation === "average" ? "Average" : "Median"} Days Active` }, { key: "loanType", label: "Loan Type" }, { key: "loanPurpose", label: "Loan Purpose" },
    { key: "loanProgram", label: "Loan Program" }, { key: "applicationDate", label: "Application Date" }, { key: "loanEstimateSentDate", label: "Loan Estimate Sent Date" },
    { key: "conditionalApprovalDate", label: "Conditional Approval Date" }, { key: "uwFinalApprovalDate", label: "UW Final Approval Date" }, { key: "ctcDate", label: "CTC Date" },
    { key: "estimatedClosingDate", label: "Estimated Closing Date" }, { key: "closingDate", label: "Closing Date" }, { key: "investorLockDate", label: "Investor Lock Date" },
    { key: "lockExpirationDate", label: "Lock Expiration Date" }, { key: "lienPosition", label: "Lien Position" }, { key: "processor", label: "Processor" }, { key: "underwriter", label: "Underwriter" }, { key: "closer", label: "Closer" },
    ...(isTpoTenant ? [{ key: "brokerLenderName", label: "Broker Lender Name" }, { key: "accountExecutive", label: "Account Executive" }, { key: "originatorLoanOfficerName", label: "Originator Loan Officer Name" }, { key: "salesRepAE", label: "Sales Rep/AE" }] : []),
    { key: "loanOfficer", label: "Loan Officer" },
  ] as Array<{ key: keyof LoanRecord | "daysActive"; label: string }>, [aggregation, isTpoTenant]);

  const detailFilterOptionsByColumn = useMemo(() => {
    const detailFilterUiActive = openDetailFilterColumnId != null;
    if (!needsDetail || !detailFilterUiActive) return {};
    const map: Record<string, string[]> = {};
    const actorFieldKey = String(ACTOR_TO_FIELD[actor]);
    const actorField = ACTOR_TO_FIELD[actor];
    const drillActorValues = sliceDrilldown.actorValues ?? [];
    const drillLoanTypes = sliceDrilldown.loanTypes ?? [];
    const drillLoanPurposes = sliceDrilldown.loanPurposes ?? [];

    const matchesSlices = (
      loan: LoanRecord & { daysActive?: number },
      ignored: "milestone" | "actor" | "loanType" | "loanPurpose" | null,
    ) => {
      if (ignored !== "milestone" && sliceMilestones.length > 0 && !sliceMilestones.includes(loan.currentMilestone)) {
        return false;
      }
      const actorValue = String(loan[actorField] ?? "Unknown");
      if (ignored !== "actor" && drillActorValues.length > 0 && !drillActorValues.includes(actorValue)) {
        return false;
      }
      if (ignored !== "loanType" && drillLoanTypes.length > 0 && !drillLoanTypes.includes(loan.loanType)) {
        return false;
      }
      if (ignored !== "loanPurpose" && drillLoanPurposes.length > 0 && !drillLoanPurposes.includes(loan.loanPurpose)) {
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
      for (const loan of optionSource) values.add(getCellDisplayValue(loan, col.key));
      map[String(col.key)] = [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    }
    return map;
  }, [detailColumns, actor, activeLoans, loansAfterSliceFilters, sliceMilestones, sliceDrilldown, needsDetail, openDetailFilterColumnId]);

  const sortedDetailRows = useMemo(() => {
    if (!needsDetail || renderStage !== "detail") return [];
    const dir = detailSort.direction === "asc" ? 1 : -1;
    return [...deferredFilteredActiveLoans].sort((a, b) => {
      const av = detailSort.key === "daysActive" ? a.daysActive : a[detailSort.key];
      const bv = detailSort.key === "daysActive" ? b.daysActive : b[detailSort.key];
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
      return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { sensitivity: "base" }) * dir;
    });
  }, [deferredFilteredActiveLoans, detailSort, needsDetail, renderStage]);
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

  const rootStyle = useMemo(() => ({ width, minHeight: height }), [width, height]);
  const toggleMilestoneSlice = (milestone: string) => {
    if (!groupId || !milestone) return;
    const prev = section?.activeWorkloadSliceMilestones ?? [];
    updateFilters(groupId, { activeWorkloadSliceMilestones: prev.includes(milestone) ? prev.filter((v) => v !== milestone) : [...prev, milestone] });
  };
  const toggleDrilldownSlice = (row: DrillRow) => {
    if (!groupId) return;
    const prev = section?.activeWorkloadSliceDrilldown ?? { actorValues: [], loanTypes: [], loanPurposes: [] };
    if (row.level === "actor") updateFilters(groupId, { activeWorkloadSliceDrilldown: prev.actorValues.length === 1 && prev.actorValues[0] === row.label ? { actorValues: [], loanTypes: [], loanPurposes: [] } : { actorValues: [row.label], loanTypes: [], loanPurposes: [] } });
    else if (row.level === "loanType") updateFilters(groupId, { activeWorkloadSliceDrilldown: prev.loanTypes.length === 1 && prev.loanTypes[0] === row.label ? { actorValues: [], loanTypes: [], loanPurposes: [] } : { actorValues: [], loanTypes: [row.label], loanPurposes: [] } });
    else updateFilters(groupId, { activeWorkloadSliceDrilldown: prev.loanPurposes.length === 1 && prev.loanPurposes[0] === row.label ? { actorValues: [], loanTypes: [], loanPurposes: [] } : { actorValues: [], loanTypes: [], loanPurposes: [row.label] } });
  };
  const handleMilestoneChartClick = (state: unknown) => {
    if (suppressNextChartClickRef.current) { suppressNextChartClickRef.current = false; return; }
    const activeLabel = typeof state === "object" && state != null && "activeLabel" in state ? String((state as { activeLabel?: string }).activeLabel ?? "") : "";
    if (activeLabel) toggleMilestoneSlice(activeLabel);
  };
  const handleMilestoneBarClick = (data: unknown, index?: number) => {
    suppressNextChartClickRef.current = true;
    const fromPayload = typeof data === "object" && data != null ? String((data as { payload?: { name?: string }; name?: string }).payload?.name ?? (data as { name?: string }).name ?? "") : "";
    if (fromPayload) { toggleMilestoneSlice(fromPayload); return; }
    if (typeof index === "number") { const row = milestoneData[index]; if (row?.name) toggleMilestoneSlice(row.name); }
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
    return <g transform={`translate(${props.x ?? 0},${props.y ?? 0})`}><text x={-8} y={0} dy={safeLines.length > 1 ? -(safeLines.length - 1) * 6 : 4} textAnchor="end" className="fill-slate-700 dark:fill-slate-300" style={{ cursor: "pointer" }} onClick={() => toggleMilestoneSlice(value)}>{safeLines.map((line, index) => <tspan key={`${line}-${index}`} x={-8} dy={index === 0 ? 0 : 12}>{line}</tspan>)}</text></g>;
  };
  const renderSortIcon = (key: keyof LoanRecord | "daysActive") => detailSort.key !== key ? <ArrowUpDown className="h-3.5 w-3.5 opacity-40" /> : detailSort.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  const getLinkedColumnFilter = (columnId: string): ColumnFilterState[string] | undefined => {
    if (columnId === "currentMilestone" && sliceMilestones.length > 0) {
      return { kind: "text", selectedValues: [...sliceMilestones] };
    }
    const actorColumnId = String(ACTOR_TO_FIELD[actor]);
    if (columnId === actorColumnId && (sliceDrilldown.actorValues ?? []).length > 0) {
      return { kind: "text", selectedValues: [...(sliceDrilldown.actorValues ?? [])] };
    }
    if (columnId === "loanType" && (sliceDrilldown.loanTypes ?? []).length > 0) {
      return { kind: "text", selectedValues: [...(sliceDrilldown.loanTypes ?? [])] };
    }
    if (columnId === "loanPurpose" && (sliceDrilldown.loanPurposes ?? []).length > 0) {
      return { kind: "text", selectedValues: [...(sliceDrilldown.loanPurposes ?? [])] };
    }
    return undefined;
  };
  const getEffectiveColumnFilter = (columnId: string): ColumnFilterState[string] | undefined =>
    appliedDetailFilters[columnId] ?? getLinkedColumnFilter(columnId);

  if (loading) return <div className="h-full w-full flex items-center justify-center text-xs text-slate-500" style={rootStyle}>Loading Active Workload…</div>;
  if (error) return <div className="h-full w-full flex items-center justify-center text-xs text-red-500" style={rootStyle}>{error}</div>;
  if (!selectedTenantId) return <div className="h-full w-full flex items-center justify-center text-xs text-slate-500" style={rootStyle}>Select tenant</div>;

  if (variant === "kpi-active-files") {
    return <Card className="h-full" style={rootStyle}><CardHeader className="pb-1"><CardTitle className="text-sm">Active Files</CardTitle></CardHeader><CardContent className="text-4xl font-semibold text-cyan-700">{kpis.activeFiles.toLocaleString()}</CardContent></Card>;
  }
  if (variant === "kpi-days-active") {
    return <Card className="h-full" style={rootStyle}><CardHeader className="pb-1"><CardTitle className="text-sm">{aggregation === "average" ? "Average Days Active" : "Median Days Active"}</CardTitle></CardHeader><CardContent className="text-4xl font-semibold text-cyan-700">{kpis.daysActive.toFixed(2)}</CardContent></Card>;
  }
  if (variant === "milestone-chart") {
    return (
      <div className="h-full w-full rounded-lg bg-white dark:bg-slate-900/80 p-3" style={rootStyle}>
        <CardHeader><CardTitle className="text-sm">Active Loans by Current Milestone</CardTitle></CardHeader>
        {renderStage === "kpi" && (
          <div className="pb-2 text-xs text-slate-500 dark:text-slate-400">Loading chart...</div>
        )}
        <div className="h-[calc(100%-40px)]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={milestoneData} layout="vertical" margin={{ top: 24, left: 8, right: 16, bottom: 12 }} barCategoryGap="28%" onClick={handleMilestoneChartClick} style={{ cursor: "pointer" }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={milestoneAxisWidth} interval={0} tick={milestoneTick} />
              <Tooltip />
              <ReferenceLine x={kpis.daysActive} stroke="#0f766e" strokeDasharray="6 4" label={{ value: `${aggregation === "average" ? "Average" : "Median"} Days Active (${kpis.daysActive.toFixed(2)})`, position: "top", fill: "#0f766e", fontSize: 11 }} />
              <Bar dataKey="activeFiles" fill="#3b82f6" name="Active Files" barSize={10} cursor="pointer" onClick={handleMilestoneBarClick}><LabelList dataKey="activeFiles" position="right" /></Bar>
              <Bar dataKey="daysActive" fill="#e11d48" name={`${aggregation === "average" ? "Average" : "Median"} Days Active`} barSize={10} cursor="pointer" onClick={handleMilestoneBarClick}><LabelList dataKey="daysActive" position="right" formatter={(value: number) => value.toFixed(2)} /></Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#3b82f6]" />
            Loan Count
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e11d48]" />
            {aggregation === "average" ? "Average Days Active" : "Median Days Active"}
          </span>
        </div>
      </div>
    );
  }
  if (variant === "drilldown") {
    return (
      <div className="h-full w-full rounded-lg bg-white dark:bg-slate-900/80 p-3" style={rootStyle}>
        <div className="flex items-center justify-between pb-2"><CardTitle className="text-sm">Drilldown</CardTitle><div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => setExpanded(new Set(drillRows.filter((r) => r.level !== "loanPurpose").map((r) => r.id)))}>Expand All</Button><Button size="sm" variant="outline" onClick={() => setExpanded(new Set())}>Collapse All</Button></div></div>
        <div className="h-[calc(100%-40px)] overflow-auto">
          <table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="px-3 py-2 text-left">{actor}</th><th className="px-3 py-2 text-right whitespace-nowrap">Active Files</th><th className="px-3 py-2 text-right whitespace-nowrap">{aggregation === "average" ? "Average" : "Median"} Days Active</th></tr></thead><tbody>{visibleDrillRows.map((row) => { const hasChildren = (drillRowsByParent.get(row.id) ?? []).length > 0; return <tr key={row.id} className={`cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/90 dark:hover:bg-slate-700/60 ${((row.level === "actor" && (sliceDrilldown.actorValues ?? []).includes(row.label)) || (row.level === "loanType" && (sliceDrilldown.loanTypes ?? []).includes(row.label)) || (row.level === "loanPurpose" && (sliceDrilldown.loanPurposes ?? []).includes(row.label))) ? "bg-blue-50/80 dark:bg-slate-800/80" : ""}`} onClick={() => toggleDrilldownSlice(row)}><td className="px-3 py-2"><div className="flex items-center gap-1" style={{ paddingLeft: `${row.level === "loanPurpose" ? 36 : row.level === "loanType" ? 18 : 0}px` }}>{hasChildren ? <button type="button" className="rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700" onClick={(event) => { event.stopPropagation(); setExpanded((prev) => { const next = new Set(prev); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; }); }}>{expanded.has(row.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button> : <span className="inline-block w-4" />}<span className={row.level !== "loanPurpose" ? "font-semibold text-slate-800 dark:text-slate-200" : "text-slate-700 dark:text-slate-300"}>{row.label}</span></div></td><td className="px-3 py-2 text-right">{row.activeFiles.toLocaleString()}</td><td className="px-3 py-2 text-right">{row.daysActive.toFixed(2)}</td></tr>; })}</tbody></table>
        </div>
      </div>
    );
  }

  // detail-table
  return (
    <div className="h-full w-full rounded-lg bg-white dark:bg-slate-900/80 p-3" style={rootStyle}>
      <div className="flex items-center justify-between pb-2">
        <div><CardTitle className="text-sm">Active Loans Detail</CardTitle><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sortedDetailRows.length.toLocaleString()} loans</p></div>
        <Button size="sm" variant="outline" onClick={() => groupId && updateFilters(groupId, { activeWorkloadShowDetailColumnFilters: !showDetailColumnFilters })}><Filter className="mr-1 h-4 w-4" />{showDetailColumnFilters ? "Hide Filters" : "Show Filters"}</Button>
      </div>
      {renderStage !== "detail" && (
        <div className="pb-2 text-xs text-slate-500 dark:text-slate-400">Loading detail table...</div>
      )}
      <div ref={detailTableScrollRef} onScroll={handleDetailTableScroll} className="relative max-h-[520px] overflow-auto border-t border-slate-200 dark:border-slate-700">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-40 bg-slate-50 dark:bg-slate-800"><tr className="bg-slate-50 dark:bg-slate-800">{detailColumns.map((column) => { const columnId = String(column.key); return <th key={columnId} className="h-12 border-b border-slate-200 bg-slate-50 px-4 text-left align-middle font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><div className="inline-flex items-center gap-1"><button type="button" className="inline-flex items-center gap-1" onClick={() => groupId && updateFilters(groupId, { activeWorkloadDetailSort: detailSort.key === column.key ? { key: column.key, direction: detailSort.direction === "asc" ? "desc" : "asc" } : { key: String(column.key), direction: "asc" } })}>{column.label}{renderSortIcon(column.key)}</button>{showDetailColumnFilters && <Popover open={openDetailFilterColumnId === columnId} onOpenChange={(open) => { if (open) { setOpenDetailFilterColumnId(columnId); setDraftDetailFilters((prev) => ({ ...prev, [columnId]: getEffectiveColumnFilter(columnId) })); } else setOpenDetailFilterColumnId(null); }}><PopoverTrigger asChild><button type="button" className={cn("rounded p-1", isFilterActive(getEffectiveColumnFilter(columnId)) ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100")}><Filter className="h-3.5 w-3.5" /></button></PopoverTrigger><PopoverContent align="start" className="w-[420px] p-3"><div className="mb-2 flex items-center justify-between gap-2"><div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{column.label}</div><div className="flex items-center gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setOpenDetailFilterColumnId(null)}>Cancel</Button><Button type="button" size="sm" onClick={() => { if (!groupId) return; const draft = draftDetailFilters[columnId]; const hasActiveDraft = Boolean(draft && isFilterActive(draft)); const next = { ...appliedDetailFilters }; if (hasActiveDraft && draft) next[columnId] = draft; else delete next[columnId]; const updates: Partial<SectionFilters> = { activeWorkloadDetailColumnFilters: next }; const actorColumnId = String(ACTOR_TO_FIELD[actor]); if (!hasActiveDraft) { if (columnId === "currentMilestone") updates.activeWorkloadSliceMilestones = []; else if (columnId === actorColumnId || columnId === "loanType" || columnId === "loanPurpose") updates.activeWorkloadSliceDrilldown = { actorValues: [], loanTypes: [], loanPurposes: [] }; } updateFilters(groupId, updates); setOpenDetailFilterColumnId(null); }}>Apply Filters</Button></div></div>{(() => { const kind = NUMERIC_COLUMN_KEYS.has(columnId) ? "number" : DATE_COLUMN_KEYS.has(columnId) ? "date" : "text"; const current = draftDetailFilters[columnId]; const options = detailFilterOptionsByColumn[columnId] ?? []; if (kind === "date") { const dateFilter: DateColumnFilter = current?.kind === "date" ? current : { kind: "date" }; const yearToken = String(new Date().getFullYear()); const fixedYears = ["2025", "2024", "2023"]; const dateShortcutOptions: Array<{ token: string; label: string; kind: "preset" | "year" | "ytd" }> = [{ token: "last-30-days", label: "Last 30 Days", kind: "preset" }, { token: "mtd", label: "MTD", kind: "preset" }, { token: "last-month", label: "Last Month", kind: "preset" }, { token: "ytd", label: `${yearToken} YTD`, kind: "ytd" }, ...fixedYears.map((y) => ({ token: y, label: y, kind: "year" as const })), { token: "rolling-13", label: "L13M", kind: "preset" }, { token: "rolling-12", label: "L12M", kind: "preset" }]; return <div className="space-y-3"><Button type="button" size="sm" variant={isDateFilterBlankOnlyShortcut(dateFilter.shortcut) ? "default" : "outline"} className="w-full justify-start" onClick={() => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: DATE_FILTER_BLANK_SHORTCUT, from: "", to: "" } }))}>{DATE_FILTER_BLANK_LABEL}</Button><div className="grid grid-cols-2 gap-2"><Input type="date" value={dateFilter.from ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", from: e.target.value, to: dateFilter.to, shortcut: undefined } }))} /><Input type="date" value={dateFilter.to ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", from: dateFilter.from, to: e.target.value, shortcut: undefined } }))} /></div><div className="grid grid-cols-2 gap-2">{dateShortcutOptions.map((opt) => <Button key={opt.token} type="button" size="sm" variant={dateFilter.shortcut === opt.token ? "default" : "outline"} onClick={() => { if (opt.kind === "year") { setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: opt.token, from: `${opt.token}-01-01`, to: `${opt.token}-12-31` } })); return; } const range = computePresetDateRange(opt.kind === "ytd" ? "ytd" : (opt.token as PeriodPreset)); setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "date", shortcut: opt.token, from: range.start, to: range.end } })); }}>{opt.label}</Button>)}</div></div>; } if (kind === "number") { const numberFilter: NumberColumnFilter = current?.kind === "number" ? current : { kind: "number", mode: "all", selectedValues: [] }; const selected = numberFilter.mode === "all" ? numberFilter.selectedValues : []; const ordered = [...options].sort((a, b) => { const as = selected.includes(a) ? 1 : 0; const bs = selected.includes(b) ? 1 : 0; if (as !== bs) return bs - as; return a.localeCompare(b, undefined, { numeric: true }); }); return <Tabs value={numberFilter.mode} onValueChange={(mode) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: mode as NumericFilterMode, selectedValues: [] } }))}><TabsList className="grid w-full grid-cols-4"><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="range">Range</TabsTrigger><TabsTrigger value="min">Greater Than</TabsTrigger><TabsTrigger value="max">Less Than</TabsTrigger></TabsList><TabsContent value="all" className="space-y-2"><Command shouldFilter={false}><CommandInput placeholder={`Search ${column.label}`} value={filterSearchByColumn[columnId] ?? ""} onValueChange={(value) => setFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }))} /><CommandList><CommandEmpty>No values found.</CommandEmpty>{ordered.filter((v) => v.toLowerCase().includes((filterSearchByColumn[columnId] ?? "").toLowerCase())).map((value) => { const isSelected = selected.includes(value); return <CommandItem key={value} onSelect={() => setDraftDetailFilters((prev) => { const cur = prev[columnId]?.kind === "number" ? prev[columnId] : { kind: "number", mode: "all", selectedValues: [] as string[] }; const nextSelected = cur.selectedValues.includes(value) ? cur.selectedValues.filter((v) => v !== value) : [...cur.selectedValues, value]; return { ...prev, [columnId]: { kind: "number", mode: "all", selectedValues: nextSelected } }; })} className={cn("cursor-pointer", isSelected ? "!bg-accent !text-accent-foreground" : "")}><span className="mr-2">{isSelected ? "✓" : ""}</span>{value}</CommandItem>; })}</CommandList></Command></TabsContent><TabsContent value="range" className="space-y-2"><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"><Input type="number" placeholder="Min" value={numberFilter.min ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "range", selectedValues: [], min: e.target.value, max: numberFilter.max } }))} /><span>-</span><Input type="number" placeholder="Max" value={numberFilter.max ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "range", selectedValues: [], min: numberFilter.min, max: e.target.value } }))} /></div></TabsContent><TabsContent value="min" className="space-y-2"><div className="flex items-center gap-2"><span className="text-sm">{">="}</span><Input type="number" placeholder="Value" value={numberFilter.value ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "min", selectedValues: [], value: e.target.value } }))} /></div></TabsContent><TabsContent value="max" className="space-y-2"><div className="flex items-center gap-2"><span className="text-sm">{"<="}</span><Input type="number" placeholder="Value" value={numberFilter.value ?? ""} onChange={(e) => setDraftDetailFilters((prev) => ({ ...prev, [columnId]: { kind: "number", mode: "max", selectedValues: [], value: e.target.value } }))} /></div></TabsContent></Tabs>; } const textFilter: TextColumnFilter = current?.kind === "text" ? current : { kind: "text", selectedValues: [] }; const ordered = [...options].sort((a, b) => { const as = textFilter.selectedValues.includes(a) ? 1 : 0; const bs = textFilter.selectedValues.includes(b) ? 1 : 0; if (as !== bs) return bs - as; return a.localeCompare(b, undefined, { numeric: true }); }); return <Command shouldFilter={false}><CommandInput placeholder={`Search ${column.label}`} value={filterSearchByColumn[columnId] ?? ""} onValueChange={(value) => setFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }))} /><CommandList><CommandEmpty>No values found.</CommandEmpty>{ordered.filter((v) => v.toLowerCase().includes((filterSearchByColumn[columnId] ?? "").toLowerCase())).map((value) => { const isSelected = textFilter.selectedValues.includes(value); return <CommandItem key={value} onSelect={() => setDraftDetailFilters((prev) => { const cur = prev[columnId]?.kind === "text" ? prev[columnId] : { kind: "text", selectedValues: [] as string[] }; const nextSelected = cur.selectedValues.includes(value) ? cur.selectedValues.filter((v) => v !== value) : [...cur.selectedValues, value]; return { ...prev, [columnId]: { kind: "text", selectedValues: nextSelected } }; })} className={cn("cursor-pointer", isSelected ? "!bg-accent !text-accent-foreground" : "")}><span className="mr-2">{isSelected ? "✓" : ""}</span>{value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}</CommandItem>; })}</CommandList></Command>; })()}<Button type="button" size="sm" variant="ghost" className="mt-2 w-full" onClick={() => setDraftDetailFilters((prev) => { const next = { ...prev }; delete next[columnId]; return next; })}>Clear Selection</Button></PopoverContent></Popover>}</div></th>; })}</tr></thead>
          <tbody>{visibleDetailRows.map((loan) => <tr key={loan.loanNumber} className="border-b border-slate-200 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-700/40">{detailColumns.map((column) => { const display = getCellDisplayValue(loan, column.key); const columnId = String(column.key); const isFiltered = isFilterActive(getEffectiveColumnFilter(columnId)); return <td key={columnId} className="p-4 align-middle"><button type="button" className={`rounded px-1 py-0.5 -mx-1 -my-0.5 text-left transition-colors hover:bg-sky-100/80 dark:hover:bg-sky-900/40 ${isFiltered ? "ring-1 ring-emerald-500" : ""}`} onClick={() => { if (!groupId) return; const next = { ...appliedDetailFilters }; const kind = NUMERIC_COLUMN_KEYS.has(columnId) ? "number" : DATE_COLUMN_KEYS.has(columnId) ? "date" : "text"; if (kind === "number") { const token = String(getFilterRawValue(loan, column.key)); const current = next[columnId]; const selected = current?.kind === "number" && current.mode === "all" ? current.selectedValues : []; const nextSelected = selected.includes(token) ? selected.filter((v) => v !== token) : [token]; if (nextSelected.length === 0) delete next[columnId]; else next[columnId] = { kind: "number", mode: "all", selectedValues: nextSelected }; } else if (kind === "date") { const raw = String(getFilterRawValue(loan, column.key) ?? ""); const current = next[columnId]; if (current?.kind === "date" && current.from === raw && current.to === raw) delete next[columnId]; else next[columnId] = { kind: "date", from: raw, to: raw, shortcut: undefined }; } else { const current = next[columnId]; const selected = current?.kind === "text" ? current.selectedValues : []; const nextSelected = selected.includes(display) ? selected.filter((v) => v !== display) : [display]; if (nextSelected.length === 0) delete next[columnId]; else next[columnId] = { kind: "text", selectedValues: nextSelected }; } updateFilters(groupId, { activeWorkloadDetailColumnFilters: next }); }}>{display}</button></td>; })}</tr>)}</tbody>
        </table>
        {visibleDetailRows.length < sortedDetailRows.length && (
          <div className="px-4 py-2 text-center text-xs text-slate-500 dark:text-slate-400">
            Showing {visibleDetailRows.length.toLocaleString()} of {sortedDetailRows.length.toLocaleString()} loans
          </div>
        )}
      </div>
    </div>
  );
}

export const ActiveWorkloadEmbed = React.memo(ActiveWorkloadEmbedInner);


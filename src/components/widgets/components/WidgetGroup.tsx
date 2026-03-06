/**
 * WidgetGroup – State-of-the-art widget container with:
 *
 *  • react-grid-layout for drag-and-drop reordering AND per-widget resize
 *  • Auto-compacting grid (no gaps, Grafana-style)
 *  • Drag handle + hover toolbar (duplicate, maximize, delete)
 *  • Full-screen "Maximize" dialog for any widget
 *  • Inline-editable group title (double-click)
 *  • Collapse / expand toggle
 *  • "Add widget" picker filtered to the group's data source
 *  • DatePeriodPicker + section-specific filter controls
 *  • Layout persistence via payload (stored as grid-unit coords)
 *  • Polymorphic items: supports both registry widgets AND Cohi SQL widgets
 *
 * Patterns borrowed from Grafana, Notion, Retool, and Datadog.
 */

import React, {
  useEffect,
  useCallback,
  useState,
  useMemo,
  useRef,
} from 'react';
import GridLayout, { type Layout, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FolderInput,
  GripVertical,
  Link2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Plus,
  Trash2,
  X,
  Pencil,
  Check,
  Sparkles,
  Calendar,
  CalendarDays,
  SlidersHorizontal,
  Unlink2,
  Bookmark,
  BookmarkCheck,
  Lock,
  Unlock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePeriodPicker, type DateRange, type PeriodSelection, type PeriodPreset, computePresetDateRange } from '@/components/ui/DatePeriodPicker';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useWidgetSectionStore,
  type SectionFilters,
  type SectionType,
  type DynamicFilterEntry,
  ACTORS_TABLE_DEFAULT_COLUMN_IDS,
} from '@/stores/widgetSectionStore';
import {
  getWidgetDefinition,
} from '@/components/widgets/registry';
import type { ColumnDef } from '@/components/views/LoanDetailView';
import { useWidgetData } from '@/components/widgets/data';
import { CohiWidgetRenderer } from '@/components/workbench/canvas/CohiWidgetRenderer';
import { EditWidgetDialog } from '@/components/widgets/components/EditWidgetDialog';
import { AddWidgetDialog } from '@/components/widgets/components/AddWidgetDialog';
import { LoanDetailColumnsModal } from '@/components/widgets/components/LoanDetailColumnsModal';
import { PricingDashboardColumnsModal } from '@/components/widgets/components/PricingDashboardColumnsModal';
import { ActorsTableColumnsModal } from '@/components/widgets/components/ActorsTableColumnsModal';
import { SalesScorecardMilestoneDatesModal, DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS } from '@/components/widgets/components/SalesScorecardMilestoneDatesModal';
import { WidgetDataProvider } from '@/components/widgets/data';
import { useLoanDetailColumnsStore } from '@/stores/loanDetailColumnsStore';
import { useTenantStore } from '@/stores/tenantStore';
import { useFilterOptions } from '@/hooks/useFilterOptions';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import { useFilterPresetStore, type FilterPreset } from '@/stores/filterPresetStore';
import { usePipelineAnalysisRange, usePipelineAnalysisFilterOptions, usePipelineAnalysisConfig } from '@/hooks/usePipelineAnalysisData';
import { api } from '@/lib/api';
import type { GroupWidgetItem, WidgetFilterState } from '@/components/workbench/canvas/types';
import type { DateFilter, DimensionFilter } from '@/hooks/useCohiWidgetData';
import type { VisualizationConfig } from '@/hooks/useCohiChat';

// ---------------------------------------------------------------------------
// Stable empty array to avoid Zustand selector re-render loops
// ---------------------------------------------------------------------------

const EMPTY_FILTER_PRESETS: FilterPreset[] = [];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WidgetGroupProps {
  groupId: string;
  title: string;
  sectionType: SectionType;
  /** @deprecated Use `items` instead – kept for backward compat */
  widgetIds: string[];
  /** Mixed items: registry + cohi_widget.  Takes precedence over widgetIds. */
  items?: GroupWidgetItem[];
  /** Persisted grid layouts (grid-unit coords, keyed by sortable id) */
  widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Layout version – stale layouts from older grid configs are auto-discarded */
  layoutVersion?: number;
  /** Whether the group body is collapsed */
  collapsed?: boolean;
  width: number;
  height: number;
  /** Full payload update callback (handles widgetIds, items, layouts, title, collapsed) */
  onUpdatePayload?: (patch: Record<string, unknown>) => void;
  /** Other widget groups on the canvas that items can be moved to */
  otherGroups?: { id: string; title: string }[];
  /** Called when a user moves an item out of this group into another group */
  onMoveItemOut?: (item: GroupWidgetItem, targetGroupId: string) => void;
  /** Persisted filter state restored from saved canvas */
  savedFilters?: Partial<import('@/stores/widgetSectionStore').SectionFilters>;
  /** Start with filters collapsed (compact mode for deep-dive canvases) */
  filtersCollapsed?: boolean;
  /**
   * When true, all widgets share the group's master filter.
   * When false, each Cohi widget uses its own independent filter bar.
   * Defaults to true for backward compatibility.
   */
  filterSync?: boolean;
  /** Whether this group's filters are locked for viewers */
  filterLocked?: boolean;
  /** Whether this group is editable by current user (owner/editor) */
  canEdit?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_COLS = 36; // 36 cols – fine granularity, safe margin budget
const ROW_HEIGHT = 16; // 16px rows – pixel-precise vertical control
const GRID_MARGIN: [number, number] = [6, 6];
const GRID_PADDING: [number, number] = [0, 0];
const HEADER_HEIGHT = 90; // approx header+filters height
/**
 * Minimum content width guaranteed to the grid.
 * Must be > margin * (GRID_COLS + 1) to avoid negative column widths.
 * 6 * 37 = 222px, so 400px gives plenty of room.
 */
const MIN_GRID_WIDTH = 400;
/** Bump this any time you change GRID_COLS / ROW_HEIGHT so stale saved layouts get discarded */
const LAYOUT_VERSION = 9; // bumped from 8 → 9 for actors chart + KPIs same size side-by-side default

// ---------------------------------------------------------------------------
// Section-specific filter options
// ---------------------------------------------------------------------------

const DATE_FIELD_OPTIONS = [
  { value: 'application_date', label: 'Application Date' },
  { value: 'funding_date', label: 'Funding Date' },
  { value: 'started_date', label: 'Started Date' },
  { value: 'closing_date', label: 'Closing Date' },
  { value: 'lock_date', label: 'Lock Date' },
];

const APPLICATION_TYPE_OPTIONS = [
  { value: 'Applications Taken', label: 'Applications Taken' },
  { value: 'Funded Production', label: 'Funded Production' },
  { value: 'Lost Opportunities', label: 'Lost Opportunities' },
  { value: 'All Loans', label: 'All Loans' },
];

const ACTOR_TYPE_OPTIONS = [
  { value: 'loan_officer', label: 'By Loan Officer' },
  { value: 'branch', label: 'By Branch' },
];

// ---------------------------------------------------------------------------
// Data-driven section filter config
// ---------------------------------------------------------------------------

/**
 * Describes a single filter field that a section type supports.
 * Filters with `staticOptions` render a plain dropdown.
 * Filters with `optionsSource` fetch distinct values from the API.
 * Filters with `dependsOn` cascade: their options are narrowed by the parent
 * filter value, and they reset to 'all' when the parent changes.
 */
interface SectionFilterField {
  /** Which SectionFilters key this maps to */
  key: keyof SectionFilters;
  /** Display label shown next to the dropdown */
  label: string;
  /** Label for the "all" option (e.g. "All Branches"). Empty string = no "all" option. */
  allLabel: string;
  /** DB column name for fetching distinct values from /api/loans/distinct-values/:column */
  optionsSource?: string;
  /** For cascading: which other filter key provides the parent value */
  dependsOn?: keyof SectionFilters;
  /** For static (non-API) option lists */
  staticOptions?: { value: string; label: string }[];
}

const SECTION_FILTER_CONFIG: Partial<Record<SectionType, SectionFilterField[]>> = {
  'company-scorecard': [
    { key: 'dateField', label: 'Date Field', allLabel: '', staticOptions: DATE_FIELD_OPTIONS },
    { key: 'branch', label: 'Branch', allLabel: 'All Branches', optionsSource: 'branch' },
    { key: 'loanOfficer', label: 'Loan Officer', allLabel: 'All Loan Officers', optionsSource: 'loan_officer', dependsOn: 'branch' },
  ],
  'loan-detail': [
    { key: 'dateField', label: 'Date Field', allLabel: '', staticOptions: DATE_FIELD_OPTIONS },
    { key: 'branch', label: 'Branch', allLabel: 'All Branches', optionsSource: 'branch' },
    { key: 'loanOfficer', label: 'Loan Officer', allLabel: 'All Loan Officers', optionsSource: 'loan_officer', dependsOn: 'branch' },
  ],
  'credit-risk': [
    { key: 'applicationType', label: 'Type', allLabel: '', staticOptions: APPLICATION_TYPE_OPTIONS },
  ],
  'sales-scorecard': [
    { key: 'actorType', label: 'View', allLabel: '', staticOptions: ACTOR_TYPE_OPTIONS },
  ],
  'sales-scorecard-overview': [
    { key: 'salesScorecardOverviewMeasure', label: 'Measure', allLabel: '', staticOptions: [{ value: 'volume', label: 'Volume' }, { value: 'units', label: 'Units' }] },
    { key: 'salesScorecardOverviewTimeMeasure', label: 'Time', allLabel: '', staticOptions: [{ value: 'quarterly', label: 'Quarterly' }, { value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }, { value: 'daily', label: 'Daily' }] },
    { key: 'branch', label: 'Branch', allLabel: 'All Branches', optionsSource: 'branch' },
    { key: 'loanOfficer', label: 'Loan Officer', allLabel: 'All Loan Officers', optionsSource: 'loan_officer', dependsOn: 'branch' },
  ],
  'high-performers': [],
  'actors': [],
  'pricing-dashboard': [],
  'pipeline-analysis': [],
  'lock-stratification': [],
};

/**
 * Section-specific filter dimensions already shown in the section's filter bar.
 * AddFilterPicker excludes these so we don't offer duplicate filters (e.g. Pipeline Analysis
 * already has Loan Type, Purpose, Branch; Pricing has Loan Status as a default dropdown).
 *
 * Rule: Only list dimensions that are already exposed as a default filter in the UI. Do NOT
 * list dimensions that are merely "entity/actor type" selectors (e.g. pricing Entity = Branch
 * chooses what to group by; it is not the same as a "Branch" filter that filters to branch
 * 1000). So for pricing-dashboard, branch and loan_officer are NOT builtins—they are valid
 * additional dynamic filters (filter to a specific branch or loan officer).
 */
const SECTION_BUILTIN_FILTER_COLUMNS: Partial<Record<SectionType, string[]>> = {
  'pipeline-analysis': ['loan_type', 'loan_purpose', 'branch'],
  'pricing-dashboard': ['current_loan_status'],
  'sales-scorecard-overview': ['branch', 'loan_officer'],
};

const HIGH_PERFORMERS_DATE_TYPE_OPTIONS: { value: 'funding_date' | 'closing_date' | 'application_date'; label: string }[] = [
  { value: 'funding_date', label: 'Funded Loans' },
  { value: 'closing_date', label: 'Closed Loans' },
  { value: 'application_date', label: 'Applications Taken' },
];

// Pricing Dashboard – same options as standalone page
const PRICING_ENTITY_OPTIONS = [
  { value: 'branch', label: 'Branch' },
  { value: 'broker_lender_name', label: 'Broker Lender Name' },
  { value: 'channel', label: 'Channel' },
  { value: 'investor', label: 'Investor' },
];
const PRICING_ACTOR_OPTIONS = [
  { value: 'loan_officer', label: 'Loan Officer' },
  { value: 'account_executive', label: 'Account Executive' },
];
const PRICING_DATE_RANGE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: 'mtd', label: 'Month to Date' },
  { value: 'lm', label: 'Last Month' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'ly', label: 'Last Year' },
];
const PRICING_LOAN_FUNDING_OPTIONS = [
  { value: 'funded', label: 'Funded Loans' },
  { value: 'closed', label: 'Closed Loans' },
];
const PRICING_LOAN_STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'funded', label: 'Funded' },
];
const PRICING_LOCK_STATUS_OPTIONS = [
  { value: 'locked', label: 'Active Locked' },
  { value: 'not_locked', label: 'Active Not Locked' },
  { value: 'total', label: 'Active Total' },
];

const LOCK_STRAT_LOCKED_OPTIONS = [
  { value: 'active_locked', label: 'Active Locked' },
  { value: 'active_not_locked', label: 'Active NOT Locked' },
  { value: 'all_active', label: 'All Active Loans' },
];
const LOCK_STRAT_MEASURE_OPTIONS = [
  { value: 'volume', label: 'Volume' },
  { value: 'units', label: 'Units' },
  { value: 'wac', label: 'WAC' },
  { value: 'wa_fico', label: 'WA FICO' },
];
const LOCK_STRAT_MILESTONE_GROUP_OPTIONS = [
  { value: 'current_milestone', label: 'Current Milestone' },
  { value: 'investor', label: 'Investor' },
  { value: 'branch', label: 'Branch' },
  { value: 'broker_lender', label: 'Broker Lender' },
  { value: 'lo', label: 'Loan Officer' },
  { value: 'ae', label: 'Account Executive' },
];
const LOCK_STRAT_PULL_THROUGH_OPTIONS = [
  { value: '30', label: '30 Days' },
  { value: '60', label: '60 Days' },
  { value: '90', label: '90 Days' },
  { value: '120', label: '120 Days' },
  { value: 'ytd', label: 'Year to Date' },
];

/** Compact dropdown for pricing dashboard filters in WidgetGroup */
function PricingFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2 pr-6 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 canvas-interactive min-w-0 max-w-[140px]"
        title={label}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Pipeline Analysis filter row: snapshot day, year range, start date, view, pct metric, loan type / purpose / branch */
const SNAPSHOT_DAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
};

function PipelineAnalysisFilterRow({
  groupId,
  filters,
  updateFilters,
  pipelineRange,
  pipelineConfig,
  pipelineFilterOptions,
  loading,
  tenantId,
}: {
  groupId: string;
  filters: SectionFilters;
  updateFilters: (sectionId: string, partial: Partial<SectionFilters>) => void;
  pipelineRange: { minYear: number | null; maxYear: number | null } | null;
  pipelineConfig: { snapshot_day_of_week: number } | null;
  pipelineFilterOptions: { loanTypes: string[]; loanPurposes: string[]; branches: string[] } | null;
  loading: boolean;
  tenantId: string | null;
}) {
  const [backfillLoading, setBackfillLoading] = useState(false);

  const handleSnapshotDayChange = useCallback(
    async (dayStr: string) => {
      const d = parseInt(dayStr, 10);
      if (!tenantId || d < 1 || d > 5) return;
      setBackfillLoading(true);
      try {
        const url = `/api/pipeline-analysis/backfill?tenant_id=${encodeURIComponent(tenantId)}`;
        await api.request<{ success: boolean; message: string }>(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day_of_week: d }),
        });
        updateFilters(groupId, { pipelineAnalysisSnapshotDay: d });
      } catch {
        // Error could be shown via toast if desired
      } finally {
        setBackfillLoading(false);
      }
    },
    [tenantId, groupId, updateFilters],
  );
  const minYear = pipelineRange?.minYear ?? new Date().getFullYear() - 2;
  const maxYear = pipelineRange?.maxYear ?? new Date().getFullYear();
  const yearRangeOptions = useMemo(() => {
    const opts: string[] = [];
    for (let y = minYear; y < maxYear; y++) opts.push(`${y}-${y + 1}`);
    if (opts.length === 0) opts.push(`${maxYear - 1}-${maxYear}`);
    return opts;
  }, [minYear, maxYear]);

  const loanTypes = filters.pipelineAnalysisLoanTypes ?? [];
  const loanPurposes = filters.pipelineAnalysisLoanPurposes ?? [];
  const branches = filters.pipelineAnalysisBranches ?? [];
  const typeOpts = pipelineFilterOptions?.loanTypes ?? [];
  const purposeOpts = pipelineFilterOptions?.loanPurposes ?? [];
  const branchOpts = pipelineFilterOptions?.branches ?? [];

  const toggleMulti = (
    key: 'pipelineAnalysisLoanTypes' | 'pipelineAnalysisLoanPurposes' | 'pipelineAnalysisBranches',
    current: string[],
    allOptions: string[],
    value: string,
  ) => {
    if (current.length === 0) {
      updateFilters(groupId, { [key]: allOptions.filter((x) => x !== value) });
      return;
    }
    if (current.length === allOptions.length) {
      updateFilters(groupId, { [key]: [value] });
      return;
    }
    if (current.includes(value)) {
      updateFilters(groupId, { [key]: current.filter((x) => x !== value) });
    } else {
      updateFilters(groupId, { [key]: [...current, value] });
    }
  };

  const isChecked = (
    current: string[],
    allOptions: string[],
    value: string,
  ) => {
    if (current.length === 0) return true;
    if (current.length === allOptions.length) return true;
    return current.includes(value);
  };

  return (
    <>
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Snapshot day</span>
      <Select
        value={String(filters.pipelineAnalysisSnapshotDay ?? pipelineConfig?.snapshot_day_of_week ?? 1)}
        onValueChange={handleSnapshotDayChange}
        disabled={loading || backfillLoading || !tenantId}
      >
        <SelectTrigger className="h-7 w-[110px] text-xs">
          <SelectValue placeholder="Day" />
        </SelectTrigger>
        <SelectContent>
          {[1, 2, 3, 4, 5].map((d) => (
            <SelectItem key={d} value={String(d)}>
              {SNAPSHOT_DAY_LABELS[d]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Year range</span>
      <Select
        value={filters.pipelineAnalysisYearRange ?? (yearRangeOptions.length > 0 ? yearRangeOptions[yearRangeOptions.length - 1] : '')}
        onValueChange={(v) => updateFilters(groupId, { pipelineAnalysisYearRange: v || undefined })}
        disabled={loading || yearRangeOptions.length === 0}
      >
        <SelectTrigger className="h-7 w-[120px] text-xs">
          <SelectValue placeholder="Range" />
        </SelectTrigger>
        <SelectContent>
          {yearRangeOptions.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Start date</span>
      <Select
        value={filters.pipelineAnalysisStartDateField ?? 'application_date'}
        onValueChange={(v) => updateFilters(groupId, { pipelineAnalysisStartDateField: v as 'application_date' | 'lock_date' | 'processing_date' | 'credit_pull_date' | 'submitted_to_underwriting_date' })}
        disabled={loading}
      >
        <SelectTrigger className="h-7 w-[200px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="application_date">Application date</SelectItem>
          <SelectItem value="lock_date">Lock date</SelectItem>
          <SelectItem value="processing_date">Processing date</SelectItem>
          <SelectItem value="credit_pull_date">Credit pull date</SelectItem>
          <SelectItem value="submitted_to_underwriting_date">Submitted to underwriting date</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">View</span>
      <Select
        value={filters.pipelineAnalysisViewMode ?? 'week'}
        onValueChange={(v) => updateFilters(groupId, { pipelineAnalysisViewMode: v as 'week' | 'month' })}
        disabled={loading}
      >
        <SelectTrigger className="h-7 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="week">Week by week</SelectItem>
          <SelectItem value="month">Month by month</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Percent changes by</span>
      <Select
        value={filters.pipelineAnalysisPctMetric ?? 'volume'}
        onValueChange={(v) => updateFilters(groupId, { pipelineAnalysisPctMetric: v as 'volume' | 'units' })}
        disabled={loading}
      >
        <SelectTrigger className="h-7 w-[100px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="volume">Volume</SelectItem>
          <SelectItem value="units">Units</SelectItem>
        </SelectContent>
      </Select>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 min-w-[120px] justify-between text-xs" disabled={loading}>
            Loan type{(loanTypes.length === 0 || loanTypes.length === typeOpts.length) ? ' (All)' : ` (${loanTypes.length})`}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="flex justify-between gap-2 mb-1.5">
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => updateFilters(groupId, { pipelineAnalysisLoanTypes: [] })}>All</Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => updateFilters(groupId, { pipelineAnalysisLoanTypes: typeOpts })}>None</Button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {typeOpts.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-0.5 hover:bg-muted/60 text-xs">
                <Checkbox
                  checked={isChecked(loanTypes, typeOpts, opt)}
                  onCheckedChange={() => toggleMulti('pipelineAnalysisLoanTypes', loanTypes, typeOpts, opt)}
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 min-w-[120px] justify-between text-xs" disabled={loading}>
            Loan purpose{(loanPurposes.length === 0 || loanPurposes.length === purposeOpts.length) ? ' (All)' : ` (${loanPurposes.length})`}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="flex justify-between gap-2 mb-1.5">
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => updateFilters(groupId, { pipelineAnalysisLoanPurposes: [] })}>All</Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => updateFilters(groupId, { pipelineAnalysisLoanPurposes: purposeOpts })}>None</Button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {purposeOpts.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-0.5 hover:bg-muted/60 text-xs">
                <Checkbox
                  checked={isChecked(loanPurposes, purposeOpts, opt)}
                  onCheckedChange={() => toggleMulti('pipelineAnalysisLoanPurposes', loanPurposes, purposeOpts, opt)}
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 min-w-[120px] justify-between text-xs" disabled={loading}>
            Branch{(branches.length === 0 || branches.length === branchOpts.length) ? ' (All)' : ` (${branches.length})`}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="flex justify-between gap-2 mb-1.5">
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => updateFilters(groupId, { pipelineAnalysisBranches: [] })}>All</Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => updateFilters(groupId, { pipelineAnalysisBranches: branchOpts })}>None</Button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {branchOpts.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-0.5 hover:bg-muted/60 text-xs">
                <Checkbox
                  checked={isChecked(branches, branchOpts, opt)}
                  onCheckedChange={() => toggleMulti('pipelineAnalysisBranches', branches, branchOpts, opt)}
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

const ACTORS_DIMENSION_OPTIONS = ['channel', 'processor', 'closer', 'underwriter', 'loan_officer', 'branch', 'investor', 'warehouse_co_name'] as const;
const ACTORS_DIMENSION_LABELS: Record<string, string> = {
  channel: 'Channel',
  processor: 'Processor',
  closer: 'Closer',
  underwriter: 'Underwriter',
  loan_officer: 'Loan Officer',
  branch: 'Branch',
  investor: 'Investor',
  warehouse_co_name: 'Warehouse Co Name',
};

// ---------------------------------------------------------------------------
// Available dimension filter catalog — users can add these via the "+" button
// ---------------------------------------------------------------------------

/**
 * All loan-table columns a user can filter on.
 * These are fetched dynamically from the DB via /api/loans/distinct-values/:column.
 */
const AVAILABLE_FILTER_DIMENSIONS: { column: string; label: string }[] = [
  { column: 'branch', label: 'Branch' },
  { column: 'loan_officer', label: 'Loan Officer' },
  { column: 'channel', label: 'Channel' },
  { column: 'loan_type', label: 'Loan Type' },
  { column: 'loan_purpose', label: 'Loan Purpose' },
  { column: 'property_state', label: 'State' },
  { column: 'property_county', label: 'County' },
  { column: 'occupancy_type', label: 'Occupancy' },
  { column: 'property_type', label: 'Property Type' },
  { column: 'current_loan_status', label: 'Loan Status' },
  { column: 'investor_name', label: 'Investor' },
];

const SECTION_COLORS: Record<SectionType, { border: string; bg: string; accent: string; dot: string }> = {
  'company-scorecard':    { border: 'border-indigo-400/50',  bg: 'bg-indigo-50/50 dark:bg-indigo-950/20',  accent: 'text-indigo-600 dark:text-indigo-400',  dot: 'bg-indigo-500' },
  'credit-risk':          { border: 'border-emerald-400/50', bg: 'bg-emerald-50/50 dark:bg-emerald-950/20', accent: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  'sales-scorecard':      { border: 'border-violet-400/50',  bg: 'bg-violet-50/50 dark:bg-violet-950/20',  accent: 'text-violet-600 dark:text-violet-400',  dot: 'bg-violet-500' },
  'operations-scorecard': { border: 'border-amber-400/50',   bg: 'bg-amber-50/50 dark:bg-amber-950/20',   accent: 'text-amber-600 dark:text-amber-400',   dot: 'bg-amber-500' },
  'operations-trends':    { border: 'border-orange-400/50',  bg: 'bg-orange-50/50 dark:bg-orange-950/20',  accent: 'text-orange-600 dark:text-orange-400',  dot: 'bg-orange-500' },
  'sales-trends':         { border: 'border-fuchsia-400/50', bg: 'bg-fuchsia-50/50 dark:bg-fuchsia-950/20', accent: 'text-fuchsia-600 dark:text-fuchsia-400', dot: 'bg-fuchsia-500' },
  'funnel':               { border: 'border-sky-400/50',     bg: 'bg-sky-50/50 dark:bg-sky-950/20',       accent: 'text-sky-600 dark:text-sky-400',       dot: 'bg-sky-500' },
  'top-tiering-comparison': { border: 'border-cyan-400/50',  bg: 'bg-cyan-50/50 dark:bg-cyan-950/20',     accent: 'text-cyan-600 dark:text-cyan-400',     dot: 'bg-cyan-500' },
  'leaderboard':          { border: 'border-rose-400/50',    bg: 'bg-rose-50/50 dark:bg-rose-950/20',     accent: 'text-rose-600 dark:text-rose-400',     dot: 'bg-rose-500' },
  'executive-dashboard':  { border: 'border-blue-400/50',    bg: 'bg-blue-50/50 dark:bg-blue-950/20',     accent: 'text-blue-600 dark:text-blue-400',     dot: 'bg-blue-500' },
  'loan-detail':          { border: 'border-sky-400/50',     bg: 'bg-sky-50/50 dark:bg-sky-950/20',       accent: 'text-sky-600 dark:text-sky-400',     dot: 'bg-sky-500' },
  'workflow-conversion':  { border: 'border-teal-400/50',    bg: 'bg-teal-50/50 dark:bg-teal-950/20',    accent: 'text-teal-600 dark:text-teal-400',    dot: 'bg-teal-500' },
  'high-performers':      { border: 'border-amber-400/50',  bg: 'bg-amber-50/50 dark:bg-amber-950/20',   accent: 'text-amber-600 dark:text-amber-400',  dot: 'bg-amber-500' },
  'actors':              { border: 'border-cyan-400/50',   bg: 'bg-cyan-50/50 dark:bg-cyan-950/20',    accent: 'text-cyan-600 dark:text-cyan-400',   dot: 'bg-cyan-500' },
  'pricing-dashboard':   { border: 'border-emerald-400/50', bg: 'bg-emerald-50/50 dark:bg-emerald-950/20', accent: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  'pipeline-analysis':   { border: 'border-sky-400/50', bg: 'bg-sky-50/50 dark:bg-sky-950/20', accent: 'text-sky-600 dark:text-sky-400', dot: 'bg-sky-500' },
  'sales-scorecard-overview': { border: 'border-violet-400/50', bg: 'bg-violet-50/50 dark:bg-violet-950/20', accent: 'text-violet-600 dark:text-violet-400', dot: 'bg-violet-500' },
  'lock-stratification': { border: 'border-blue-400/50', bg: 'bg-blue-50/50 dark:bg-blue-950/20', accent: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
};

/**
 * Sections whose embedded component manages its own filter UI (date pickers,
 * scope selectors, etc.). The WidgetGroup header hides its own date/filter
 * controls for these sections to avoid redundant/conflicting UI.
 */
const SELF_MANAGED_SECTIONS: Set<SectionType> = new Set([
  'executive-dashboard',
  'leaderboard',
]);

// ---------------------------------------------------------------------------
// Helpers – convert legacy widgetIds to GroupWidgetItem[]
// ---------------------------------------------------------------------------

function normalizeItems(widgetIds: string[], items?: GroupWidgetItem[]): GroupWidgetItem[] {
  if (items && items.length > 0) return items;
  return widgetIds.map((defId) => ({ kind: 'registry' as const, defId }));
}

/** Stable key for a GroupWidgetItem at a given index */
function itemKey(item: GroupWidgetItem, idx: number): string {
  if (item.kind === 'registry') return `${item.defId}__${idx}`;
  return `cohi__${item.id}__${idx}`;
}

// ---------------------------------------------------------------------------
// Direct grid-unit sizing per widget category.
// ---------------------------------------------------------------------------

interface GridSize { w: number; h: number; minW: number; minH: number }

const GRID_SIZES: Record<string, GridSize> = {
  kpi:          { w: 5,  h: 5,  minW: 2,  minH: 3 },
  chart:        { w: 18, h: 12, minW: 8,  minH: 6 },
  distribution: { w: 12, h: 10, minW: 6,  minH: 5 },
  table:        { w: 36, h: 16, minW: 18, minH: 8 },
  cohi:         { w: 18, h: 14, minW: 8,  minH: 8 },
};
const DEFAULT_GRID: GridSize = { w: 9, h: 8, minW: 4, minH: 4 };

/** Rows so workflow conversion fits without scroll: toolbar ~72px + 2 rows of 420px cards + gap ~= 928px → 928/16 ≈ 58; use 64 for margin */
const WORKFLOW_EMBED_GRID_H = 64;

function getGridSizeForItem(item: GroupWidgetItem): GridSize {
  if (item.kind === 'cohi') return GRID_SIZES.cohi;
  if (item.kind === 'registry' && item.defId === 'workflow-conversion-embed') {
    return { w: GRID_COLS, h: WORKFLOW_EMBED_GRID_H, minW: 24, minH: 40 };
  }
  if (item.kind === 'registry' && item.defId === 'sales-scorecard-overview-chart') {
    return { w: 24, h: 20, minW: 18, minH: 14 };
  }
  if (item.kind === 'registry' && item.defId === 'sales-scorecard-overview-table') {
    return { w: 36, h: 20, minW: 24, minH: 12 };
  }
  if (item.kind === 'registry' && item.defId.startsWith('lock-stratification-')) {
    if (item.defId === 'lock-stratification-kpis') return { w: 24, h: 10, minW: 16, minH: 6 };
    if (item.defId === 'lock-stratification-interest-rates') return { w: 24, h: 28, minW: 18, minH: 20 };
    if (item.defId === 'lock-stratification-days-to-expiration') return { w: 24, h: 22, minW: 18, minH: 14 };
    if (item.defId === 'lock-stratification-pull-through') return { w: 24, h: 26, minW: 18, minH: 18 };
    if (item.defId === 'lock-stratification-milestone-bar') return { w: 24, h: 30, minW: 18, minH: 22 };
    if (item.defId === 'lock-stratification-milestone-pivot') return { w: 24, h: 26, minW: 18, minH: 18 };
    return { w: 20, h: 22, minW: 12, minH: 14 };
  }
  // High Performers: 2x2 grid
  if (item.kind === 'registry' && item.defId.startsWith('high-performers-')) {
    return { w: 18, h: 16, minW: 12, minH: 8 };
  }
  // Actors: chart and KPIs side-by-side same size (18x20); tables below
  if (item.kind === 'registry' && item.defId.startsWith('actors-')) {
    if (item.defId.startsWith('actors-table-')) {
      return { w: 18, h: 20, minW: 12, minH: 12 };
    }
    if (item.defId === 'actors-status-chart' || item.defId === 'actors-kpis') {
      return { w: 18, h: 20, minW: 10, minH: 14 };
    }
    const def = getWidgetDefinition(item.defId);
    return (def && GRID_SIZES[def.category]) || DEFAULT_GRID;
  }
  // Pipeline Analysis: chart widgets default ~630×368px; table uses standard table size
  if (item.kind === 'registry' && item.defId.startsWith('pipeline-analysis-')) {
    if (item.defId === 'pipeline-analysis-chart' || item.defId === 'pipeline-analysis-lo-count')
      return { w: 18, h: 20, minW: 12, minH: 14 };
    // table: use standard table grid size
  }
  const def = getWidgetDefinition(item.defId);
  return (def && GRID_SIZES[def.category]) || DEFAULT_GRID;
}

/** Build react-grid-layout Layout from items.
 *  Saved layouts are only used when `layoutVersion` matches `LAYOUT_VERSION`.
 *  Items without a saved layout are placed AFTER (below) all saved items so
 *  that newly added / moved widgets appear at the end of the group.
 */
function buildDefaultLayout(
  items: GroupWidgetItem[],
  savedLayouts?: Record<string, { x: number; y: number; w: number; h: number }>,
  layoutVersion?: number,
): Layout[] {
  const validSaved =
    savedLayouts && layoutVersion === LAYOUT_VERSION ? savedLayouts : undefined;

  // First pass: place items that have saved positions and track the max Y extent
  const layout: Layout[] = [];
  let maxYBottom = 0; // bottom-most Y + H of any saved item

  const unsavedIndices: number[] = [];

  items.forEach((item, idx) => {
    const key = itemKey(item, idx);
    const gs = getGridSizeForItem(item);

    if (validSaved?.[key]) {
      const s = validSaved[key];
      layout.push({ i: key, x: s.x, y: s.y, w: s.w, h: s.h, minW: gs.minW, minH: gs.minH });
      maxYBottom = Math.max(maxYBottom, s.y + s.h);
    } else {
      unsavedIndices.push(idx);
    }
  });

  // Second pass: place unsaved items starting after all saved items
  let cx = 0;
  let cy = maxYBottom;
  let rowMaxH = 0;

  unsavedIndices.forEach((idx) => {
    const item = items[idx];
    const key = itemKey(item, idx);
    const gs = getGridSizeForItem(item);

    if (cx + gs.w > GRID_COLS) {
      cx = 0;
      cy += rowMaxH;
      rowMaxH = 0;
    }

    layout.push({ i: key, x: cx, y: cy, w: gs.w, h: gs.h, minW: gs.minW, minH: gs.minH });
    cx += gs.w;
    rowMaxH = Math.max(rowMaxH, gs.h);
  });

  return layout;
}

/** Extract grid-unit layout map for persistence */
function layoutToMap(layout: Layout[]): Record<string, { x: number; y: number; w: number; h: number }> {
  const map: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const l of layout) {
    map[l.i] = { x: l.x, y: l.y, w: l.w, h: l.h };
  }
  return map;
}

// ---------------------------------------------------------------------------
// Grid cell widget wrapper – renders a single item inside the grid
// ---------------------------------------------------------------------------

function GridCellWidget({
  item,
  itemId,
  groupId,
  width,
  height,
  dateFilter,
  dimensionFilters,
  filterSyncEnabled,
  onFilterChange,
  onDelete,
  onDuplicate,
  onMaximize,
  otherGroups,
  onMoveToGroup,
  onVizTypeChange,
  onOpenEditDialog,
  onRegistryConfigChange,
}: {
  item: GroupWidgetItem;
  /** Stable unique ID used for canvasDataStore reporting */
  itemId: string;
  /** Section/group id – used for workflow-conversion embed to show Filter/Presets */
  groupId: string;
  width: number;
  height: number;
  dateFilter: DateFilter | null;
  dimensionFilters: DimensionFilter[] | null;
  filterSyncEnabled: boolean;
  onFilterChange?: (filters: WidgetFilterState) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMaximize: () => void;
  otherGroups?: { id: string; title: string }[];
  onMoveToGroup?: (targetGroupId: string) => void;
  onVizTypeChange?: (type: string) => void;
  onOpenEditDialog?: () => void;
  /** For registry widgets: persist config changes (e.g. workflow dropdown state). */
  onRegistryConfigChange?: (config: Record<string, unknown>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);

  const isValid =
    item.kind === 'cohi' ||
    (item.kind === 'registry' && !!getWidgetDefinition(item.defId));

  if (!isValid) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 p-3 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg relative">
        Widget not found: {item.kind === 'registry' ? item.defId : item.id}
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-1 right-1 p-1 rounded bg-red-500/90 text-white hover:bg-red-600 text-xs canvas-interactive"
          title="Remove widget"
          aria-label="Remove widget"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  }

  const hasOtherGroups = otherGroups && otherGroups.length > 0 && onMoveToGroup;
  const canEdit = item.kind === 'cohi' && !!onOpenEditDialog;

  // Derive a display title for the drag handle
  const widgetTitle = item.kind === 'cohi'
    ? item.title
    : (getWidgetDefinition(item.defId)?.name || item.defId);

  return (
    <div
      className="h-full w-full relative rounded-lg overflow-hidden flex flex-col group/widget"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMoveMenuOpen(false); }}
    >
      {/* Title + drag handle strip */}
      <div
        className="widget-drag-handle flex items-center gap-1.5 h-6 min-h-[24px] px-1.5 bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700/40 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/60"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3 w-3 text-slate-300 dark:text-slate-600 shrink-0" />
        {item.kind === 'cohi' && (
          <Sparkles className="h-2.5 w-2.5 text-indigo-400 shrink-0" />
        )}
        <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 truncate flex-1 min-w-0">
          {widgetTitle}
        </span>

        {/* Action buttons on hover */}
        <div className={cn(
          'flex items-center gap-0.5 transition-opacity shrink-0',
          hovered ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}>
          {/* Edit with Cohi (only for cohi widgets) */}
          {canEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenEditDialog!(); }}
              className="p-0.5 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:text-violet-400 dark:hover:bg-violet-900/30 canvas-interactive transition-colors"
              title="Edit with Cohi"
              aria-label="Edit with Cohi"
            >
              <MessageSquare className="h-3 w-3" />
            </button>
          )}
          {/* Move to group popover */}
          {hasOtherGroups && (
            <div className="relative">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMoveMenuOpen((v) => !v); }}
                className="p-0.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:text-amber-400 dark:hover:bg-amber-900/30 canvas-interactive transition-colors"
                title="Move to another group"
                aria-label="Move to another group"
              >
                <FolderInput className="h-3 w-3" />
              </button>
              {moveMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="px-2 py-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Move to group
                  </div>
                  {otherGroups!.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="w-full text-left px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors canvas-interactive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveToGroup!(g.id);
                        setMoveMenuOpen(false);
                      }}
                    >
                      {g.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="p-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/30 canvas-interactive transition-colors"
            title="Duplicate"
            aria-label="Duplicate widget"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            className="p-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/30 canvas-interactive transition-colors"
            title="Maximize"
            aria-label="Maximize widget"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 canvas-interactive transition-colors"
            title="Remove from group"
            aria-label="Remove from group"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Widget content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {item.kind === 'registry' ? (
          <GridCellRegistryWidget
            defId={item.defId}
            config={item.config}
            onConfigChange={onRegistryConfigChange}
            canvasItemId={itemId}
            width={width}
            height={height - 20}
          />
        ) : (
          <GridCellCohiWidget item={item} canvasItemId={itemId} width={width} height={height - 20} dateFilter={dateFilter} dimensionFilters={dimensionFilters} filterSyncEnabled={filterSyncEnabled} onFilterChange={onFilterChange} onVizTypeChange={onVizTypeChange} />
        )}
      </div>
    </div>
  );
}

/** Human-readable period label for Loan Detail subtitle (workbench only). Returns undefined when "All". */
function getLoanDetailPeriodLabel(periodSelection: PeriodSelection | undefined): string | undefined {
  if (!periodSelection?.dateRange) return undefined;
  const { type, preset, year, dateRange } = periodSelection;
  if (type === 'year' && year != null) return String(year);
  if (type === 'preset' && preset) {
    const presetLabels: Record<PeriodPreset, string> = {
      'rolling-3': 'Last 3 Months',
      'rolling-6': 'Last 6 Months',
      'rolling-12': 'Last 12 Months',
      'rolling-13': 'Last 13 Months',
      'mtd': 'Month to Date',
      'qtd': 'Quarter to Date',
      'ytd': dateRange.start ? `${dateRange.start.slice(0, 4)} YTD` : 'YTD',
      'last-month': 'Last Month',
      'last-quarter': 'Last Quarter',
      'last-year': 'Last Year',
      'trailing-12': 'Last 12 Months',
    };
    return presetLabels[preset] ?? preset;
  }
  if (type === 'custom' && dateRange?.start && dateRange?.end) {
    return 'custom date range';
  }
  return undefined;
}

/** Build comma-separated filter summary for Loan Detail subtitle (e.g. "Branch: X, Loan Purpose: Y"). */
function getLoanDetailFilterSummary(filters: SectionFilters): string | undefined {
  const parts: string[] = [];
  if (filters.branch && filters.branch !== 'all') parts.push(`Branch: ${filters.branch}`);
  if (filters.loanOfficer && filters.loanOfficer !== 'all') parts.push(`Loan Officer: ${filters.loanOfficer}`);
  if (filters.dynamicFilters?.length) {
    for (const df of filters.dynamicFilters) {
      if (df.value && df.value !== 'all') parts.push(`${df.label}: ${df.value}`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function GridCellRegistryWidget({
  defId,
  config: configProp,
  onConfigChange,
  canvasItemId,
  width,
  height,
}: {
  defId: string;
  config?: Record<string, unknown>;
  onConfigChange?: (config: Record<string, unknown>) => void;
  canvasItemId: string;
  width: number;
  height: number;
}) {
  const definition = getWidgetDefinition(defId);
  const reportWidgetData = useCanvasDataStore((s) => s.reportWidgetData);
  const removeWidget = useCanvasDataStore((s) => s.removeWidget);
  const groupId = canvasItemId.split('__')[0] ?? '';
  const filters = useWidgetSectionStore((s) => s.getFilters(groupId));
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);

  const { data: selectedData, loading, error } = useWidgetData(
    definition?.dataSource ?? '',
    definition?.dataSelector,
  );

  // Report data to canvasDataStore for Cohi chat context
  useEffect(() => {
    if (!definition) return;
    if (!loading && selectedData != null && !error) {
      reportWidgetData(canvasItemId, {
        widgetName: definition.name,
        category: definition.category as 'kpi' | 'chart' | 'table' | 'embed' | 'other',
        data: selectedData,
      });
    }
    return () => {
      removeWidget(canvasItemId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedData, loading, error, canvasItemId]);

  if (!definition) return null;

  const getColumns = useLoanDetailColumnsStore((s) => s.getColumns);
  const isLoanDetail = definition.dataSource === 'loan-detail';
  const savedColumns = isLoanDetail ? getColumns(canvasItemId) : undefined;
  const customColumns: ColumnDef[] | undefined =
    savedColumns?.length
      ? savedColumns
          .filter((c) => c.field !== '__blank__')
          .map((c) => ({ id: c.id, label: c.label, field: c.field }))
      : undefined;

  const Component = definition.component;
  const periodLabel =
    isLoanDetail
      ? getLoanDetailPeriodLabel(filters.periodSelection)
      : undefined;
  const filterSummary = isLoanDetail ? getLoanDetailFilterSummary(filters) : undefined;
  const isHighPerformers = definition.dataSource === 'high-performers';
  const highPerformersConfig = isHighPerformers
    ? {
        sectionId: groupId,
        periodKey: definition.id.includes('-left') ? ('left' as const) : ('right' as const),
        period:
          definition.id.includes('-left')
            ? (filters.highPerformersLeftPeriod ?? 'mtd')
            : (filters.highPerformersRightPeriod ?? 'ytd'),
      }
    : {};

  const isActors = definition.dataSource === 'actors';
  const actorsCalculation = filters.actorsCalculation ?? 'average';
  const actorsTurnTimeType = filters.actorsTurnTimeType ?? 'app_to_fund_days';
  const actorsTurnTimeLabel =
    actorsCalculation === 'median'
      ? actorsTurnTimeType === 'app_to_fund_days'
        ? 'Median App to Fund'
        : 'Median App to Closing'
      : actorsTurnTimeType === 'app_to_fund_days'
        ? 'Avg App to Fund'
        : 'Avg App to Closing';
  const actorsTableDims = (filters.actorsTableDimensions ?? ['loan_officer', 'processor', 'underwriter', 'closer']) as string[];
  const tableIndex = (definition.config?.tableIndex as number) ?? 0;
  const actorsConfig = isActors
    ? {
        measure: filters.actorsMeasure ?? 'units',
        onStatusClick:
          definition.id === 'actors-status-chart'
            ? (status: string) => {
                const next = filters.actorsSelectedStatus === status ? null : status;
                updateFilters(groupId, { actorsSelectedStatus: next });
              }
            : undefined,
        turnTimeLabel: actorsTurnTimeLabel,
        dimension: actorsTableDims[tableIndex] ?? 'loan_officer',
        dimensionLabel: ACTORS_DIMENSION_LABELS[actorsTableDims[tableIndex] ?? 'loan_officer'] ?? 'Loan Officer',
        dimensionOptions: ACTORS_DIMENSION_OPTIONS,
        onDimensionChange:
          definition.id?.startsWith('actors-table-')
            ? (index: number, value: string) => {
                const next = [...actorsTableDims] as [string, string, string, string];
                next[index] = value;
                updateFilters(groupId, { actorsTableDimensions: next });
              }
            : undefined,
        onRowClick:
          definition.id?.startsWith('actors-table-')
            ? (dimension: string, name: string) => {
                updateFilters(groupId, { actorsSelectedActor: { type: dimension, name } });
              }
            : undefined,
        visibleColumnIds:
          filters.actorsTableColumnIds?.length
            ? filters.actorsTableColumnIds
            : [...ACTORS_TABLE_DEFAULT_COLUMN_IDS],
      }
    : {};

  const isPricingTable =
    definition.dataSource === 'pricing-dashboard' &&
    (definition.id?.includes('-report') || definition.id?.includes('-detail'));
  const pricingConfig = isPricingTable
    ? {
        onRowClick: (row: Record<string, unknown>, columnKey?: string) => {
          if (columnKey === 'entityName') {
            const entityName = row?.entityName != null ? String(row.entityName).trim() : '';
            if (entityName && entityName !== 'Totals') {
              updateFilters(groupId, {
                pricingEntityValue: entityName,
                pricingEntityFilterType: filters.pricingEntityType ?? 'branch',
                pricingActorValue: '',
                pricingActorFilterType: undefined,
              });
            }
          } else if (columnKey === 'actorName') {
            const actorName = row?.actorName != null ? String(row.actorName).trim() : '';
            if (actorName) {
              updateFilters(groupId, {
                pricingEntityValue: '',
                pricingEntityFilterType: undefined,
                pricingActorValue: actorName,
                pricingActorFilterType: filters.pricingActorType ?? 'loan_officer',
              });
            }
          }
        },
      }
    : {};

  const isWorkflowConversion = defId === 'workflow-conversion-embed';
  const isSalesScorecardOverview = defId === 'sales-scorecard-overview-chart' || defId === 'sales-scorecard-overview-table';
  const salesScorecardOverviewConfig = isSalesScorecardOverview ? { groupId } : {};
  const isLockStratification = defId?.startsWith('lock-stratification-');
  const lockStratificationConfig = isLockStratification ? { groupId, variant: definition.config?.variant } : {};
  const workflowConfig = isWorkflowConversion
    ? {
        groupId,
        workflowInitialState:
          filters.workflowPeriodSelection != null ||
          filters.workflowCalculationType != null ||
          filters.workflowGrouping != null ||
          (filters.workflowSegments != null && filters.workflowSegments.length > 0)
            ? {
                periodSelection: filters.workflowPeriodSelection,
                calculationType: filters.workflowCalculationType,
                grouping: filters.workflowGrouping,
                segments: filters.workflowSegments,
              }
            : undefined,
        onWorkflowStateChange: (state: {
          periodSelection: import('@/components/ui/DatePeriodPicker').PeriodSelection;
          calculationType: 'conversion' | 'turn_time';
          grouping: 'workflow' | 'individual';
          segments: { from: string; to: string }[];
        }) => {
          updateFilters(groupId, {
            workflowPeriodSelection: state.periodSelection,
            workflowCalculationType: state.calculationType,
            workflowGrouping: state.grouping,
            workflowSegments: state.segments,
          });
        },
      }
    : {};

  const config = {
    ...definition.config,
    ...configProp,
    ...(periodLabel != null && { periodLabel }),
    ...(filterSummary != null && { filterSummary }),
    ...(customColumns != null && { customColumns }),
    ...highPerformersConfig,
    ...actorsConfig,
    ...pricingConfig,
    ...workflowConfig,
    ...salesScorecardOverviewConfig,
    ...lockStratificationConfig,
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 min-w-0">
        <Component
          data={selectedData}
          loading={loading}
          error={error}
          width={width}
          height={height}
          config={config}
          onConfigChange={onConfigChange}
        />
      </div>
    </div>
  );
}

function GridCellCohiWidget({
  item,
  canvasItemId,
  width,
  height,
  dateFilter,
  dimensionFilters,
  filterSyncEnabled,
  onFilterChange,
  onVizTypeChange,
}: {
  item: Extract<GroupWidgetItem, { kind: 'cohi' }>;
  canvasItemId: string;
  width: number;
  height: number;
  dateFilter: DateFilter | null;
  dimensionFilters: DimensionFilter[] | null;
  filterSyncEnabled: boolean;
  onFilterChange?: (filters: WidgetFilterState) => void;
  onVizTypeChange?: (type: string) => void;
}) {
  const { selectedTenantId } = useTenantStore();
  return (
    <div className="h-full w-full">
      <CohiWidgetRenderer
        sql={item.sql}
        vizConfig={item.vizConfig}
        title={item.title}
        explanation={item.explanation}
        tenantId={selectedTenantId}
        width={width}
        height={height}
        groupDateFilter={dateFilter}
        groupDimensionFilters={dimensionFilters}
        filterSyncEnabled={filterSyncEnabled}
        initialFilters={item.savedFilters}
        onFilterChange={onFilterChange}
        onVizTypeChange={onVizTypeChange}
        canvasItemId={canvasItemId}
        hideTitle
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maximize Dialog
// ---------------------------------------------------------------------------

function MaximizeDialog({
  item,
  open,
  onClose,
  dateFilter,
  dimensionFilters,
  filterSyncEnabled,
}: {
  item: GroupWidgetItem | null;
  open: boolean;
  onClose: () => void;
  dateFilter: DateFilter | null;
  dimensionFilters: DimensionFilter[] | null;
  filterSyncEnabled: boolean;
}) {
  if (!item) return null;

  const title =
    item.kind === 'registry'
      ? (getWidgetDefinition(item.defId)?.name || item.defId)
      : item.title;

  const subtitle =
    item.kind === 'registry'
      ? (() => {
          const def = getWidgetDefinition(item.defId);
          return def ? `${def.group} \u00b7 ${def.category}` : '';
        })()
      : 'Cohi SQL Widget';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[90vw] w-[90vw] max-h-[90vh] h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Minimize2 className="h-4 w-4 text-slate-400" />
            {title}
            <span className="text-xs font-normal text-slate-400 ml-2">
              {subtitle}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto p-6">
          {item.kind === 'registry' ? (
            <MaximizeRegistryWidget defId={item.defId} />
          ) : (
            <MaximizeCohiWidget item={item} dateFilter={dateFilter} dimensionFilters={dimensionFilters} filterSyncEnabled={filterSyncEnabled} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MaximizeRegistryWidget({ defId }: { defId: string }) {
  const definition = getWidgetDefinition(defId);
  if (!definition) return null;

  const { data, loading, error } = useWidgetData(
    definition.dataSource,
    definition.dataSelector,
  );

  const Component = definition.component;
  return <Component data={data} loading={loading} error={error} width={1200} height={700} />;
}

function MaximizeCohiWidget({
  item,
  dateFilter,
  dimensionFilters,
  filterSyncEnabled,
}: {
  item: Extract<GroupWidgetItem, { kind: 'cohi' }>;
  dateFilter: DateFilter | null;
  dimensionFilters: DimensionFilter[] | null;
  filterSyncEnabled: boolean;
}) {
  const { selectedTenantId } = useTenantStore();
  return (
    <CohiWidgetRenderer
      sql={item.sql}
      vizConfig={item.vizConfig}
      title={item.title}
      explanation={item.explanation}
      tenantId={selectedTenantId}
      width={1200}
      height={700}
      groupDateFilter={dateFilter}
      groupDimensionFilters={dimensionFilters}
      filterSyncEnabled={filterSyncEnabled}
      initialFilters={item.savedFilters}
      hideTitle
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WidgetGroup({
  groupId,
  title,
  sectionType,
  widgetIds,
  items: itemsProp,
  widgetLayouts,
  layoutVersion: layoutVersionProp,
  collapsed: collapsedProp,
  width,
  height,
  onUpdatePayload,
  otherGroups,
  onMoveItemOut,
  savedFilters: savedFiltersProp,
  filtersCollapsed: filtersCollapsedProp,
  filterSync: filterSyncProp,
  filterLocked: filterLockedProp,
  canEdit = true,
}: WidgetGroupProps) {
  const registerSection = useWidgetSectionStore((s) => s.registerSection);
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);
  const addDynamicFilter = useWidgetSectionStore((s) => s.addDynamicFilter);
  const removeDynamicFilter = useWidgetSectionStore((s) => s.removeDynamicFilter);
  const updateDynamicFilter = useWidgetSectionStore((s) => s.updateDynamicFilter);
  const filters = useWidgetSectionStore((s) => s.getFilters(groupId));

  // Pipeline Analysis filter options (used when sectionType === 'pipeline-analysis')
  const { selectedTenantId } = useTenantStore();
  const pipelineRange = usePipelineAnalysisRange(selectedTenantId ?? null);
  const { options: pipelineFilterOptions } = usePipelineAnalysisFilterOptions(selectedTenantId ?? null);
  const pipelineConfig = usePipelineAnalysisConfig(selectedTenantId ?? null);

  // Normalize legacy widgetIds to items
  const items = useMemo(() => normalizeItems(widgetIds, itemsProp), [widgetIds, itemsProp]);

  // Local state
  const [collapsed, setCollapsed] = useState(collapsedProp ?? false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(filtersCollapsedProp ?? false);
  // filterSync defaults to true for backward compat with existing canvases
  const [filterSync, setFilterSync] = useState(filterSyncProp ?? true);
  const filterLocked = filterLockedProp ?? false;
  const filtersReadOnly = filterLocked && !canEdit;
  const effectiveFilterSync = filtersReadOnly ? true : filterSync;
  const [isRenaming, setIsRenaming] = useState(false);
  const [localTitle, setLocalTitle] = useState(title);
  const [maximizedItem, setMaximizedItem] = useState<GroupWidgetItem | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
  const [actorsColumnsModalOpen, setActorsColumnsModalOpen] = useState(false);
  const [pricingDashboardColumnsModalOpen, setPricingDashboardColumnsModalOpen] = useState(false);
  const [loanDetailColumnsModalOpen, setLoanDetailColumnsModalOpen] = useState(false);
  const [salesScorecardMilestoneDatesModalOpen, setSalesScorecardMilestoneDatesModalOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const filtersRestoredRef = useRef(false);

  // Sync collapsed with prop
  useEffect(() => {
    if (collapsedProp !== undefined) setCollapsed(collapsedProp);
  }, [collapsedProp]);

  // Register this group as a section on mount, then restore saved filters
  useEffect(() => {
    registerSection(groupId, sectionType);
    if (savedFiltersProp && !filtersRestoredRef.current) {
      filtersRestoredRef.current = true;
      // Loan-detail always defaults to "All" (no date filter); don't restore periodSelection/dateRange
      const toRestore =
        sectionType === 'loan-detail'
          ? { ...savedFiltersProp, periodSelection: undefined, dateRange: undefined }
          : savedFiltersProp;
      updateFilters(groupId, toRestore);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, sectionType, registerSection]);

  // Pipeline Analysis: set default year range when options have loaded and none is set (so table/charts show correct years from first paint)
  const yearRangeOptions = useMemo(() => {
    if (sectionType !== 'pipeline-analysis') return [];
    const min = pipelineRange?.minYear ?? new Date().getFullYear() - 2;
    const max = pipelineRange?.maxYear ?? new Date().getFullYear();
    const opts: string[] = [];
    for (let y = min; y < max; y++) opts.push(`${y}-${y + 1}`);
    if (opts.length === 0) opts.push(`${max - 1}-${max}`);
    return opts;
  }, [sectionType, pipelineRange?.minYear, pipelineRange?.maxYear]);
  useEffect(() => {
    if (sectionType !== 'pipeline-analysis') return;
    if (yearRangeOptions.length === 0) return;
    const current = filters.pipelineAnalysisYearRange;
    if (current != null && current !== '') return;
    if (savedFiltersProp?.pipelineAnalysisYearRange) return;
    const defaultRange = yearRangeOptions[yearRangeOptions.length - 1];
    updateFilters(groupId, { pipelineAnalysisYearRange: defaultRange });
  }, [sectionType, groupId, yearRangeOptions, filters.pipelineAnalysisYearRange, savedFiltersProp?.pipelineAnalysisYearRange, updateFilters]);

  // Auto-focus title input when renaming
  useEffect(() => {
    if (isRenaming) titleInputRef.current?.focus();
  }, [isRenaming]);

  // ─── Build the group's dateFilter for cohi_widget children ───
  const groupDateFilter = useMemo<DateFilter | null>(() => {
    const dateField = filters.dateField || 'application_date';
    if (filters.periodSelection?.dateRange) {
      return {
        column: dateField,
        start: filters.periodSelection.dateRange.start,
        end: filters.periodSelection.dateRange.end,
      };
    }
    if (filters.dateRange) {
      return {
        column: dateField,
        start: filters.dateRange.start,
        end: filters.dateRange.end,
      };
    }
    // Year-only selection
    if (filters.year) {
      return {
        column: dateField,
        start: `${filters.year}-01-01`,
        end: `${filters.year}-12-31`,
      };
    }
    return null;
  }, [filters.dateField, filters.periodSelection, filters.dateRange, filters.year]);

  // ─── Build dimension filters (branch, loan officer, dynamic, etc.) for cohi widgets ───
  const groupDimensionFilters = useMemo<DimensionFilter[] | null>(() => {
    const dims: DimensionFilter[] = [];
    if (filters.branch && filters.branch !== 'all') {
      dims.push({ column: 'branch', value: filters.branch });
    }
    if (filters.loanOfficer && filters.loanOfficer !== 'all') {
      dims.push({ column: 'loan_officer', value: filters.loanOfficer });
    }
    // Include user-added dynamic filters
    if (filters.dynamicFilters) {
      for (const df of filters.dynamicFilters) {
        if (df.value && df.value !== 'all') {
          dims.push({ column: df.column, value: df.value });
        }
      }
    }
    return dims.length > 0 ? dims : null;
  }, [filters.branch, filters.loanOfficer, filters.dynamicFilters]);

  // ─── Payload updater (merges into existing payload) ───
  const patchPayload = useCallback(
    (patch: Record<string, unknown>) => {
      onUpdatePayload?.(patch);
    },
    [onUpdatePayload],
  );

  // ─── Persist filter state into the payload so it survives save/reload ───
  const filterSerialRef = useRef(0);
  useEffect(() => {
    // Skip the first render (mount) to avoid immediately overwriting
    filterSerialRef.current += 1;
    if (filterSerialRef.current <= 1) return;
    // Pick just the serialisable filter fields we care about
    const toSave: Record<string, unknown> = {};
    if (filters.year) toSave.year = filters.year;
    if (filters.dateRange) toSave.dateRange = filters.dateRange;
    if (filters.periodSelection) toSave.periodSelection = filters.periodSelection;
    if (filters.dateField && filters.dateField !== 'application_date') toSave.dateField = filters.dateField;
    if (filters.applicationType && filters.applicationType !== 'Applications Taken') toSave.applicationType = filters.applicationType;
    if (filters.actorType && filters.actorType !== 'loan_officer') toSave.actorType = filters.actorType;
    if (filters.branch && filters.branch !== 'all') toSave.branch = filters.branch;
    if (filters.loanOfficer && filters.loanOfficer !== 'all') toSave.loanOfficer = filters.loanOfficer;
    if (filters.dynamicFilters && filters.dynamicFilters.length > 0) toSave.dynamicFilters = filters.dynamicFilters;
    if (sectionType === 'workflow-conversion') {
      if (filters.workflowPeriodSelection) toSave.workflowPeriodSelection = filters.workflowPeriodSelection;
      if (filters.workflowCalculationType) toSave.workflowCalculationType = filters.workflowCalculationType;
      if (filters.workflowGrouping) toSave.workflowGrouping = filters.workflowGrouping;
      if (filters.workflowSegments && filters.workflowSegments.length > 0) toSave.workflowSegments = filters.workflowSegments;
    }
    if (sectionType === 'pipeline-analysis') {
      if (filters.pipelineAnalysisYearRange) toSave.pipelineAnalysisYearRange = filters.pipelineAnalysisYearRange;
      if (filters.pipelineAnalysisStartDateField && filters.pipelineAnalysisStartDateField !== 'application_date') toSave.pipelineAnalysisStartDateField = filters.pipelineAnalysisStartDateField;
      if (filters.pipelineAnalysisViewMode && filters.pipelineAnalysisViewMode !== 'week') toSave.pipelineAnalysisViewMode = filters.pipelineAnalysisViewMode;
      if (filters.pipelineAnalysisPctMetric && filters.pipelineAnalysisPctMetric !== 'volume') toSave.pipelineAnalysisPctMetric = filters.pipelineAnalysisPctMetric;
      if (filters.pipelineAnalysisSnapshotDay != null) toSave.pipelineAnalysisSnapshotDay = filters.pipelineAnalysisSnapshotDay;
      if (filters.pipelineAnalysisLoanTypes && filters.pipelineAnalysisLoanTypes.length > 0) toSave.pipelineAnalysisLoanTypes = filters.pipelineAnalysisLoanTypes;
      if (filters.pipelineAnalysisLoanPurposes && filters.pipelineAnalysisLoanPurposes.length > 0) toSave.pipelineAnalysisLoanPurposes = filters.pipelineAnalysisLoanPurposes;
      if (filters.pipelineAnalysisBranches && filters.pipelineAnalysisBranches.length > 0) toSave.pipelineAnalysisBranches = filters.pipelineAnalysisBranches;
    }
    if (sectionType === 'sales-scorecard-overview') {
      if (filters.salesScorecardOverviewMeasure && filters.salesScorecardOverviewMeasure !== 'volume') toSave.salesScorecardOverviewMeasure = filters.salesScorecardOverviewMeasure;
      if (filters.salesScorecardOverviewTimeMeasure && filters.salesScorecardOverviewTimeMeasure !== 'monthly') toSave.salesScorecardOverviewTimeMeasure = filters.salesScorecardOverviewTimeMeasure;
      if (filters.salesScorecardOverviewMilestoneColumns && filters.salesScorecardOverviewMilestoneColumns.length > 0) toSave.salesScorecardOverviewMilestoneColumns = filters.salesScorecardOverviewMilestoneColumns;
    }
    if (sectionType === 'pricing-dashboard') {
      if (filters.pricingDashboardColumns && filters.pricingDashboardColumns.length > 0) toSave.pricingDashboardColumns = filters.pricingDashboardColumns;
    }
    if (sectionType === 'lock-stratification') {
      if (filters.lockStratLocked && filters.lockStratLocked !== 'all_active') toSave.lockStratLocked = filters.lockStratLocked;
      if (filters.lockStratMeasure && filters.lockStratMeasure !== 'volume') toSave.lockStratMeasure = filters.lockStratMeasure;
      if (filters.lockStratMilestoneGroupBy && filters.lockStratMilestoneGroupBy !== 'current_milestone') toSave.lockStratMilestoneGroupBy = filters.lockStratMilestoneGroupBy;
      if (filters.lockStratPullThroughPeriod && filters.lockStratPullThroughPeriod !== '60') toSave.lockStratPullThroughPeriod = filters.lockStratPullThroughPeriod;
    }
    patchPayload({ savedFilters: Object.keys(toSave).length > 0 ? toSave : undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionType, filters.year, filters.dateRange, filters.periodSelection, filters.dateField, filters.applicationType, filters.actorType, filters.branch, filters.loanOfficer, filters.dynamicFilters, filters.workflowPeriodSelection, filters.workflowCalculationType, filters.workflowGrouping, filters.workflowSegments, filters.pipelineAnalysisYearRange, filters.pipelineAnalysisStartDateField, filters.pipelineAnalysisViewMode, filters.pipelineAnalysisPctMetric, filters.pipelineAnalysisSnapshotDay, filters.pipelineAnalysisLoanTypes, filters.pipelineAnalysisLoanPurposes, filters.pipelineAnalysisBranches, filters.salesScorecardOverviewMeasure, filters.salesScorecardOverviewTimeMeasure, filters.salesScorecardOverviewMilestoneColumns, filters.pricingDashboardColumns, filters.lockStratLocked, filters.lockStratMeasure, filters.lockStratMilestoneGroupBy, filters.lockStratPullThroughPeriod]);

  // ─── Grid layout ───
  const contentWidth = Math.max(width - 24, MIN_GRID_WIDTH);

  const gridLayout = useMemo(
    () => buildDefaultLayout(items, widgetLayouts, layoutVersionProp),
    [items, widgetLayouts, layoutVersionProp],
  );

  const saveLayout = useCallback(
    (newLayout: Layout[]) => {
      patchPayload({ widgetLayouts: layoutToMap(newLayout), layoutVersion: LAYOUT_VERSION });
    },
    [patchPayload],
  );

  // ─── Item management ───
  const persistItems = useCallback(
    (nextItems: GroupWidgetItem[], extraPatch?: Record<string, unknown>) => {
      // Persist both formats for backward compat
      const nextWidgetIds = nextItems
        .filter((i) => i.kind === 'registry')
        .map((i) => (i as Extract<GroupWidgetItem, { kind: 'registry' }>).defId);
      patchPayload({
        items: nextItems,
        widgetIds: nextWidgetIds,
        ...extraPatch,
      });
    },
    [patchPayload],
  );

  const handleDelete = useCallback(
    (index: number) => {
      const next = items.filter((_, i) => i !== index);
      // Clean up saved layout
      const key = itemKey(items[index], index);
      const nextLayouts = { ...widgetLayouts };
      delete nextLayouts[key];
      persistItems(next, { widgetLayouts: nextLayouts, layoutVersion: LAYOUT_VERSION });
    },
    [items, widgetLayouts, persistItems],
  );

  const handleDuplicate = useCallback(
    (index: number) => {
      const dup = { ...items[index] };
      // Give cohi items a new id
      if (dup.kind === 'cohi') {
        (dup as any).id = `${dup.id}-dup-${Date.now()}`;
      }
      const next = [...items];
      next.splice(index + 1, 0, dup);
      persistItems(next);
    },
    [items, persistItems],
  );

  const handleRegistryConfigChange = useCallback(
    (index: number, config: Record<string, unknown>) => {
      const next = items.map((it, i) =>
        i === index && it.kind === 'registry' ? { ...it, config } : it
      );
      persistItems(next);
    },
    [items, persistItems],
  );

  const handleMoveItemToGroup = useCallback(
    (index: number, targetGroupId: string) => {
      if (!onMoveItemOut) return;
      const movedItem = items[index];
      // Remove item from this group
      const next = items.filter((_, i) => i !== index);
      const key = itemKey(items[index], index);
      const nextLayouts = { ...widgetLayouts };
      delete nextLayouts[key];
      persistItems(next, { widgetLayouts: nextLayouts, layoutVersion: LAYOUT_VERSION });
      // Tell the canvas to add the item to the target group
      onMoveItemOut(movedItem, targetGroupId);
    },
    [items, widgetLayouts, persistItems, onMoveItemOut],
  );

  /** Persist filter changes for a single cohi widget */
  const handleCohiWidgetFilterChange = useCallback(
    (index: number, newFilters: WidgetFilterState) => {
      const item = items[index];
      if (item.kind !== 'cohi') return;
      const updated: GroupWidgetItem = {
        ...item,
        savedFilters: Object.keys(newFilters).length > 0 ? newFilters : undefined,
      };
      const next = items.map((it, i) => (i === index ? updated : it));
      persistItems(next);
    },
    [items, persistItems],
  );

  /** Persist a viz type change for a cohi item back into the items array */
  const handleVizTypeChange = useCallback(
    (index: number, newType: string) => {
      const item = items[index];
      if (item.kind !== 'cohi') return;
      const updated: GroupWidgetItem = {
        ...item,
        vizConfig: { ...item.vizConfig, type: newType as any },
      };
      const next = items.map((it, i) => (i === index ? updated : it));
      persistItems(next);
    },
    [items, persistItems],
  );

  // ── Edit widget save handler (called from EditWidgetDialog) ──
  const { selectedTenantId: tenantIdForEdit } = useTenantStore();
  const handleEditWidgetSave = useCallback(
    (index: number, updated: { sql: string; vizConfig: any; title: string; explanation?: string }) => {
      const item = items[index];
      if (item.kind !== 'cohi') return;
      const next = items.map((it, i) =>
        i === index
          ? { ...item, sql: updated.sql, vizConfig: updated.vizConfig, title: updated.title, explanation: updated.explanation || item.explanation }
          : it,
      );
      persistItems(next);
    },
    [items, persistItems],
  );

  const handleAddRegistryWidget = useCallback(
    (defId: string) => {
      const next = [...items, { kind: 'registry' as const, defId }];
      persistItems(next);
    },
    [items, persistItems],
  );

  /** Add a Cohi-generated (SQL-backed) widget to this group */
  const handleAddCohiWidget = useCallback(
    (widget: { sql: string; title: string; vizConfig: VisualizationConfig; explanation?: string }) => {
      const cohiItem: GroupWidgetItem = {
        kind: 'cohi',
        id: `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sql: widget.sql,
        title: widget.title,
        vizConfig: widget.vizConfig,
        explanation: widget.explanation,
        // No savedFilters = widget starts with SQL's own date range (no filter override)
      };
      const next = [...items, cohiItem];
      persistItems(next);
    },
    [items, persistItems],
  );

  // ─── Title management ───
  const commitTitle = useCallback(() => {
    if (!canEdit) return;
    setIsRenaming(false);
    if (localTitle.trim() && localTitle !== title) {
      patchPayload({ title: localTitle.trim() });
    } else {
      setLocalTitle(title);
    }
  }, [canEdit, localTitle, title, patchPayload]);

  // ─── Collapse management ───
  const toggleCollapse = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    patchPayload({ collapsed: next });
  }, [collapsed, patchPayload]);

  // ─── Filter sync toggle ───
  const toggleFilterSync = useCallback(() => {
    if (!canEdit || filtersReadOnly) return;
    const next = !filterSync;
    setFilterSync(next);
    patchPayload({ filterSync: next });

    // When turning sync ON, broadcast the current group filter to all Cohi
    // widgets so they reflect the same date range.  When turning OFF, clear
    // each widget's savedFilters so they revert to their SQL's own dates.
    if (items.some((i) => i.kind === 'cohi')) {
      const broadcastItems = items.map((item) => {
        if (item.kind !== 'cohi') return item;
        if (next) {
          // Sync ON → write current group filter state into the widget
          const groupState: WidgetFilterState = {};
          if (filters.dateField && filters.dateField !== 'application_date') groupState.dateField = filters.dateField;
          if (filters.periodSelection?.preset) groupState.preset = filters.periodSelection.preset;
          if (filters.year) groupState.year = filters.year;
          if (filters.periodSelection?.dateRange) groupState.dateRange = filters.periodSelection.dateRange;
          else if (filters.dateRange) groupState.dateRange = filters.dateRange;
          return { ...item, savedFilters: Object.keys(groupState).length > 0 ? groupState : undefined };
        } else {
          // Sync OFF → clear saved filters, let each widget start fresh
          const { savedFilters: _, ...rest } = item;
          return rest as typeof item;
        }
      });
      persistItems(broadcastItems);
    }
  }, [canEdit, filtersReadOnly, filterSync, patchPayload, items, filters, persistItems]);

  const toggleFilterLock = useCallback(() => {
    if (!canEdit) return;
    patchPayload({ filterLocked: !filterLocked });
  }, [canEdit, filterLocked, patchPayload]);

  // ─── Filter handlers ───
  const handleYearChange = useCallback(
    (year: number) => updateFilters(groupId, { year, dateRange: undefined }),
    [groupId, updateFilters],
  );

  const handleDateRangeChange = useCallback(
    (range: DateRange) => updateFilters(groupId, { dateRange: range }),
    [groupId, updateFilters],
  );

  const handlePeriodChange = useCallback(
    (selection: PeriodSelection) => {
      updateFilters(groupId, {
        periodSelection: selection,
        dateRange: selection.dateRange,
        ...(selection.year != null ? { year: selection.year } : {}),
      });
    },
    [groupId, updateFilters],
  );

  // ─── Apply a saved filter preset to the group ───
  const handleApplyGroupPreset = useCallback(
    (preset: FilterPreset) => {
      const f = preset.filters;
      const patch: Partial<SectionFilters> = {};
      if (f.dateField) patch.dateField = f.dateField;
      if (f.preset) {
        const range = computePresetDateRange(f.preset as PeriodPreset);
        patch.periodSelection = { preset: f.preset as PeriodPreset, dateRange: range };
        patch.dateRange = range;
      } else if (f.year) {
        patch.year = f.year;
        patch.dateRange = { start: `${f.year}-01-01`, end: `${f.year}-12-31` };
      } else if (f.dateRange) {
        patch.dateRange = f.dateRange;
      }
      updateFilters(groupId, patch);
    },
    [groupId, updateFilters],
  );

  // ─── Per-section preset config ───
  const sectionPresetConfig = useMemo((): { presets?: PeriodPreset[]; showYears?: boolean } => {
    switch (sectionType) {
      case 'operations-scorecard':
        return { presets: ['rolling-3', 'rolling-6', 'rolling-12'], showYears: false };
      case 'sales-trends':
        return { presets: ['rolling-3', 'rolling-6'], showYears: false };
      case 'top-tiering-comparison':
        return { presets: ['mtd', 'qtd', 'ytd', 'last-month', 'last-quarter', 'last-year', 'trailing-12'], showYears: false };
      case 'leaderboard':
        return { presets: ['mtd', 'qtd', 'last-month', 'last-quarter', 'last-year'], showYears: false };
      case 'executive-dashboard':
        return { presets: ['mtd', 'ytd', 'last-month', 'last-year'], showYears: false };
      case 'actors':
        return { presets: ['mtd', 'last-month', 'qtd', 'last-quarter', 'ytd', 'last-year'], showYears: false };
      case 'sales-scorecard-overview':
        return { presets: ['mtd', 'last-month', 'qtd', 'last-quarter', 'ytd', 'last-year'], showYears: false };
      case 'lock-stratification':
        return { presets: ['mtd', 'last-month', 'qtd', 'ytd', 'last-year'], showYears: false };
      default:
        return {}; // default behavior: rolling-13, rolling-12 + year buttons
    }
  }, [sectionType]);

  const update = useCallback(
    (partial: Partial<SectionFilters>) => updateFilters(groupId, partial),
    [groupId, updateFilters],
  );

  // ─── Keyboard shortcuts ───
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Dialog handles its own close on Escape
    },
    [],
  );

  const colors = SECTION_COLORS[sectionType];

  // Count items by kind
  const registryCount = items.filter((i) => i.kind === 'registry').length;
  const cohiCount = items.filter((i) => i.kind === 'cohi').length;
  const itemLabel = `${items.length} widget${items.length !== 1 ? 's' : ''}${cohiCount > 0 ? ` (${cohiCount} Cohi)` : ''}`;

  // First Loan Detail table widget's canvas item id (for Edit Columns modal opened from group filter bar)
  const loanDetailCanvasItemId = useMemo(() => {
    const idx = items.findIndex((i) => i.kind === 'registry' && (i as { defId?: string }).defId === 'loan-detail-table');
    if (idx < 0) return null;
    return `${groupId}__${itemKey(items[idx], idx)}`;
  }, [items, groupId]);

  return (
    <div
      className={cn(
        'h-full w-full flex flex-col rounded-xl border-2 overflow-hidden group/widgetgroup',
        colors.border,
        'bg-white dark:bg-slate-900 shadow-sm',
      )}
      onKeyDown={handleKeyDown}
    >
      {/* ═══════ Compact group header — single row: title + filter toggle + actions ═══════ */}
      <div className={cn('shrink-0 border-b border-slate-200/70 dark:border-slate-700/70', colors.bg)}>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 min-h-[32px]">
          {/* Collapse toggle */}
          <button
            type="button"
            onClick={toggleCollapse}
            className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors canvas-interactive shrink-0"
            title={collapsed ? 'Expand group' : 'Collapse group'}
            aria-label={collapsed ? 'Expand group' : 'Collapse group'}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            )}
          </button>

          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', colors.dot)} />

          {/* Editable title */}
          {isRenaming ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                ref={titleInputRef}
                type="text"
                title="Group title"
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') { setLocalTitle(title); setIsRenaming(false); }
                }}
                className="flex-1 min-w-0 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500/50 canvas-interactive"
              />
              <button
                type="button"
                onClick={commitTitle}
                className="p-0.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 canvas-interactive"
                aria-label="Save title"
              >
                <Check className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <h3
              className={cn('text-xs font-semibold tracking-tight flex-1 min-w-0 truncate cursor-pointer', colors.accent)}
              onDoubleClick={() => {
                if (!canEdit) return;
                setLocalTitle(title);
                setIsRenaming(true);
              }}
              title={canEdit ? "Double-click to rename" : title}
            >
              {title}
            </h3>
          )}

          {/* Rename pencil — only on hover */}
          {!isRenaming && canEdit && (
            <button
              type="button"
              onClick={() => { setLocalTitle(title); setIsRenaming(true); }}
              className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5 canvas-interactive transition-colors opacity-0 group-hover/widgetgroup:opacity-100"
              title="Rename group"
              aria-label="Rename group"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
          )}

          {/* Filter lock toggle (owner/editor) or lock badge (viewer) */}
          {!collapsed && !SELF_MANAGED_SECTIONS.has(sectionType) && (
            canEdit ? (
              <button
                type="button"
                onClick={toggleFilterLock}
                className={cn(
                  'flex items-center gap-0.5 h-5 px-1.5 rounded text-[9px] font-medium canvas-interactive transition-all shrink-0',
                  filterLocked
                    ? 'text-amber-600 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-950/30'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
                title={filterLocked ? 'Filters locked for viewers' : 'Allow viewers to adjust filters'}
                aria-label={filterLocked ? 'Unlock filters for viewers' : 'Lock filters for viewers'}
              >
                {filterLocked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                <span>{filterLocked ? 'Locked' : 'Unlocked'}</span>
              </button>
            ) : filterLocked ? (
              <div
                className="flex items-center gap-0.5 h-5 px-1.5 rounded text-[9px] font-medium shrink-0 text-amber-600 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-950/30"
                title="Filters are locked by the canvas owner"
                aria-label="Filters locked"
              >
                <Lock className="h-2.5 w-2.5" />
                <span>Locked</span>
              </div>
            ) : null
          )}

          {/* Filter sync toggle */}
          {!collapsed && !SELF_MANAGED_SECTIONS.has(sectionType) && !filtersReadOnly && (
            <button
              type="button"
              onClick={toggleFilterSync}
              className={cn(
                'flex items-center gap-0.5 h-5 px-1.5 rounded text-[9px] font-medium canvas-interactive transition-all shrink-0',
                filterSync
                  ? 'text-blue-500 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-950/30'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
              title={filterSync ? 'Sync ON: all widgets share group filters. Click to let each widget filter independently.' : 'Sync OFF: each widget has its own filters. Click to sync all widgets.'}
              aria-label={filterSync ? 'Disable filter sync' : 'Enable filter sync'}
            >
              {filterSync ? <Link2 className="h-2.5 w-2.5" /> : <Unlink2 className="h-2.5 w-2.5" />}
              <span>{filterSync ? 'Synced' : 'Independent'}</span>
            </button>
          )}

          {/* Filter bar toggle (only when sync is on) */}
          {!collapsed && !SELF_MANAGED_SECTIONS.has(sectionType) && effectiveFilterSync && !filtersReadOnly && (
            <button
              type="button"
              onClick={() => setFiltersCollapsed((v) => !v)}
              className={cn(
                'flex items-center gap-0.5 h-5 px-1.5 rounded text-[9px] font-medium canvas-interactive transition-all shrink-0',
                filtersCollapsed
                  ? 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  : 'text-blue-500 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-950/30',
              )}
              title={filtersCollapsed ? 'Show group filters' : 'Hide group filters'}
              aria-label={filtersCollapsed ? 'Show group filters' : 'Hide group filters'}
            >
              <SlidersHorizontal className="h-2.5 w-2.5" />
              <span>Filters</span>
            </button>
          )}

          {/* Add widget — opens the multi-tab dialog */}
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              className={cn(
                'flex items-center gap-0.5 h-5 px-1.5 rounded border text-[9px] font-medium canvas-interactive transition-colors shrink-0',
                'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20',
              )}
              title="Add widget to group"
              aria-label="Add widget"
            >
              <Plus className="h-2.5 w-2.5" />
              Add
            </button>
          )}
        </div>

        {/* Expanded filter controls — compact row below header, only when sync ON and filters expanded */}
        {!collapsed && !SELF_MANAGED_SECTIONS.has(sectionType) && effectiveFilterSync && !filtersCollapsed && !filtersReadOnly && (
          <div className="flex items-center gap-1.5 px-2.5 pb-1.5 flex-wrap">
            {sectionType === 'workflow-conversion' ? (
              <>
                {/* Dynamic (user-added) filters */}
                {(filters.dynamicFilters || []).map((df) => (
                  <DynamicDimensionFilter
                    key={df.column}
                    entry={df}
                    tenantId={tenantIdForEdit}
                    onChange={(value) => updateDynamicFilter(groupId, df.column, value)}
                    onRemove={() => removeDynamicFilter(groupId, df.column)}
                  />
                ))}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                <AddFilterPicker
                  groupId={groupId}
                  existingColumns={(filters.dynamicFilters || []).map((f) => f.column)}
                  onAdd={(col, label) => addDynamicFilter(groupId, { column: col, label, value: 'all' })}
                />
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                <GroupFilterBookmarkButton
                  filters={filters}
                  onApplyPreset={handleApplyGroupPreset}
                />
              </>
            ) : sectionType === 'pricing-dashboard' ? (
              <>
                <PricingFilterSelect
                  label="Entity"
                  value={filters.pricingEntityType ?? 'branch'}
                  options={PRICING_ENTITY_OPTIONS}
                  onChange={(v) => updateFilters(groupId, { pricingEntityType: v })}
                />
                <PricingFilterSelect
                  label="Actor"
                  value={filters.pricingActorType ?? 'loan_officer'}
                  options={PRICING_ACTOR_OPTIONS}
                  onChange={(v) => updateFilters(groupId, { pricingActorType: v })}
                />
                <PricingFilterSelect
                  label="Date range"
                  value={filters.pricingDateRange ?? 'mtd'}
                  options={PRICING_DATE_RANGE_OPTIONS}
                  onChange={(v) => updateFilters(groupId, { pricingDateRange: v })}
                />
                <PricingFilterSelect
                  label="Loan status"
                  value={filters.pricingLoanStatus ?? 'active'}
                  options={PRICING_LOAN_STATUS_OPTIONS}
                  onChange={(v) => updateFilters(groupId, { pricingLoanStatus: v })}
                />
                <PricingFilterSelect
                  label="Loan funding"
                  value={filters.pricingLoanFunding ?? 'funded'}
                  options={PRICING_LOAN_FUNDING_OPTIONS}
                  onChange={(v) => updateFilters(groupId, { pricingLoanFunding: v })}
                />
                <PricingFilterSelect
                  label="Lock status"
                  value={filters.pricingLockStatus ?? 'total'}
                  options={PRICING_LOCK_STATUS_OPTIONS}
                  onChange={(v) => updateFilters(groupId, { pricingLockStatus: v })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPricingDashboardColumnsModalOpen(true)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
                  Edit columns
                </Button>
                {((filters.pricingEntityValue ?? '').trim() !== '' || (filters.pricingActorValue ?? '').trim() !== '') && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-xs">
                    {(filters.pricingEntityValue ?? '').trim() !== ''
                      ? `${PRICING_ENTITY_OPTIONS.find((o) => o.value === (filters.pricingEntityFilterType ?? filters.pricingEntityType ?? 'branch'))?.label ?? 'Entity'}: ${filters.pricingEntityValue}`
                      : `${PRICING_ACTOR_OPTIONS.find((o) => o.value === (filters.pricingActorFilterType ?? filters.pricingActorType ?? 'loan_officer'))?.label ?? 'Actor'}: ${filters.pricingActorValue}`}
                    <button
                      type="button"
                      onClick={() => updateFilters(groupId, { pricingEntityValue: '', pricingEntityFilterType: undefined, pricingActorValue: '', pricingActorFilterType: undefined })}
                      className="p-0.5 rounded hover:bg-emerald-200 dark:hover:bg-emerald-800"
                      aria-label="Clear entity/actor filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {/* Dynamic (user-added) filters */}
                {(filters.dynamicFilters || []).map((df) => (
                  <DynamicDimensionFilter
                    key={df.column}
                    entry={df}
                    tenantId={tenantIdForEdit}
                    onChange={(value) => updateDynamicFilter(groupId, df.column, value)}
                    onRemove={() => removeDynamicFilter(groupId, df.column)}
                  />
                ))}
                {/* Divider before add-filter */}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {/* Add filter dimension button */}
                <AddFilterPicker
                  groupId={groupId}
                  existingColumns={[
                    ...(SECTION_FILTER_CONFIG[sectionType] ?? [])
                      .filter((f) => f.optionsSource)
                      .map((f) => f.optionsSource!),
                    ...(SECTION_BUILTIN_FILTER_COLUMNS[sectionType] ?? []),
                    ...(filters.dynamicFilters || []).map((f) => f.column),
                  ]}
                  onAdd={(col, label) => addDynamicFilter(groupId, { column: col, label, value: 'all' })}
                />
                {/* Divider before presets */}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {/* Filter preset bookmarks */}
                <GroupFilterBookmarkButton
                  filters={filters}
                  onApplyPreset={handleApplyGroupPreset}
                />
              </>
            ) : sectionType === 'pipeline-analysis' ? (
              <>
                <PipelineAnalysisFilterRow
                  groupId={groupId}
                  filters={filters}
                  updateFilters={updateFilters}
                  pipelineRange={pipelineRange.range}
                  pipelineConfig={pipelineConfig.config}
                  pipelineFilterOptions={pipelineFilterOptions}
                  loading={pipelineRange.loading}
                  tenantId={selectedTenantId ?? null}
                />
                {/* Dynamic (user-added) filters */}
                {(filters.dynamicFilters || []).map((df) => (
                  <DynamicDimensionFilter
                    key={df.column}
                    entry={df}
                    tenantId={tenantIdForEdit}
                    onChange={(value) => updateDynamicFilter(groupId, df.column, value)}
                    onRemove={() => removeDynamicFilter(groupId, df.column)}
                  />
                ))}
                {/* Divider before add-filter */}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {/* Add filter dimension button */}
                <AddFilterPicker
                  groupId={groupId}
                  existingColumns={[
                    ...(SECTION_FILTER_CONFIG[sectionType] ?? [])
                      .filter((f) => f.optionsSource)
                      .map((f) => f.optionsSource!),
                    ...(SECTION_BUILTIN_FILTER_COLUMNS[sectionType] ?? []),
                    ...(filters.dynamicFilters || []).map((f) => f.column),
                  ]}
                  onAdd={(col, label) => addDynamicFilter(groupId, { column: col, label, value: 'all' })}
                />
                {/* Divider before presets */}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {/* Filter preset bookmarks */}
                <GroupFilterBookmarkButton
                  filters={filters}
                  onApplyPreset={handleApplyGroupPreset}
                />
              </>
            ) : sectionType === 'actors' ? (
              <>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Period</span>
                <DatePeriodPicker
                  year={filters.year}
                  onYearChange={handleYearChange}
                  onDateRangeChange={handleDateRangeChange}
                  onPeriodChange={handlePeriodChange}
                  presets={sectionPresetConfig.presets}
                  showYears={sectionPresetConfig.showYears}
                  size="sm"
                  showLabel={false}
                  yearsToShow={4}
                  defaultPreset="mtd"
                  periodSelectionFromStore={filters.periodSelection}
                />
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Calculation</span>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
                  {(['average', 'median'] as const).map((val) => {
                    const selected = (filters.actorsCalculation ?? 'average') === val;
                    return (
                      <Button
                        key={val}
                        variant="ghost"
                        size="sm"
                        className={cn(
                          '!h-7 !py-0 !min-h-0 px-2.5 text-xs',
                          selected
                            ? 'bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 hover:text-blue-600 dark:hover:text-blue-400'
                        )}
                        onClick={() => updateFilters(groupId, { actorsCalculation: val })}
                      >
                        {val === 'average' ? 'Average' : 'Median'}
                      </Button>
                    );
                  })}
                </div>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Turn Time</span>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
                  {(['app_to_fund_days', 'app_to_closing_days'] as const).map((val) => {
                    const selected = (filters.actorsTurnTimeType ?? 'app_to_fund_days') === val;
                    return (
                      <Button
                        key={val}
                        variant="ghost"
                        size="sm"
                        className={cn(
                          '!h-7 !py-0 !min-h-0 px-2.5 text-xs',
                          selected
                            ? 'bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 hover:text-blue-600 dark:hover:text-blue-400'
                        )}
                        onClick={() => updateFilters(groupId, { actorsTurnTimeType: val })}
                      >
                        {val === 'app_to_fund_days' ? 'App to Fund' : 'App to Closing'}
                      </Button>
                    );
                  })}
                </div>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Date Range</span>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
                  {(['calendar_days', 'business_days'] as const).map((val) => {
                    const selected = (filters.actorsDateRangeType ?? 'calendar_days') === val;
                    return (
                      <Button
                        key={val}
                        variant="ghost"
                        size="sm"
                        className={cn(
                          '!h-7 !py-0 !min-h-0 px-2.5 text-xs',
                          selected
                            ? 'bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 hover:text-blue-600 dark:hover:text-blue-400'
                        )}
                        onClick={() => updateFilters(groupId, { actorsDateRangeType: val })}
                      >
                        {val === 'calendar_days' ? 'Calendar' : 'Business'}
                      </Button>
                    );
                  })}
                </div>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Measure</span>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
                  {(['units', 'volume'] as const).map((val) => {
                    const selected = (filters.actorsMeasure ?? 'units') === val;
                    return (
                      <Button
                        key={val}
                        variant="ghost"
                        size="sm"
                        className={cn(
                          '!h-7 !py-0 !min-h-0 px-2.5 text-xs',
                          selected
                            ? 'bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 hover:text-blue-600 dark:hover:text-blue-400'
                        )}
                        onClick={() => updateFilters(groupId, { actorsMeasure: val })}
                      >
                        {val === 'units' ? 'Units' : 'Volume'}
                      </Button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="!h-7 gap-1.5 border-slate-300 dark:border-slate-600 text-xs"
                  onClick={() => setActorsColumnsModalOpen(true)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Columns
                </Button>
                {filters.actorsSelectedStatus != null && filters.actorsSelectedStatus !== '' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-cyan-100 dark:bg-cyan-900/40 px-2 py-0.5 text-xs">
                    Status: {filters.actorsSelectedStatus}
                    <button
                      type="button"
                      onClick={() => updateFilters(groupId, { actorsSelectedStatus: null })}
                      className="p-0.5 rounded hover:bg-cyan-200 dark:hover:bg-cyan-800"
                      aria-label="Clear status filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {filters.actorsSelectedActor != null && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-cyan-100 dark:bg-cyan-900/40 px-2 py-0.5 text-xs">
                    {filters.actorsSelectedActor.type}: {filters.actorsSelectedActor.name}
                    <button
                      type="button"
                      onClick={() => updateFilters(groupId, { actorsSelectedActor: null })}
                      className="p-0.5 rounded hover:bg-cyan-200 dark:hover:bg-cyan-800"
                      aria-label="Clear actor filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {/* Dynamic (user-added) filters */}
                {(filters.dynamicFilters || []).map((df) => (
                  <DynamicDimensionFilter
                    key={df.column}
                    entry={df}
                    tenantId={tenantIdForEdit}
                    onChange={(value) => updateDynamicFilter(groupId, df.column, value)}
                    onRemove={() => removeDynamicFilter(groupId, df.column)}
                  />
                ))}
                {/* Divider before add-filter */}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {/* Add filter dimension button */}
                <AddFilterPicker
                  groupId={groupId}
                  existingColumns={[
                    ...(SECTION_FILTER_CONFIG[sectionType] ?? [])
                      .filter((f) => f.optionsSource)
                      .map((f) => f.optionsSource!),
                    ...(SECTION_BUILTIN_FILTER_COLUMNS[sectionType] ?? []),
                    ...(filters.dynamicFilters || []).map((f) => f.column),
                  ]}
                  onAdd={(col, label) => addDynamicFilter(groupId, { column: col, label, value: 'all' })}
                />
                {/* Divider before presets */}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {/* Filter preset bookmarks */}
                <GroupFilterBookmarkButton
                  filters={filters}
                  onApplyPreset={handleApplyGroupPreset}
                />
              </>
            ) : sectionType === 'high-performers' ? (
              <>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Loan:</span>
                {HIGH_PERFORMERS_DATE_TYPE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={(filters.highPerformersDateType ?? 'funding_date') === opt.value ? 'default' : 'outline'}
                    size="sm"
                    className="!h-7 !py-0 !min-h-0 px-2.5 text-xs"
                    onClick={() => updateFilters(groupId, { highPerformersDateType: opt.value })}
                  >
                    {opt.label}
                  </Button>
                ))}
                {/* Dynamic (user-added) filters */}
                {(filters.dynamicFilters || []).map((df) => (
                  <DynamicDimensionFilter
                    key={df.column}
                    entry={df}
                    tenantId={tenantIdForEdit}
                    onChange={(value) => updateDynamicFilter(groupId, df.column, value)}
                    onRemove={() => removeDynamicFilter(groupId, df.column)}
                  />
                ))}
                {/* Divider before add-filter */}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {/* Add filter dimension button */}
                <AddFilterPicker
                  groupId={groupId}
                  existingColumns={[
                    ...(SECTION_FILTER_CONFIG[sectionType] ?? [])
                      .filter((f) => f.optionsSource)
                      .map((f) => f.optionsSource!),
                    ...(SECTION_BUILTIN_FILTER_COLUMNS[sectionType] ?? []),
                    ...(filters.dynamicFilters || []).map((f) => f.column),
                  ]}
                  onAdd={(col, label) => addDynamicFilter(groupId, { column: col, label, value: 'all' })}
                />
                {/* Divider before presets */}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {/* Filter preset bookmarks */}
                <GroupFilterBookmarkButton
                  filters={filters}
                  onApplyPreset={handleApplyGroupPreset}
                />
              </>
            ) : sectionType === 'lock-stratification' ? (
              <>
                <PricingFilterSelect label="Locked" value={filters.lockStratLocked ?? 'all_active'} options={LOCK_STRAT_LOCKED_OPTIONS} onChange={(v) => updateFilters(groupId, { lockStratLocked: v as 'active_locked' | 'active_not_locked' | 'all_active' })} />
                <PricingFilterSelect label="Measure" value={filters.lockStratMeasure ?? 'volume'} options={LOCK_STRAT_MEASURE_OPTIONS} onChange={(v) => updateFilters(groupId, { lockStratMeasure: v as 'volume' | 'units' | 'wac' | 'wa_fico' })} />
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                <GroupFilterBookmarkButton filters={filters} onApplyPreset={handleApplyGroupPreset} />
              </>
            ) : (
              <>
            <DatePeriodPicker
              year={filters.year}
              onYearChange={handleYearChange}
              onDateRangeChange={handleDateRangeChange}
              onPeriodChange={handlePeriodChange}
              presets={sectionPresetConfig.presets}
              showYears={sectionPresetConfig.showYears}
              size="sm"
              showLabel={false}
              yearsToShow={4}
              showAllOption={sectionType === 'loan-detail'}
              onAllSelect={
                sectionType === 'loan-detail'
                  ? () => updateFilters(groupId, { periodSelection: undefined, dateRange: undefined })
                  : undefined
              }
              periodSelectionFromStore={sectionType === 'loan-detail' || sectionType === 'sales-scorecard-overview' ? filters.periodSelection : undefined}
            />

            {/* Data-driven filters from SECTION_FILTER_CONFIG */}
            {(SECTION_FILTER_CONFIG[sectionType] ?? []).map((field) => {
              const sectionFields = SECTION_FILTER_CONFIG[sectionType] ?? [];
              const parentField = field.dependsOn
                ? sectionFields.find((f) => f.key === field.dependsOn)
                : undefined;
              return (
                <DynamicFilterSelect
                  key={field.key}
                  field={field}
                  value={String(filters[field.key] ?? '')}
                  onChange={(v) => update({ [field.key]: v } as Partial<SectionFilters>)}
                  parentValue={field.dependsOn ? String(filters[field.dependsOn] ?? 'all') : undefined}
                  parentColumn={parentField?.optionsSource}
                  tenantId={tenantIdForEdit}
                />
              );
            })}

            {/* Edit Columns (Loan Detail only) — next to filters like pricing dashboard */}
            {sectionType === 'loan-detail' && (
              <>
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setLoanDetailColumnsModalOpen(true)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
                  Edit Columns
                </Button>
              </>
            )}

            {/* Milestone Dates button (Sales Scorecard Overview only) – before dynamic filters */}
            {sectionType === 'sales-scorecard-overview' && (
              <>
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setSalesScorecardMilestoneDatesModalOpen(true)}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Milestone Dates
                </Button>
              </>
            )}

            {/* Dynamic (user-added) filters */}
            {(filters.dynamicFilters || []).map((df) => (
              <DynamicDimensionFilter
                key={df.column}
                entry={df}
                tenantId={tenantIdForEdit}
                onChange={(value) => updateDynamicFilter(groupId, df.column, value)}
                onRemove={() => removeDynamicFilter(groupId, df.column)}
              />
            ))}

            {/* Divider before add-filter */}
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

            {/* Add filter dimension button */}
            <AddFilterPicker
              groupId={groupId}
              existingColumns={[
                ...(SECTION_FILTER_CONFIG[sectionType] ?? [])
                  .filter((f) => f.optionsSource)
                  .map((f) => f.optionsSource!),
                ...(SECTION_BUILTIN_FILTER_COLUMNS[sectionType] ?? []),
                ...(filters.dynamicFilters || []).map((f) => f.column),
              ]}
              onAdd={(col, label) => addDynamicFilter(groupId, { column: col, label, value: 'all' })}
            />

            {/* Divider before presets */}
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

            {/* Filter preset bookmarks */}
            <GroupFilterBookmarkButton
              filters={filters}
              onApplyPreset={handleApplyGroupPreset}
            />
              </>
            )}
          </div>
        )}
      </div>

      {/* ═══════ Widget grid (collapsible) ═══════ */}
      {!collapsed && (
        <WidgetDataProvider sectionId={groupId}>
        <div className="flex-1 min-h-0 overflow-auto px-3 py-2 canvas-interactive">
          <GridLayout
            className="layout"
            layout={gridLayout}
            width={contentWidth}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight: ROW_HEIGHT,
              margin: GRID_MARGIN,
              containerPadding: GRID_PADDING,
              maxRows: Infinity,
            }}
            compactor={verticalCompactor}
            dragConfig={{
              enabled: true,
              bounded: false,
              handle: '.widget-drag-handle',
              threshold: 3,
            }}
            resizeConfig={{
              enabled: true,
              handles: ['se'],
            }}
            onDragStop={saveLayout}
            onResizeStop={saveLayout}
          >
            {items.map((item, idx) => {
              const key = itemKey(item, idx);
              const layoutItem = gridLayout.find((l) => l.i === key);
              const cellW = layoutItem
                ? layoutItem.w * (contentWidth / GRID_COLS) - GRID_MARGIN[0]
                : 200;
              const cellH = layoutItem
                ? layoutItem.h * ROW_HEIGHT - GRID_MARGIN[1]
                : 200;

              return (
                <div key={key} className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-700/60 shadow-sm overflow-hidden transition-shadow hover:shadow-md">
                  <GridCellWidget
                    item={item}
                    itemId={`${groupId}__${key}`}
                    groupId={groupId}
                    width={cellW}
                    height={cellH}
                    dateFilter={groupDateFilter}
                    dimensionFilters={groupDimensionFilters}
                    filterSyncEnabled={effectiveFilterSync}
                    onFilterChange={item.kind === 'cohi' ? (f) => handleCohiWidgetFilterChange(idx, f) : undefined}
                    onDelete={() => handleDelete(idx)}
                    onDuplicate={() => handleDuplicate(idx)}
                    onMaximize={() => setMaximizedItem(item)}
                    otherGroups={otherGroups}
                    onMoveToGroup={(targetId) => handleMoveItemToGroup(idx, targetId)}
                    onVizTypeChange={item.kind === 'cohi' ? (type) => handleVizTypeChange(idx, type) : undefined}
                    onOpenEditDialog={item.kind === 'cohi' ? () => { setEditingItemIdx(idx); setEditDialogOpen(true); } : undefined}
                    onRegistryConfigChange={item.kind === 'registry' ? (config) => handleRegistryConfigChange(idx, config) : undefined}
                  />
                </div>
              );
            })}
          </GridLayout>

          {items.length === 0 && (
            <div className="w-full py-12 text-center text-sm text-slate-400 dark:text-slate-500">
              <Plus className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No widgets yet. Click <strong>+ Add</strong> above to get started.
            </div>
          )}
        </div>
        </WidgetDataProvider>
      )}

      {/* Collapsed placeholder */}
      {collapsed && (
        <div className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500 italic">
          {itemLabel} &middot; click the arrow to expand
        </div>
      )}

      {/* ═══════ Maximize dialog ═══════ */}
      <MaximizeDialog
        item={maximizedItem}
        open={maximizedItem !== null}
        onClose={() => setMaximizedItem(null)}
        dateFilter={groupDateFilter}
        dimensionFilters={groupDimensionFilters}
        filterSyncEnabled={effectiveFilterSync}
      />

      {/* Actors table columns modal (workbench only) */}
      {sectionType === 'actors' && (
        <ActorsTableColumnsModal
          open={actorsColumnsModalOpen}
          onClose={() => setActorsColumnsModalOpen(false)}
          sectionId={groupId}
          columnIds={filters.actorsTableColumnIds ?? []}
          onSave={(sid, columnIds) => updateFilters(sid, { actorsTableColumnIds: columnIds })}
        />
      )}

      {/* Pricing Dashboard columns modal */}
      {sectionType === 'pricing-dashboard' && (
        <PricingDashboardColumnsModal
          open={pricingDashboardColumnsModalOpen}
          onClose={() => setPricingDashboardColumnsModalOpen(false)}
          groupId={groupId}
        />
      )}

      {/* Loan Detail columns modal (opened from group filter bar "Edit Columns") */}
      {sectionType === 'loan-detail' && loanDetailCanvasItemId && (
        <LoanDetailColumnsModal
          open={loanDetailColumnsModalOpen}
          onClose={() => setLoanDetailColumnsModalOpen(false)}
          canvasItemId={loanDetailCanvasItemId}
          tenantId={selectedTenantId}
        />
      )}

      {/* Sales Scorecard Overview: Milestone Dates modal */}
      {sectionType === 'sales-scorecard-overview' && (
        <SalesScorecardMilestoneDatesModal
          open={salesScorecardMilestoneDatesModalOpen}
          onClose={() => setSalesScorecardMilestoneDatesModalOpen(false)}
          selectedColumns={filters.salesScorecardOverviewMilestoneColumns ?? [...DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS]}
          onSave={(columns) => {
            updateFilters(groupId, { salesScorecardOverviewMilestoneColumns: columns });
            setSalesScorecardMilestoneDatesModalOpen(false);
          }}
          tenantId={tenantIdForEdit}
        />
      )}

      {/* Edit Widget Dialog */}
      {editingItemIdx !== null && items[editingItemIdx]?.kind === 'cohi' && (
        <EditWidgetDialog
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) setEditingItemIdx(null);
          }}
          item={items[editingItemIdx] as Extract<GroupWidgetItem, { kind: 'cohi' }>}
          tenantId={tenantIdForEdit}
          dateFilter={groupDateFilter}
          onSave={(updated) => handleEditWidgetSave(editingItemIdx, updated)}
        />
      )}

      {/* Add Widget Dialog — multi-tab with Ask Cohi, Quick Metrics, Templates */}
      <AddWidgetDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        sectionType={sectionType}
        groupId={groupId}
        existingItems={items}
        onAddRegistry={handleAddRegistryWidget}
        onAddCohi={handleAddCohiWidget}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact filter dropdown (static options)
// ---------------------------------------------------------------------------

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none h-6 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2 pr-5 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 canvas-interactive"
          title={label}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dynamic filter: renders static options OR fetches from API, with cascading
// ---------------------------------------------------------------------------

function DynamicFilterSelect({
  field,
  value,
  onChange,
  parentValue,
  parentColumn,
  tenantId,
}: {
  field: SectionFilterField;
  value: string;
  onChange: (value: string) => void;
  /** Current value of the parent filter (for cascading). undefined = no parent. */
  parentValue?: string;
  /** DB column name of the parent filter (resolved from its optionsSource). */
  parentColumn?: string;
  tenantId?: string | null;
}) {
  // For static options, delegate to the simple FilterSelect
  if (field.staticOptions) {
    return (
      <FilterSelect
        value={value}
        onChange={onChange}
        options={field.staticOptions}
        label={field.label}
      />
    );
  }

  // API-driven options (optionsSource must be set)
  return (
    <ApiFilterSelect
      field={field}
      value={value}
      onChange={onChange}
      parentValue={parentValue}
      parentColumn={parentColumn}
      tenantId={tenantId}
    />
  );
}

/** Separate component so the useFilterOptions hook is only called for API-driven fields. */
function ApiFilterSelect({
  field,
  value,
  onChange,
  parentValue,
  parentColumn,
  tenantId,
}: {
  field: SectionFilterField;
  value: string;
  onChange: (value: string) => void;
  parentValue?: string;
  parentColumn?: string;
  tenantId?: string | null;
}) {
  const { options, loading } = useFilterOptions({
    column: field.optionsSource!,
    tenantId,
    filterBy: parentColumn && parentValue && parentValue !== 'all'
      ? parentColumn
      : undefined,
    filterValue: parentValue && parentValue !== 'all' ? parentValue : undefined,
  });

  // Build the dropdown options: "All X" + fetched values
  const selectOptions = useMemo(() => {
    const items: { value: string; label: string }[] = [];
    if (field.allLabel) {
      items.push({ value: 'all', label: field.allLabel });
    }
    for (const opt of options) {
      items.push({ value: opt, label: opt });
    }
    return items;
  }, [options, field.allLabel]);

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        {field.label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading && options.length === 0}
          className="appearance-none h-6 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2 pr-5 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 canvas-interactive disabled:opacity-50"
          title={field.label}
        >
          {selectOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DynamicDimensionFilter – renders a user-added dynamic filter with remove button
// ---------------------------------------------------------------------------

function DynamicDimensionFilter({
  entry,
  tenantId,
  onChange,
  onRemove,
}: {
  entry: DynamicFilterEntry;
  tenantId?: string | null;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const { options, loading } = useFilterOptions({
    column: entry.column,
    tenantId,
  });

  const selectOptions = useMemo(() => {
    const items: { value: string; label: string }[] = [
      { value: 'all', label: `All ${entry.label}` },
    ];
    for (const opt of options) {
      items.push({ value: opt, label: opt });
    }
    return items;
  }, [options, entry.label]);

  return (
    <div className="flex items-center gap-1 group/dimfilter">
      <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        {entry.label}
      </span>
      <div className="relative">
        <select
          value={entry.value}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading && options.length === 0}
          className="appearance-none h-6 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2 pr-5 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 canvas-interactive disabled:opacity-50"
          title={entry.label}
        >
          {selectOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-400 pointer-events-none" />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors canvas-interactive opacity-0 group-hover/dimfilter:opacity-100"
        title={`Remove ${entry.label} filter`}
        aria-label={`Remove ${entry.label} filter`}
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddFilterPicker – dropdown to add a new filter dimension from the catalog
// ---------------------------------------------------------------------------

function AddFilterPicker({
  groupId,
  existingColumns,
  onAdd,
}: {
  groupId: string;
  existingColumns: string[];
  onAdd: (column: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const available = useMemo(
    () => AVAILABLE_FILTER_DIMENSIONS.filter((d) => !existingColumns.includes(d.column)),
    [existingColumns],
  );

  if (available.length === 0) return null;

  return (
    <div className="relative" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-0.5 h-5 px-1.5 rounded text-[9px] font-medium canvas-interactive transition-colors',
          open
            ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
            : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
        )}
        title="Add filter dimension"
        aria-label="Add filter"
      >
        <Plus className="h-2.5 w-2.5" />
        <span>Filter</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-52 max-h-60 overflow-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl canvas-interactive">
          <div className="px-2 py-1.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
            Add filter dimension
          </div>
          <div className="p-1">
            {available.map((dim) => (
              <button
                key={dim.column}
                type="button"
                onClick={() => {
                  onAdd(dim.column, dim.label);
                  setOpen(false);
                }}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 text-xs transition-colors"
              >
                <SlidersHorizontal className="h-3 w-3 text-slate-400 shrink-0" />
                <span className="font-medium text-slate-700 dark:text-slate-200">{dim.label}</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">{dim.column}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupFilterBookmarkButton – save/load filter presets on the group filter bar
// ---------------------------------------------------------------------------

function GroupFilterBookmarkButton({
  filters,
  onApplyPreset,
}: {
  filters: SectionFilters;
  onApplyPreset: (preset: FilterPreset) => void;
}) {
  const { selectedTenantId } = useTenantStore();
  const tenantId = selectedTenantId || 'default';
  const ensureLoaded = useFilterPresetStore((s) => s.ensureLoaded);
  const presets = useFilterPresetStore((s) => s.presetsByTenant[tenantId]) ?? EMPTY_FILTER_PRESETS;
  const addPreset = useFilterPresetStore((s) => s.addPreset);
  const removePreset = useFilterPresetStore((s) => s.removePreset);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Lazily load presets from localStorage on first render
  useEffect(() => { ensureLoaded(tenantId); }, [tenantId, ensureLoaded]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSaving(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Build WidgetFilterState from the group's SectionFilters
  const currentFilterState = useMemo<WidgetFilterState>(() => {
    const state: WidgetFilterState = {};
    if (filters.dateField && filters.dateField !== 'application_date') state.dateField = filters.dateField;
    if (filters.periodSelection?.preset) state.preset = filters.periodSelection.preset;
    if (filters.year) state.year = filters.year;
    if (filters.periodSelection?.dateRange) {
      state.dateRange = filters.periodSelection.dateRange;
    } else if (filters.dateRange) {
      state.dateRange = filters.dateRange;
    }
    return state;
  }, [filters.dateField, filters.periodSelection, filters.dateRange, filters.year]);

  const hasActiveFilter = Object.keys(currentFilterState).length > 0;

  const handleSave = () => {
    if (!presetName.trim()) return;
    addPreset(tenantId, presetName.trim(), currentFilterState);
    setPresetName('');
    setSaving(false);
  };

  const describePreset = (p: FilterPreset): string => {
    const parts: string[] = [];
    if (p.filters.preset) parts.push(p.filters.preset);
    if (p.filters.year) parts.push(String(p.filters.year));
    if (p.filters.dateField && p.filters.dateField !== 'application_date') parts.push(p.filters.dateField);
    if (p.filters.dimensionFilters?.length) parts.push(`+${p.filters.dimensionFilters.length} filters`);
    return parts.join(' \u00b7 ') || 'No filter';
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSaving(false); }}
        className={cn(
          'flex items-center gap-0.5 h-5 px-1.5 rounded text-[9px] font-medium canvas-interactive transition-colors',
          open
            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
            : 'text-slate-400 dark:text-slate-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20',
        )}
        title="Filter bookmarks"
        aria-label="Filter bookmarks"
      >
        {presets.length > 0 ? <BookmarkCheck className="h-2.5 w-2.5" /> : <Bookmark className="h-2.5 w-2.5" />}
        <span>Presets</span>
      </button>

      {open && (
        <div className="absolute right-0 top-6 z-50 w-56 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 text-[11px]">
          {/* Header */}
          <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Filter Presets
          </div>

          {/* Existing presets */}
          {presets.length === 0 && !saving && (
            <div className="px-3 py-2 text-slate-400 dark:text-slate-500 italic">
              No saved presets
            </div>
          )}
          {presets.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 group/preset"
            >
              <button
                type="button"
                className="flex-1 text-left text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                onClick={() => {
                  onApplyPreset(p);
                  setOpen(false);
                }}
                title={describePreset(p)}
              >
                <span className="font-medium">{p.name}</span>
                <span className="ml-1.5 text-[9px] text-slate-400">{describePreset(p)}</span>
              </button>
              <button
                type="button"
                onClick={() => removePreset(tenantId, p.id)}
                className="p-0.5 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover/preset:opacity-100 transition-opacity canvas-interactive"
                title="Delete preset"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}

          {/* Divider */}
          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

          {/* Save current */}
          {saving ? (
            <div className="px-3 py-1.5 flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Preset name..."
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') setSaving(false);
                }}
                className="flex-1 h-5 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-500/50 canvas-interactive"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={!presetName.trim()}
                className="h-5 px-2 rounded bg-indigo-500 text-white text-[10px] font-medium hover:bg-indigo-600 disabled:opacity-50 canvas-interactive"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSaving(true)}
              disabled={!hasActiveFilter}
              className="w-full text-left px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasActiveFilter ? 'Save current group filters as a preset' : 'Set a filter first'}
            >
              <Bookmark className="h-2.5 w-2.5 inline-block mr-1.5" />
              Save current as preset...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Export for use in WorkflowConversionView (workbench Filter + Presets bar)
export { AddFilterPicker, GroupFilterBookmarkButton, DynamicDimensionFilter };

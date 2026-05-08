import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Loader2, Download, Calendar, Telescope, FlaskConical, Lightbulb, Target, ShieldAlert, Zap, User, ChevronDown, ChevronRight, Database, ArrowUpDown, ArrowUp, ArrowDown, Search, Bookmark, Check, HelpCircle, TrendingUp, TrendingDown, MessageSquare, Sparkles } from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef as TanstackColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDebugMode } from '@/contexts/DebugModeContext';
import {
  FIELD_REGISTRY,
  SUMMARY_REGISTRY,
  DEFAULT_COLUMNS,
  DEFAULT_SUMMARY_METRICS,
  type FieldFormat,
} from '@/config/insightFieldRegistry';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InsightChat } from './InsightChat';
import { DataQualityImpactBlock } from './DataQualityImpactBlock';
import type { InsightDataQualityMeta } from '@/lib/insightDataQuality';

// ============================================================================
// Types
// ============================================================================

interface InsightDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  insightSource: string;
  insightMessage: string;
  insightId?: number;
  dateFilter: string;
  selectedTenantId?: string | null;
  isAdmin?: boolean;
  etmData?: {
    what_changed?: string;
    why?: string;
    business_impact?: string;
    risk_if_ignored?: string;
    recommended_action?: string;
    owner?: string;
  };
  /** Whether this insight is already on the watchlist (from parent). */
  isTracked?: boolean;
  /** Toggle track/untrack on the watchlist. */
  onToggleTrack?: () => void;
  /** @deprecated Use isTracked + onToggleTrack for toggle behavior. */
  onTrackInsight?: () => void;
  /** When details fetch fails (e.g. 404 no detail_data), call this so parent can show a fallback (e.g. DashboardInsightEvidenceModal). */
  onDetailUnavailable?: () => void;
}

interface AuditSummaryDef {
  key: string;
  label: string;
  value: number | string;
  format: string;
  color: string;
}

interface AuditCorrection {
  key: string;
  label: string;
  from: number;
  to: number;
  reason: string;
}

interface DomainStat {
  id: string;
  candidateCount: number;
  promptLength: number;
}

interface PipelineContextData {
  generationBatch: string;
  dateFilter: string;
  channelGroup?: string;
  metricsPrompt: string;
  signalsText: string;
  signalCount: number;
  generatorModel: string;
  generatorCandidateCount: number;
  judgeModel?: string;
  curatorModel?: string;
  domains?: DomainStat[];
  stepTimings: {
    signals: number;
    rag: number;
    generator: number;
    factCheck: number;
    judge: number;
    curator: number;
    evidence: number;
    total: number;
  };
}

interface InsightJourneyData {
  generatorIndex: number;
  headline: string;
  reasoningChain?: string;
  citedNumbers?: string[];
  sourceDomain?: string;
  factCheck: {
    score: number;
    issues: string[];
  };
  judgeScore: number;
  judgeIssues?: string[];
  curatorBucket: string;
  curatorPriority: string;
}

interface EvidenceAuditData {
  pipelineContext?: PipelineContextData;
  insightJourney?: InsightJourneyData;
  generatedSql: string;
  rowCount: number;
  rawSummary: AuditSummaryDef[];
  resolvedSummary: AuditSummaryDef[];
  finalSummary: AuditSummaryDef[];
  corrections: AuditCorrection[];
  comparisonSql?: string;
  comparisonRowCount?: number;
  sqlExecutionMs?: number;
  totalMs?: number;
}

interface ColumnDef {
  key: string;
  label: string;
  format: string;
  align: string;
}

interface SummaryDef {
  key: string;
  label: string;
  value: number | string;
  format: string;
  color: string;
}

interface DisplayConfig {
  columns: string[];
  summaryMetrics: string[];
  column_defs?: ColumnDef[];
  summary_defs?: SummaryDef[];
}

interface DateRangeInfo {
  label: string;
  startDate: string;
  endDate: string;
}

interface ETMSection {
  what_changed?: string;
  why?: string;
  business_impact?: string;
  risk_if_ignored?: string;
  recommended_action?: string;
  owner?: string;
}

interface ComparisonData {
  label: string;
  currentLabel: string;
  rows: Record<string, any>[];
  summary: Record<string, number>;
  summary_defs?: SummaryDef[];
}

interface DetailData {
  source: string;
  title: string;
  summary: Record<string, number>;
  displayConfig?: DisplayConfig;
  dateRange?: DateRangeInfo;
  dataAsOf?: string;
  rows?: Record<string, any>[];
  etm?: ETMSection;
  /** My Insights: ties the card to the user's interest profile */
  profile_relevance?: string | null;
  comparison?: ComparisonData | null;
  audit?: EvidenceAuditData | null;
  data_quality?: InsightDataQualityMeta;
  // Legacy fields
  loans?: Record<string, any>[];
  officers?: Record<string, any>[];
  months?: Record<string, any>[];
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatCell(value: any, format: FieldFormat): string {
  if (value == null || value === '') return '-';

  switch (format) {
    case 'currency': {
      const num = Number(value);
      if (isNaN(num)) return '-';
      if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
      if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
      return `$${num.toFixed(0)}`;
    }
    case 'percent': {
      const num = Number(value);
      if (isNaN(num)) return '-';
      return `${num.toFixed(1)}%`;
    }
    case 'rate': {
      const num = Number(value);
      if (isNaN(num)) return '-';
      return `${num.toFixed(3)}%`;
    }
    case 'number': {
      const num = Number(value);
      if (isNaN(num)) return '-';
      return num.toLocaleString();
    }
    case 'days': {
      const num = Number(value);
      if (isNaN(num)) return '-';
      return `${Math.round(num)}d`;
    }
    case 'bps': {
      const num = Number(value);
      if (isNaN(num)) return '-';
      return `${num} bps`;
    }
    case 'date': {
      if (!value) return '-';
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return String(value);
      }
    }
    case 'mono':
      return String(value);
    case 'badge':
      return String(value);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'text':
    default:
      return String(value);
  }
}

/** Plain-text version for CSV (no HTML, no $ prefix rounding quirks) */
function formatCellPlain(value: any, format: FieldFormat): string {
  if (value == null || value === '') return '';

  switch (format) {
    case 'currency':
    case 'number':
    case 'bps':
    case 'days': {
      const num = Number(value);
      return isNaN(num) ? '' : String(num);
    }
    case 'percent':
    case 'rate': {
      const num = Number(value);
      return isNaN(num) ? '' : String(num);
    }
    case 'date': {
      if (!value) return '';
      try {
        return new Date(value).toISOString().split('T')[0];
      } catch {
        return String(value);
      }
    }
    case 'boolean':
      return value ? 'Yes' : 'No';
    default:
      return String(value).replace(/,/g, ' '); // escape commas for CSV
  }
}

/** Build a human-readable date range string like "Jan 1 – Feb 9, 2026" */
function formatDateRange(dr?: DateRangeInfo): string {
  if (!dr) return '';
  try {
    const start = new Date(dr.startDate);
    const end = new Date(dr.endDate);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const optsYear: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    const sameYear = start.getFullYear() === end.getFullYear();
    if (sameYear) {
      return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', optsYear)}`;
    }
    return `${start.toLocaleDateString('en-US', optsYear)} – ${end.toLocaleDateString('en-US', optsYear)}`;
  } catch {
    return dr.label || '';
  }
}

function formatSummaryValue(value: any, format: string): string {
  if (value == null) return '-';
  const num = Number(value);
  switch (format) {
    case 'currency': {
      if (isNaN(num)) return '-';
      if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
      if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
      return `$${num.toFixed(0)}`;
    }
    case 'percent':
      return isNaN(num) ? '-' : `${num.toFixed(1)}%`;
    case 'days':
      return isNaN(num) ? '-' : `${Math.round(num)}d`;
    case 'bps':
      return isNaN(num) ? '-' : `${num} bps`;
    case 'number':
    default:
      return isNaN(num) ? String(value) : num.toLocaleString();
  }
}

// ============================================================================
// Shared tooltip helper
// ============================================================================

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="w-3 h-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================================
// ETM field tooltip descriptions
// ============================================================================

const ETM_TOOLTIPS: Record<string, string> = {
  what_changed: 'The specific metric or trend that triggered this insight',
  why: 'Root cause analysis — what is likely driving the change',
  business_impact: 'Estimated effect on revenue, volume, or operational efficiency',
  risk_if_ignored: 'What could happen if no action is taken in the next 30–90 days',
  recommended_action: 'Suggested next step for your team',
  owner: 'The role or person best positioned to act on this',
};

// ============================================================================
// Table context sentence templates
// ============================================================================

const TABLE_CONTEXT: Record<string, string> = {
  predictions: 'Loans flagged by the prediction model with their risk scores and key attributes.',
  credit_risk: 'Loans with elevated credit risk factors such as low FICO, high LTV, or high DTI.',
  lost_opportunity: 'Loans that were withdrawn or denied during the selected period.',
  pipeline: 'Active pipeline loans and their current status, age, and lock information.',
  performance: 'Loan officer performance metrics including volume, pull-through, and cycle time.',
  comparisons: 'Month-over-month comparison of funded volume and loan counts.',
  closing_risk: 'Loans with approaching closing dates that may need attention.',
  lock_expiration: 'Loans with rate locks expiring soon.',
  trid: 'Loans approaching TRID compliance deadlines.',
  margin: 'Margin data is shown as summary metrics above.',
  condition_backlog: 'Loans with outstanding underwriting conditions.',
  tiering: 'Personnel ranked by performance tier with revenue and volume metrics.',
  product_breakdown: 'Loan products broken down by volume, pull-through, and fallout rates.',
  risk_cross_tab: 'Risk segments showing fallout rates across product, FICO, and DTI bands.',
  dashboard_insights: 'Leaderboard and by-period metrics supporting this dashboard insight.',
};

// ============================================================================
// Suggested Q&A starter questions by insight source
// ============================================================================

const STARTER_QUESTIONS: Record<string, string[]> = {
  predictions: ['Which loan officers have the most at-risk loans?', 'What is the most common reason for predicted withdrawals?'],
  credit_risk: ['Are high-risk loans concentrated in any product type?', 'How does this compare to last month?'],
  lost_opportunity: ['Are these losses concentrated in any product type or officer?', 'What is driving the withdrawals?'],
  pipeline: ["What's causing the longest cycle times?", 'Which loans have been stalled the longest?'],
  performance: ['Who are the top-improving officers this month?', 'Which officers have the highest fallout?'],
  comparisons: ['What products are driving the volume change?', 'How does pull-through compare year-over-year?'],
  closing_risk: ['Which loans are most likely to miss their closing date?', 'What milestones are blocking closings?'],
  lock_expiration: ['What is the total volume at risk from lock expirations?', 'Can any of these locks be extended?'],
  margin: ['What products have the best margins?', 'Is margin trending up or down?'],
  condition_backlog: ['Which loans have the most outstanding conditions?', 'Are conditions concentrated in any product?'],
  tiering: ['What separates top-tier from bottom-tier performers?', 'How has tiering changed from last month?'],
  product_breakdown: ['Which product has the worst pull-through?', 'Where is volume growing fastest?'],
  risk_cross_tab: ['Which risk segment has the highest fallout?', 'How large is the worst-performing segment?'],
  dashboard_insights: ['How does this period compare to the previous one?', 'Who are the top performers by volume?'],
};

// ============================================================================
// Summary Card component
// ============================================================================

const SummaryCard = ({ label, value, color = 'blue', description, delta }: {
  label: string;
  value: string | number;
  color?: 'blue' | 'green' | 'red' | 'amber' | 'purple';
  description?: string;
  delta?: { value: number; favorable: 'up' | 'down' };
}) => {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
    green: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300',
    red: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300',
  };

  const deltaIsGood = delta && (
    (delta.favorable === 'up' && delta.value > 0) ||
    (delta.favorable === 'down' && delta.value < 0)
  );
  const deltaIsBad = delta && !deltaIsGood && delta.value !== 0;

  return (
    <div className={`rounded-lg p-3 ${colorClasses[color]}`}>
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium opacity-80">{label}</span>
        {description && <InfoTip text={description} />}
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-lg font-semibold">{value}</span>
        {delta && delta.value !== 0 && (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${deltaIsGood ? 'text-emerald-600 dark:text-emerald-400' : deltaIsBad ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
            {delta.value > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {delta.value > 0 ? '+' : ''}{delta.value.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Badge cell renderer (for predictedOutcome, riskReason, etc.)
// ============================================================================

function BadgeCell({ value }: { value: string }) {
  const lower = (value || '').toLowerCase();
  const isDanger =
    lower.includes('deny') ||
    lower.includes('risk') ||
    lower.includes('critical');
  const isWarning =
    lower.includes('withdraw') || lower.includes('warn');

  const cls = isDanger
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
    : isWarning
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';

  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {value}
    </span>
  );
}

// ============================================================================
// Sortable + Searchable Data Table (powered by @tanstack/react-table)
// ============================================================================

interface InsightDataTableProps {
  columns: string[];
  rows: Record<string, any>[];
  columnDefMap: Record<string, ColumnDef>;
}

function InsightDataTable({ columns, rows, columnDefMap }: InsightDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [showFilters, setShowFilters] = useState(false);

  const tableColumns = useMemo<TanstackColumnDef<Record<string, any>>[]>(() =>
    columns
      .filter(colKey => {
        const cDef = columnDefMap[colKey];
        const field = FIELD_REGISTRY[colKey];
        return cDef?.label || field?.label;
      })
      .map(colKey => {
        const cDef = columnDefMap[colKey];
        const field = FIELD_REGISTRY[colKey];
        const fmt = (cDef?.format || field?.format || 'text') as FieldFormat;
        const align = cDef?.align || field?.align || 'left';
        const label = cDef?.label || field?.label || colKey;

        return {
          accessorKey: colKey,
          header: label,
          sortingFn: (fmt === 'currency' || fmt === 'number' || fmt === 'percent' || fmt === 'days' || fmt === 'bps' || fmt === 'rate')
            ? 'alphanumeric' as const
            : 'text' as const,
          filterFn: 'includesString' as const,
          cell: ({ getValue }: { getValue: () => any }) => {
            const raw = getValue();
            if (fmt === 'mono') {
              return <span className="font-mono text-xs">{formatCell(raw, fmt)}</span>;
            }
            if (fmt === 'badge') {
              return <BadgeCell value={String(raw || '-')} />;
            }
            if (fmt === 'boolean') {
              return raw
                ? <span className="text-emerald-600">Yes</span>
                : <span className="text-slate-400">No</span>;
            }
            return <span className={`text-${align}`}>{formatCell(raw, fmt)}</span>;
          },
          meta: { align, format: fmt },
        };
      }),
    [columns, columnDefMap]
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const hasActiveFilters = columnFilters.length > 0;

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Detail ({hasActiveFilters ? `${filteredCount} of ${rows.length}` : rows.length} {rows.length === 1 ? 'row' : 'rows'})
        </span>
        <button
          onClick={() => setShowFilters(f => !f)}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
            showFilters
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <Search className="w-3 h-3" />
          {showFilters ? 'Hide Filters' : 'Filter'}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id} className="border-b border-slate-200 dark:border-slate-700">
              {headerGroup.headers.map(header => {
                const meta = header.column.columnDef.meta as { align: string; format: string } | undefined;
                const align = meta?.align || 'left';
                const canSort = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();

                return (
                  <th
                    key={header.id}
                    className={`py-3 px-2 font-medium text-slate-600 dark:text-slate-400 text-${align}`}
                  >
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        className={`flex items-center gap-1 ${canSort ? 'cursor-pointer select-none hover:text-slate-900 dark:hover:text-slate-200' : ''} ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="inline-flex w-3.5 h-3.5 flex-shrink-0">
                            {sortDir === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5 text-indigo-500" />
                            ) : sortDir === 'desc' ? (
                              <ArrowDown className="w-3.5 h-3.5 text-indigo-500" />
                            ) : (
                              <ArrowUpDown className="w-3.5 h-3.5 opacity-30" />
                            )}
                          </span>
                        )}
                      </button>
                      {showFilters && (
                        <input
                          type="text"
                          value={(header.column.getFilterValue() as string) ?? ''}
                          onChange={e => header.column.setFilterValue(e.target.value || undefined)}
                          placeholder="Search..."
                          className="w-full min-w-[60px] px-1.5 py-0.5 text-xs font-normal border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr
              key={row.id}
              className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              {row.getVisibleCells().map(cell => {
                const meta = cell.column.columnDef.meta as { align: string; format: string } | undefined;
                const align = meta?.align || 'left';
                return (
                  <td key={cell.id} className={`py-3 px-2 text-${align}`}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
          {filteredCount === 0 && hasActiveFilters && (
            <tr>
              <td colSpan={columns.length} className="py-6 text-center text-slate-400 text-sm">
                No rows match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export const InsightDetailModal = ({
  isOpen,
  onClose,
  insightSource,
  insightMessage,
  insightId,
  dateFilter,
  selectedTenantId,
  isAdmin,
  etmData,
  isTracked: isTrackedProp,
  onToggleTrack,
  onTrackInsight,
  onDetailUnavailable,
}: InsightDetailModalProps) => {
  const navigate = useNavigate();
  const { isPlatformStaff } = useAuth();
  const isAdminUser = isAdmin ?? isPlatformStaff();
  const { isDebugMode } = useDebugMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetailData | null>(null);
  const [isCreatingDeepDive, setIsCreatingDeepDive] = useState(false);
  const [localTracked, setLocalTracked] = useState(false);
  const isTracked = onToggleTrack != null ? (isTrackedProp ?? false) : localTracked;
  const [activePeriod, setActivePeriod] = useState<'current' | 'prior'>('current');
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [auditSection, setAuditSection] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && insightSource) {
      fetchDetails();
    }
  }, [isOpen, insightSource, insightId, dateFilter]);

  const fetchDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const tenantParam = selectedTenantId ? `&tenant_id=${selectedTenantId}` : '';
      const idParam = insightId ? `&insightId=${insightId}` : '';
      const headlineParam = !insightId && insightMessage ? `&headline=${encodeURIComponent(insightMessage)}` : '';
      const result = await api.request<DetailData>(
        `/api/dashboard/insights/details/${insightSource}?dateFilter=${dateFilter}${tenantParam}${idParam}${headlineParam}`
      );
      setData(result);
      setActivePeriod('current');
    } catch (err: any) {
      console.error('Error fetching insight details see:', err);
      setError(err.message || 'Failed to load details');
      const msg = err?.message ?? '';
      if (onDetailUnavailable && (msg.includes('No detail data') || msg.includes('Insight not found'))) {
        onDetailUnavailable();
      }
    } finally {
      setLoading(false);
    }
  };

  // Deep Dive in Workbench handler
  const handleDeepDive = useCallback(async () => {
    if (!insightId || isCreatingDeepDive) return;
    setIsCreatingDeepDive(true);
    try {
      const tenantParam = selectedTenantId ? `?tenant_id=${encodeURIComponent(selectedTenantId)}` : '';
      const result = await api.request<{ id: string }>(
        `/api/workbench/canvases/from-insight${tenantParam}`,
        {
          method: 'POST',
          body: JSON.stringify({ insightId }),
        }
      );
      onClose();
      navigate(`/my-dashboard?canvas=${result.id}`);
    } catch (err: any) {
      console.error('Error creating deep-dive canvas:', err);
    } finally {
      setIsCreatingDeepDive(false);
    }
  }, [insightId, isCreatingDeepDive, selectedTenantId, onClose, navigate]);

  const [isCreatingResearch, setIsCreatingResearch] = useState(false);

  const handleMoveToResearch = useCallback(async () => {
    if (isCreatingResearch) return;
    setIsCreatingResearch(true);
    try {
      const tenantParam = selectedTenantId ? `?tenant_id=${encodeURIComponent(selectedTenantId)}` : '';
      const summaryMetrics: Record<string, any> = {};
      if (data?.summary) {
        for (const [k, v] of Object.entries(data.summary)) {
          summaryMetrics[k] = v;
        }
      }

      const result = await api.request<{ sessionId: string }>(
        `/api/research/sessions${tenantParam}`,
        {
          method: 'POST',
          body: JSON.stringify({
            initialContext: {
              insightId,
              headline: insightMessage,
              understory: etmData?.what_changed || data?.title || insightMessage,
              keyMetrics: summaryMetrics,
              evidenceSummary: etmData?.business_impact || undefined,
            },
          }),
        }
      );
      onClose();
      navigate(`/research?session=${result.sessionId}`);
    } catch (err: any) {
      console.error('Error creating research session from insight:', err);
    } finally {
      setIsCreatingResearch(false);
    }
  }, [isCreatingResearch, selectedTenantId, insightId, insightMessage, etmData, data, onClose, navigate]);

  const hasComparison = useMemo(() => !!data?.comparison, [data]);

  // Unified rows from new `rows` field or legacy `loans`/`officers`/`months`
  const rows = useMemo(() => {
    if (!data) return [];
    if (activePeriod === 'prior' && data.comparison?.rows) {
      return data.comparison.rows;
    }
    return data.rows || data.loans || data.officers || data.months || [];
  }, [data, activePeriod]);

  // Check if we have self-describing column_defs from the evidence table
  const hasColumnDefs = useMemo(() => {
    return (data?.displayConfig?.column_defs?.length || 0) > 0;
  }, [data]);

  const hasSummaryDefs = useMemo(() => {
    return (data?.displayConfig?.summary_defs?.length || 0) > 0;
  }, [data]);

  // Resolve ETM data from the detail response or from props
  const etm = useMemo(() => {
    return data?.etm || etmData || null;
  }, [data, etmData]);

  // Resolve columns: prefer column_defs (self-describing) → LLM columns → defaults
  const columns = useMemo(() => {
    if (hasColumnDefs) {
      return data!.displayConfig!.column_defs!.map(c => c.key);
    }
    let cols: string[];
    const llmCols = data?.displayConfig?.columns;
    if (llmCols?.length && rows.length > 0) {
      const sampleRow = rows[0];
      const validCols = llmCols.filter(k => sampleRow[k] !== undefined);
      cols = validCols.length >= 2 ? validCols : (DEFAULT_COLUMNS[insightSource] || []);
    } else {
      cols = DEFAULT_COLUMNS[insightSource] || [];
    }
    if (rows.length > 0 && rows[0].loanNumber !== undefined) {
      const without = cols.filter(c => c !== 'loanNumber');
      cols = ['loanNumber', ...without];
    }
    return cols;
  }, [data, insightSource, rows, hasColumnDefs]);

  // Build a lookup map for column_defs by key
  const columnDefMap = useMemo(() => {
    const map: Record<string, ColumnDef> = {};
    if (data?.displayConfig?.column_defs) {
      for (const def of data.displayConfig.column_defs) {
        map[def.key] = def;
      }
    }
    return map;
  }, [data]);

  // Resolve summary metrics: prefer summary_defs → LLM metrics → defaults
  const summaryMetricKeys = useMemo(() => {
    if (hasSummaryDefs) return data!.displayConfig!.summary_defs!.map(s => s.key);
    const llmMetrics = data?.displayConfig?.summaryMetrics;
    if (llmMetrics?.length && data?.summary) {
      const validMetrics = llmMetrics.filter(k => data.summary[k] != null);
      if (validMetrics.length >= 1) return validMetrics;
    }
    return DEFAULT_SUMMARY_METRICS[insightSource] || [];
  }, [data, insightSource, hasSummaryDefs]);

  // Build a lookup map for summary_defs by key (period-aware)
  const summaryDefMap = useMemo(() => {
    const map: Record<string, SummaryDef> = {};
    if (activePeriod === 'prior' && data?.comparison?.summary_defs) {
      for (const def of data.comparison.summary_defs) {
        map[def.key] = def;
      }
    } else if (data?.displayConfig?.summary_defs) {
      for (const def of data.displayConfig.summary_defs) {
        map[def.key] = def;
      }
    }
    return map;
  }, [data, activePeriod]);

  // ==============================
  // CSV Export
  // ==============================

  const exportCSV = () => {
    if (!columns.length || !rows.length) return;
    const headers = columns.map(k => {
      const def = columnDefMap[k];
      if (def) return def.label;
      return FIELD_REGISTRY[k]?.label || k;
    });
    const csvRows = rows.map(row =>
      columns.map(k => {
        const def = columnDefMap[k];
        const field = FIELD_REGISTRY[k];
        const fmt = (def?.format || field?.format || 'text') as FieldFormat;
        const raw = row[k];
        return `"${formatCellPlain(raw, fmt).replace(/"/g, '""')}"`;
      }).join(',')
    );
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `insight-${insightSource}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-5xl max-h-[92vh] overflow-hidden bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">
                  {data?.title || 'Insight Details'}
                </h2>
                {data?.dateRange && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 whitespace-nowrap">
                    <Calendar className="w-3 h-3" />
                    {data.dateRange.label} &middot; {formatDateRange(data.dateRange)}
                  </span>
                )}
                {data?.dataAsOf && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                    Data as of {new Date(data.dataAsOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })},{' '}
                    {new Date(data.dataAsOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                {insightMessage}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {(onToggleTrack ?? onTrackInsight) && (
                <button
                  onClick={() => {
                    if (onToggleTrack) {
                      onToggleTrack();
                    } else {
                      onTrackInsight?.();
                      setLocalTracked(true);
                    }
                  }}
                  disabled={onToggleTrack == null && isTracked}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
                    isTracked
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/30 dark:hover:text-amber-300'
                  }`}
                  title={isTracked ? 'Remove from watchlist' : 'Track this insight'}
                >
                  {isTracked ? <Check className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                  <span className="hidden sm:inline">{isTracked ? 'Tracked' : 'Track'}</span>
                </button>
              )}
              {insightId && (
                <button
                  onClick={handleDeepDive}
                  disabled={isCreatingDeepDive}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg hover:from-blue-600 hover:to-indigo-700 shadow-sm hover:shadow transition-all disabled:opacity-50"
                  title="Open deep-dive analysis in Workbench"
                >
                  {isCreatingDeepDive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Telescope className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">
                    {isCreatingDeepDive ? 'Creating...' : 'Deep Dive'}
                  </span>
                </button>
              )}
              <button
                onClick={handleMoveToResearch}
                disabled={isCreatingResearch}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/30 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                title="Investigate further in Research Lab"
              >
                {isCreatingResearch ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FlaskConical className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">
                  {isCreatingResearch ? 'Opening...' : 'Research Lab'}
                </span>
              </button>
              {rows.length > 0 && columns.length > 0 && (
                <button
                  onClick={exportCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  title="Export to CSV"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Export</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="ml-3 text-slate-500">Loading details...</span>
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
                <p className="text-slate-600 dark:text-slate-400">{error}</p>
                <button
                  onClick={fetchDetails}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : data ? (
              <div className="space-y-6">
                {data.data_quality?.flagged && (
                  <DataQualityImpactBlock dq={data.data_quality} />
                )}

                {data.profile_relevance?.trim() && (
                  <div className="rounded-xl border border-blue-200/70 dark:border-blue-800/50 bg-blue-50/60 dark:bg-blue-950/25 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 mb-1.5 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Why this is for you
                    </h3>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {data.profile_relevance.trim()}
                    </p>
                  </div>
                )}

                {/* ========== Recommended Action Hero Callout ========== */}
                {etm?.recommended_action && (
                  <div className="flex gap-3 rounded-xl border-l-4 border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 p-4">
                    <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Recommended Action</span>
                        <InfoTip text={ETM_TOOLTIPS.recommended_action} />
                      </div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed">{etm.recommended_action}</p>
                      {etm.owner && (
                        <span className="inline-flex items-center gap-1 mt-2 text-xs text-slate-500 dark:text-slate-400">
                          <User className="w-3 h-3" /> Owner: {etm.owner}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* ========== ETM Reasoning Panel (with tooltips) ========== */}
                {etm && (etm.what_changed || etm.why || etm.business_impact) && (
                  <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-500" />
                      Executive Analysis
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      {etm.what_changed && (
                        <div className="space-y-1">
                          <span className="font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                            <Target className="w-3.5 h-3.5 text-blue-500" />
                            What Changed
                            <InfoTip text={ETM_TOOLTIPS.what_changed} />
                          </span>
                          <p className="text-slate-700 dark:text-slate-300 pl-5">{etm.what_changed}</p>
                        </div>
                      )}
                      {etm.why && (
                        <div className="space-y-1">
                          <span className="font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                            Why
                            <InfoTip text={ETM_TOOLTIPS.why} />
                          </span>
                          <p className="text-slate-700 dark:text-slate-300 pl-5">{etm.why}</p>
                        </div>
                      )}
                      {etm.business_impact && (
                        <div className="space-y-1">
                          <span className="font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-emerald-500" />
                            Business Impact
                            <InfoTip text={ETM_TOOLTIPS.business_impact} />
                          </span>
                          <p className="text-slate-700 dark:text-slate-300 pl-5">{etm.business_impact}</p>
                        </div>
                      )}
                      {etm.risk_if_ignored && (
                        <div className="space-y-1">
                          <span className="font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                            Risk if Ignored
                            <InfoTip text={ETM_TOOLTIPS.risk_if_ignored} />
                          </span>
                          <p className="text-slate-700 dark:text-slate-300 pl-5">{etm.risk_if_ignored}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ========== Period Toggle (comparison insights only) ========== */}
                {hasComparison && data?.comparison && (
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 w-fit">
                    <button
                      onClick={() => setActivePeriod('current')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        activePeriod === 'current'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                    >
                      {data.comparison.currentLabel || 'Current Period'}
                    </button>
                    <button
                      onClick={() => setActivePeriod('prior')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        activePeriod === 'prior'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                    >
                      {data.comparison.label || 'Prior Period'}
                    </button>
                  </div>
                )}

                {/* ========== Dynamic Summary Cards ========== */}
                {summaryMetricKeys.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {summaryMetricKeys.map(metricKey => {
                      const sDef = summaryDefMap[metricKey];
                      const config = SUMMARY_REGISTRY[metricKey];

                      // Compute delta if comparison data is available
                      let delta: { value: number; favorable: 'up' | 'down' } | undefined;
                      if (activePeriod === 'current' && data.comparison?.summary) {
                        const currentVal = sDef ? Number(sDef.value) : data.summary?.[metricKey];
                        const priorVal = data.comparison.summary[metricKey];
                        if (currentVal != null && priorVal != null && !isNaN(Number(currentVal)) && !isNaN(Number(priorVal)) && Number(priorVal) !== 0) {
                          const pct = ((Number(currentVal) - Number(priorVal)) / Math.abs(Number(priorVal))) * 100;
                          const isNegativeGood = metricKey.includes('Risk') || metricKey.includes('Lost') || metricKey.includes('denied') || metricKey.includes('withdrawn') || metricKey.includes('Fallout') || metricKey.includes('Expiring');
                          delta = { value: pct, favorable: isNegativeGood ? 'down' : 'up' };
                        }
                      }

                      if (sDef) {
                        return (
                          <SummaryCard
                            key={metricKey}
                            label={sDef.label}
                            value={formatSummaryValue(sDef.value, sDef.format)}
                            color={(sDef.color as any) || 'blue'}
                            description={config?.description}
                            delta={delta}
                          />
                        );
                      }
                      const value = data.summary?.[metricKey];
                      if (value == null || !config) return null;
                      return (
                        <SummaryCard
                          key={metricKey}
                          label={config.label}
                          value={formatSummaryValue(value, config.format)}
                          color={config.color}
                          description={config.description}
                          delta={delta}
                        />
                      );
                    })}
                  </div>
                )}

                {/* ========== Table Context Sentence ========== */}
                {columns.length > 0 && rows.length > 0 && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 -mb-3">
                    {TABLE_CONTEXT[insightSource] || 'Detailed data supporting this insight.'}{' '}
                    <span className="font-medium">
                      {rows.length} {rows.length === 1 ? 'record' : 'records'}
                      {data?.dateRange ? ` from ${formatDateRange(data.dateRange)}` : ''}.
                    </span>
                  </p>
                )}

                {/* ========== Dynamic Data Table (sortable + searchable) ========== */}
                {columns.length > 0 && rows.length > 0 ? (
                  <InsightDataTable
                    columns={columns}
                    rows={rows}
                    columnDefMap={columnDefMap}
                  />
                ) : columns.length === 0 && rows.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    {insightSource === 'margin'
                      ? 'Margin is an aggregate metric. See summary cards above for current and prior month comparison.'
                      : 'No detailed data available for this insight.'}
                  </div>
                ) : null}

                {/* Data as-of timestamp */}
                {data?.dateRange && (
                  <div className="text-xs text-slate-400 text-right pt-2">
                    Data as of {new Date(data.dateRange.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                )}

                {/* ========== Inline Q&A (InsightChat) ========== */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <InsightChat
                    insightContext={{
                      title: insightMessage,
                      summary: etm?.what_changed || data?.title || insightMessage,
                      keyMetrics: data.summary as Record<string, string | number> | undefined,
                      evidence: data.audit?.generatedSql ? [{
                        sql: data.audit.generatedSql,
                        explanation: etm?.why || '',
                        rowCount: data.audit.rowCount,
                      }] : undefined,
                    }}
                    selectedTenantId={selectedTenantId}
                    starterQuestions={STARTER_QUESTIONS[insightSource]}
                  />
                </div>

                {/* Debug mode: Data Provenance Audit Panel */}
                {isDebugMode && (
                  <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => { setIsAuditOpen(!isAuditOpen); if (isAuditOpen) setAuditSection(null); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      {isAuditOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      <Database className="w-3.5 h-3.5" />
                      Data Provenance
                      {data?.audit && data.audit.corrections.length > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-[10px] font-semibold">
                          {data.audit.corrections.length} correction{data.audit.corrections.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {data?.audit?.pipelineContext ? (
                        <span className="ml-auto text-[10px] text-slate-400">
                          {data.audit.rowCount} rows · {data.audit.pipelineContext.stepTimings.total}ms total
                        </span>
                      ) : data?.audit ? (
                        <span className="ml-auto text-[10px] text-slate-400">
                          {data.audit.rowCount} rows
                          {data.audit.totalMs != null && ` · ${data.audit.totalMs}ms`}
                        </span>
                      ) : (
                        <span className="ml-auto text-[10px] text-slate-400">no audit data</span>
                      )}
                    </button>

                    {isAuditOpen && (
                      <div className="text-xs bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
                        {!data?.audit ? (
                          <div className="px-3 py-3 text-slate-400 text-[11px]">
                            No provenance data available for this insight. Regenerate insights to populate the audit trail.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">

                            {/* ── Section: Pipeline Overview ── */}
                            {data.audit.pipelineContext && (
                              <div>
                                <button
                                  onClick={() => setAuditSection(auditSection === 'pipeline' ? null : 'pipeline')}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                >
                                  {auditSection === 'pipeline' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  Pipeline Overview
                                  <span className="ml-auto text-[10px] text-slate-400 font-normal">
                                    {data.audit.pipelineContext.generatorCandidateCount} candidates &rarr; {data.audit.rowCount} rows
                                  </span>
                                </button>
                                {auditSection === 'pipeline' && (
                                  <div className="px-3 pb-3 space-y-2">
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                      <span>Batch</span><span className="truncate">{data.audit.pipelineContext.generationBatch}</span>
                                      <span>Date Filter</span><span>{data.audit.pipelineContext.dateFilter}</span>
                                      {data.audit.pipelineContext.channelGroup && (<><span>Channel</span><span>{data.audit.pipelineContext.channelGroup}</span></>)}
                                      <span>Generator</span><span>{data.audit.pipelineContext.generatorModel} ({data.audit.pipelineContext.generatorCandidateCount} candidates)</span>
                                      {data.audit.pipelineContext.judgeModel && (<><span>Judge</span><span>{data.audit.pipelineContext.judgeModel}</span></>)}
                                      {data.audit.pipelineContext.curatorModel && (<><span>Curator</span><span>{data.audit.pipelineContext.curatorModel}</span></>)}
                                      <span>Signals</span><span>{data.audit.pipelineContext.signalCount} computed</span>
                                    </div>
                                    {data.audit.pipelineContext.domains && data.audit.pipelineContext.domains.length > 0 && (
                                      <div className="pt-1">
                                        <div className="text-[10px] font-medium text-slate-400 mb-1">Domain-Split Generation</div>
                                        <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                          {data.audit.pipelineContext.domains.map(d => (
                                            <div key={d.id} className="bg-slate-50 dark:bg-slate-800 rounded px-2 py-1">
                                              <div className="font-medium text-slate-600 dark:text-slate-300">{d.id.replace(/_/g, ' ')}</div>
                                              <div>{d.candidateCount} candidates · {(d.promptLength / 1000).toFixed(1)}KB</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    <div className="text-[10px] text-slate-400 pt-1">
                                      <span className="font-medium">Step Timings:</span>{' '}
                                      Signals {data.audit.pipelineContext.stepTimings.signals}ms
                                      {' · '}RAG {data.audit.pipelineContext.stepTimings.rag}ms
                                      {' · '}Generator {data.audit.pipelineContext.stepTimings.generator}ms
                                      {' · '}Fact-Check {data.audit.pipelineContext.stepTimings.factCheck}ms
                                      {' · '}Judge {data.audit.pipelineContext.stepTimings.judge}ms
                                      {' · '}Curator {data.audit.pipelineContext.stepTimings.curator}ms
                                      {' · '}Evidence {data.audit.pipelineContext.stepTimings.evidence}ms
                                      {' · '}Total {data.audit.pipelineContext.stepTimings.total}ms
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* ── Section: Metrics Prompt ── */}
                            {data.audit.pipelineContext?.metricsPrompt && (
                              <div>
                                <button
                                  onClick={() => setAuditSection(auditSection === 'metrics' ? null : 'metrics')}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                >
                                  {auditSection === 'metrics' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  Metrics Prompt (LLM Input)
                                  <span className="ml-auto text-[10px] text-slate-400 font-normal">
                                    {data.audit.pipelineContext.metricsPrompt.length.toLocaleString()} chars
                                  </span>
                                </button>
                                {auditSection === 'metrics' && (
                                  <div className="px-3 pb-3">
                                    <pre className="bg-slate-50 dark:bg-slate-800 rounded p-2 text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                                      {data.audit.pipelineContext.metricsPrompt}
                                    </pre>
                                    {data.audit.pipelineContext.signalsText && (
                                      <>
                                        <div className="font-medium text-slate-500 dark:text-slate-400 mt-2 mb-1 text-[11px]">Signals Text</div>
                                        <pre className="bg-slate-50 dark:bg-slate-800 rounded p-2 text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                                          {data.audit.pipelineContext.signalsText}
                                        </pre>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* ── Section: Insight Journey ── */}
                            {data.audit.insightJourney && (
                              <div>
                                <button
                                  onClick={() => setAuditSection(auditSection === 'journey' ? null : 'journey')}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                >
                                  {auditSection === 'journey' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  Insight Journey
                                  <span className="ml-auto text-[10px] text-slate-400 font-normal">
                                    {data.audit.insightJourney.sourceDomain && <>{data.audit.insightJourney.sourceDomain.replace(/_/g, ' ')} · </>}
                                    FC {data.audit.insightJourney.factCheck.score.toFixed(2)}
                                    {' · '}Judge {data.audit.insightJourney.judgeScore.toFixed(1)}
                                    {' · '}{data.audit.insightJourney.curatorBucket}/{data.audit.insightJourney.curatorPriority}
                                  </span>
                                </button>
                                {auditSection === 'journey' && (
                                  <div className="px-3 pb-3 space-y-2">
                                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                      <span className="font-medium">Generator Index</span>
                                      <span>#{data.audit.insightJourney.generatorIndex}</span>
                                      {data.audit.insightJourney.sourceDomain && (
                                        <>
                                          <span className="font-medium">Source Domain</span>
                                          <span className="capitalize">{data.audit.insightJourney.sourceDomain.replace(/_/g, ' ')}</span>
                                        </>
                                      )}
                                      <span className="font-medium">Fact-Check Score</span>
                                      <span className={data.audit.insightJourney.factCheck.score < 0.7 ? 'text-amber-500' : 'text-emerald-500'}>
                                        {data.audit.insightJourney.factCheck.score.toFixed(2)}
                                        {data.audit.insightJourney.factCheck.issues.length > 0 &&
                                          ` (${data.audit.insightJourney.factCheck.issues.length} issue${data.audit.insightJourney.factCheck.issues.length > 1 ? 's' : ''})`}
                                      </span>
                                      {data.audit.insightJourney.factCheck.issues.length > 0 && (
                                        <>
                                          <span className="font-medium">FC Issues</span>
                                          <span className="text-amber-500">{data.audit.insightJourney.factCheck.issues.join('; ')}</span>
                                        </>
                                      )}
                                      <span className="font-medium">Judge Score</span>
                                      <span className={data.audit.insightJourney.judgeScore < 5 ? 'text-amber-500' : 'text-emerald-500'}>
                                        {data.audit.insightJourney.judgeScore.toFixed(1)}/10
                                      </span>
                                      {data.audit.insightJourney.judgeIssues && data.audit.insightJourney.judgeIssues.length > 0 && (
                                        <>
                                          <span className="font-medium">Judge Issues</span>
                                          <span className="text-amber-500">{data.audit.insightJourney.judgeIssues.join('; ')}</span>
                                        </>
                                      )}
                                      <span className="font-medium">Curator</span>
                                      <span>{data.audit.insightJourney.curatorBucket} / {data.audit.insightJourney.curatorPriority}</span>
                                      {data.audit.insightJourney.citedNumbers && data.audit.insightJourney.citedNumbers.length > 0 && (
                                        <>
                                          <span className="font-medium">Cited Numbers</span>
                                          <span>{data.audit.insightJourney.citedNumbers.join(', ')}</span>
                                        </>
                                      )}
                                    </div>
                                    {data.audit.insightJourney.reasoningChain && (
                                      <div>
                                        <div className="font-medium text-slate-500 dark:text-slate-400 mb-1 text-[11px]">LLM Reasoning Chain</div>
                                        <pre className="bg-slate-50 dark:bg-slate-800 rounded p-2 text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                                          {data.audit.insightJourney.reasoningChain}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* ── Section: Evidence Agent ── */}
                            <div>
                              <button
                                onClick={() => setAuditSection(auditSection === 'evidence' ? null : 'evidence')}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                              >
                                {auditSection === 'evidence' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                Evidence Agent (SQL + KPIs)
                                <span className="ml-auto text-[10px] text-slate-400 font-normal">
                                  {data.audit.rowCount} rows
                                  {data.audit.corrections.length > 0 && ` · ${data.audit.corrections.length} corrections`}
                                  {data.audit.sqlExecutionMs != null && ` · ${data.audit.sqlExecutionMs}ms`}
                                </span>
                              </button>
                              {auditSection === 'evidence' && (
                                <div className="px-3 pb-3 space-y-2">
                                  {/* KPI corrections */}
                                  {data.audit.corrections.length > 0 && (
                                    <div>
                                      <div className="font-semibold text-amber-600 dark:text-amber-400 mb-1 text-[11px]">KPI Corrections Applied</div>
                                      <div className="space-y-1">
                                        {data.audit.corrections.map((c, i) => (
                                          <div key={i} className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                                            <span className="font-medium">{c.label}</span>
                                            <span className="text-rose-500 line-through">{c.from}</span>
                                            <span className="text-slate-400">&rarr;</span>
                                            <span className="text-emerald-600">{c.to}</span>
                                            <span className="text-slate-400 text-[10px]">({c.reason})</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Summary pipeline */}
                                  {data.audit.rawSummary.length > 0 && (
                                    <div>
                                      <div className="font-medium text-slate-500 dark:text-slate-400 mb-1 text-[11px]">Summary Pipeline</div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-[11px] font-mono">
                                          <thead>
                                            <tr className="text-slate-400 text-left">
                                              <th className="pr-3 py-0.5">KPI</th>
                                              <th className="pr-3 py-0.5">Raw (LLM)</th>
                                              <th className="pr-3 py-0.5">Resolved</th>
                                              <th className="pr-3 py-0.5">Final</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {data.audit.rawSummary.map((raw, i) => {
                                              const resolved = data.audit!.resolvedSummary[i];
                                              const final_ = data.audit!.finalSummary[i];
                                              const changed = String(raw.value) !== String(final_?.value);
                                              return (
                                                <tr key={raw.key} className={changed ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}>
                                                  <td className="pr-3 py-0.5 font-medium">{raw.label}</td>
                                                  <td className="pr-3 py-0.5">{String(raw.value)}</td>
                                                  <td className="pr-3 py-0.5">{String(resolved?.value ?? '-')}</td>
                                                  <td className="pr-3 py-0.5">{String(final_?.value ?? '-')}</td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}

                                  {/* Evidence SQL */}
                                  {data.audit.generatedSql && (
                                    <div>
                                      <div className="font-medium text-slate-500 dark:text-slate-400 mb-1 text-[11px]">Evidence SQL</div>
                                      <pre className="bg-slate-50 dark:bg-slate-800 rounded p-2 overflow-x-auto text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                                        {data.audit.generatedSql}
                                      </pre>
                                    </div>
                                  )}

                                  {/* Comparison SQL */}
                                  {data.audit.comparisonSql && (
                                    <div>
                                      <div className="font-medium text-slate-500 dark:text-slate-400 mb-1 text-[11px]">
                                        Comparison SQL
                                        {data.audit.comparisonRowCount != null && (
                                          <span className="ml-2 font-normal text-slate-400">({data.audit.comparisonRowCount} rows)</span>
                                        )}
                                      </div>
                                      <pre className="bg-slate-50 dark:bg-slate-800 rounded p-2 overflow-x-auto text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                                        {data.audit.comparisonSql}
                                      </pre>
                                    </div>
                                  )}

                                  {/* Timing */}
                                  {(data.audit.sqlExecutionMs != null || data.audit.totalMs != null) && (
                                    <div className="flex gap-4 text-slate-400 text-[10px]">
                                      {data.audit.sqlExecutionMs != null && <span>SQL exec: {data.audit.sqlExecutionMs}ms</span>}
                                      {data.audit.totalMs != null && <span>Evidence agent: {data.audit.totalMs}ms</span>}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

export default InsightDetailModal;

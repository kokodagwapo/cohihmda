import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Loader2, Download, Calendar, Telescope } from 'lucide-react';
import { api } from '@/lib/api';
import {
  FIELD_REGISTRY,
  SUMMARY_REGISTRY,
  DEFAULT_COLUMNS,
  DEFAULT_SUMMARY_METRICS,
  type FieldFormat,
} from '@/config/insightFieldRegistry';

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
}

interface DisplayConfig {
  columns: string[];
  summaryMetrics: string[];
}

interface DateRangeInfo {
  label: string;
  startDate: string;
  endDate: string;
}

interface DetailData {
  source: string;
  title: string;
  summary: Record<string, number>;
  displayConfig?: DisplayConfig;
  dateRange?: DateRangeInfo;
  /** ISO timestamp of when the insight was generated (data freshness) */
  dataAsOf?: string;
  rows?: Record<string, any>[];
  // Legacy fields — kept for backward compat
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
// Summary Card component
// ============================================================================

const SummaryCard = ({ label, value, color = 'blue' }: {
  label: string;
  value: string | number;
  color?: 'blue' | 'green' | 'red' | 'amber' | 'purple';
}) => {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
    green: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300',
    red: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300',
  };

  return (
    <div className={`rounded-lg p-3 ${colorClasses[color]}`}>
      <span className="text-xs font-medium opacity-80">{label}</span>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
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
}: InsightDetailModalProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetailData | null>(null);
  const [isCreatingDeepDive, setIsCreatingDeepDive] = useState(false);

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
    } catch (err: any) {
      console.error('Error fetching insight details see:', err);
      setError(err.message || 'Failed to load details');
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

  // Unified rows from new `rows` field or legacy `loans`/`officers`/`months`
  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows || data.loans || data.officers || data.months || [];
  }, [data]);

  // Resolve columns: prefer LLM-chosen columns → but validate they actually exist
  // in the row data. If <2 of the LLM columns have data, fall back to defaults.
  // RULE: If the rows contain loanId, it MUST always be the first column.
  const columns = useMemo(() => {
    let cols: string[];
    const llmCols = data?.displayConfig?.columns;
    if (llmCols?.length && rows.length > 0) {
      const sampleRow = rows[0];
      const validCols = llmCols.filter(k => sampleRow[k] !== undefined);
      cols = validCols.length >= 2 ? validCols : (DEFAULT_COLUMNS[insightSource] || []);
    } else {
      cols = DEFAULT_COLUMNS[insightSource] || [];
    }

    // Enforce: if this is loan-level data, loanId is always first
    if (rows.length > 0 && rows[0].loanId !== undefined) {
      const without = cols.filter(c => c !== 'loanId');
      cols = ['loanId', ...without];
    }

    return cols;
  }, [data, insightSource, rows]);

  // Resolve summary metrics: prefer LLM-chosen → validate against actual summary → fall back
  const summaryMetricKeys = useMemo(() => {
    const llmMetrics = data?.displayConfig?.summaryMetrics;
    if (llmMetrics?.length && data?.summary) {
      const validMetrics = llmMetrics.filter(k => data.summary[k] != null);
      if (validMetrics.length >= 1) return validMetrics;
    }
    return DEFAULT_SUMMARY_METRICS[insightSource] || [];
  }, [data, insightSource]);

  // ==============================
  // CSV Export
  // ==============================

  const exportCSV = () => {
    if (!columns.length || !rows.length) return;
    const headers = columns.map(k => FIELD_REGISTRY[k]?.label || k);
    const csvRows = rows.map(row =>
      columns.map(k => {
        const field = FIELD_REGISTRY[k];
        const raw = row[k];
        return `"${formatCellPlain(raw, field?.format || 'text').replace(/"/g, '""')}"`;
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

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-5xl max-h-[85vh] overflow-hidden bg-white dark:bg-slate-900 rounded-2xl shadow-2xl"
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
          <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(85vh-80px)]">
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
                {/* ========== Dynamic Summary Cards ========== */}
                {summaryMetricKeys.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {summaryMetricKeys.map(metricKey => {
                      const config = SUMMARY_REGISTRY[metricKey];
                      const value = data.summary?.[metricKey];
                      if (value == null || !config) return null;
                      return (
                        <SummaryCard
                          key={metricKey}
                          label={config.label}
                          value={formatSummaryValue(value, config.format)}
                          color={config.color}
                        />
                      );
                    })}
                  </div>
                )}

                {/* ========== Dynamic Data Table ========== */}
                {columns.length > 0 && rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Detail ({rows.length} {rows.length === 1 ? 'row' : 'rows'})
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          {columns.map(colKey => {
                            const field = FIELD_REGISTRY[colKey];
                            if (!field) return null;
                            return (
                              <th
                                key={colKey}
                                className={`py-3 px-2 font-medium text-slate-600 dark:text-slate-400 text-${field.align}`}
                              >
                                {field.label}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => (
                          <tr
                            key={row.loanId || row.name || row.month || idx}
                            className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          >
                            {columns.map(colKey => {
                              const field = FIELD_REGISTRY[colKey];
                              if (!field) return <td key={colKey} />;
                              const raw = row[colKey];

                              // Special rendering for certain formats
                              if (field.format === 'mono') {
                                return (
                                  <td key={colKey} className="py-3 px-2 font-mono text-xs">
                                    {formatCell(raw, field.format)}
                                  </td>
                                );
                              }
                              if (field.format === 'badge') {
                                return (
                                  <td key={colKey} className="py-3 px-2">
                                    <BadgeCell value={String(raw || '-')} />
                                  </td>
                                );
                              }
                              if (field.format === 'boolean') {
                                return (
                                  <td key={colKey} className="py-3 px-2 text-center">
                                    {raw ? (
                                      <span className="text-emerald-600">Yes</span>
                                    ) : (
                                      <span className="text-slate-400">No</span>
                                    )}
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={colKey}
                                  className={`py-3 px-2 text-${field.align}`}
                                >
                                  {formatCell(raw, field.format)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
              </div>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default InsightDetailModal;

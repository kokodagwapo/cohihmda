/**
 * Enhanced Visualization Component
 * Modern charts with animations, drilldown capabilities, and Cohi insights
 */

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  RadialBarChart,
  RadialBar,
  ComposedChart,
  Treemap,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Users,
  DollarSign,
  Percent,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Layers,
  Lightbulb,
  Target,
  Activity,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface DrilldownLevel {
  id: string;
  label: string;
  data: any[];
  parentId?: string;
}

export interface CohiInsight {
  type: 'success' | 'warning' | 'alert' | 'info';
  title: string;
  description: string;
  metric?: string;
  trend?: 'up' | 'down' | 'neutral';
  /** Data row for drilldown (e.g. top performer, loan officer, loan) */
  payload?: any;
}

export interface EnhancedVisualizationConfig {
  type: 'bar' | 'line' | 'pie' | 'area' | 'radial' | 'treemap' | 'composed' | 'kpi-grid' | 'drilldown-table' | 'table' | 'kpi' | 'donut' | 'horizontal_bar';
  title: string;
  subtitle?: string;
  data: any[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  animated?: boolean;
  drilldownEnabled?: boolean;
  drilldownLevels?: DrilldownLevel[];
  insights?: CohiInsight[];
  kpis?: KPIData[];
}

interface KPIData {
  label: string;
  value: number | string;
  change?: number;
  changeLabel?: string;
  format?: 'number' | 'currency' | 'percent';
  icon?: React.ComponentType<any>;
  color?: string;
}

interface EnhancedVisualizationProps {
  config: EnhancedVisualizationConfig;
  className?: string;
  height?: number;
  onDrilldown?: (item: any, level: string) => void;
  showInsights?: boolean;
  loading?: boolean;
  /**
   * When true, forces a compact layout suitable for narrow containers (< 500px).
   * - Insights panel always stacks below the chart (never side-by-side)
   * - Chart margins are reduced
   * - Axis font sizes are smaller
   * - Pie/donut legend is hidden to save space
   * Use this when rendering inside a sidebar or narrow panel.
   */
  compact?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

// Modern pastel color palette for premium dashboard experience
const PASTEL_COLORS = [
  { start: '#818cf8', end: '#6366f1', pastel: '#c7d2fe' }, // soft indigo
  { start: '#4ade80', end: '#22c55e', pastel: '#bbf7d0' }, // soft green
  { start: '#fbbf24', end: '#f59e0b', pastel: '#fde68a' }, // soft amber
  { start: '#f87171', end: '#ef4444', pastel: '#fecaca' }, // soft coral
  { start: '#c084fc', end: '#a855f7', pastel: '#e9d5ff' }, // soft purple
  { start: '#f472b6', end: '#ec4899', pastel: '#fbcfe8' }, // soft pink
  { start: '#2dd4bf', end: '#14b8a6', pastel: '#99f6e4' }, // soft teal
  { start: '#fb923c', end: '#f97316', pastel: '#fed7aa' }, // soft orange
  { start: '#60a5fa', end: '#3b82f6', pastel: '#bfdbfe' }, // soft blue
  { start: '#22d3ee', end: '#06b6d4', pastel: '#a5f3fc' }, // soft cyan
];

const GRADIENT_COLORS = PASTEL_COLORS;

const DEFAULT_COLORS = GRADIENT_COLORS.map(g => g.start);

// Theme-aware chart colors (axis, grid, tooltip) – use CSS variables for dark/light
const CHART_THEME = {
  light: {
    axis: 'hsl(215, 16%, 47%)',
    grid: 'hsl(214, 32%, 91%)',
    tooltipBg: 'rgba(255, 255, 255, 0.95)',
    tooltipBorder: 'hsl(214, 32%, 91%)',
    cursor: 'rgba(99, 102, 241, 0.08)',
  },
  dark: {
    axis: 'hsl(212, 9%, 58%)',
    grid: 'hsl(213, 12%, 21%)',
    tooltipBg: 'hsl(215, 21%, 11%, 0.95)',
    tooltipBorder: 'hsl(213, 12%, 21%)',
    cursor: 'rgba(99, 102, 241, 0.12)',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatValue(value: any, format?: string): string {
  if (value === null || value === undefined) return 'N/A';
  
  if (typeof value === 'number') {
    if (format === 'currency') {
      if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
      if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
      return `$${value.toLocaleString()}`;
    }
    if (format === 'percent') return `${value.toFixed(1)}%`;
    if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    if (value % 1 !== 0) return value.toFixed(2);
    return value.toLocaleString();
  }
  
  return String(value);
}

function formatLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ============================================================================
// Animated Tooltip
// ============================================================================

const AnimatedTooltip = ({ active, payload, label }: any) => {
  const { theme } = useTheme();
  const t = CHART_THEME[theme === 'dark' ? 'dark' : 'light'];
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  const hasLeaderboardMetrics =
    row && (
      typeof row.volume === 'number' ||
      typeof row.pullthrough === 'number' ||
      typeof row.turntime === 'number' ||
      typeof row.revenue === 'number'
    );

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="rounded-xl shadow-2xl p-4 backdrop-blur-md min-w-[160px] border"
      style={{
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.15), 0 8px 16px -4px rgba(0, 0, 0, 0.08)',
      }}
    >
      <p className="font-semibold mb-3 text-sm pb-2 border-b" style={{ color: t.axis, borderColor: t.grid }}>{label}</p>
      <div className="space-y-2">
        {payload.map((entry: any, index: number) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full ring-2"
                style={{ backgroundColor: entry.color, ringColor: t.tooltipBg }}
              />
              <span className="text-xs" style={{ color: t.axis }}>{formatLabel(entry.name)}</span>
            </div>
            <span className="font-bold tabular-nums" style={{ color: t.axis }}>{formatValue(entry.value)}</span>
          </motion.div>
        ))}
      </div>
      {hasLeaderboardMetrics && row && (
        <div className="mt-3 pt-2 border-t space-y-1.5 text-xs" style={{ borderColor: t.grid, color: t.axis }}>
          {typeof row.volume === 'number' && (
            <div className="flex justify-between gap-4"><span>Volume</span><span className="tabular-nums">{formatValue(row.volume)}</span></div>
          )}
          {typeof row.pullthrough === 'number' && (
            <div className="flex justify-between gap-4"><span>Pull-through</span><span className="tabular-nums">{row.pullthrough}%</span></div>
          )}
          {typeof row.turntime === 'number' && (
            <div className="flex justify-between gap-4"><span>Turntime</span><span className="tabular-nums">{row.turntime} days</span></div>
          )}
          {typeof row.revenue === 'number' && (
            <div className="flex justify-between gap-4"><span>Revenue</span><span className="tabular-nums">{formatValue(row.revenue)}</span></div>
          )}
        </div>
      )}
    </motion.div>
  );
};

// ============================================================================
// Loading Skeleton for Charts
// ============================================================================

const ChartSkeleton: React.FC<{ height: number; type?: 'bar' | 'line' | 'pie' }> = ({ height, type = 'bar' }) => {
  return (
    <div className="w-full animate-pulse" style={{ height }}>
      <div className="flex items-end justify-around h-full p-4 gap-2">
        {type === 'bar' && (
          <>
            {[65, 85, 45, 75, 55, 90, 40].map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ delay: i * 0.08, duration: 0.4, ease: 'easeOut' }}
                className="flex-1 bg-gradient-to-t from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-600 rounded-t-lg"
              />
            ))}
          </>
        )}
        {type === 'line' && (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-full h-3/4" viewBox="0 0 200 100" preserveAspectRatio="none">
              <motion.path
                d="M0,80 C20,60 40,70 60,40 C80,10 100,30 120,50 C140,70 160,20 180,40 L200,30"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-slate-200 dark:text-slate-700"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.5, ease: 'easeInOut' }}
              />
            </svg>
          </div>
        )}
        {type === 'pie' && (
          <div className="w-full h-full flex items-center justify-center">
            <motion.div
              className="w-32 h-32 rounded-full bg-gradient-to-br from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-600"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// KPI Grid Component
// ============================================================================

const KPIGrid: React.FC<{ kpis: KPIData[] }> = ({ kpis }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, index) => {
        const Icon = kpi.icon || DollarSign;
        const isPositive = (kpi.change || 0) > 0;
        const isNegative = (kpi.change || 0) < 0;
        
        return (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.4 }}
            whileHover={{ scale: 1.02, y: -2 }}
            className="relative overflow-hidden"
          >
            <Card className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 border-slate-200/50 dark:border-slate-700/50 shadow-lg hover:shadow-xl transition-all duration-300">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div 
                    className="p-2.5 rounded-xl"
                    style={{ backgroundColor: `${kpi.color || '#3b82f6'}15` }}
                  >
                    <Icon 
                      className="w-5 h-5" 
                      style={{ color: kpi.color || '#3b82f6' }}
                    />
                  </div>
                  {kpi.change !== undefined && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: index * 0.1 + 0.2 }}
                      className={cn(
                        "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
                        isPositive && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                        isNegative && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                        !isPositive && !isNegative && "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      )}
                    >
                      {isPositive ? <TrendingUp className="w-3 h-3" /> : isNegative ? <TrendingDown className="w-3 h-3" /> : null}
                      {kpi.change > 0 ? '+' : ''}{kpi.change?.toFixed(1)}%
                    </motion.div>
                  )}
                </div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.1 + 0.1 }}
                  className="text-2xl font-bold text-slate-900 dark:text-white mb-1"
                >
                  {formatValue(kpi.value, kpi.format)}
                </motion.div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{kpi.label}</div>
                {kpi.changeLabel && (
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{kpi.changeLabel}</div>
                )}
              </CardContent>
              <div 
                className="absolute bottom-0 left-0 right-0 h-1 opacity-50"
                style={{ 
                  background: `linear-gradient(90deg, ${kpi.color || '#3b82f6'}, transparent)` 
                }}
              />
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
};

// ============================================================================
// Cohi Insights Panel
// ============================================================================

const CohiInsightsPanel: React.FC<{
  insights: CohiInsight[];
  onInsightClick?: (insight: CohiInsight) => void;
}> = ({ insights, onInsightClick }) => {
  const getInsightIcon = (type: CohiInsight['type']) => {
    switch (type) {
      case 'success': return CheckCircle;
      case 'warning': return AlertTriangle;
      case 'alert': return XCircle;
      default: return Lightbulb;
    }
  };
  
  const getInsightStyle = (type: CohiInsight['type']) => {
    switch (type) {
      case 'success': return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800';
      case 'warning': return 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800';
      case 'alert': return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
      default: return 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800';
    }
  };
  
  const getIconColor = (type: CohiInsight['type']) => {
    switch (type) {
      case 'success': return 'text-green-600 dark:text-green-400';
      case 'warning': return 'text-amber-600 dark:text-amber-400';
      case 'alert': return 'text-red-600 dark:text-red-400';
      default: return 'text-blue-600 dark:text-blue-400';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 text-blue-500 shrink-0" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">Cohi Insights</span>
      </div>
      <div className="space-y-3">
        {insights.map((insight, index) => {
          const Icon = getInsightIcon(insight.type);
          const hasDrilldown = !!insight.payload && !!onInsightClick;
          return (
            <div
              key={index}
              role={hasDrilldown ? 'button' : undefined}
              tabIndex={hasDrilldown ? 0 : undefined}
              onClick={() => hasDrilldown && onInsightClick(insight)}
              onKeyDown={hasDrilldown ? (e) => e.key === 'Enter' && onInsightClick?.(insight) : undefined}
              className={cn(
                "rounded-xl border p-3.5 transition-colors text-left",
                hasDrilldown && "cursor-pointer hover:bg-white/80 dark:hover:bg-slate-700/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
                getInsightStyle(insight.type)
              )}
            >
              <div className="flex gap-3">
                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", insight.type === 'success' && "bg-emerald-100 dark:bg-emerald-900/40", insight.type === 'warning' && "bg-amber-100 dark:bg-amber-900/40", insight.type === 'alert' && "bg-red-100 dark:bg-red-900/40", (insight.type === 'info' || !insight.type) && "bg-slate-200 dark:bg-slate-700")}>
                  <Icon className={cn("w-4 h-4 shrink-0", getIconColor(insight.type))} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white">{insight.title}</span>
                    {insight.trend === 'up' && <TrendingUp className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                    {insight.trend === 'down' && <TrendingDown className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">{insight.description}</p>
                  {(insight.metric || hasDrilldown) && (
                    <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                      {insight.metric && (
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{insight.metric}</span>
                      )}
                      {hasDrilldown && (
                        <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 inline-flex items-center gap-1">
                          View details
                          <ChevronRight className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Drilldown Table
// ============================================================================

interface DrilldownTableProps {
  data: any[];
  currentLevel: string;
  onDrilldown: (item: any, nextLevel: string) => void;
  onBack?: () => void;
  breadcrumbs?: string[];
}

const DrilldownTable: React.FC<DrilldownTableProps> = ({ 
  data, 
  currentLevel, 
  onDrilldown, 
  onBack,
  breadcrumbs = []
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  
  const columns = useMemo(() => {
    if (!data.length) return [];
    return Object.keys(data[0]).filter(k => !k.startsWith('_'));
  }, [data]);
  
  const sortedData = useMemo(() => {
    if (!sortConfig) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.dir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortConfig.dir === 'asc' 
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [data, sortConfig]);
  
  const toggleRow = (index: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  
  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return prev.dir === 'asc' ? { key, dir: 'desc' } : null;
      }
      return { key, dir: 'asc' };
    });
  };
  
  return (
    <div className="space-y-4">
      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 text-blue-600">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          )}
          <div className="flex items-center gap-1 text-slate-500">
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="w-4 h-4" />}
                <span className={i === breadcrumbs.length - 1 ? "font-medium text-slate-900 dark:text-white" : ""}>
                  {crumb}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
      
      {/* Table */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden shadow-lg bg-white dark:bg-slate-900">
        <ScrollArea className="max-h-[400px]">
          <Table>
            <TableHeader className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-800/80 sticky top-0 z-10 border-b-2 border-slate-200 dark:border-slate-700">
              <TableRow>
                <TableHead className="w-8"></TableHead>
                {columns.map(col => (
                  <TableHead 
                    key={col}
                    className="cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all duration-200 py-4"
                    onClick={() => handleSort(col)}
                  >
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-semibold text-xs uppercase tracking-wider">
                      {formatLabel(col)}
                      {sortConfig?.key === col && (
                        <motion.span 
                          initial={{ scale: 0, rotate: -180 }} 
                          animate={{ scale: 1, rotate: 0 }}
                          className="text-indigo-600 dark:text-indigo-400 font-bold"
                        >
                          {sortConfig.dir === 'asc' ? '↑' : '↓'}
                        </motion.span>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {sortedData.map((row, rowIndex) => {
                  const isExpanded = expandedRows.has(rowIndex);
                  const hasChildren = row._children?.length > 0;
                  const canDrilldown = row._drilldownLevel;
                  
                  return (
                    <React.Fragment key={rowIndex}>
                      <motion.tr
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: rowIndex * 0.02, duration: 0.3 }}
                        className={cn(
                          "group transition-all duration-200 cursor-pointer border-b border-slate-100 dark:border-slate-800",
                          isExpanded 
                            ? "bg-gradient-to-r from-blue-50 to-indigo-50/50 dark:from-blue-900/20 dark:to-indigo-900/10" 
                            : rowIndex % 2 === 0 
                              ? "bg-white dark:bg-slate-900" 
                              : "bg-slate-50/50 dark:bg-slate-800/30",
                          "hover:bg-gradient-to-r hover:from-indigo-50 hover:to-purple-50/30 dark:hover:from-indigo-900/20 dark:hover:to-purple-900/10"
                        )}
                        onClick={() => {
                          if (canDrilldown) onDrilldown(row, row._drilldownLevel);
                          else if (hasChildren) toggleRow(rowIndex);
                        }}
                      >
                        <TableCell className="w-8">
                          {(hasChildren || canDrilldown) && (
                            <motion.div 
                              animate={{ rotate: isExpanded ? 90 : 0 }}
                              className="p-1 rounded-md bg-slate-100 dark:bg-slate-700 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/30 transition-colors"
                            >
                              <ChevronRight className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                            </motion.div>
                          )}
                        </TableCell>
                        {columns.map(col => (
                          <TableCell key={col} className="py-3.5">
                            <motion.span
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className={cn(
                                "text-slate-700 dark:text-slate-300",
                                typeof row[col] === 'number' && "tabular-nums font-semibold text-slate-900 dark:text-white"
                              )}
                            >
                              {formatValue(row[col])}
                            </motion.span>
                          </TableCell>
                        ))}
                      </motion.tr>
                      
                      {/* Expanded Children */}
                      {isExpanded && hasChildren && (
                        <motion.tr
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <TableCell colSpan={columns.length + 1} className="p-0 bg-slate-50/50 dark:bg-slate-800/30">
                            <div className="pl-8 py-2">
                              <DrilldownTable
                                data={row._children}
                                currentLevel={currentLevel}
                                onDrilldown={onDrilldown}
                              />
                            </div>
                          </TableCell>
                        </motion.tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </AnimatePresence>
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  );
};

// ============================================================================
// Animated Bar Chart
// ============================================================================

type ChartTheme = typeof CHART_THEME.light;

const AnimatedBarChart: React.FC<{
  data: any[];
  xKey: string;
  yKey: string;
  colors: string[];
  height: number;
  showGrid?: boolean;
  showLegend?: boolean;
  onBarClick?: (data: any, index: number) => void;
  chartTheme?: ChartTheme;
  compact?: boolean;
}> = ({ data, xKey, yKey, colors, height, showGrid, showLegend, onBarClick, chartTheme, compact }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const t = chartTheme || CHART_THEME.light;

  const getBarStroke = (index: number) => {
    const colorSet = PASTEL_COLORS[index % PASTEL_COLORS.length];
    return colorSet.end;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={compact ? { top: 10, right: 10, left: 5, bottom: 45 } : { top: 20, right: 30, left: 20, bottom: 60 }}>
        <defs>
          {PASTEL_COLORS.map((g, i) => (
            <linearGradient key={i} id={`barGradient${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={g.pastel} stopOpacity={0.95} />
              <stop offset="50%" stopColor={g.start} stopOpacity={0.85} />
              <stop offset="100%" stopColor={g.end} stopOpacity={0.75} />
            </linearGradient>
          ))}
          <filter id="barShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.1"/>
          </filter>
        </defs>
        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} strokeOpacity={0.5} vertical={false} />
        )}
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: compact ? 9 : 11, fill: t.axis, fontWeight: 500 }}
          tickLine={false}
          axisLine={{ stroke: t.grid, strokeWidth: 1 }}
          angle={compact ? -60 : -45}
          textAnchor="end"
          height={compact ? 50 : 60}
        />
        <YAxis
          tick={{ fontSize: compact ? 9 : 11, fill: t.axis, fontWeight: 500 }}
          tickLine={false}
          axisLine={false}
          width={compact ? 40 : undefined}
          tickFormatter={(v) => formatValue(v)}
        />
        <Tooltip content={<AnimatedTooltip />} cursor={{ fill: t.cursor }} />
        {showLegend && <Legend />}
        <Bar
          dataKey={yKey}
          name=""
          radius={[10, 10, 4, 4]}
          cursor="pointer"
          onClick={(data, index) => onBarClick?.(data, index)}
          onMouseEnter={(_, index) => setActiveIndex(index)}
          onMouseLeave={() => setActiveIndex(null)}
          filter="url(#barShadow)"
          animationDuration={800}
          animationEasing="ease-out"
        >
          {data.map((entry, index) => (
            <Cell
              key={index}
              fill={`url(#barGradient${index % PASTEL_COLORS.length})`}
              stroke={getBarStroke(index)}
              strokeWidth={activeIndex === index ? 2 : 1}
              opacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
              style={{ transition: 'all 0.3s ease', filter: activeIndex === index ? 'brightness(1.05)' : 'none' }}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// Horizontal bar chart: category on Y-axis, value on X-axis
const AnimatedHorizontalBarChart: React.FC<{
  data: any[];
  categoryKey: string;
  valueKey: string;
  colors: string[];
  height: number;
  showGrid?: boolean;
  onBarClick?: (data: any, index: number) => void;
  chartTheme?: ChartTheme;
  compact?: boolean;
}> = ({ data, categoryKey, valueKey, colors, height, showGrid, onBarClick, chartTheme, compact }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const t = chartTheme || CHART_THEME.light;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={compact ? { top: 5, right: 10, left: 5, bottom: 5 } : { top: 10, right: 30, left: 80, bottom: 10 }}>
        <defs>
          {PASTEL_COLORS.map((g, i) => (
            <linearGradient key={i} id={`hBarGradient${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={g.pastel} stopOpacity={0.95} />
              <stop offset="100%" stopColor={g.end} stopOpacity={0.85} />
            </linearGradient>
          ))}
          <filter id="hBarShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.1"/>
          </filter>
        </defs>
        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} strokeOpacity={0.5} horizontal={false} />
        )}
        <XAxis type="number" tick={{ fontSize: compact ? 9 : 11, fill: t.axis }} tickLine={false} axisLine={{ stroke: t.grid }} tickFormatter={(v) => formatValue(v)} />
        <YAxis type="category" dataKey={categoryKey} width={compact ? 50 : 70} tick={{ fontSize: compact ? 9 : 11, fill: t.axis }} tickLine={false} axisLine={{ stroke: t.grid }} />
        <Tooltip content={<AnimatedTooltip />} cursor={{ fill: t.cursor }} />
        <Bar
          dataKey={valueKey}
          name=""
          radius={[0, 4, 4, 0]}
          cursor="pointer"
          onClick={(data, index) => onBarClick?.(data, index)}
          onMouseEnter={(_, index) => setActiveIndex(index)}
          onMouseLeave={() => setActiveIndex(null)}
          filter="url(#hBarShadow)"
          animationDuration={800}
          animationEasing="ease-out"
        >
          {data.map((entry, index) => (
            <Cell
              key={index}
              fill={`url(#hBarGradient${index % PASTEL_COLORS.length})`}
              stroke={PASTEL_COLORS[index % PASTEL_COLORS.length].end}
              strokeWidth={activeIndex === index ? 2 : 1}
              opacity={activeIndex === null || activeIndex === index ? 1 : 0.7}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ============================================================================
// Animated Area Chart
// ============================================================================

const AnimatedAreaChart: React.FC<{
  data: any[];
  xKey: string;
  yKeys: string[];
  colors: string[];
  height: number;
  showGrid?: boolean;
  showLegend?: boolean;
  stacked?: boolean;
  chartTheme?: ChartTheme;
  compact?: boolean;
}> = ({ data, xKey, yKeys, colors, height, showGrid, showLegend, stacked, chartTheme, compact }) => {
  const t = chartTheme || CHART_THEME.light;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={compact ? { top: 10, right: 10, left: 5, bottom: 10 } : { top: 20, right: 30, left: 20, bottom: 20 }}>
        <defs>
          {PASTEL_COLORS.map((g, i) => (
            <linearGradient key={i} id={`areaGradient${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={g.pastel} stopOpacity={0.7} />
              <stop offset="50%" stopColor={g.start} stopOpacity={0.3} />
              <stop offset="100%" stopColor={g.start} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} strokeOpacity={0.5} vertical={false} />
        )}
        <XAxis dataKey={xKey} tick={{ fontSize: compact ? 9 : 11, fill: t.axis, fontWeight: 500 }} tickLine={false} axisLine={{ stroke: t.grid, strokeWidth: 1 }} />
        <YAxis tick={{ fontSize: compact ? 9 : 11, fill: t.axis, fontWeight: 500 }} tickLine={false} axisLine={false} width={compact ? 40 : undefined} tickFormatter={(v) => formatValue(v)} />
        <Tooltip content={<AnimatedTooltip />} cursor={{ stroke: t.grid, strokeWidth: 1, strokeDasharray: '4 4' }} />
        {showLegend && <Legend />}
        {yKeys.map((key, index) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stackId={stacked ? 'stack' : undefined}
            stroke={PASTEL_COLORS[index % PASTEL_COLORS.length].end}
            strokeWidth={2.5}
            fill={`url(#areaGradient${index % PASTEL_COLORS.length})`}
            animationDuration={1000}
            animationEasing="ease-out"
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
};

// ============================================================================
// Animated Pie Chart
// ============================================================================

const AnimatedPieChart: React.FC<{
  data: any[];
  nameKey: string;
  valueKey: string;
  colors: string[];
  height: number;
  onSliceClick?: (data: any, index: number) => void;
  compact?: boolean;
}> = ({ data, nameKey, valueKey, colors, height, onSliceClick, compact }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <defs>
          {PASTEL_COLORS.map((g, i) => (
            <linearGradient key={i} id={`pieGradient${i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={g.pastel} stopOpacity={0.95} />
              <stop offset="50%" stopColor={g.start} stopOpacity={0.9} />
              <stop offset="100%" stopColor={g.end} stopOpacity={0.85} />
            </linearGradient>
          ))}
          <filter id="pieShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.12"/>
          </filter>
        </defs>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius="35%"
          outerRadius="70%"
          paddingAngle={3}
          cursor="pointer"
          onClick={(data, index) => onSliceClick?.(data, index)}
          onMouseEnter={(_, index) => setActiveIndex(index)}
          onMouseLeave={() => setActiveIndex(null)}
          animationDuration={800}
          animationEasing="ease-out"
        >
          {data.map((entry, index) => (
            <Cell 
              key={index} 
              fill={`url(#pieGradient${index % PASTEL_COLORS.length})`}
              stroke={PASTEL_COLORS[index % PASTEL_COLORS.length].end}
              strokeWidth={activeIndex === index ? 3 : 1}
              opacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
              style={{ 
                transition: 'all 0.3s ease',
                filter: activeIndex === index ? 'brightness(1.08) url(#pieShadow)' : 'url(#pieShadow)'
              }}
            />
          ))}
        </Pie>
        <Tooltip content={<AnimatedTooltip />} />
        {compact ? (
          <Legend
            verticalAlign="bottom"
            align="center"
            layout="horizontal"
            wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={(value) => (
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">{value}</span>
            )}
          />
        ) : (
          <Legend 
            verticalAlign="middle" 
            align="right"
            layout="vertical"
            wrapperStyle={{ paddingLeft: 20 }}
            formatter={(value) => (
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{value}</span>
            )}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const EnhancedVisualization: React.FC<EnhancedVisualizationProps> = ({
  config,
  className,
  height = 350,
  onDrilldown,
  showInsights = true,
  loading = false,
  compact = false,
}) => {
  const { theme } = useTheme();
  const chartTheme = CHART_THEME[theme === 'dark' ? 'dark' : 'light'];
  const [drilldownStack, setDrilldownStack] = useState<string[]>([]);

  const colors = config.colors || DEFAULT_COLORS;
  const xKey = config.xKey || config.nameKey || 'name';
  const yKey = config.yKey || config.valueKey || 'value';
  const yKeys = config.yKeys || [yKey];
  
  // Determine skeleton type based on chart type
  const getSkeletonType = (): 'bar' | 'line' | 'pie' => {
    if (config.type === 'bar' || config.type === 'horizontal_bar') return 'bar';
    if (config.type === 'pie' || config.type === 'donut') return 'pie';
    return 'line';
  };
  
  const handleDrilldown = useCallback((item: any, nextLevel: string) => {
    setDrilldownStack(prev => [...prev, nextLevel]);
    onDrilldown?.(item, nextLevel);
  }, [onDrilldown]);
  
  const handleBack = useCallback(() => {
    setDrilldownStack(prev => prev.slice(0, -1));
  }, []);
  
  const renderChart = useMemo(() => {
    // Show loading skeleton when loading
    if (loading) {
      return <ChartSkeleton height={height} type={getSkeletonType()} />;
    }
    
    if (!config.data || config.data.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12">
          <Layers className="w-12 h-12 mb-3 opacity-30" />
          <p>No data available</p>
        </div>
      );
    }
    
    switch (config.type) {
      case 'bar':
        return (
          <AnimatedBarChart
            data={config.data}
            xKey={xKey}
            yKey={yKey}
            colors={colors}
            height={height}
            showGrid={config.showGrid}
            showLegend={config.showLegend}
            chartTheme={chartTheme}
            compact={compact}
            onBarClick={(data) => config.drilldownEnabled && onDrilldown?.(data, 'loan_officer')}
          />
        );
        
      case 'area':
      case 'line':
        return (
          <AnimatedAreaChart
            data={config.data}
            xKey={xKey}
            yKeys={yKeys}
            colors={colors}
            height={height}
            showGrid={config.showGrid}
            showLegend={config.showLegend}
            stacked={config.stacked}
            chartTheme={chartTheme}
            compact={compact}
          />
        );
        
      case 'pie':
        return (
          <AnimatedPieChart
            data={config.data}
            nameKey={xKey}
            valueKey={yKey}
            colors={colors}
            height={height}
            compact={compact}
            onSliceClick={(data) => config.drilldownEnabled && onDrilldown?.(data, 'loan_officer')}
          />
        );
        
      case 'kpi-grid':
      case 'kpi':
        return <KPIGrid kpis={config.kpis || []} />;
        
      case 'drilldown-table':
      case 'table':
        return (
          <DrilldownTable
            data={config.data}
            currentLevel={drilldownStack[drilldownStack.length - 1] || 'top'}
            onDrilldown={handleDrilldown}
            onBack={drilldownStack.length > 0 ? handleBack : undefined}
            breadcrumbs={drilldownStack}
          />
        );
      
      case 'donut':
        return (
          <AnimatedPieChart
            data={config.data}
            nameKey={xKey}
            valueKey={yKey}
            colors={colors}
            height={height}
            compact={compact}
            onSliceClick={(data) => config.drilldownEnabled && onDrilldown?.(data, 'loan_officer')}
          />
        );
        
      case 'horizontal_bar':
        return (
          <AnimatedHorizontalBarChart
            data={config.data}
            categoryKey={xKey}
            valueKey={yKey}
            colors={colors}
            height={height}
            showGrid={config.showGrid}
            chartTheme={chartTheme}
            compact={compact}
            onBarClick={(data) => config.drilldownEnabled && onDrilldown?.(data, 'loan_officer')}
          />
        );
        
      default:
        return (
          <AnimatedBarChart
            data={config.data}
            xKey={xKey}
            yKey={yKey}
            colors={colors}
            height={height}
            showGrid={config.showGrid}
            showLegend={config.showLegend}
            chartTheme={chartTheme}
            compact={compact}
          />
        );
    }
  }, [config, theme, xKey, yKey, yKeys, colors, height, drilldownStack, handleDrilldown, handleBack, onDrilldown, compact]);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("space-y-0", className)}
    >
      <div className="overflow-hidden rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/50 shadow-sm">
        {/* Header – minimal */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-200/70 dark:border-slate-700/70">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{config.title}</h3>
          {config.subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{config.subtitle}</p>
          )}
        </div>

        {/* Chart + Insights: chart first (full width or 2/3), insights in a clear right column.
            In compact mode, always stack vertically so the chart gets full container width. */}
        <div className={showInsights && config.insights?.length
          ? compact
            ? "flex flex-col"
            : "flex flex-col lg:flex-row lg:gap-6"
          : ""
        }>
          <div className={showInsights && config.insights?.length
            ? compact
              ? "flex-1 min-w-0 min-h-[180px] p-3"
              : "flex-1 min-w-0 min-h-[220px] sm:min-h-[260px] p-4 sm:p-5 lg:p-5"
            : compact ? "p-3" : "p-4 sm:p-5"
          }>
            {renderChart}
          </div>

          {showInsights && config.insights && config.insights.length > 0 && (
            <div className={compact
              ? "w-full pt-3 pb-3 px-3 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200/70 dark:border-slate-700/70"
              : "w-full lg:w-[280px] lg:flex-shrink-0 lg:border-l border-slate-200/70 dark:border-slate-700/70 pt-4 pb-4 px-4 sm:px-5 lg:pt-5 lg:pb-5 lg:pl-0 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200/70 lg:border-t-0"
            }>
              <CohiInsightsPanel
                insights={config.insights}
                onInsightClick={config.drilldownEnabled && onDrilldown
                  ? (insight) => insight.payload != null && onDrilldown(insight.payload, insight.title === 'Needs Attention' ? 'loan_officer' : 'loan_officer')
                  : undefined
                }
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default EnhancedVisualization;

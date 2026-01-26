/**
 * Dynamic Visualization Component
 * Interactive charts and data visualizations with sorting, selection, and chart type switching
 */

import React, { useState, useMemo, useCallback } from 'react';
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
  Brush,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  BarChart3, 
  LineChart as LineChartIcon, 
  PieChart as PieChartIcon,
  AreaChart as AreaChartIcon,
  Table as TableIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Grid3X3,
  MoreHorizontal,
  Copy,
  Check,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// ============================================================================
// Types
// ============================================================================

export interface VisualizationConfig {
  type: 'bar' | 'line' | 'pie' | 'area' | 'table' | 'kpi' | 'donut' | 'horizontal_bar';
  title: string;
  data: any[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  xLabel?: string;  // Human-readable X-axis label
  yLabel?: string;  // Human-readable Y-axis label
  nameKey?: string;
  valueKey?: string;
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  kpiConfig?: {
    value: number | string;
    label: string;
    change?: number;
    changeLabel?: string;
    format?: 'number' | 'currency' | 'percent';
  };
  tableConfig?: {
    columns: { key: string; label: string; format?: string }[];
    sortable?: boolean;
    pageSize?: number;
  };
}

type ChartType = VisualizationConfig['type'];

interface DynamicVisualizationProps {
  config: VisualizationConfig;
  className?: string;
  height?: number;
  showTitle?: boolean;
  compact?: boolean;
  onChartTypeChange?: (newType: ChartType) => void;
  onDataSelect?: (selectedData: any) => void;
  interactive?: boolean;
}

// ============================================================================
// Chart Type Compatibility
// ============================================================================

const CHART_TYPE_INFO: Record<ChartType, { 
  label: string; 
  icon: React.ComponentType<any>;
  compatibleWith: ChartType[];
  description: string;
}> = {
  bar: {
    label: 'Bar Chart',
    icon: BarChart3,
    compatibleWith: ['bar', 'horizontal_bar', 'line', 'area', 'table'],
    description: 'Compare categories',
  },
  horizontal_bar: {
    label: 'Horizontal Bar',
    icon: BarChart3,
    compatibleWith: ['bar', 'horizontal_bar', 'line', 'area', 'table'],
    description: 'Compare many categories',
  },
  line: {
    label: 'Line Chart',
    icon: LineChartIcon,
    compatibleWith: ['line', 'area', 'bar', 'table'],
    description: 'Show trends',
  },
  area: {
    label: 'Area Chart',
    icon: AreaChartIcon,
    compatibleWith: ['area', 'line', 'bar', 'table'],
    description: 'Trends with volume',
  },
  pie: {
    label: 'Pie Chart',
    icon: PieChartIcon,
    compatibleWith: ['pie', 'donut', 'bar', 'horizontal_bar', 'table'],
    description: 'Part of whole',
  },
  donut: {
    label: 'Donut Chart',
    icon: PieChartIcon,
    compatibleWith: ['donut', 'pie', 'bar', 'horizontal_bar', 'table'],
    description: 'Part of whole',
  },
  table: {
    label: 'Data Table',
    icon: TableIcon,
    compatibleWith: ['table', 'bar', 'horizontal_bar', 'line', 'pie'],
    description: 'Detailed data',
  },
  kpi: {
    label: 'KPI Card',
    icon: TrendingUp,
    compatibleWith: ['kpi'],
    description: 'Single metric',
  },
};

// ============================================================================
// Default Colors
// ============================================================================

const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#06b6d4', // cyan
  '#84cc16', // lime
];

// ============================================================================
// Helper Functions
// ============================================================================

function isDateValue(value: any): boolean {
  if (typeof value !== 'string') return false;
  return /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i.test(value) ||
         /^\d{4}-\d{2}-\d{2}/.test(value) ||
         /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value);
}

function formatValue(value: any, format?: string): string {
  if (value === null || value === undefined) return 'N/A';
  
  if (isDateValue(value)) {
    return value;
  }
  
  if (typeof value === 'number') {
    if (format === 'currency') {
      if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
      if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
      return `$${value.toLocaleString()}`;
    }
    
    if (value >= 100000) {
      if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
      return `$${(value / 1000).toFixed(1)}K`;
    }
    
    if (format === 'percent') return `${value.toFixed(1)}%`;
    if (value % 1 !== 0) return value.toFixed(2);
    return value.toLocaleString();
  }
  
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(value)) {
      return formatValue(num, format);
    }
  }
  
  return String(value);
}

function formatAxisValue(value: any): string {
  if (typeof value !== 'number') return String(value);
  
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  if (value % 1 !== 0) return value.toFixed(1);
  return value.toLocaleString();
}

function formatLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function downloadCSV(data: any[], filename: string) {
  if (!data.length) return;
  
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const val = row[h];
      if (typeof val === 'string' && val.includes(',')) {
        return `"${val}"`;
      }
      return val ?? '';
    }).join(','))
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
}

/**
 * Intelligently resolve chart keys based on chart type and available data
 * This ensures switching chart types doesn't result in empty charts
 */
interface ResolvedKeys {
  categoryKey: string;  // For x-axis or pie names
  valueKey: string;     // For y-axis or pie values
  valueKeys?: string[]; // For multi-series charts
}

function resolveChartKeys(
  data: any[],
  chartType: ChartType,
  config: VisualizationConfig
): ResolvedKeys {
  if (!data.length) {
    return { categoryKey: '', valueKey: '' };
  }
  
  const keys = Object.keys(data[0]);
  
  // Find numeric and non-numeric columns
  const numericKeys: string[] = [];
  const categoryKeys: string[] = [];
  
  keys.forEach(key => {
    const sampleValues = data.slice(0, 5).map(row => row[key]);
    const isNumeric = sampleValues.some(v => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)));
    const hasVariety = new Set(sampleValues.map(String)).size > 1;
    
    if (isNumeric && hasVariety) {
      numericKeys.push(key);
    } else {
      categoryKeys.push(key);
    }
  });
  
  // Get explicitly provided keys
  const providedCategoryKey = config.xKey || config.nameKey;
  const providedValueKey = config.yKey || config.valueKey;
  const providedValueKeys = config.yKeys;
  
  // Resolve category key (for labels)
  let categoryKey = providedCategoryKey;
  if (!categoryKey || !keys.includes(categoryKey)) {
    // Prefer first non-numeric key, or first key overall
    categoryKey = categoryKeys[0] || keys[0];
  }
  
  // Resolve value key(s) (for measurements)
  let valueKey = providedValueKey;
  let valueKeys = providedValueKeys;
  
  if (!valueKey || !keys.includes(valueKey)) {
    // Look for numeric keys that aren't the category key
    const availableNumericKeys = numericKeys.filter(k => k !== categoryKey);
    valueKey = availableNumericKeys[0] || keys.find(k => k !== categoryKey) || keys[1] || keys[0];
  }
  
  if (valueKeys) {
    // Filter to only valid keys
    valueKeys = valueKeys.filter(k => keys.includes(k));
    if (valueKeys.length === 0) {
      valueKeys = undefined;
    }
  }
  
  return {
    categoryKey,
    valueKey,
    valueKeys,
  };
}

/**
 * Check if a chart type can display the given data meaningfully
 */
function canDisplayChartType(data: any[], chartType: ChartType): boolean {
  if (!data.length) return false;
  
  const keys = Object.keys(data[0]);
  
  switch (chartType) {
    case 'kpi':
      // KPI needs exactly one row with one value
      return data.length === 1 || keys.some(k => typeof data[0][k] === 'number');
    
    case 'pie':
    case 'donut':
      // Pie needs at least 2 categories and numeric values
      return data.length >= 2 && data.length <= 15;
    
    case 'bar':
    case 'horizontal_bar':
    case 'line':
    case 'area':
      // Need at least 2 data points
      return data.length >= 1;
    
    case 'table':
      // Tables can show anything
      return true;
    
    default:
      return true;
  }
}

// ============================================================================
// Custom Tooltip
// ============================================================================

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-slate-900 dark:text-white mb-1">{label}</p>
      {payload.map((entry: any, index: number) => (
        <p key={index} style={{ color: entry.color }} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span>{formatLabel(entry.name)}: {formatValue(entry.value)}</span>
        </p>
      ))}
    </div>
  );
};

// ============================================================================
// KPI Card Component
// ============================================================================

const KPICard: React.FC<{ config: VisualizationConfig['kpiConfig'] }> = ({ config }) => {
  if (!config) return null;
  
  const { value, label, change, changeLabel, format } = config;
  const formattedValue = formatValue(value, format);
  
  return (
    <div className="flex flex-col items-center justify-center h-full py-8">
      <div className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
        {formattedValue}
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        {label}
      </div>
      {change !== undefined && (
        <div className={cn(
          "flex items-center gap-1 text-sm",
          change > 0 ? "text-green-600" : change < 0 ? "text-red-600" : "text-slate-500"
        )}>
          {change > 0 ? <TrendingUp className="w-4 h-4" /> : 
           change < 0 ? <TrendingDown className="w-4 h-4" /> : 
           <Minus className="w-4 h-4" />}
          <span>{change > 0 ? '+' : ''}{change.toFixed(1)}%</span>
          {changeLabel && <span className="text-slate-400">({changeLabel})</span>}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Interactive Data Table Component
// ============================================================================

interface InteractiveTableProps {
  data: any[];
  config: VisualizationConfig['tableConfig'];
  compact?: boolean;
  onRowSelect?: (row: any) => void;
  selectedRows?: Set<number>;
}

const InteractiveTable: React.FC<InteractiveTableProps> = ({ 
  data, 
  config, 
  compact,
  onRowSelect,
  selectedRows = new Set(),
}) => {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = config?.pageSize || 10;
  
  const columns = useMemo(() => 
    config?.columns || Object.keys(data[0] || {}).map(key => ({
      key,
      label: formatLabel(key),
    })),
    [config?.columns, data]
  );
  
  const sortedData = useMemo(() => {
    if (!sortConfig) return data;
    
    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      
      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }
      
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [data, sortConfig]);
  
  const paginatedData = useMemo(() => {
    const start = currentPage * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);
  
  const totalPages = Math.ceil(data.length / pageSize);
  
  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return prev.direction === 'asc' 
          ? { key, direction: 'desc' }
          : null;
      }
      return { key, direction: 'asc' };
    });
  };
  
  const getSortIcon = (key: string) => {
    if (sortConfig?.key !== key) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400" />;
    }
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-blue-500" />
      : <ArrowDown className="w-3 h-3 text-blue-500" />;
  };
  
  return (
    <div className="space-y-2">
      <div className="overflow-auto max-h-[400px] border rounded-lg">
        <Table>
          <TableHeader className="sticky top-0 bg-slate-50 dark:bg-slate-800">
            <TableRow>
              {columns.map(col => (
                <TableHead 
                  key={col.key} 
                  className={cn(
                    "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 select-none transition-colors",
                    compact ? "py-2 px-3 text-xs" : "py-3 px-4"
                  )}
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    <span>{col.label}</span>
                    {getSortIcon(col.key)}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.map((row, rowIndex) => {
              const actualIndex = currentPage * pageSize + rowIndex;
              const isSelected = selectedRows.has(actualIndex);
              
              return (
                <TableRow 
                  key={rowIndex}
                  className={cn(
                    "cursor-pointer transition-colors",
                    isSelected && "bg-blue-50 dark:bg-blue-900/20",
                    !isSelected && "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  )}
                  onClick={() => onRowSelect?.(row)}
                >
                  {columns.map(col => (
                    <TableCell 
                      key={col.key} 
                      className={cn(
                        compact ? "py-2 px-3 text-sm" : "py-3 px-4",
                        typeof row[col.key] === 'number' && "tabular-nums"
                      )}
                    >
                      {formatValue(row[col.key], col.format)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Showing {currentPage * pageSize + 1}-{Math.min((currentPage + 1) * pageSize, data.length)} of {data.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="px-2">
              Page {currentPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Chart Type Switcher Component
// ============================================================================

interface ChartTypeSwitcherProps {
  currentType: ChartType;
  onTypeChange: (type: ChartType) => void;
  compact?: boolean;
}

const ChartTypeSwitcher: React.FC<ChartTypeSwitcherProps> = ({ 
  currentType, 
  onTypeChange,
  compact,
}) => {
  const compatibleTypes = CHART_TYPE_INFO[currentType]?.compatibleWith || [];
  
  if (compatibleTypes.length <= 1) return null;
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={compact ? "sm" : "default"} className="gap-2">
          {React.createElement(CHART_TYPE_INFO[currentType]?.icon || BarChart3, { 
            className: compact ? "w-3 h-3" : "w-4 h-4" 
          })}
          <span className={compact ? "text-xs" : "text-sm"}>
            {CHART_TYPE_INFO[currentType]?.label || 'Chart'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Change Chart Type</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {compatibleTypes.map(type => {
          const info = CHART_TYPE_INFO[type];
          const Icon = info.icon;
          
          return (
            <DropdownMenuItem
              key={type}
              onClick={() => onTypeChange(type)}
              className={cn(
                "flex items-center gap-2 cursor-pointer",
                currentType === type && "bg-slate-100 dark:bg-slate-800"
              )}
            >
              <Icon className="w-4 h-4" />
              <div className="flex-1">
                <div className="font-medium">{info.label}</div>
                <div className="text-xs text-slate-500">{info.description}</div>
              </div>
              {currentType === type && <Check className="w-4 h-4 text-blue-500" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const DynamicVisualization: React.FC<DynamicVisualizationProps> = ({
  config,
  className,
  height = 300,
  showTitle = true,
  compact = false,
  onChartTypeChange,
  onDataSelect,
  interactive = true,
}) => {
  const [activeChartType, setActiveChartType] = useState<ChartType>(config.type);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(config.showGrid !== false);
  const [showLegend, setShowLegend] = useState(config.showLegend !== false);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const colors = config.colors || DEFAULT_COLORS;
  const chartHeight = isExpanded ? Math.max(height, 500) : (compact ? Math.min(height, 200) : height);
  
  // Resolve keys for the current chart type (memoized at component level for reuse)
  const resolvedKeysForSelection = useMemo(() => {
    return resolveChartKeys(config.data, activeChartType, config);
  }, [config.data, activeChartType, config]);
  
  // Handle chart type change
  const handleTypeChange = useCallback((newType: ChartType) => {
    setActiveChartType(newType);
    onChartTypeChange?.(newType);
  }, [onChartTypeChange]);
  
  // Handle data point click
  const handleDataClick = useCallback((data: any, index: number) => {
    setSelectedIndex(prev => prev === index ? null : index);
    onDataSelect?.(data);
  }, [onDataSelect]);
  
  // Copy data to clipboard
  const handleCopyData = useCallback(() => {
    const text = JSON.stringify(config.data, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [config.data]);
  
  // Render chart based on active type
  const renderChart = useMemo(() => {
    const { data, stacked } = config;
    
    if (!data || data.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-slate-500">
          No data available
        </div>
      );
    }
    
    // Resolve keys intelligently based on chart type and available data
    const resolvedKeys = resolveChartKeys(data, activeChartType, config);
    const { categoryKey, valueKey, valueKeys } = resolvedKeys;
    
    // Check if chart type can display this data
    if (!canDisplayChartType(data, activeChartType)) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
          <div className="text-center">
            <p className="font-medium">This chart type isn't ideal for this data</p>
            <p className="text-sm">Try switching to a different visualization</p>
          </div>
        </div>
      );
    }

    const commonProps = {
      data,
      margin: compact 
        ? { top: 5, right: 5, left: 5, bottom: 5 }
        : { top: 10, right: 30, left: 10, bottom: 10 },
    };
    
    // Get colors with selection highlight
    const getBarColor = (index: number) => {
      if (selectedIndex !== null && selectedIndex !== index) {
        return colors[index % colors.length] + '40'; // 25% opacity
      }
      return colors[index % colors.length];
    };

    switch (activeChartType) {
      case 'bar':
        // Get axis labels from config or generate from keys
        const barXLabel = config.xLabel || formatLabel(categoryKey);
        const barYLabel = config.yLabel || formatLabel(valueKey);
        
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart {...commonProps} margin={compact ? commonProps.margin : { ...commonProps.margin, left: 20, bottom: 40 }}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />}
              <XAxis 
                dataKey={categoryKey} 
                tick={{ fontSize: compact ? 10 : 12 }} 
                tickFormatter={(value) => String(value).length > 15 ? String(value).slice(0, 15) + '...' : value}
                label={!compact ? { value: barXLabel, position: 'bottom', offset: 0, style: { textAnchor: 'middle', fontSize: 12, fill: '#64748b' } } : undefined}
              />
              <YAxis 
                tick={{ fontSize: compact ? 10 : 12 }} 
                tickFormatter={formatAxisValue}
                label={!compact ? { value: barYLabel, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12, fill: '#64748b' } } : undefined}
              />
              <Tooltip content={<CustomTooltip />} />
              {showLegend && <Legend />}
              {data.length > 20 && <Brush dataKey={categoryKey} height={30} stroke="#3b82f6" />}
              {valueKeys && valueKeys.length > 1 ? (
                valueKeys.map((key, index) => (
                  <Bar 
                    key={key} 
                    dataKey={key} 
                    fill={colors[index % colors.length]} 
                    stackId={stacked ? 'stack' : undefined}
                    cursor="pointer"
                    onClick={(e) => handleDataClick(e, index)}
                  />
                ))
              ) : (
                <Bar 
                  dataKey={valueKey} 
                  cursor="pointer"
                  onClick={(data, index) => handleDataClick(data, index)}
                >
                  {data.map((_, index) => (
                    <Cell key={index} fill={getBarColor(index)} />
                  ))}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'horizontal_bar':
        const hbarXLabel = config.yLabel || formatLabel(valueKey); // X axis shows values in horizontal
        const hbarYLabel = config.xLabel || formatLabel(categoryKey); // Y axis shows categories in horizontal
        
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart {...commonProps} layout="vertical" margin={compact ? commonProps.margin : { ...commonProps.margin, left: 20, bottom: 40 }}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />}
              <XAxis 
                type="number" 
                tick={{ fontSize: compact ? 10 : 12 }} 
                tickFormatter={formatAxisValue}
                label={!compact ? { value: hbarXLabel, position: 'bottom', offset: 0, style: { textAnchor: 'middle', fontSize: 12, fill: '#64748b' } } : undefined}
              />
              <YAxis 
                dataKey={categoryKey} 
                type="category" 
                width={140}
                tick={{ fontSize: compact ? 10 : 12 }} 
                tickFormatter={(value) => String(value).length > 20 ? String(value).slice(0, 20) + '...' : value}
              />
              <Tooltip content={<CustomTooltip />} />
              {showLegend && <Legend />}
              <Bar 
                dataKey={valueKey} 
                cursor="pointer"
                onClick={(data, index) => handleDataClick(data, index)}
              >
                {data.map((_, index) => (
                  <Cell key={index} fill={getBarColor(index)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      case 'line':
        const lineXLabel = config.xLabel || formatLabel(categoryKey);
        const lineYLabel = config.yLabel || formatLabel(valueKey);
        
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart {...commonProps} margin={compact ? commonProps.margin : { ...commonProps.margin, left: 20, bottom: 40 }}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />}
              <XAxis 
                dataKey={categoryKey} 
                tick={{ fontSize: compact ? 10 : 12 }}
                label={!compact ? { value: lineXLabel, position: 'bottom', offset: 0, style: { textAnchor: 'middle', fontSize: 12, fill: '#64748b' } } : undefined}
              />
              <YAxis 
                tick={{ fontSize: compact ? 10 : 12 }} 
                tickFormatter={formatAxisValue}
                label={!compact ? { value: lineYLabel, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12, fill: '#64748b' } } : undefined}
              />
              <Tooltip content={<CustomTooltip />} />
              {showLegend && <Legend />}
              {data.length > 20 && <Brush dataKey={categoryKey} height={30} stroke="#3b82f6" />}
              {valueKeys && valueKeys.length > 1 ? (
                valueKeys.map((key, index) => (
                  <Line 
                    key={key} 
                    type="monotone" 
                    dataKey={key} 
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={{ cursor: 'pointer' }}
                    activeDot={{ r: 8, cursor: 'pointer' }}
                  />
                ))
              ) : (
                <Line 
                  type="monotone" 
                  dataKey={valueKey} 
                  stroke={colors[0]}
                  strokeWidth={2}
                  dot={{ cursor: 'pointer' }}
                  activeDot={{ r: 8, cursor: 'pointer', onClick: (e: any) => handleDataClick(e, e.index) }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
        const areaXLabel = config.xLabel || formatLabel(categoryKey);
        const areaYLabel = config.yLabel || formatLabel(valueKey);
        
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <AreaChart {...commonProps} margin={compact ? commonProps.margin : { ...commonProps.margin, left: 20, bottom: 40 }}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />}
              <XAxis 
                dataKey={categoryKey} 
                tick={{ fontSize: compact ? 10 : 12 }}
                label={!compact ? { value: areaXLabel, position: 'bottom', offset: 0, style: { textAnchor: 'middle', fontSize: 12, fill: '#64748b' } } : undefined}
              />
              <YAxis 
                tick={{ fontSize: compact ? 10 : 12 }} 
                tickFormatter={formatAxisValue}
                label={!compact ? { value: areaYLabel, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12, fill: '#64748b' } } : undefined}
              />
              <Tooltip content={<CustomTooltip />} />
              {showLegend && <Legend />}
              {data.length > 20 && <Brush dataKey={categoryKey} height={30} stroke="#3b82f6" />}
              {valueKeys && valueKeys.length > 1 ? (
                valueKeys.map((key, index) => (
                  <Area 
                    key={key} 
                    type="monotone" 
                    dataKey={key} 
                    stroke={colors[index % colors.length]}
                    fill={colors[index % colors.length]}
                    fillOpacity={0.3}
                    stackId={stacked ? 'stack' : undefined}
                  />
                ))
              ) : (
                <Area 
                  type="monotone" 
                  dataKey={valueKey} 
                  stroke={colors[0]}
                  fill={colors[0]}
                  fillOpacity={0.3}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'pie':
      case 'donut':
        // Use resolved keys for pie charts
        const innerRadius = activeChartType === 'donut' ? '50%' : 0;
        
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <PieChart>
              <Pie
                data={data}
                dataKey={valueKey}
                nameKey={categoryKey}
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius="80%"
                label={({ name, percent }) => compact ? `${(percent * 100).toFixed(0)}%` : `${name}: ${(percent * 100).toFixed(0)}%`}
                labelLine={!compact}
                cursor="pointer"
                onClick={(data, index) => handleDataClick(data, index)}
              >
                {data.map((_, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={selectedIndex !== null && selectedIndex !== index 
                      ? colors[index % colors.length] + '40'
                      : colors[index % colors.length]
                    }
                    stroke={selectedIndex === index ? '#000' : undefined}
                    strokeWidth={selectedIndex === index ? 2 : undefined}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              {showLegend && <Legend />}
            </PieChart>
          </ResponsiveContainer>
        );

      case 'kpi':
        return <KPICard config={config.kpiConfig} />;

      case 'table':
        return (
          <InteractiveTable 
            data={data} 
            config={config.tableConfig} 
            compact={compact}
            onRowSelect={onDataSelect}
          />
        );

      default:
        return (
          <div className="flex items-center justify-center h-full text-slate-500">
            Unknown visualization type: {activeChartType}
          </div>
        );
    }
  }, [config, activeChartType, colors, chartHeight, compact, showGrid, showLegend, selectedIndex, handleDataClick, onDataSelect]);

  // Toolbar actions
  const toolbarActions = interactive && (
    <div className="flex items-center gap-2">
      {/* Chart type switcher */}
      <ChartTypeSwitcher
        currentType={activeChartType}
        onTypeChange={handleTypeChange}
        compact={compact}
      />
      
      {/* More options menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={compact ? "sm" : "default"}>
            <MoreHorizontal className={compact ? "w-3 h-3" : "w-4 h-4"} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setShowGrid(!showGrid)}>
            <Grid3X3 className="w-4 h-4 mr-2" />
            {showGrid ? 'Hide Grid' : 'Show Grid'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowLegend(!showLegend)}>
            <BarChart3 className="w-4 h-4 mr-2" />
            {showLegend ? 'Hide Legend' : 'Show Legend'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? <Minimize2 className="w-4 h-4 mr-2" /> : <Maximize2 className="w-4 h-4 mr-2" />}
            {isExpanded ? 'Collapse' : 'Expand'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyData}>
            {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
            {copied ? 'Copied!' : 'Copy Data'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => downloadCSV(config.data, config.title || 'data')}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <Card className={cn("overflow-hidden", isExpanded && "fixed inset-4 z-50", className)}>
      {showTitle && (
        <CardHeader className={cn(
          "flex flex-row items-center justify-between",
          compact ? "p-3" : "p-4"
        )}>
          <div className="flex items-center gap-2">
            <CardTitle className={compact ? "text-sm" : "text-base"}>
              {config.title}
            </CardTitle>
            {config.data.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {config.data.length} {config.data.length === 1 ? 'item' : 'items'}
              </Badge>
            )}
          </div>
          {toolbarActions}
        </CardHeader>
      )}
      <CardContent className={compact ? "p-3" : "p-4"}>
        <div style={{ height: activeChartType === 'kpi' ? 'auto' : chartHeight }}>
          {renderChart}
        </div>
        
        {/* Selection info */}
        {selectedIndex !== null && activeChartType !== 'table' && config.data[selectedIndex] && (
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">
              Selected: {config.data[selectedIndex][resolvedKeysForSelection.categoryKey]}
            </div>
            <div className="text-xs text-blue-600 dark:text-blue-400 flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(config.data[selectedIndex]).map(([key, value]) => (
                <span key={key}>
                  <span className="font-medium">{formatLabel(key)}:</span> {formatValue(value)}
                </span>
              ))}
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="mt-2 text-xs"
              onClick={() => setSelectedIndex(null)}
            >
              Clear selection
            </Button>
          </div>
        )}
      </CardContent>
      
      {/* Backdrop for expanded mode */}
      {isExpanded && (
        <div 
          className="fixed inset-0 bg-black/50 -z-10"
          onClick={() => setIsExpanded(false)}
        />
      )}
    </Card>
  );
};

export default DynamicVisualization;

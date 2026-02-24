/**
 * FindingDrillDown
 *
 * Detailed drill-down view for a research finding.
 * Shows:
 *   - KPI metric cards from keyMetrics (with smart formatting + tooltips)
 *   - Sortable/filterable data tables from evidence queries
 *   - Auto-generated bar charts for numeric distributions
 *   - SQL queries (collapsible, debug-mode only)
 */

import { useState, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Cell,
} from "recharts";
import {
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Code,
  Table2,
  BarChart3,
  HelpCircle,
  X,
  Search,
  Download,
  FileSpreadsheet,
  FileText,
  Bookmark,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useDebugMode } from "@/contexts/DebugModeContext";
import { exportDataAsExcel } from "@/utils/exportUtils";
import { SaveToWorkbenchModal, type SaveToWorkbenchPayload } from "@/components/research/SaveToWorkbenchModal";
import {
  FIELD_REGISTRY,
  SUMMARY_REGISTRY,
  type FieldFormat,
} from "@/config/insightFieldRegistry";
import type { Finding, EvidenceItem } from "@/hooks/useResearchSession";

// ============================================================================
// Types
// ============================================================================

interface FindingDrillDownProps {
  finding: Finding;
  onClose: () => void;
  sessionId?: string | null;
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
  column: string;
  direction: SortDirection;
}

// ============================================================================
// Humanization + formatting utilities
// ============================================================================

/**
 * Converts snake_case or camelCase keys into readable labels.
 * Looks up FIELD_REGISTRY and SUMMARY_REGISTRY first, falls back to
 * splitting on _ and camelCase boundaries.
 */
function humanizeKey(key: string): string {
  if (FIELD_REGISTRY[key]?.label) return FIELD_REGISTRY[key].label;
  if (SUMMARY_REGISTRY[key]?.label) return SUMMARY_REGISTRY[key].label;

  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Maps an agent-provided format string to a FieldFormat.
 */
const VALID_AGENT_FORMATS = new Set(["number", "currency", "percent", "days", "date", "text", "rate", "bps", "mono", "boolean", "badge"]);
function agentFormatToFieldFormat(agentFmt: string | undefined): FieldFormat | null {
  if (!agentFmt) return null;
  const lower = agentFmt.toLowerCase().trim();
  if (VALID_AGENT_FORMATS.has(lower)) return lower as FieldFormat;
  return null;
}

/**
 * Looks up FIELD_REGISTRY for known DB column names (used by evidence tables).
 * Returns "text" for anything not in the registry — no heuristic guessing.
 */
function inferFormat(key: string): FieldFormat {
  if (FIELD_REGISTRY[key]?.format) return FIELD_REGISTRY[key].format;
  if (SUMMARY_REGISTRY[key]?.format) return SUMMARY_REGISTRY[key].format as FieldFormat;
  return "text";
}

/**
 * Resolves format for a KPI metric. Agent-provided format is the source of truth.
 * Falls back to value-based detection ($ prefix, % suffix) then registry lookup.
 */
function inferFormatFromValue(key: string, value: string | number, agentFormat?: string): FieldFormat {
  const fromAgent = agentFormatToFieldFormat(agentFormat);
  if (fromAgent) return fromAgent;
  const strVal = String(value);
  if (strVal.startsWith("$")) return "currency";
  if (strVal.endsWith("%")) return "percent";
  return inferFormat(key);
}

/**
 * Format a value using the field format type.
 */
function formatValue(value: any, format: FieldFormat): string {
  if (value == null || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  const strVal = String(value);

  switch (format) {
    case "currency": {
      const cleaned = strVal.replace(/[$,]/g, "");
      const num = Number(cleaned);
      if (isNaN(num)) return strVal;
      if (Math.abs(num) >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
      if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
      if (Math.abs(num) >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
      return `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    case "percent": {
      const cleaned = strVal.replace(/%/g, "");
      const num = Number(cleaned);
      if (isNaN(num)) return strVal;
      return `${num.toFixed(1)}%`;
    }
    case "rate": {
      const num = Number(strVal);
      if (isNaN(num)) return strVal;
      return `${num.toFixed(3)}%`;
    }
    case "days": {
      const num = Number(strVal);
      if (isNaN(num)) return strVal;
      return `${Math.round(num)}d`;
    }
    case "bps": {
      const num = Number(strVal);
      if (isNaN(num)) return strVal;
      return `${num} bps`;
    }
    case "date": {
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return strVal;
      }
    }
    case "number": {
      const num = Number(strVal);
      if (isNaN(num)) return strVal;
      return num.toLocaleString();
    }
    case "mono":
      return strVal;
    case "boolean":
      return value ? "Yes" : "No";
    case "badge":
    case "text":
    default:
      if (typeof value === "number") return value.toLocaleString();
      return strVal;
  }
}

// ============================================================================
// Tooltip helper
// ============================================================================

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="w-3 h-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================================
// KPI Card
// ============================================================================

const CHART_COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd",
  "#818cf8", "#7c3aed", "#6d28d9", "#5b21b6",
];

function KPICard({ metricKey, value, description, agentFormat }: { metricKey: string; value: string | number; description?: string; agentFormat?: string }) {
  const label = humanizeKey(metricKey);
  const format = inferFormatFromValue(metricKey, value, agentFormat);
  const formatted = formatValue(value, format);
  const tip = description || SUMMARY_REGISTRY[metricKey]?.description;

  return (
    <Card className="flex-1 min-w-[140px]">
      <CardContent className="pt-3 pb-2 px-4">
        <div className="flex items-center gap-1">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide truncate">
            {label}
          </p>
          {tip && <InfoTip text={tip} />}
        </div>
        <p className="text-lg font-bold tabular-nums mt-1">{formatted}</p>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Sortable Data Table
// ============================================================================

const EVIDENCE_ROW_HEIGHT = 28;
const EVIDENCE_INITIAL_ROWS = 100;
const EVIDENCE_LOAD_MORE_STEP = 100;

interface EvidenceTableProps {
  evidence: EvidenceItem;
  index: number;
  findingTitle?: string;
  sessionId?: string | null;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
}

function EvidenceTable({ evidence, index, findingTitle, sessionId, onSaveToWorkbench }: EvidenceTableProps) {
  const { isDebugMode } = useDebugMode();
  const [sort, setSort] = useState<SortState>({ column: "", direction: null });
  const [filter, setFilter] = useState("");
  const [sqlOpen, setSqlOpen] = useState(false);
  const [visibleRowCount, setVisibleRowCount] = useState(EVIDENCE_INITIAL_ROWS);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const toggleSort = (column: string) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      if (prev.direction === "desc") return { column: "", direction: null };
      return { column, direction: "asc" };
    });
  };

  const columnFormats = useMemo(() => {
    const formats: Record<string, FieldFormat> = {};
    const agentFmts = evidence.columnFormats || {};
    for (const f of evidence.fields) {
      const fromAgent = agentFormatToFieldFormat(agentFmts[f]);
      if (fromAgent) {
        formats[f] = fromAgent;
        continue;
      }
      const registryFormat = inferFormat(f);
      if (registryFormat !== "text") {
        formats[f] = registryFormat;
        continue;
      }
      const sample = evidence.rows.find((r) => r[f] != null)?.[f];
      if (sample != null) {
        if (typeof sample === "number") formats[f] = "number";
        else if (typeof sample === "boolean") formats[f] = "boolean";
        else {
          const s = String(sample);
          if (s.startsWith("$")) formats[f] = "currency";
          else if (s.endsWith("%")) formats[f] = "percent";
          else if (/^\d{4}-\d{2}-\d{2}/.test(s)) formats[f] = "date";
          else formats[f] = "text";
        }
      } else {
        formats[f] = "text";
      }
    }
    return formats;
  }, [evidence.fields, evidence.rows, evidence.columnFormats]);

  const filteredAndSorted = useMemo(() => {
    let rows = [...evidence.rows];

    if (filter.trim()) {
      const lowerFilter = filter.toLowerCase();
      rows = rows.filter((row) =>
        evidence.fields.some((f) => {
          const val = row[f];
          if (val == null) return false;
          const text = typeof val === 'object' ? JSON.stringify(val) : String(val);
          return text.toLowerCase().includes(lowerFilter);
        })
      );
    }

    if (sort.column && sort.direction) {
      rows.sort((a, b) => {
        const aVal = a[sort.column];
        const bVal = b[sort.column];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        const aStr = typeof aVal === 'object' ? JSON.stringify(aVal) : String(aVal);
        const bStr = typeof bVal === 'object' ? JSON.stringify(bVal) : String(bVal);
        const aNum = parseFloat(aStr.replace(/[$,%]/g, ""));
        const bNum = parseFloat(bStr.replace(/[$,%]/g, ""));
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sort.direction === "asc" ? aNum - bNum : bNum - aNum;
        }
        const cmp = aStr.localeCompare(bStr);
        return sort.direction === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [evidence, sort, filter]);

  const isNumericFormat = (fmt: FieldFormat) =>
    ["currency", "number", "percent", "rate", "days", "bps"].includes(fmt);

  const handleExportCSV = () => {
    const escape = (v: string) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const headers = evidence.fields.map((f) => escape(humanizeKey(f)));
    const rows = evidence.rows.map((row) =>
      evidence.fields.map((f) => {
        const fmt = columnFormats[f] || "text";
        return escape(row[f] == null ? "" : formatValue(row[f], fmt));
      }),
    );
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evidence-query-${index + 1}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    const tableRows = evidence.rows.map((row) =>
      evidence.fields.map((f) => {
        const fmt = columnFormats[f] || "text";
        return row[f] == null ? "" : formatValue(row[f], fmt);
      }),
    );
    exportDataAsExcel(
      {
        title: `Evidence Query ${index + 1}`,
        tables: [
          {
            name: `Query ${index + 1}`,
            headers: evidence.fields.map(humanizeKey),
            rows: tableRows,
          },
        ],
      },
      `evidence-query-${index + 1}-${new Date().toISOString().split("T")[0]}`,
    );
  };

  const totalFiltered = filteredAndSorted.length;
  const count = Math.min(visibleRowCount, totalFiltered);
  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => EVIDENCE_ROW_HEIGHT,
    overscan: 5,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalBodyHeight = rowVirtualizer.getTotalSize();
  const gridCols = { display: "grid" as const, gridTemplateColumns: `repeat(${evidence.fields.length}, minmax(80px, 1fr))` };
  const canLoadMore = totalFiltered > visibleRowCount;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">Query {index + 1}</Badge>
          <span className="text-xs text-muted-foreground">
            {evidence.rowCount} rows
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportCSV}>
            <FileText className="h-3 w-3" />
            CSV
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportExcel}>
            <FileSpreadsheet className="h-3 w-3" />
            Excel
          </Button>
          {onSaveToWorkbench && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() =>
                onSaveToWorkbench({
                  sql: evidence.sql,
                  title: [findingTitle, evidence.explanation].filter(Boolean).join(" — ").slice(0, 120) || "Research table",
                  vizConfig: {
                    type: "table",
                    title: [findingTitle, evidence.explanation].filter(Boolean).join(" — ").slice(0, 80) || "Table",
                    data: [],
                    tableConfig: {
                      columns: evidence.fields.map((f) => ({
                        key: f,
                        label: humanizeKey(f),
                        format: columnFormats[f] || "text",
                      })),
                    },
                  },
                  explanation: evidence.explanation,
                  sourceType: "research",
                  sourceSessionId: sessionId ?? undefined,
                })
              }
            >
              <Bookmark className="h-3 w-3" />
              Save to Workbench
            </Button>
          )}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="h-7 text-xs pl-7 w-40"
            />
          </div>
        </div>
      </div>

      {evidence.explanation && (
        <p className="text-xs text-muted-foreground italic bg-muted/30 rounded px-2.5 py-1.5">
          {evidence.explanation}
        </p>
      )}

      {/* Data table: virtualized body with progressive "Show more" */}
      <div className="border rounded-md overflow-hidden flex flex-col max-h-72">
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-auto overflow-x-auto"
          role="grid"
          aria-label="Evidence table"
        >
          <div style={{ minWidth: "max-content" }}>
            {/* Sticky header */}
            <div
              className="sticky top-0 z-10 border-b bg-muted/80 text-xs"
              style={{ ...gridCols }}
              role="row"
            >
              {evidence.fields.map((f) => {
                const fmt = columnFormats[f] || "text";
                return (
                  <div
                    key={f}
                    role="columnheader"
                    className={cn(
                      "px-2 py-1.5 font-medium whitespace-nowrap cursor-pointer hover:bg-accent/50 select-none",
                      isNumericFormat(fmt) ? "text-right" : "text-left",
                    )}
                    onClick={() => toggleSort(f)}
                  >
                    <div className={cn("flex items-center gap-1", isNumericFormat(fmt) && "justify-end")}>
                      <span>{humanizeKey(f)}</span>
                      {sort.column === f ? (
                        sort.direction === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-30" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {totalFiltered === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No matching rows
              </div>
            ) : (
              <div
                style={{
                  height: `${totalBodyHeight}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualItems.map((virtualRow) => {
                  const row = filteredAndSorted[virtualRow.index];
                  if (!row) return null;
                  return (
                    <div
                      key={virtualRow.key}
                      className="absolute left-0 border-b last:border-b-0 hover:bg-muted/30 text-xs"
                      style={{
                        ...gridCols,
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      role="row"
                    >
                      {evidence.fields.map((f) => {
                        const fmt = columnFormats[f] || "text";
                        return (
                          <div
                            key={f}
                            className={cn(
                              "px-2 py-1 whitespace-nowrap max-w-[200px] truncate",
                              isNumericFormat(fmt) ? "text-right tabular-nums" : "text-left",
                              fmt === "mono" && "font-mono",
                            )}
                            role="cell"
                          >
                            {row[f] == null ? (
                              <span className="text-muted-foreground italic">-</span>
                            ) : (
                              formatValue(row[f], fmt)
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {(totalFiltered > EVIDENCE_INITIAL_ROWS || canLoadMore) && totalFiltered > 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground bg-muted/30 border-t flex items-center justify-between gap-2 flex-shrink-0">
            <span>
              Showing {count} of {totalFiltered} rows
            </span>
            {canLoadMore && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setVisibleRowCount((prev) => Math.min(prev + EVIDENCE_LOAD_MORE_STEP, totalFiltered))}
              >
                Show more
              </Button>
            )}
          </div>
        )}
      </div>

      {/* SQL (collapsible, debug mode only) */}
      {isDebugMode && (
        <Collapsible open={sqlOpen} onOpenChange={setSqlOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Code className="h-3 w-3" />
            {sqlOpen ? "Hide SQL" : "Show SQL"}
            {sqlOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto font-mono mt-1">
              {evidence.sql}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ============================================================================
// Evidence Preview Table (lightweight, for inline use in Report)
// ============================================================================

const EVIDENCE_PREVIEW_MAX_ROWS = 20;

export interface EvidencePreviewTableProps {
  evidence: EvidenceItem;
  maxRows?: number;
}

export function EvidencePreviewTable({ evidence, maxRows = EVIDENCE_PREVIEW_MAX_ROWS }: EvidencePreviewTableProps) {
  const columnFormats = useMemo(() => {
    const formats: Record<string, FieldFormat> = {};
    const agentFmts = evidence.columnFormats || {};
    for (const f of evidence.fields) {
      const fromAgent = agentFormatToFieldFormat(agentFmts[f]);
      if (fromAgent) {
        formats[f] = fromAgent;
        continue;
      }
      const registryFormat = inferFormat(f);
      if (registryFormat !== "text") {
        formats[f] = registryFormat;
        continue;
      }
      const sample = evidence.rows.find((r) => r[f] != null)?.[f];
      if (sample != null) {
        if (typeof sample === "number") formats[f] = "number";
        else if (typeof sample === "boolean") formats[f] = "boolean";
        else {
          const s = String(sample);
          if (s.startsWith("$")) formats[f] = "currency";
          else if (s.endsWith("%")) formats[f] = "percent";
          else if (/^\d{4}-\d{2}-\d{2}/.test(s)) formats[f] = "date";
          else formats[f] = "text";
        }
      } else {
        formats[f] = "text";
      }
    }
    return formats;
  }, [evidence.fields, evidence.rows, evidence.columnFormats]);

  const isNumericFormat = (fmt: FieldFormat) =>
    ["currency", "number", "percent", "rate", "days", "bps"].includes(fmt);

  const displayRows = evidence.rows.slice(0, maxRows);
  const totalRows = evidence.rows.length;
  const gridCols = { display: "grid" as const, gridTemplateColumns: `repeat(${evidence.fields.length}, minmax(70px, 1fr))` };

  if (totalRows === 0) return null;

  return (
    <div className="rounded-md border overflow-hidden" role="grid" aria-label="Evidence preview table">
      <div className="overflow-x-auto max-h-48 overflow-y-auto">
        <div style={{ minWidth: "max-content" }}>
          <div
            className="sticky top-0 z-10 border-b bg-muted/80 text-xs"
            style={gridCols}
            role="row"
          >
            {evidence.fields.map((f) => {
              const fmt = columnFormats[f] || "text";
              return (
                <div
                  key={f}
                  role="columnheader"
                  className={cn(
                    "px-2 py-1.5 font-medium whitespace-nowrap",
                    isNumericFormat(fmt) ? "text-right" : "text-left",
                  )}
                >
                  {humanizeKey(f)}
                </div>
              );
            })}
          </div>
          {displayRows.map((row, i) => (
            <div
              key={i}
              className={cn("border-b last:border-b-0 text-xs hover:bg-muted/30", gridCols)}
              role="row"
            >
              {evidence.fields.map((f) => {
                const fmt = columnFormats[f] || "text";
                return (
                  <div
                    key={f}
                    role="gridcell"
                    className={cn(
                      "px-2 py-1 whitespace-nowrap max-w-[160px] truncate",
                      isNumericFormat(fmt) ? "text-right tabular-nums" : "text-left",
                    )}
                  >
                    {row[f] == null ? (
                      <span className="text-muted-foreground italic">-</span>
                    ) : (
                      formatValue(row[f], fmt)
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {totalRows > maxRows && (
        <div className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/30 border-t">
          Showing {maxRows} of {totalRows} rows
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Auto Chart
// ============================================================================

export interface AutoChartProps {
  evidence: EvidenceItem;
  findingTitle?: string;
  sessionId?: string | null;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
}

export function AutoChart({ evidence, findingTitle, sessionId, onSaveToWorkbench }: AutoChartProps) {
  const { fields, rows } = evidence;
  if (rows.length < 2 || rows.length > 30) return null;

  const numericFields = fields.filter((f) => {
    const sample = rows.find((r) => r[f] != null);
    if (!sample) return false;
    const raw = sample[f];
    const num = parseFloat(String(raw).replace(/[$,%]/g, ""));
    return !isNaN(num) && typeof raw !== "boolean";
  });

  // Score candidate label fields by quality (prefer medium cardinality)
  const labelCandidates = fields
    .map((f) => {
      const lower = f.toLowerCase();
      // Skip boolean/flag columns
      if (/^(has_|is_|flag_)/.test(lower)) return null;

      const values = rows.map((r) => r[f]).filter((v) => v != null);
      if (values.length === 0) return null;

      // Must be non-numeric strings
      const isText = values.some(
        (v) => typeof v === "string" && isNaN(parseFloat(String(v).replace(/[$,%]/g, "")))
      );
      if (!isText) return null;

      const unique = new Set(values.map((v) => String(v)));

      // Skip if only boolean-like values
      const boolVals = new Set(["true", "false", "0", "1", "yes", "no", "t", "f"]);
      if ([...unique].every((v) => boolVals.has(v.toLowerCase()))) return null;

      // Need at least 2 unique values for a meaningful chart
      if (unique.size < 2) return null;

      // Score: prefer medium cardinality (3-15 unique values)
      const cardinality = unique.size;
      let score = 0;
      if (cardinality >= 3 && cardinality <= 15) score = 100;
      else if (cardinality === 2) score = 50;
      else if (cardinality > 15 && cardinality <= rows.length * 0.8) score = 30;
      else score = 10; // near-unique (every row different) — poor label

      return { field: f, uniqueCount: cardinality, score };
    })
    .filter(Boolean) as Array<{ field: string; uniqueCount: number; score: number }>;

  // Pick the best label field
  labelCandidates.sort((a, b) => b.score - a.score);
  const labelField = labelCandidates[0]?.field;

  if (!labelField || numericFields.length === 0) return null;

  const bestField = numericFields.find((f) =>
    /rate|count|total|amount|revenue|avg|sum|percent|volume/i.test(f)
  ) || numericFields[0];

  const agentFmts = evidence.columnFormats || {};
  const bestFormat = agentFormatToFieldFormat(agentFmts[bestField]) || inferFormat(bestField);

  const chartData = rows.slice(0, 20).map((row) => {
    const labelRaw = row[labelField];
    const valueRaw = row[bestField];
    return {
      name: truncateLabel(typeof labelRaw === 'object' && labelRaw !== null ? JSON.stringify(labelRaw) : String(labelRaw || "N/A")),
      value: parseFloat((typeof valueRaw === 'object' && valueRaw !== null ? JSON.stringify(valueRaw) : String(valueRaw || 0)).replace(/[$,%]/g, "")),
    };
  });

  // Final guard: if all chart labels are identical after building, skip
  const uniqueLabels = new Set(chartData.map((d) => d.name));
  if (uniqueLabels.size < 2) return null;

  // Chart type inference: time-series -> line; long/many labels -> horizontal bar; else vertical bar
  const labelFieldLower = labelField.toLowerCase();
  const sampleLabel = chartData[0]?.name ?? "";
  const isTimeSeries =
    /date|month|quarter|year/.test(labelFieldLower) || /^\d{4}-\d{2}/.test(sampleLabel);
  const avgLabelLength =
    chartData.reduce((sum, d) => sum + (d.name?.length ?? 0), 0) / chartData.length;
  const isHorizontal = chartData.length > 12 || avgLabelLength > 20;

  const tooltipFormatter = (value: number) => [formatValue(value, bestFormat), humanizeKey(bestField)];

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <BarChart3 className="h-3 w-3" />
        {humanizeKey(bestField)} by {humanizeKey(labelField)}
      </p>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {isTimeSeries ? (
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={50}
              />
              <YAxis tick={{ fontSize: 10 }} width={55} />
              <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={tooltipFormatter} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          ) : isHorizontal ? (
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 5, right: 30, bottom: 5, left: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis type="number" tick={{ fontSize: 10 }} width={50} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
              <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={tooltipFormatter} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={50}
              />
              <YAxis tick={{ fontSize: 10 }} width={55} />
              <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={tooltipFormatter} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {onSaveToWorkbench && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 mt-1"
          onClick={() =>
            onSaveToWorkbench({
              sql: evidence.sql,
              title: [findingTitle, `${humanizeKey(bestField)} by ${humanizeKey(labelField)}`].filter(Boolean).join(" — ").slice(0, 120) || "Research chart",
              vizConfig: {
                type: "bar",
                title: [findingTitle, humanizeKey(bestField)].filter(Boolean).join(" — ").slice(0, 80) || "Chart",
                data: [],
                xKey: labelField,
                yKey: bestField,
              },
              explanation: evidence.explanation,
              sourceType: "research",
              sourceSessionId: sessionId ?? undefined,
            })
          }
        >
          <Bookmark className="h-3 w-3" />
          Save to Workbench
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function truncateLabel(s: string): string {
  return s.length > 18 ? s.substring(0, 15) + "..." : s;
}

// ============================================================================
// Main Component
// ============================================================================

export function FindingDrillDown({ finding, onClose, sessionId }: FindingDrillDownProps) {
  const [saveToWorkbenchPayload, setSaveToWorkbenchPayload] = useState<SaveToWorkbenchPayload | null>(null);
  const hasMetrics = Object.keys(finding.keyMetrics).length > 0;
  const hasEvidence = finding.evidence.length > 0;

  const chartableEvidence = finding.evidence.filter(
    (e) => e.rows.length >= 2 && e.rows.length <= 30 && e.fields.length >= 2
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-semibold">{finding.title}</h3>
            <Badge
              variant={
                finding.confidence === "high"
                  ? "default"
                  : finding.confidence === "medium"
                  ? "secondary"
                  : "outline"
              }
            >
              {finding.confidence} confidence
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {finding.summary}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="flex-shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* KPI Cards */}
      {hasMetrics && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Key Metrics
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(finding.keyMetrics).map(([k, v]) => (
              <KPICard key={k} metricKey={k} value={v} description={finding.keyMetricDescriptions?.[k]} agentFormat={finding.keyMetricFormats?.[k]} />
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      {chartableEvidence.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Visualizations
          </h4>
          <div className="grid gap-4 md:grid-cols-2">
            {chartableEvidence.map((ev, i) => (
              <Card key={i}>
                <CardContent className="pt-4 pb-3">
                  <AutoChart
                    evidence={ev}
                    findingTitle={finding.title}
                    sessionId={sessionId}
                    onSaveToWorkbench={setSaveToWorkbenchPayload}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Evidence Tables */}
      {hasEvidence && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Table2 className="h-3.5 w-3.5" />
            Evidence Data ({finding.evidence.length} {finding.evidence.length === 1 ? "query" : "queries"})
          </h4>
          <div className="space-y-5">
            {finding.evidence.map((ev, i) => (
              <EvidenceTable
                key={i}
                evidence={ev}
                index={i}
                findingTitle={finding.title}
                sessionId={sessionId}
                onSaveToWorkbench={setSaveToWorkbenchPayload}
              />
            ))}
          </div>
        </div>
      )}

      <SaveToWorkbenchModal
        open={saveToWorkbenchPayload !== null}
        onClose={() => setSaveToWorkbenchPayload(null)}
        payload={saveToWorkbenchPayload}
      />
    </div>
  );
}

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
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
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

/** Common mortgage/LO abbreviations to preserve when humanizing column names */
const LABEL_ABBREVIATIONS: Record<string, string> = {
  lo: "LO",
  los: "LOS",
  t12m: "T12m",
  t6m: "T6m",
  ytd: "YTD",
  pt: "PT",
  fico: "FICO",
  ltv: "LTV",
  dti: "DTI",
  cltv: "CLTV",
  hcltv: "HCLTV",
  bps: "bps",
  pni: "P&I",
  ami: "AMI",
};

/**
 * Converts snake_case or camelCase keys into readable labels.
 * Looks up FIELD_REGISTRY and SUMMARY_REGISTRY first, falls back to
 * splitting on _ and camelCase boundaries. Preserves common mortgage abbreviations (LO, T12m, etc.).
 */
function humanizeKey(key: string): string {
  if (FIELD_REGISTRY[key]?.label) return FIELD_REGISTRY[key].label;
  if (SUMMARY_REGISTRY[key]?.label) return SUMMARY_REGISTRY[key].label;

  const withSpaces = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = withSpaces.split(/\s+/);
  const result = words
    .map((w) => {
      const lower = w.toLowerCase();
      return LABEL_ABBREVIATIONS[lower] ?? w.replace(/\b\w/g, (c) => c.toUpperCase());
    })
    .join(" ")
    .trim();
  return result || key;
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

const EVIDENCE_PREVIEW_DEFAULT_ROWS = 8;
const EVIDENCE_PREVIEW_MAX_ROWS = 20;

export interface EvidencePreviewTableProps {
  evidence: EvidenceItem;
  maxRows?: number;
}

function EvidenceCell({
  value,
  format,
  maxWidth = 160,
}: {
  value: unknown;
  format: FieldFormat;
  maxWidth?: number;
}) {
  const str = value == null ? "" : typeof value === "string" ? value : String(value);
  const isTruncated = str.length > 28;
  const content = value == null ? (
    <span className="text-muted-foreground italic">-</span>
  ) : (
    formatValue(value, format)
  );
  return (
    <td
      className={cn(
        "px-2 py-1 text-xs border-b border-border last:border-b-0 tabular-nums",
        ["currency", "number", "percent", "rate", "days", "bps"].includes(format)
          ? "text-right"
          : "text-left",
      )}
      style={{ maxWidth }}
      title={isTruncated ? str : undefined}
    >
      <span className={cn("block", isTruncated && "max-w-[160px] truncate")}>
        {content}
      </span>
    </td>
  );
}

export function EvidencePreviewTable({ evidence, maxRows = EVIDENCE_PREVIEW_MAX_ROWS }: EvidencePreviewTableProps) {
  const [expanded, setExpanded] = useState(false);
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

  const visibleRowCount = expanded ? Math.min(evidence.rows.length, maxRows) : EVIDENCE_PREVIEW_DEFAULT_ROWS;
  const displayRows = evidence.rows.slice(0, visibleRowCount);
  const totalRows = evidence.rows.length;
  const hasMore = totalRows > visibleRowCount;

  if (totalRows === 0) return null;

  return (
    <div className="rounded-md border overflow-hidden" role="region" aria-label="Evidence preview table">
      <div className="overflow-x-auto overflow-y-visible">
        <table className="w-full border-collapse text-xs" style={{ minWidth: `${evidence.fields.length * 90}px` }}>
          <thead>
            <tr className="sticky top-0 z-10 border-b bg-muted/80">
              {evidence.fields.map((f) => {
                const fmt = columnFormats[f] || "text";
                return (
                  <th
                    key={f}
                    className={cn(
                      "px-2 py-1.5 font-medium whitespace-nowrap text-left",
                      isNumericFormat(fmt) && "text-right",
                    )}
                  >
                    {humanizeKey(f)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i} className="hover:bg-muted/30">
                {evidence.fields.map((f) => {
                  const fmt = columnFormats[f] || "text";
                  return (
                    <EvidenceCell
                      key={f}
                      value={row[f]}
                      format={fmt}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hasMore || (expanded && totalRows > EVIDENCE_PREVIEW_DEFAULT_ROWS)) && (
        <div className="flex items-center justify-between px-2 py-1.5 text-[10px] text-muted-foreground bg-muted/30 border-t">
          <span>
            Showing {displayRows.length} of {totalRows} rows
          </span>
          {!expanded && totalRows > EVIDENCE_PREVIEW_DEFAULT_ROWS && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setExpanded(true)}
            >
              Show more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Auto Chart
// ============================================================================

/**
 * Platform color palette — matches DynamicVisualization for cross-platform
 * visual consistency. MULTI_SERIES_COLORS are used when 2+ series are present
 * (each series gets a distinct color + a legend). SINGLE_SERIES_COLOR is used
 * for single-series bar charts where individual bar colors carry no meaning.
 */
const MULTI_SERIES_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#84cc16",
];
const SINGLE_SERIES_COLOR = "#6366f1";

// ── Internal resolved chart config ──────────────────────────────────────────

interface ResolvedChartConfig {
  chartType: 'bar' | 'horizontal_bar' | 'line' | 'area' | 'pie' | 'donut' | 'stacked_bar' | 'grouped_bar';
  xKey: string;
  yKey: string;
  yKeys?: string[];
  isStacked: boolean;
  isMultiSeries: boolean;
  data: Record<string, any>[];
  title: string;
  xLabel?: string;
  yLabel?: string;
}

// ── Helper: score candidate label fields ────────────────────────────────────

/**
 * Strict numeric check. Uses Number() rather than parseFloat() so that
 * period/timeframe tokens like "90D", "30D", "YTD", "Q1 2025" are NOT
 * treated as numbers. parseFloat("90D") = 90 (wrong); Number("90D") = NaN.
 * Currency/percent suffixes are stripped first so "$1,234" and "45.2%" still
 * parse correctly.
 */
function isStrictlyNumeric(value: unknown): boolean {
  if (typeof value === "number") return !isNaN(value);
  if (typeof value === "boolean") return false;
  const cleaned = String(value).replace(/[$,%\s]/g, "").trim();
  if (cleaned === "") return false;
  return !isNaN(Number(cleaned));
}

function scoreLabelCandidates(
  fields: string[],
  rows: Record<string, any>[],
): Array<{ field: string; uniqueCount: number; score: number }> {
  const BOOL_VALS = new Set(["true", "false", "0", "1", "yes", "no", "t", "f"]);
  return fields
    .map((f) => {
      const lower = f.toLowerCase();
      if (/^(has_|is_|flag_|sort_)/.test(lower)) return null;
      const values = rows.map((r) => r[f]).filter((v) => v != null);
      if (values.length === 0) return null;
      // A field qualifies as a label candidate if at least one value is a
      // non-numeric string (strict check — "90D", "YTD" are non-numeric here).
      const isText = values.some((v) => typeof v === "string" && !isStrictlyNumeric(v));
      if (!isText) return null;
      const unique = new Set(values.map((v) => String(v)));
      if ([...unique].every((v) => BOOL_VALS.has(v.toLowerCase()))) return null;
      if (unique.size < 2) return null;
      const c = unique.size;
      const score = c >= 3 && c <= 15 ? 100 : c === 2 ? 50 : c > 15 && c <= rows.length * 0.8 ? 30 : 10;
      return { field: f, uniqueCount: c, score };
    })
    .filter(Boolean) as Array<{ field: string; uniqueCount: number; score: number }>;
}

// ── Helper: identify numeric fields ─────────────────────────────────────────

function getNumericFields(fields: string[], rows: Record<string, any>[]): string[] {
  return fields.filter((f) => {
    const sample = rows.find((r) => r[f] != null);
    if (!sample) return false;
    const raw = sample[f];
    // Use strict check so "90D", "YTD" etc. are not treated as numeric.
    return isStrictlyNumeric(raw);
  });
}

// ── Core adapter: evidence → resolved config ─────────────────────────────────
/**
 * evidenceToChartConfig
 *
 * Priority order:
 *  1. Use chartHint from the AI agent when present — it has explicit axis keys
 *     and chart type knowledge.
 *  2. Multi-series fallback: if 2+ numeric fields coexist with a label field,
 *     render a grouped_bar.
 *  3. Duplicate-label fallback: if the best label has duplicates and a second
 *     categorical field exists, attempt a client-side pivot to grouped_bar.
 *  4. Single-series fallback: current behaviour (best label + best value).
 */
function evidenceToChartConfig(evidence: EvidenceItem): ResolvedChartConfig | null {
  const { fields, rows, chartHint, columnFormats } = evidence;
  if (rows.length < 2) return null;

  const agentFmts = columnFormats || {};
  const numericFields = getNumericFields(fields, rows);

  // ── PATH 1: agent-provided chartHint ──────────────────────────────────────
  if (chartHint) {
    const hintType = chartHint.type ?? 'bar';
    const xKey = chartHint.xKey ?? chartHint.nameKey ?? fields.find(f => !numericFields.includes(f)) ?? fields[0];
    const yKey = chartHint.yKey ?? chartHint.valueKey ?? numericFields[0];
    const yKeys = chartHint.yKeys?.filter(k => fields.includes(k) && numericFields.includes(k));
    const isMulti = (yKeys?.length ?? 0) > 1;
    const isStacked = hintType === 'stacked_bar';
    const chartType = hintType === 'stacked_bar' ? 'stacked_bar'
      : hintType === 'grouped_bar' ? 'grouped_bar'
      : hintType;

    const titleYLabel = isMulti
      ? (yKeys ?? []).map(k => humanizeKey(k)).join(", ")
      : humanizeKey(yKey ?? numericFields[0]);
    const titleXLabel = humanizeKey(xKey ?? fields[0]);

    const data = rows.slice(0, 30).map((row) => {
      const entry: Record<string, any> = {};
      entry[xKey] = rawLabel(row[xKey]);
      if (isMulti && yKeys) {
        for (const k of yKeys) {
          entry[k] = parseNumeric(row[k]);
        }
      } else if (yKey) {
        entry[yKey] = parseNumeric(row[yKey]);
      }
      // include remaining fields for tooltip richness
      for (const f of fields) {
        if (!(f in entry)) entry[f] = row[f];
      }
      return entry;
    });

    // Validate: at least 2 distinct x-values
    const uniqueX = new Set(data.map(d => d[xKey]));
    if (uniqueX.size < 2) return null;

    return {
      chartType,
      xKey,
      yKey: yKey ?? numericFields[0],
      yKeys: isMulti ? yKeys : undefined,
      isStacked,
      isMultiSeries: isMulti,
      data,
      title: `${titleYLabel} by ${titleXLabel}`,
      xLabel: chartHint.xLabel,
      yLabel: chartHint.yLabel,
    };
  }

  // ── PATH 2–4: auto-detection fallback ────────────────────────────────────

  const labelCandidates = scoreLabelCandidates(fields, rows);
  labelCandidates.sort((a, b) => b.score - a.score);
  const labelField = labelCandidates[0]?.field;
  if (!labelField || numericFields.length === 0) return null;

  // PATH 2: multiple numeric fields → grouped_bar
  if (numericFields.length >= 2) {
    const preferredYKeys = numericFields.slice(0, 6); // cap to 6 series
    const data = rows.slice(0, 30).map((row) => {
      const entry: Record<string, any> = {};
      entry[labelField] = rawLabel(row[labelField]);
      for (const k of preferredYKeys) {
        entry[k] = parseNumeric(row[k]);
      }
      return entry;
    });

    const uniqueLabels = new Set(data.map(d => d[labelField]));
    if (uniqueLabels.size < 2) return null;

    const avgLen = data.reduce((s, d) => s + String(d[labelField]).length, 0) / data.length;
    const isHoriz = data.length > 10 || avgLen > 18;

    return {
      chartType: isHoriz ? 'horizontal_bar' : 'grouped_bar',
      xKey: labelField,
      yKey: preferredYKeys[0],
      yKeys: preferredYKeys,
      isStacked: false,
      isMultiSeries: true,
      data,
      title: `${preferredYKeys.map(k => humanizeKey(k)).join(", ")} by ${humanizeKey(labelField)}`,
    };
  }

  // PATH 3: duplicate labels + second categorical → client-side pivot
  const bestField = numericFields.find((f) =>
    /rate|count|total|amount|revenue|avg|sum|percent|volume/i.test(f)
  ) ?? numericFields[0];

  const labelValues = rows.map(r => String(r[labelField] ?? ""));
  const hasDuplicateLabels = labelValues.length !== new Set(labelValues).size;

  if (hasDuplicateLabels) {
    const otherCategoricals = labelCandidates.slice(1);
    const seriesField = otherCategoricals[0]?.field;
    if (seriesField) {
      const seriesValues = [...new Set(rows.map(r => String(r[seriesField] ?? "")))].slice(0, 6);
      const categories = [...new Set(rows.map(r => String(r[labelField] ?? "")))];
      // Build pivot: { labelField: cat, series1: val, series2: val, ... }
      const pivot: Record<string, Record<string, any>> = {};
      for (const cat of categories) pivot[cat] = { [labelField]: cat };
      for (const row of rows) {
        const cat = String(row[labelField] ?? "");
        const ser = String(row[seriesField] ?? "");
        if (seriesValues.includes(ser)) {
          pivot[cat][ser] = parseNumeric(row[bestField]);
        }
      }
      const pivotData = Object.values(pivot);
      const uniqueLabelsAfterPivot = new Set(pivotData.map(d => d[labelField]));
      if (uniqueLabelsAfterPivot.size >= 2) {
        const avgLen = pivotData.reduce((s, d) => s + String(d[labelField]).length, 0) / pivotData.length;
        const isHoriz = pivotData.length > 10 || avgLen > 18;
        return {
          chartType: isHoriz ? 'horizontal_bar' : 'grouped_bar',
          xKey: labelField,
          yKey: seriesValues[0],
          yKeys: seriesValues,
          isStacked: false,
          isMultiSeries: true,
          data: pivotData,
          title: `${humanizeKey(bestField)} by ${humanizeKey(labelField)} (grouped by ${humanizeKey(seriesField)})`,
        };
      }
    }
  }

  // PATH 4: single-series (current behaviour, improved)
  const data = rows.slice(0, 30).map((row) => {
    const entry: Record<string, any> = {};
    entry[labelField] = rawLabel(row[labelField]);
    entry[bestField] = parseNumeric(row[bestField]);
    for (const f of fields) {
      if (!(f in entry)) entry[f] = row[f];
    }
    return entry;
  });

  const uniqueLabels = new Set(data.map(d => d[labelField]));
  if (uniqueLabels.size < 2) return null;

  const labelFieldLower = labelField.toLowerCase();
  const sampleLabel = String(data[0]?.[labelField] ?? "");
  const isTimeSeries =
    /date|month|quarter|year|period/.test(labelFieldLower) || /^\d{4}-\d{2}/.test(sampleLabel);
  const avgLabelLength = data.reduce((s, d) => s + String(d[labelField]).length, 0) / data.length;
  const isHorizontal = data.length > 12 || avgLabelLength > 20;

  const inferredType = isTimeSeries ? 'line' : isHorizontal ? 'horizontal_bar' : 'bar';

  const bestFormat = agentFormatToFieldFormat(agentFmts[bestField]) || inferFormat(bestField);
  void bestFormat; // used below via evidence ref

  return {
    chartType: inferredType,
    xKey: labelField,
    yKey: bestField,
    isStacked: false,
    isMultiSeries: false,
    data,
    title: `${humanizeKey(bestField)} by ${humanizeKey(labelField)}`,
  };
}

// ── Tiny helpers ─────────────────────────────────────────────────────────────

function rawLabel(v: unknown): string {
  if (v == null) return "N/A";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 22 ? s.substring(0, 19) + "…" : s;
}

function parseNumeric(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return parseFloat(String(v).replace(/[$,%]/g, "")) || 0;
}

// ── AutoChart props / component ───────────────────────────────────────────────

export interface AutoChartProps {
  evidence: EvidenceItem;
  findingTitle?: string;
  sessionId?: string | null;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
}

export function AutoChart({ evidence, findingTitle, sessionId, onSaveToWorkbench }: AutoChartProps) {
  const config = evidenceToChartConfig(evidence);
  if (!config) return null;

  const { chartType, xKey, yKey, yKeys, isStacked, isMultiSeries, data, title } = config;
  const agentFmts = evidence.columnFormats || {};
  const bestFormat = agentFormatToFieldFormat(agentFmts[yKey]) || inferFormat(yKey);

  // For tooltip value formatting
  const tooltipFormatter = (value: number, name: string) => [
    formatValue(value, bestFormat),
    humanizeKey(name),
  ];

  // Colors: single solid color for single-series, multi-color palette for multi
  const seriesKeys = isMultiSeries && yKeys ? yKeys : [yKey];
  const getSeriesColor = (i: number) =>
    isMultiSeries ? MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length] : SINGLE_SERIES_COLOR;

  // ── Pie / Donut ───────────────────────────────────────────────────────────
  if (chartType === 'pie' || chartType === 'donut') {
    const pieData = data.map((row, i) => ({
      name: String(row[xKey] ?? ""),
      value: parseNumeric(row[yKey]),
      fill: MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length],
    }));
    return (
      <AutoChartShell title={title} findingTitle={findingTitle} evidence={evidence} sessionId={sessionId} onSaveToWorkbench={onSaveToWorkbench} xKey={xKey} yKey={yKey}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={chartType === 'donut' ? 72 : 80}
            innerRadius={chartType === 'donut' ? 36 : 0}
          >
            {pieData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Pie>
          <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={tooltipFormatter} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </AutoChartShell>
    );
  }

  // ── Area chart ────────────────────────────────────────────────────────────
  if (chartType === 'area') {
    return (
      <AutoChartShell title={title} findingTitle={findingTitle} evidence={evidence} sessionId={sessionId} onSaveToWorkbench={onSaveToWorkbench} xKey={xKey} yKey={yKey}>
        <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={44} />
          <YAxis tick={{ fontSize: 10 }} width={55} />
          <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={tooltipFormatter} />
          {isMultiSeries && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {seriesKeys.map((k, i) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              name={humanizeKey(k)}
              stroke={getSeriesColor(i)}
              fill={getSeriesColor(i)}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={false}
              stackId={isStacked ? "stack" : undefined}
            />
          ))}
        </AreaChart>
      </AutoChartShell>
    );
  }

  // ── Line chart ────────────────────────────────────────────────────────────
  if (chartType === 'line') {
    return (
      <AutoChartShell title={title} findingTitle={findingTitle} evidence={evidence} sessionId={sessionId} onSaveToWorkbench={onSaveToWorkbench} xKey={xKey} yKey={yKey}>
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={44} />
          <YAxis tick={{ fontSize: 10 }} width={55} />
          <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={tooltipFormatter} />
          {isMultiSeries && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {seriesKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              name={humanizeKey(k)}
              stroke={getSeriesColor(i)}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </AutoChartShell>
    );
  }

  // ── Horizontal bar chart ──────────────────────────────────────────────────
  if (chartType === 'horizontal_bar') {
    const maxLabelLen = Math.max(...data.map(d => String(d[xKey] ?? "").length));
    const yAxisWidth = Math.min(Math.max(maxLabelLen * 6, 60), 140);
    return (
      <AutoChartShell title={title} findingTitle={findingTitle} evidence={evidence} sessionId={sessionId} onSaveToWorkbench={onSaveToWorkbench} xKey={xKey} yKey={yKey}>
        <BarChart layout="vertical" data={data} margin={{ top: 5, right: 30, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey={xKey} tick={{ fontSize: 10 }} width={yAxisWidth} />
          <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={tooltipFormatter} />
          {isMultiSeries && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {isMultiSeries ? (
            seriesKeys.map((k, i) => (
              <Bar key={k} dataKey={k} name={humanizeKey(k)} fill={getSeriesColor(i)} radius={[0, 3, 3, 0]} stackId={isStacked ? "stack" : undefined} />
            ))
          ) : (
            <Bar dataKey={yKey} radius={[0, 3, 3, 0]} fill={SINGLE_SERIES_COLOR} />
          )}
        </BarChart>
      </AutoChartShell>
    );
  }

  // ── Vertical bar / grouped_bar / stacked_bar ──────────────────────────────
  return (
    <AutoChartShell title={title} findingTitle={findingTitle} evidence={evidence} sessionId={sessionId} onSaveToWorkbench={onSaveToWorkbench} xKey={xKey} yKey={yKey}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 10 }}
          angle={-25}
          textAnchor="end"
          height={44}
        />
        <YAxis tick={{ fontSize: 10 }} width={55} />
        <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={tooltipFormatter} />
        {isMultiSeries && <Legend wrapperStyle={{ fontSize: 10 }} />}
        {isMultiSeries ? (
          seriesKeys.map((k, i) => (
            <Bar key={k} dataKey={k} name={humanizeKey(k)} fill={getSeriesColor(i)} radius={[3, 3, 0, 0]} stackId={isStacked ? "stack" : undefined} />
          ))
        ) : (
          <Bar dataKey={yKey} radius={[3, 3, 0, 0]} fill={SINGLE_SERIES_COLOR} />
        )}
      </BarChart>
    </AutoChartShell>
  );
}

// ── Shell wrapper (title + chart container + save button) ────────────────────

interface AutoChartShellProps {
  title: string;
  findingTitle?: string;
  evidence: EvidenceItem;
  sessionId?: string | null;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
  xKey: string;
  yKey: string;
  children: React.ReactNode;
}

function AutoChartShell({
  title,
  findingTitle,
  evidence,
  sessionId,
  onSaveToWorkbench,
  xKey,
  yKey,
  children,
}: AutoChartShellProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <BarChart3 className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{title}</span>
      </p>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
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
              title: [findingTitle, title].filter(Boolean).join(" — ").slice(0, 120) || "Research chart",
              vizConfig: {
                type: "bar",
                title: [findingTitle, title].filter(Boolean).join(" — ").slice(0, 80) || "Chart",
                data: [],
                xKey,
                yKey,
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
// Main Component
// ============================================================================

export function FindingDrillDown({ finding, onClose, sessionId }: FindingDrillDownProps) {
  const [saveToWorkbenchPayload, setSaveToWorkbenchPayload] = useState<SaveToWorkbenchPayload | null>(null);
  const hasMetrics = Object.keys(finding.keyMetrics).length > 0;
  const hasEvidence = finding.evidence.length > 0;

  const chartableEvidence = finding.evidence.filter(
    (e) => e.rows.length >= 2 && e.rows.length <= 50 && e.fields.length >= 2
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

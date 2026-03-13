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

import { useState, useMemo, useRef, cloneElement } from "react";
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
  FileSpreadsheet,
  FileText,
  Bookmark,
  MoreHorizontal,
  Maximize2,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Card className="flex-1 min-w-[120px]">
      <CardContent className="pt-2 pb-1.5 px-3">
        <div className="flex items-center gap-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide truncate">
            {label}
          </p>
          {tip && <InfoTip text={tip} />}
        </div>
        <p className="text-base font-bold tabular-nums mt-0.5">{formatted}</p>
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
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="h-7 text-xs pl-7 w-32"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={handleExportCSV} className="gap-2 text-xs cursor-pointer">
                <FileText className="h-3.5 w-3.5" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportExcel} className="gap-2 text-xs cursor-pointer">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Export Excel
              </DropdownMenuItem>
              {onSaveToWorkbench && (
                <DropdownMenuItem
                  className="gap-2 text-xs cursor-pointer"
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
                  <Bookmark className="h-3.5 w-3.5" />
                  Save to Workbench
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
  /** Title used for the workbench widget (e.g. finding/insight headline). */
  saveTitle?: string;
  /** Research session ID, forwarded to the workbench payload. */
  sessionId?: string | null;
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

export function EvidencePreviewTable({ evidence, maxRows = EVIDENCE_PREVIEW_MAX_ROWS, onSaveToWorkbench, saveTitle, sessionId }: EvidencePreviewTableProps) {
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

  const handleExportCSV = () => {
    const header = evidence.fields.map(humanizeKey).join(",");
    const rows = evidence.rows.map((r) => evidence.fields.map((f) => {
      const v = r[f]; return v == null ? "" : typeof v === "string" && v.includes(",") ? `"${v}"` : String(v);
    }).join(","));
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "evidence.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    exportDataAsExcel(evidence.rows, evidence.fields, saveTitle || "Evidence");
  };

  return (
    <div className="rounded-md border overflow-hidden" role="region" aria-label="Evidence preview table">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b">
        <span className="text-[10px] text-muted-foreground font-medium">
          {totalRows} row{totalRows !== 1 ? "s" : ""}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={handleExportCSV} className="gap-2 text-xs cursor-pointer">
              <FileText className="h-3.5 w-3.5" />
              Export CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportExcel} className="gap-2 text-xs cursor-pointer">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export Excel
            </DropdownMenuItem>
            {onSaveToWorkbench && (
              <DropdownMenuItem
                className="gap-2 text-xs cursor-pointer"
                onClick={() =>
                  onSaveToWorkbench({
                    sql: evidence.sql,
                    title: [saveTitle, evidence.explanation].filter(Boolean).join(" — ").slice(0, 120) || "Research table",
                    vizConfig: {
                      type: "table",
                      title: [saveTitle, evidence.explanation].filter(Boolean).join(" — ").slice(0, 80) || "Table",
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
                <Bookmark className="h-3.5 w-3.5" />
                Save to Workbench
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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

// ── Shared data-normalisation helpers ────────────────────────────────────────

/**
 * Aggregate rows so there is exactly one entry per unique x-value.
 * All numeric value keys are summed within each group.
 * Rows are expected to already have rawLabel applied to xKey.
 */
function aggregateByX(
  rows: Record<string, any>[],
  xKey: string,
  valueKeys: string[],
): Record<string, any>[] {
  const agg = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const x = String(row[xKey] ?? "");
    if (!agg.has(x)) {
      const entry: Record<string, any> = { [xKey]: x };
      for (const k of valueKeys) entry[k] = 0;
      agg.set(x, entry);
    }
    const entry = agg.get(x)!;
    for (const k of valueKeys) {
      entry[k] = (entry[k] ?? 0) + parseNumeric(row[k]);
    }
  }
  return [...agg.values()];
}

/**
 * Pivot long-format rows to wide format.
 * Each unique xKey value becomes one row; each unique seriesKey value becomes a
 * column containing the parsed numeric value from valueKey.
 *
 * Returns null when the pivot produces fewer than 2 distinct x-categories or
 * when no series values are actually present in the data.
 */
function pivotLongToWide(
  rows: Record<string, any>[],
  xKey: string,
  seriesKey: string,
  valueKey: string,
): { data: Record<string, any>[]; seriesValues: string[] } | null {
  const seriesValues = [...new Set(rows.map(r => String(r[seriesKey] ?? "")))].slice(0, 6);
  if (seriesValues.length === 0) return null;
  const categories = [...new Set(rows.map(r => String(r[xKey] ?? "")))];
  if (categories.length < 2) return null;
  const pivotMap: Record<string, Record<string, any>> = {};
  for (const cat of categories) pivotMap[cat] = { [xKey]: rawLabel(cat) };
  for (const row of rows) {
    const cat = String(row[xKey] ?? "");
    const ser = String(row[seriesKey] ?? "");
    if (seriesValues.includes(ser)) {
      pivotMap[cat][ser] = parseNumeric(row[valueKey]);
    }
  }
  const data = Object.values(pivotMap);
  // Require at least one series column with non-zero data across rows
  const populated = seriesValues.filter(sv => data.some(d => d[sv] !== 0 && d[sv] !== undefined));
  if (populated.length === 0) return null;
  return { data, seriesValues: populated };
}

// ── Core adapter: evidence → resolved config ─────────────────────────────────
/**
 * evidenceToChartConfig
 *
 * Priority order:
 *  1. Use chartHint from the AI agent when present — it has explicit axis keys
 *     and chart type knowledge. If the agent hinted a single-series chart but
 *     the underlying data is long-format (duplicate x-values), we automatically
 *     pivot to grouped_bar or aggregate to guarantee one bar per x-value.
 *  2. Multi-series fallback: if 2+ numeric fields coexist with a label field,
 *     render a grouped_bar. Deduplicates by aggregating per x-category.
 *  3. Duplicate-label fallback: if the best label has duplicates and a second
 *     categorical field exists, attempt a client-side pivot to grouped_bar.
 *  4. Single-series fallback: best label + best value. Aggregates duplicates.
 *
 * KEY INVARIANT: every returned config has exactly one data row per x-value.
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

    // ── Duplicate x-value guard (long-format SQL data) ──────────────────────
    // The agent may label the chart as single-series but issue a SQL query that
    // returns multiple rows per x-category (e.g. program × period).  When that
    // happens we must pivot or aggregate before rendering — otherwise Recharts
    // gets two bars for "FHA Fixed Rate" both labelled with the same series name.
    if (!isMulti) {
      const uniqueRawX = new Set(rows.slice(0, 30).map(r => String(r[xKey] ?? "")));
      const totalRows = Math.min(rows.length, 30);
      if (uniqueRawX.size < totalRows) {
        // There are duplicate x-values → try pivot first
        const actualYKey = yKey ?? numericFields[0];
        const seriesCandidates = fields.filter(f => {
          if (f === xKey || numericFields.includes(f)) return false;
          const vals = rows.map(r => r[f]).filter(v => v != null);
          return vals.some(v => typeof v === "string" && !isStrictlyNumeric(v));
        });

        if (seriesCandidates.length > 0) {
          // Try each categorical candidate as series dimension; use first that works
          for (const seriesField of seriesCandidates) {
            const result = pivotLongToWide(rows.slice(0, 30), xKey, seriesField, actualYKey);
            if (result) {
              const { data: pivotData, seriesValues } = result;
              const avgLen = pivotData.reduce((s, d) => s + String(d[xKey]).length, 0) / pivotData.length;
              return {
                chartType: pivotData.length > 10 || avgLen > 18 ? 'horizontal_bar' : 'grouped_bar',
                xKey,
                yKey: seriesValues[0],
                yKeys: seriesValues,
                isStacked: false,
                isMultiSeries: true,
                data: pivotData,
                title: `${humanizeKey(actualYKey)} by ${humanizeKey(xKey)} (by ${humanizeKey(seriesField)})`,
                xLabel: chartHint.xLabel,
                yLabel: chartHint.yLabel,
              };
            }
          }
        }

        // No viable series field → aggregate (sum) per x-category
        const labelledRows = rows.slice(0, 30).map(row => ({
          ...row,
          [xKey]: rawLabel(String(row[xKey] ?? "")),
        }));
        const aggData = aggregateByX(labelledRows, xKey, [actualYKey]);
        if (aggData.length < 2) return null;
        const avgLenAgg = aggData.reduce((s, d) => s + String(d[xKey]).length, 0) / aggData.length;
        const resolvedType: ResolvedChartConfig['chartType'] =
          chartType === 'bar' && (aggData.length > 12 || avgLenAgg > 20) ? 'horizontal_bar' : chartType as ResolvedChartConfig['chartType'];
        return {
          chartType: resolvedType,
          xKey,
          yKey: actualYKey,
          isStacked,
          isMultiSeries: false,
          data: aggData,
          title: `${titleYLabel} by ${titleXLabel}`,
          xLabel: chartHint.xLabel,
          yLabel: chartHint.yLabel,
        };
      }
    }

    // No duplicates: proceed with standard mapping
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
      for (const f of fields) {
        if (!(f in entry)) entry[f] = row[f];
      }
      return entry;
    });

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
    const rawData = rows.slice(0, 30).map((row) => {
      const entry: Record<string, any> = {};
      entry[labelField] = rawLabel(row[labelField]);
      for (const k of preferredYKeys) {
        entry[k] = parseNumeric(row[k]);
      }
      return entry;
    });

    // Deduplicate: if the same labelField value appears more than once (e.g.
    // the query has an extra grouping dimension we're not using as the x-axis),
    // aggregate all numeric series by summing within each x-category.
    const uniqueLabels = new Set(rawData.map(d => d[labelField]));
    if (uniqueLabels.size < 2) return null;

    const data = uniqueLabels.size < rawData.length
      ? aggregateByX(rawData, labelField, preferredYKeys)
      : rawData;

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
  // Note: we may arrive here when hasDuplicateLabels=true but no second
  // categorical field was found (PATH 3 fell through). In that case we MUST
  // aggregate to avoid rendering duplicate bars per x-category.
  const rawData4 = rows.slice(0, 30).map((row) => {
    const entry: Record<string, any> = {};
    entry[labelField] = rawLabel(row[labelField]);
    entry[bestField] = parseNumeric(row[bestField]);
    for (const f of fields) {
      if (!(f in entry)) entry[f] = row[f];
    }
    return entry;
  });

  const uniqueLabels4 = new Set(rawData4.map(d => d[labelField]));
  if (uniqueLabels4.size < 2) return null;

  // Aggregate if duplicates survived into data (sum bestField per x-category)
  const data = uniqueLabels4.size < rawData4.length
    ? aggregateByX(rawData4, labelField, [bestField])
    : rawData4;

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
  /** When true render at hero size (h-64, tick font 11). Default false = h-48, tick font 10. */
  hero?: boolean;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
  /** Title used for the workbench widget. */
  saveTitle?: string;
  /** Research session ID, forwarded to the workbench payload. */
  sessionId?: string | null;
}

// Minimum pixel width per category group to ensure every label is readable
const MIN_PX_PER_GROUP_SINGLE = 40;
const MIN_PX_PER_GROUP_MULTI_BASE = 20;
const MIN_PX_PER_SERIES = 18;
const MIN_PX_PER_POINT_LINE = 42;
const Y_AXIS_PX = 60;
const H_MARGIN_PX = 20;
// Threshold: if computed width exceeds this, enable horizontal scroll
const SCROLL_THRESHOLD_PX = 540;

function calcMinWidth(numPoints: number, numSeries: number, isMulti: boolean): number | undefined {
  const perGroup = isMulti
    ? Math.max(MIN_PX_PER_GROUP_MULTI_BASE + MIN_PX_PER_SERIES * numSeries, 48)
    : MIN_PX_PER_GROUP_SINGLE;
  const computed = Y_AXIS_PX + H_MARGIN_PX + numPoints * perGroup;
  return computed > SCROLL_THRESHOLD_PX ? computed : undefined;
}

function calcMinWidthLine(numPoints: number): number | undefined {
  const computed = Y_AXIS_PX + H_MARGIN_PX + numPoints * MIN_PX_PER_POINT_LINE;
  return computed > SCROLL_THRESHOLD_PX ? computed : undefined;
}

export function AutoChart({ evidence, hero = false, onSaveToWorkbench, saveTitle, sessionId }: AutoChartProps) {
  const config = evidenceToChartConfig(evidence);
  if (!config) return null;

  const { chartType, xKey, yKey, yKeys, isStacked, isMultiSeries, data, title } = config;
  const agentFmts = evidence.columnFormats || {};
  const bestFormat = agentFormatToFieldFormat(agentFmts[yKey]) || inferFormat(yKey);
  const tickFontSize = hero ? 11 : 10;

  const tooltipFormatter = (value: number, name: string) => [
    formatValue(value, bestFormat),
    humanizeKey(name),
  ];

  const seriesKeys = isMultiSeries && yKeys ? yKeys : [yKey];
  const getSeriesColor = (i: number) =>
    isMultiSeries ? MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length] : SINGLE_SERIES_COLOR;

  // Minimal grid: only horizontal reference lines, very faint
  const grid = <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />;

  // ── Pie / Donut ───────────────────────────────────────────────────────────
  if (chartType === 'pie' || chartType === 'donut') {
    const pieData = data.map((row, i) => ({
      name: String(row[xKey] ?? ""),
      value: parseNumeric(row[yKey]),
      fill: MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length],
    }));
    return (
      <AutoChartShell title={title} hero={hero} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle}>
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
    const minWidth = calcMinWidthLine(data.length);
    return (
      <AutoChartShell title={title} hero={hero} minWidth={minWidth} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle}>
        <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          {grid}
          <XAxis dataKey={xKey} interval={0} tick={{ fontSize: tickFontSize }} angle={-30} textAnchor="end" height={48} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: tickFontSize }} width={55} axisLine={false} tickLine={false} />
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
              fillOpacity={0.12}
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
    const minWidth = calcMinWidthLine(data.length);
    return (
      <AutoChartShell title={title} hero={hero} minWidth={minWidth} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle}>
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          {grid}
          <XAxis dataKey={xKey} interval={0} tick={{ fontSize: tickFontSize }} angle={-30} textAnchor="end" height={48} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: tickFontSize }} width={55} axisLine={false} tickLine={false} />
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
              dot={{ r: hero ? 3.5 : 3 }}
            />
          ))}
        </LineChart>
      </AutoChartShell>
    );
  }

  // ── Horizontal bar chart ──────────────────────────────────────────────────
  if (chartType === 'horizontal_bar') {
    const maxLabelLen = Math.max(...data.map(d => String(d[xKey] ?? "").length));
    const yAxisWidth = Math.min(Math.max(maxLabelLen * 6, 60), 160);
    // Each row needs ~26px; compute a minHeight so all labels are visible
    const minRowPx = 26;
    const computedH = data.length * minRowPx + 40;
    const baseH = hero ? 256 : 192;
    const minHeight = computedH > baseH ? computedH : undefined;
    return (
      <AutoChartShell title={title} hero={hero} minHeight={minHeight} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle}>
        <BarChart layout="vertical" data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
          {grid}
          <XAxis type="number" tick={{ fontSize: tickFontSize }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey={xKey} interval={0} tick={{ fontSize: tickFontSize }} width={yAxisWidth} axisLine={false} tickLine={false} />
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
  const minWidth = calcMinWidth(data.length, seriesKeys.length, isMultiSeries);
  return (
    <AutoChartShell title={title} hero={hero} minWidth={minWidth} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 8, left: 5 }}>
        {grid}
        <XAxis
          dataKey={xKey}
          interval={0}
          tick={{ fontSize: tickFontSize }}
          angle={-30}
          textAnchor="end"
          height={52}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: tickFontSize }} width={55} axisLine={false} tickLine={false} />
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

// ── Shell wrapper: title + responsive chart container ────────────────────────

interface AutoChartShellProps {
  title: string;
  hero?: boolean;
  /** Minimum pixel width for the chart canvas — triggers horizontal scroll when set */
  minWidth?: number;
  /** Minimum pixel height for the chart canvas — triggers vertical scroll when set (horizontal bars) */
  minHeight?: number;
  children: React.ReactNode;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
  /** Evidence data for building the workbench save payload. */
  evidence?: EvidenceItem;
  sessionId?: string | null;
  saveTitle?: string;
}

function AutoChartShell({ title, hero = false, minWidth, minHeight, children, onSaveToWorkbench, evidence, sessionId, saveTitle }: AutoChartShellProps) {
  const [maximized, setMaximized] = useState(false);
  const baseHeight = hero ? 256 : 192;
  // For horizontal bar: grow vertically up to 2× base, then scroll
  const effectiveHeight = minHeight ? Math.min(minHeight, baseHeight * 2) : baseHeight;
  const scrollsX = !!minWidth;
  const scrollsY = !!minHeight && minHeight > effectiveHeight;

  const renderChart = (forDialog: boolean) => {
    const height = forDialog ? "calc(80vh - 6rem)" : effectiveHeight;
    const minW = forDialog ? (minWidth ? Math.max(minWidth, 600) : undefined) : minWidth;
    return (
      <div
        style={{
          overflowX: scrollsX ? "auto" : undefined,
          overflowY: (!forDialog && scrollsY) ? "auto" : undefined,
          height: forDialog ? "calc(80vh - 6rem)" : effectiveHeight,
        }}
      >
        <div style={{ minWidth: minW, height }}>
          <ResponsiveContainer width="100%" height="100%">
            {cloneElement(children as React.ReactElement)}
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 min-w-0">
            <BarChart3 className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{title}</span>
          </p>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {onSaveToWorkbench && evidence && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    className="gap-2 text-xs cursor-pointer"
                    onClick={() =>
                      onSaveToWorkbench({
                        sql: evidence.sql,
                        title: [saveTitle, title].filter(Boolean).join(" — ").slice(0, 120) || "Research chart",
                        vizConfig: {
                          type: "table",
                          title: title || "Chart",
                          data: [],
                        },
                        explanation: evidence.explanation,
                        sourceType: "research",
                        sourceSessionId: sessionId ?? undefined,
                      })
                    }
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                    Save to Workbench
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              type="button"
              onClick={() => setMaximized(true)}
              className="rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Maximize chart"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {renderChart(false)}
      </div>

      <Dialog open={maximized} onOpenChange={setMaximized}>
        <DialogContent className="max-w-[92vw] w-[92vw] p-6 gap-3">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            {title}
          </DialogTitle>
          {renderChart(true)}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

const KPI_INITIAL_VISIBLE = 6;

export function FindingDrillDown({ finding, onClose, sessionId }: FindingDrillDownProps) {
  const [saveToWorkbenchPayload, setSaveToWorkbenchPayload] = useState<SaveToWorkbenchPayload | null>(null);
  const [kpiExpanded, setKpiExpanded] = useState(false);
  const [extraChartsOpen, setExtraChartsOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const hasMetrics = Object.keys(finding.keyMetrics).length > 0;
  const hasEvidence = finding.evidence.length > 0;

  const chartableEvidence = finding.evidence.filter(
    (e) => e.rows.length >= 2 && e.rows.length <= 50 && e.fields.length >= 2
  );

  // Hero = last chartable evidence (agent's final, most complete query)
  const heroEvidence = chartableEvidence.length > 0
    ? chartableEvidence[chartableEvidence.length - 1]
    : null;
  const extraCharts = chartableEvidence.length > 1
    ? chartableEvidence.slice(0, chartableEvidence.length - 1)
    : [];

  const allMetrics = Object.entries(finding.keyMetrics);
  const visibleMetrics = kpiExpanded ? allMetrics : allMetrics.slice(0, KPI_INITIAL_VISIBLE);
  const hiddenCount = allMetrics.length - KPI_INITIAL_VISIBLE;

  // Primary evidence for the header Save to Workbench action
  const primaryEvidence = finding.evidence[finding.evidence.length - 1] ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
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
              {finding.confidence}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {finding.summary}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {primaryEvidence && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      setSaveToWorkbenchPayload({
                        sql: primaryEvidence.sql,
                        title: finding.title.slice(0, 120),
                        vizConfig: {
                          type: "table",
                          title: finding.title.slice(0, 80),
                          data: [],
                          tableConfig: {
                            columns: primaryEvidence.fields.map((f) => ({ key: f, label: humanizeKey(f) })),
                          },
                        },
                        explanation: primaryEvidence.explanation,
                        sourceType: "research",
                        sourceSessionId: sessionId ?? undefined,
                      })
                    }
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">Save to Workbench</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Hero chart — full-width, prominent */}
      {heroEvidence && (
        <AutoChart evidence={heroEvidence} hero />
      )}

      {/* KPI strip */}
      {hasMetrics && (
        <div className="flex flex-wrap gap-2 items-start">
          {visibleMetrics.map(([k, v]) => (
            <KPICard key={k} metricKey={k} value={v} description={finding.keyMetricDescriptions?.[k]} agentFormat={finding.keyMetricFormats?.[k]} />
          ))}
          {!kpiExpanded && hiddenCount > 0 && (
            <button
              onClick={() => setKpiExpanded(true)}
              className="flex-1 min-w-[80px] h-full flex items-center justify-center text-xs text-muted-foreground hover:text-foreground transition-colors border border-dashed rounded-md px-3 py-2"
            >
              +{hiddenCount} more
            </button>
          )}
          {kpiExpanded && hiddenCount > 0 && (
            <button
              onClick={() => setKpiExpanded(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2"
            >
              show less
            </button>
          )}
        </div>
      )}

      {/* Additional charts — collapsed by default */}
      {extraCharts.length > 0 && (
        <Collapsible open={extraChartsOpen} onOpenChange={setExtraChartsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
            {extraChartsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {extraChartsOpen ? "Hide" : "Show"} {extraCharts.length} more visualization{extraCharts.length > 1 ? "s" : ""}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-4 md:grid-cols-2 mt-3">
              {extraCharts.map((ev, i) => (
                <Card key={i} className="overflow-hidden">
                  <CardContent className="pt-3 pb-3">
                    <AutoChart evidence={ev} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Separator className="opacity-50" />

      {/* Evidence tables — collapsed by default */}
      {hasEvidence && (
        <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
            {evidenceOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <Table2 className="h-3.5 w-3.5" />
            {evidenceOpen ? "Hide" : "View"} evidence data &mdash; {finding.evidence.length} {finding.evidence.length === 1 ? "query" : "queries"}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-5 mt-3">
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
          </CollapsibleContent>
        </Collapsible>
      )}

      <SaveToWorkbenchModal
        open={saveToWorkbenchPayload !== null}
        onClose={() => setSaveToWorkbenchPayload(null)}
        payload={saveToWorkbenchPayload}
      />
    </div>
  );
}

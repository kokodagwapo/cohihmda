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

import { useState, useMemo, useRef, cloneElement, type ReactNode } from "react";
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
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
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
  Presentation,
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
import {
  exportDataAsExcel,
  exportElementAsPpt,
  exportVisualizationAsPdf,
  type ExportData,
} from "@/utils/exportUtils";
import { useToast } from "@/hooks/use-toast";
import { SaveToWorkbenchModal, type SaveToWorkbenchPayload } from "@/components/research/SaveToWorkbenchModal";
import {
  FIELD_REGISTRY,
  SUMMARY_REGISTRY,
  type FieldFormat,
} from "@/config/insightFieldRegistry";
import type { Finding, EvidenceItem, EvidenceItemSql } from "@/hooks/useResearchSession";
import { isSqlEvidence, isRegistryWidgetEvidence } from "@/hooks/useResearchSession";
import { RegistryWidgetEmbed } from "@/components/research/RegistryWidgetEmbed";
import {
  resolveResearchVisualizationLineage,
  shouldShowResearchSqlLineageLink,
} from "@/lib/researchVisualizationLineage";
import { ResearchSourceDashboardLink } from "@/components/research/ResearchSourceDashboardLink";
import { detectSnapshotColumnsInTimeframeTable } from "@/lib/research/snapshotMetricTableHint";
import {
  agentFormatToFieldFormat,
  buildSqlEvidenceExportData,
  formatValue,
  humanizeKey,
  inferFormat,
  inferFormatFromValue,
} from "@/lib/researchEvidenceExport";
import { evidenceToChartConfig, parseNumeric } from "@/lib/researchChartConfig";

async function exportResearchElement(
  action: "pdf" | "ppt",
  target: HTMLElement | null,
  title: string,
  toast: ReturnType<typeof useToast>["toast"],
  options?: { exportData?: ExportData; rows?: Record<string, unknown>[] },
) {
  if (!target) {
    toast({
      title: "Export failed",
      description: "Export target not found.",
      variant: "destructive",
    });
    return;
  }
  try {
    if (action === "pdf") {
      const rows = options?.rows ?? [];
      await exportVisualizationAsPdf({
        visualization: { type: "table", title, data: rows },
        title,
        captureTarget: target,
      });
    } else {
      await exportElementAsPpt(target, title, options?.exportData);
    }
    toast({
      title: "Downloaded",
      description: `Exported ${action === "pdf" ? "PDF" : "PowerPoint"}.`,
    });
  } catch (error) {
    toast({
      title: "Export failed",
      description: error instanceof Error ? error.message : "Export failed.",
      variant: "destructive",
    });
  }
}

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

const ID_COLUMN_PATTERN = /^(loan|id|number|account|borrower|servicer|pool|investor|branch|zip|fips|census|ssn|ein|fico|phone|fax)/i;
const ID_COLUMN_SUFFIX_PATTERN = /(_id|_number|_num|_no|_code|_ln|_key|_ref)$/i;

function isIdentifierColumn(columnName: string): boolean {
  const normalized = columnName.replace(/[\s-]+/g, "_");
  return ID_COLUMN_PATTERN.test(normalized) || ID_COLUMN_SUFFIX_PATTERN.test(normalized);
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
  evidence: EvidenceItemSql;
  index: number;
  findingTitle?: string;
  sessionId?: string | null;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
  lineageSlot?: ReactNode;
}

function EvidenceTable({ evidence, index, findingTitle, sessionId, onSaveToWorkbench, lineageSlot }: EvidenceTableProps) {
  const { isDebugMode } = useDebugMode();
  const { toast } = useToast();
  const [sort, setSort] = useState<SortState>({ column: "", direction: null });
  const [filter, setFilter] = useState("");
  const [sqlOpen, setSqlOpen] = useState(false);
  const [visibleRowCount, setVisibleRowCount] = useState(EVIDENCE_INITIAL_ROWS);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const exportCaptureRef = useRef<HTMLDivElement>(null);
  const exportTitle =
    [findingTitle, `Query ${index + 1}`].filter(Boolean).join(" — ") ||
    `Evidence Query ${index + 1}`;

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
        if (typeof sample === "number" && !isIdentifierColumn(f)) formats[f] = "number";
        else if (typeof sample === "number" && isIdentifierColumn(f)) formats[f] = "text";
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
      buildSqlEvidenceExportData(
        evidence,
        columnFormats,
        `Evidence Query ${index + 1}`,
        `Query ${index + 1}`,
      ),
      `evidence-query-${index + 1}-${new Date().toISOString().split("T")[0]}`,
    );
  };

  const evidenceExportData = useMemo(
    () =>
      buildSqlEvidenceExportData(
        evidence,
        columnFormats,
        exportTitle,
        `Query ${index + 1}`,
      ),
    [evidence, columnFormats, exportTitle, index],
  );

  const handleExportPdf = () =>
    void exportResearchElement(
      "pdf",
      exportCaptureRef.current,
      exportTitle,
      toast,
      { rows: evidence.rows as Record<string, unknown>[] },
    );

  const handleExportPpt = () =>
    void exportResearchElement(
      "ppt",
      exportCaptureRef.current,
      exportTitle,
      toast,
      { exportData: evidenceExportData },
    );

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

  const snapshotColumns = useMemo(
    () => detectSnapshotColumnsInTimeframeTable(evidence.fields, evidence.rows),
    [evidence.fields, evidence.rows],
  );

  return (
    <div className="space-y-2">
      {snapshotColumns.length > 0 && (
        <p className="text-xs text-muted-foreground rounded-md border border-amber-200/60 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/40 px-2.5 py-2">
          <strong>Snapshot metrics:</strong>{" "}
          {snapshotColumns.map(humanizeKey).join(", ")} show the same value for
          each period because they reflect the <strong>current pipeline as of
          today</strong>, not a historical cohort. Compare windowed metrics
          (applications, funded, pull-through) across periods instead.
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">Query {index + 1}</Badge>
          <span className="text-xs text-muted-foreground">
            {evidence.rowCount} rows
          </span>
          {lineageSlot}
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
              <DropdownMenuItem onClick={handleExportPdf} className="gap-2 text-xs cursor-pointer">
                <FileText className="h-3.5 w-3.5" />
                Export PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPpt} className="gap-2 text-xs cursor-pointer">
                <Presentation className="h-3.5 w-3.5" />
                Export PowerPoint
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
      <div
        ref={exportCaptureRef}
        className="border rounded-md overflow-hidden flex flex-col max-h-72 bg-white dark:bg-slate-950"
      >
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
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const exportCaptureRef = useRef<HTMLDivElement>(null);
  const sqlEvidence = isSqlEvidence(evidence) ? evidence : null;
  const columnFormats = useMemo(() => {
    if (!sqlEvidence) return {} as Record<string, FieldFormat>;
    const formats: Record<string, FieldFormat> = {};
    const agentFmts = sqlEvidence.columnFormats || {};
    for (const f of sqlEvidence.fields) {
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
      const sample = sqlEvidence.rows.find((r) => r[f] != null)?.[f];
      if (sample != null) {
        if (typeof sample === "number" && !isIdentifierColumn(f)) formats[f] = "number";
        else if (typeof sample === "number" && isIdentifierColumn(f)) formats[f] = "text";
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
  }, [sqlEvidence]);

  const exportTitle = useMemo(
    () =>
      [saveTitle, sqlEvidence?.explanation].filter(Boolean).join(" — ").slice(0, 120) ||
      "Evidence",
    [saveTitle, sqlEvidence?.explanation],
  );

  const evidenceExportData = useMemo(
    () =>
      sqlEvidence
        ? buildSqlEvidenceExportData(sqlEvidence, columnFormats, exportTitle)
        : undefined,
    [sqlEvidence, columnFormats, exportTitle],
  );

  const isNumericFormat = (fmt: FieldFormat) =>
    ["currency", "number", "percent", "rate", "days", "bps"].includes(fmt);

  const visibleRowCount = sqlEvidence
    ? expanded
      ? Math.min(sqlEvidence.rows.length, maxRows)
      : EVIDENCE_PREVIEW_DEFAULT_ROWS
    : 0;
  const displayRows = sqlEvidence ? sqlEvidence.rows.slice(0, visibleRowCount) : [];
  const totalRows = sqlEvidence?.rows.length ?? 0;
  const hasMore = totalRows > visibleRowCount;

  if (!sqlEvidence || totalRows === 0) return null;

  const handleExportCSV = () => {
    const header = sqlEvidence.fields.map(humanizeKey).join(",");
    const rows = sqlEvidence.rows.map((r) => sqlEvidence.fields.map((f) => {
      const v = r[f]; return v == null ? "" : typeof v === "string" && v.includes(",") ? `"${v}"` : String(v);
    }).join(","));
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "evidence.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    if (!evidenceExportData) return;
    exportDataAsExcel(
      evidenceExportData,
      `${exportTitle.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().split("T")[0]}`,
    );
  };

  const handleExportPdf = () =>
    void exportResearchElement(
      "pdf",
      exportCaptureRef.current,
      exportTitle,
      toast,
      { rows: sqlEvidence.rows as Record<string, unknown>[] },
    );

  const handleExportPpt = () =>
    void exportResearchElement(
      "ppt",
      exportCaptureRef.current,
      exportTitle,
      toast,
      { exportData: evidenceExportData },
    );

  return (
    <div
      ref={exportCaptureRef}
      className="rounded-md border overflow-hidden bg-white dark:bg-slate-950"
      role="region"
      aria-label="Evidence preview table"
    >
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
            <DropdownMenuItem onClick={handleExportPdf} className="gap-2 text-xs cursor-pointer">
              <FileText className="h-3.5 w-3.5" />
              Export PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportPpt} className="gap-2 text-xs cursor-pointer">
              <Presentation className="h-3.5 w-3.5" />
              Export PowerPoint
            </DropdownMenuItem>
            {onSaveToWorkbench && (
              <DropdownMenuItem
                className="gap-2 text-xs cursor-pointer"
                onClick={() =>
                  onSaveToWorkbench({
                    sql: sqlEvidence.sql,
                    title: [saveTitle, sqlEvidence.explanation].filter(Boolean).join(" — ").slice(0, 120) || "Research table",
                    vizConfig: {
                      type: "table",
                      title: [saveTitle, sqlEvidence.explanation].filter(Boolean).join(" — ").slice(0, 80) || "Table",
                      data: [],
                      tableConfig: {
                        columns: sqlEvidence.fields.map((f) => ({
                          key: f,
                          label: humanizeKey(f),
                          format: columnFormats[f] || "text",
                        })),
                      },
                    },
                    explanation: sqlEvidence.explanation,
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
        <table className="w-full border-collapse text-xs" style={{ minWidth: `${sqlEvidence.fields.length * 90}px` }}>
          <thead>
            <tr className="sticky top-0 z-10 border-b bg-muted/80">
              {sqlEvidence.fields.map((f) => {
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
                {sqlEvidence.fields.map((f) => {
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

// ── AutoChart props / component ───────────────────────────────────────────────

const MULTI_SERIES_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#84cc16",
];
const SINGLE_SERIES_COLOR = "#6366f1";

export interface AutoChartProps {
  evidence: EvidenceItem;
  /** When true render at hero size (h-64, tick font 11). Default false = h-48, tick font 10. */
  hero?: boolean;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
  /** Title used for the workbench widget. */
  saveTitle?: string;
  /** Research session ID, forwarded to the workbench payload. */
  sessionId?: string | null;
  /** DOM key for full-report PPT chart capture. */
  captureKey?: string;
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

export function AutoChart({
  evidence,
  hero = false,
  onSaveToWorkbench,
  saveTitle,
  sessionId,
  captureKey,
}: AutoChartProps) {
  if (!isSqlEvidence(evidence)) return null;
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
      <AutoChartShell title={title} hero={hero} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle} captureKey={captureKey}>
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
      <AutoChartShell title={title} hero={hero} minWidth={minWidth} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle} captureKey={captureKey}>
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
      <AutoChartShell title={title} hero={hero} minWidth={minWidth} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle} captureKey={captureKey}>
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

  // ── Histogram ─────────────────────────────────────────────────────────────
  if (chartType === 'histogram') {
    const bucketCount = evidence.chartHint?.buckets ?? 20;
    const values = data.map((d) => parseNumeric(d[xKey])).filter((v) => !isNaN(v));
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = max === min ? 1 : (max - min) / bucketCount;
    const buckets: { range: string; count: number }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const lo = min + i * step;
      const hi = lo + step;
      const count = values.filter((v) => v >= lo && (i === bucketCount - 1 ? v <= hi : v < hi)).length;
      buckets.push({ range: lo.toFixed(1), count });
    }
    return (
      <AutoChartShell title={title} hero={hero} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle} captureKey={captureKey}>
        <BarChart data={buckets} margin={{ top: 5, right: 10, bottom: 8, left: 5 }}>
          {grid}
          <XAxis dataKey="range" tick={{ fontSize: tickFontSize }} angle={-30} textAnchor="end" height={48} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: tickFontSize }} width={40} axisLine={false} tickLine={false} />
          <RechartsTooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [v, "Count"]} />
          <Bar dataKey="count" fill={SINGLE_SERIES_COLOR} radius={[2, 2, 0, 0]} />
        </BarChart>
      </AutoChartShell>
    );
  }

  // ── Scatter chart ─────────────────────────────────────────────────────────
  if (chartType === 'scatter') {
    const hint = evidence.chartHint;
    const xScatterKey = hint?.xKey ?? xKey;
    const yScatterKey = hint?.yKey ?? hint?.y2Key ?? yKey;
    const scatterData = data
      .map((d) => ({ x: parseNumeric(d[xScatterKey]), y: parseNumeric(d[yScatterKey]) }))
      .filter((p) => !isNaN(p.x) && !isNaN(p.y));
    if (scatterData.length === 0) return null;
    return (
      <AutoChartShell title={title} hero={hero} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle} captureKey={captureKey}>
        <ScatterChart margin={{ top: 5, right: 10, bottom: 8, left: 5 }}>
          {grid}
          <XAxis dataKey="x" type="number" name={humanizeKey(xScatterKey)} tick={{ fontSize: tickFontSize }} axisLine={false} tickLine={false} />
          <YAxis dataKey="y" type="number" name={humanizeKey(yScatterKey)} tick={{ fontSize: tickFontSize }} width={50} axisLine={false} tickLine={false} />
          <ZAxis range={[30, 30]} />
          <RechartsTooltip contentStyle={{ fontSize: 11 }} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={scatterData} fill={SINGLE_SERIES_COLOR} opacity={0.6} />
        </ScatterChart>
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
      <AutoChartShell title={title} hero={hero} minHeight={minHeight} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle} captureKey={captureKey}>
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
    <AutoChartShell title={title} hero={hero} minWidth={minWidth} onSaveToWorkbench={onSaveToWorkbench} evidence={evidence} sessionId={sessionId} saveTitle={saveTitle} captureKey={captureKey}>
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
  captureKey?: string;
}

function AutoChartShell({ title, hero = false, minWidth, minHeight, children, onSaveToWorkbench, evidence, sessionId, saveTitle, captureKey }: AutoChartShellProps) {
  const { toast } = useToast();
  const [maximized, setMaximized] = useState(false);
  const exportCaptureRef = useRef<HTMLDivElement>(null);
  const baseHeight = hero ? 256 : 192;
  const sqlEvidence = evidence && isSqlEvidence(evidence) ? evidence : null;
  const exportTitle =
    [saveTitle, title].filter(Boolean).join(" — ").slice(0, 120) || title || "Research chart";
  const chartExportData = useMemo(
    () =>
      sqlEvidence
        ? buildSqlEvidenceExportData(sqlEvidence, {}, exportTitle, title)
        : undefined,
    [sqlEvidence, exportTitle, title],
  );
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

  const handleExportPdf = () =>
    void exportResearchElement(
      "pdf",
      exportCaptureRef.current,
      exportTitle,
      toast,
      {
        rows: sqlEvidence
          ? (sqlEvidence.rows as Record<string, unknown>[])
          : [],
      },
    );

  const handleExportPpt = () =>
    void exportResearchElement(
      "ppt",
      exportCaptureRef.current,
      exportTitle,
      toast,
      { exportData: chartExportData },
    );

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 min-w-0">
            <BarChart3 className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{title}</span>
          </p>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  aria-label="Chart export options"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={handleExportPdf}
                  className="gap-2 text-xs cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Export PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleExportPpt}
                  className="gap-2 text-xs cursor-pointer"
                >
                  <Presentation className="h-3.5 w-3.5" />
                  Export PowerPoint
                </DropdownMenuItem>
                {onSaveToWorkbench && sqlEvidence && (
                  <DropdownMenuItem
                    className="gap-2 text-xs cursor-pointer"
                    onClick={() =>
                      onSaveToWorkbench({
                        sql: sqlEvidence.sql,
                        title: [saveTitle, title].filter(Boolean).join(" — ").slice(0, 120) || "Research chart",
                        vizConfig: {
                          type: "table",
                          title: title || "Chart",
                          data: [],
                        },
                        explanation: sqlEvidence.explanation,
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
        <div
          ref={exportCaptureRef}
          className="rounded-md border border-transparent bg-white dark:bg-slate-950"
          {...(captureKey
            ? { "data-research-export-key": captureKey }
            : {})}
        >
          {renderChart(false)}
        </div>
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
  const [extraRegistryOpen, setExtraRegistryOpen] = useState(false);

  const hasMetrics = Object.keys(finding.keyMetrics).length > 0;
  const hasEvidence = finding.evidence.length > 0;

  const registryDashboardPaths = useMemo(
    () => finding.evidence.filter(isRegistryWidgetEvidence).map((e) => e.dashboardPath),
    [finding.evidence],
  );

  const registryEvidence = useMemo(
    () => finding.evidence.filter(isRegistryWidgetEvidence).slice(0, 3),
    [finding.evidence],
  );
  const heroRegistry = registryEvidence[0];
  const extraRegistry = registryEvidence.slice(1);

  const chartableEvidence = finding.evidence.filter(
    (e) =>
      isSqlEvidence(e) &&
      e.rows.length >= 2 &&
      e.rows.length <= 50 &&
      e.fields.length >= 2,
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
  const summaryBullets =
    Array.isArray(finding.summary_bullets) && finding.summary_bullets.length > 0
      ? finding.summary_bullets
      : (finding.summary ? [finding.summary] : []);

  const primarySqlEvidence = [...finding.evidence].reverse().find(isSqlEvidence) ?? null;
  const primaryRegistryEvidence = [...finding.evidence].reverse().find(isRegistryWidgetEvidence) ?? null;

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
          {summaryBullets.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground leading-relaxed">
              {summaryBullets.map((bullet, idx) => (
                <li key={`${idx}-${bullet.slice(0, 24)}`}>{bullet}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {primaryRegistryEvidence && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      setSaveToWorkbenchPayload({
                        title: finding.title.slice(0, 120),
                        registryWidget: {
                          definitionId: primaryRegistryEvidence.definitionId,
                          period: primaryRegistryEvidence.period,
                          filters: primaryRegistryEvidence.filters,
                        },
                        sourceType: "research",
                        sourceSessionId: sessionId ?? undefined,
                      })
                    }
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">Save canonical widget to Workbench</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {primarySqlEvidence && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      setSaveToWorkbenchPayload({
                        sql: primarySqlEvidence.sql,
                        title: finding.title.slice(0, 120),
                        vizConfig: {
                          type: "table",
                          title: finding.title.slice(0, 80),
                          data: [],
                          tableConfig: {
                            columns: primarySqlEvidence.fields.map((f) => ({ key: f, label: humanizeKey(f) })),
                          },
                        },
                        explanation: primarySqlEvidence.explanation,
                        sourceType: "research",
                        sourceSessionId: sessionId ?? undefined,
                      })
                    }
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">Save SQL table to Workbench</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Canonical registry widgets (hero + optional extras) */}
      {heroRegistry && (
        <div className="space-y-3">
          <RegistryWidgetEmbed evidence={heroRegistry} hero />
          {extraRegistry.length > 0 && (
            <Collapsible open={extraRegistryOpen} onOpenChange={setExtraRegistryOpen}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                {extraRegistryOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {extraRegistryOpen ? "Hide" : "Show"} {extraRegistry.length} more visualization
                {extraRegistry.length > 1 ? "s" : ""}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid gap-3 md:grid-cols-2 mt-3">
                  {extraRegistry.map((ev, i) => (
                    <RegistryWidgetEmbed key={`${ev.definitionId}-${i}`} evidence={ev} />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

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
            {evidenceOpen ? "Hide" : "View"} evidence data &mdash; {finding.evidence.length}{" "}
            {finding.evidence.length === 1 ? "item" : "items"}
            {" "}(SQL tables + widgets)
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-5 mt-3">
              {(() => {
                let registryRendered = 0;
                return finding.evidence.map((ev, i) => {
                  if (isRegistryWidgetEvidence(ev)) {
                    if (registryRendered >= 3) return null;
                    registryRendered += 1;
                    return (
                      <div key={`rw-${i}`} className="space-y-1">
                        <RegistryWidgetEmbed evidence={ev} />
                      </div>
                    );
                  }
                  if (!isSqlEvidence(ev)) return null;
                  const lineage = resolveResearchVisualizationLineage({
                    sql: ev.sql,
                    explanation: ev.explanation,
                    findingTitle: finding.title,
                  });
                  const showLineage =
                    lineage &&
                    shouldShowResearchSqlLineageLink({
                      resolvedLineage: lineage,
                      registryDashboardPaths,
                    });
                  const lineageSlot =
                    showLineage && lineage ? (
                      <ResearchSourceDashboardLink source={lineage} compact className="ml-1" />
                    ) : null;
                  return (
                    <EvidenceTable
                      key={`sql-${i}`}
                      evidence={ev}
                      index={i}
                      findingTitle={finding.title}
                      sessionId={sessionId}
                      onSaveToWorkbench={setSaveToWorkbenchPayload}
                      lineageSlot={lineageSlot}
                    />
                  );
                });
              })()}
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

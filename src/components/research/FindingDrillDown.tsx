/**
 * FindingDrillDown
 *
 * Detailed drill-down view for a research finding.
 * Shows:
 *   - KPI metric cards from keyMetrics
 *   - Sortable/filterable data tables from evidence queries
 *   - Auto-generated bar charts for numeric distributions
 *   - The SQL queries used (collapsible)
 */

import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import {
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Code,
  Table2,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  X,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { Finding, EvidenceItem } from "@/hooks/useResearchSession";

// ============================================================================
// Types
// ============================================================================

interface FindingDrillDownProps {
  finding: Finding;
  onClose: () => void;
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
  column: string;
  direction: SortDirection;
}

// ============================================================================
// KPI Card
// ============================================================================

const CHART_COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd",
  "#818cf8", "#7c3aed", "#6d28d9", "#5b21b6",
];

function KPICard({ name, value }: { name: string; value: string | number }) {
  const strVal = String(value);
  const numVal = parseFloat(strVal.replace(/[^0-9.-]/g, ""));
  const isNegative = numVal < 0;
  const isPercentage = strVal.includes("%");
  const isCurrency = strVal.includes("$") || strVal.includes("M") || strVal.includes("K");

  return (
    <Card className="flex-1 min-w-[140px]">
      <CardContent className="pt-3 pb-2 px-4">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide truncate">
          {name}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <p className="text-lg font-bold tabular-nums">{strVal}</p>
          {!isNaN(numVal) && (
            isNegative ? (
              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
            ) : numVal > 0 ? (
              <TrendingUp className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Minus className="h-3.5 w-3.5 text-muted-foreground" />
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Sortable Data Table
// ============================================================================

function EvidenceTable({ evidence, index }: { evidence: EvidenceItem; index: number }) {
  const [sort, setSort] = useState<SortState>({ column: "", direction: null });
  const [filter, setFilter] = useState("");
  const [sqlOpen, setSqlOpen] = useState(false);

  const toggleSort = (column: string) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      if (prev.direction === "desc") return { column: "", direction: null };
      return { column, direction: "asc" };
    });
  };

  const filteredAndSorted = useMemo(() => {
    let rows = [...evidence.rows];

    // Filter
    if (filter.trim()) {
      const lowerFilter = filter.toLowerCase();
      rows = rows.filter((row) =>
        evidence.fields.some((f) => {
          const val = row[f];
          return val != null && String(val).toLowerCase().includes(lowerFilter);
        })
      );
    }

    // Sort
    if (sort.column && sort.direction) {
      rows.sort((a, b) => {
        const aVal = a[sort.column];
        const bVal = b[sort.column];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        const aNum = parseFloat(String(aVal));
        const bNum = parseFloat(String(bVal));
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sort.direction === "asc" ? aNum - bNum : bNum - aNum;
        }
        const cmp = String(aVal).localeCompare(String(bVal));
        return sort.direction === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [evidence, sort, filter]);

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
        <p className="text-xs text-muted-foreground">{evidence.explanation}</p>
      )}

      {/* Data table */}
      <div className="border rounded-md overflow-x-auto max-h-72">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b bg-muted/80">
              {evidence.fields.map((f) => (
                <th
                  key={f}
                  className="px-2 py-1.5 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-accent/50 select-none"
                  onClick={() => toggleSort(f)}
                >
                  <div className="flex items-center gap-1">
                    <span>{f}</span>
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
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.slice(0, 100).map((row, i) => (
              <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                {evidence.fields.map((f) => (
                  <td key={f} className="px-2 py-1 whitespace-nowrap max-w-[200px] truncate">
                    {row[f] == null ? (
                      <span className="text-muted-foreground italic">null</span>
                    ) : (
                      formatCellValue(row[f])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredAndSorted.length > 100 && (
          <div className="px-2 py-1 text-xs text-muted-foreground bg-muted/30 border-t">
            Showing 100 of {filteredAndSorted.length} rows
          </div>
        )}
        {filteredAndSorted.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            No matching rows
          </div>
        )}
      </div>

      {/* SQL (collapsible) */}
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
    </div>
  );
}

// ============================================================================
// Auto Chart — tries to visualize numeric data
// ============================================================================

function AutoChart({ evidence }: { evidence: EvidenceItem }) {
  // Find a good label column and numeric columns
  const { fields, rows } = evidence;
  if (rows.length < 2 || rows.length > 30) return null;

  const numericFields = fields.filter((f) => {
    const sample = rows.find((r) => r[f] != null);
    if (!sample) return false;
    const val = parseFloat(String(sample[f]));
    return !isNaN(val) && typeof sample[f] !== "boolean";
  });

  const labelField = fields.find((f) => {
    const sample = rows.find((r) => r[f] != null);
    if (!sample) return false;
    return isNaN(parseFloat(String(sample[f]))) || typeof sample[f] === "string";
  });

  if (!labelField || numericFields.length === 0) return null;

  // Pick the most interesting numeric field (prefer rates, counts, amounts)
  const bestField = numericFields.find((f) =>
    /rate|count|total|amount|revenue|avg|sum|percent/i.test(f)
  ) || numericFields[0];

  const chartData = rows.slice(0, 20).map((row) => ({
    name: truncateLabel(String(row[labelField] || "N/A")),
    value: parseFloat(String(row[bestField] || 0)),
  }));

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <BarChart3 className="h-3 w-3" />
        {bestField} by {labelField}
      </p>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
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
            <YAxis tick={{ fontSize: 10 }} width={50} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(value: number) => [formatNumber(value), bestField]}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatCellValue(val: any): string {
  if (typeof val === "number") return formatNumber(val);
  return String(val);
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

function truncateLabel(s: string): string {
  return s.length > 18 ? s.substring(0, 15) + "..." : s;
}

// ============================================================================
// Main Component
// ============================================================================

export function FindingDrillDown({ finding, onClose }: FindingDrillDownProps) {
  const hasMetrics = Object.keys(finding.keyMetrics).length > 0;
  const hasEvidence = finding.evidence.length > 0;

  // Find evidence tables that are good candidates for charting
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
              <KPICard key={k} name={k} value={v} />
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
                  <AutoChart evidence={ev} />
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
            Evidence Data ({finding.evidence.length} queries)
          </h4>
          <div className="space-y-5">
            {finding.evidence.map((ev, i) => (
              <EvidenceTable key={i} evidence={ev} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

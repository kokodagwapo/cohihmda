/**
 * FieldHealthView — Data Coverage
 *
 * Framed around business operations, not field population rates.
 * Four concern areas for executives:
 *   1. Loan Identification — loans that can't be tracked or sized
 *   2. Personnel & Assignments — loans with no one responsible
 *   3. Closing & Funding Records — funded loans with incomplete packages
 *   4. LOS Configuration — fields receiving zero data (mapping issue)
 *
 * Full 296-field reference available in the "All tracked fields" accordion.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Settings2,
  Hash,
  Users,
  Banknote,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CheckCircle2,
  ArrowRight,
  Database,
  Search,
  ArrowUpDown,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldMissingLoansDialog, type FieldRef } from "./FieldMissingLoansDialog";
import { FieldPopulationStats } from "@/components/admin/FieldPopulationStats";
import { api } from "@/lib/api";
import type {
  CrucialFieldStatus,
  CrucialFieldStageGroup,
} from "./types";

interface AllFieldCoverage {
  column: string;
  dataType: string;
  populatedCount: number;
  missingCount: number;
}

// ─── Business concern definitions ────────────────────────────────────────────

interface ConcernDef {
  id: string;
  icon: typeof Hash;
  label: string;
  description: string;
  /** Columns that belong to this concern group */
  columns: string[];
  /**
   * When true, this concern is informational only (no click-through).
   * Used for LOS configuration gaps — not a data entry problem.
   */
  informational?: boolean;
}

const CONCERNS: ConcernDef[] = [
  {
    id: "identification",
    icon: Hash,
    label: "Loan Identification",
    description: "Every loan needs these to appear in any report, dashboard, or export.",
    // application_date / started_date excluded here since they have their own stage filter
    // and will surface naturally in the "all fields" view if unmapped
    columns: ["loan_number", "loan_amount", "loan_source", "application_date", "started_date"],
  },
  {
    id: "personnel",
    icon: Users,
    label: "Personnel & Assignments",
    description: "Loans without an assigned officer or branch cannot be tracked. Processor is checked only on loans that progressed past application stage.",
    // processor moved to processing stage — it's only meaningful once a loan is in the pipeline
    columns: ["loan_officer", "branch", "processor", "underwriter", "closer", "account_executive"],
  },
  {
    id: "funded",
    icon: Banknote,
    label: "Closing & Funding Records",
    description: "Originated and funded loans require complete closing documentation for investor delivery and HMDA filing.",
    columns: ["closing_date", "funding_date", "ctc_date", "shipped_date", "investor_purchase_date", "investor_status"],
  },
  {
    id: "configuration",
    icon: Settings2,
    label: "LOS Field Mapping",
    description: "These fields have no data across any applicable loans — likely not configured in your LOS integration.",
    informational: true,
    columns: [], // populated dynamically
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFieldMap(stageGroups: {
  universal: CrucialFieldStageGroup;
  originated: CrucialFieldStageGroup;
  processing: CrucialFieldStageGroup;
}): Map<string, CrucialFieldStatus> {
  const map = new Map<string, CrucialFieldStatus>();
  for (const group of Object.values(stageGroups)) {
    for (const f of group.fields) {
      map.set(f.column, f);
    }
  }
  return map;
}

// ─── Individual row ───────────────────────────────────────────────────────────

function ConcernRow({
  field,
  onClick,
}: {
  field: CrucialFieldStatus;
  onClick?: (f: CrucialFieldStatus) => void;
}) {
  const noApplicable = field.applicableLoanCount === 0;
  const allMissing = field.populatedCount === 0 && field.applicableLoanCount > 0;
  const hasMissing = !allMissing && field.missingCount > 0;
  const isOk = !allMissing && !hasMissing;

  if (noApplicable) return null;

  return (
    <div
      className={`flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors ${
        (hasMissing || allMissing) && onClick
          ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
          : "cursor-default"
      }`}
      onClick={() => (hasMissing || allMissing) && onClick?.(field)}
      role={onClick && (hasMissing || allMissing) ? "button" : undefined}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {isOk ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : allMissing ? (
          <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-slate-300 dark:border-slate-600" />
        ) : (
          <div className="h-3.5 w-3.5 shrink-0 rounded-full bg-slate-200 dark:bg-slate-600" />
        )}
        <span
          className={`text-sm truncate ${
            allMissing
              ? "text-slate-400 dark:text-slate-500"
              : "text-slate-700 dark:text-slate-300"
          }`}
        >
          {field.name}
        </span>
        {field.columnMissing && (
          <Badge variant="outline" className="text-[10px] shrink-0 text-slate-400">
            schema missing
          </Badge>
        )}
      </div>

      <div className="shrink-0 ml-4 flex items-center gap-1">
        {isOk && (
          <span className="text-xs text-slate-400">
            {field.applicableLoanCount.toLocaleString()} loans ✓
          </span>
        )}
        {allMissing && !field.columnMissing && (
          <span className="text-xs text-slate-400 italic">No data received</span>
        )}
        {hasMissing && (
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
            {field.missingCount.toLocaleString()}{" "}
            <span className="text-slate-400 font-normal text-xs">
              loan{field.missingCount !== 1 ? "s" : ""} missing this
            </span>
            {onClick && <ChevronRight className="h-3.5 w-3.5 text-slate-400 ml-0.5" />}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Concern card ─────────────────────────────────────────────────────────────

function ConcernCard({
  concern,
  fieldMap,
  onFieldClick,
}: {
  concern: ConcernDef;
  fieldMap: Map<string, CrucialFieldStatus>;
  onFieldClick: (f: FieldRef) => void;
}) {
  const Icon = concern.icon;

  const fields = concern.columns
    .map((col) => fieldMap.get(col))
    .filter((f): f is CrucialFieldStatus => !!f && f.applicableLoanCount > 0);

  if (fields.length === 0) return null;

  const unmapped = fields.filter((f) => f.populatedCount === 0);
  const withGaps = fields.filter((f) => f.populatedCount > 0 && f.missingCount > 0);
  const totalAffectedLoans = withGaps.reduce((s, f) => s + f.missingCount, 0);
  const allOk = unmapped.length === 0 && withGaps.length === 0;

  return (
    <Card className={`border ${allOk ? "border-slate-200 dark:border-slate-700" : "border-slate-200 dark:border-slate-700"}`}>
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 mt-0.5">
          <Icon className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {concern.label}
            </span>
            <div className="shrink-0">
              {allOk ? (
                <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-xs font-normal">
                  No issues
                </Badge>
              ) : totalAffectedLoans > 0 ? (
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {totalAffectedLoans.toLocaleString()}{" "}
                  <span className="text-xs font-normal text-slate-400">loans affected</span>
                </span>
              ) : unmapped.length > 0 ? (
                <span className="text-xs text-slate-400 italic">
                  {unmapped.length} field{unmapped.length > 1 ? "s" : ""} not receiving data
                </span>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
            {concern.description}
          </p>
        </div>
      </div>

      {/* Rows */}
      <CardContent className="px-3 py-2 space-y-0">
        {fields.map((f) => (
          <ConcernRow
            key={f.column}
            field={f}
            onClick={concern.informational ? undefined : (cf) => onFieldClick({ column: cf.column, name: cf.name, missingCount: cf.missingCount, applicableLoanCount: cf.applicableLoanCount })}
          />
        ))}
      </CardContent>
    </Card>
  );
}

// ─── All-fields accordion (full 296-column coverage) ─────────────────────────

type SortMode = "missing" | "alpha" | "populated";

function humanLabel(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function AllFieldsAccordion({
  tenantId,
  totalLoans,
  onFieldClick,
}: {
  tenantId: string | null;
  totalLoans: number;
  onFieldClick: (f: FieldRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<AllFieldCoverage[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("missing");
  const [showZeroOnly, setShowZeroOnly] = useState(false);

  const load = useCallback(async () => {
    if (fields.length > 0 || loading) return;
    setLoading(true);
    try {
      const res = await api.request<{
        success: boolean;
        totalLoans: number;
        fields: AllFieldCoverage[];
      }>(`/api/data-quality/all-fields-coverage?tenant_id=${tenantId ?? ""}`);
      if (res.success) setFields(res.fields ?? []);
    } finally {
      setLoading(false);
    }
  }, [tenantId, fields.length, loading]);

  useEffect(() => {
    if (open) load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    let list = fields;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) => f.column.includes(q) || humanLabel(f.column).toLowerCase().includes(q)
      );
    }
    if (showZeroOnly) {
      list = list.filter((f) => f.populatedCount === 0);
    }
    return [...list].sort((a, b) => {
      if (sortMode === "missing") return b.missingCount - a.missingCount;
      if (sortMode === "populated") return b.populatedCount - a.populatedCount;
      return a.column.localeCompare(b.column);
    });
  }, [fields, search, sortMode, showZeroOnly]);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      {/* Header toggle */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            All tracked fields
          </span>
          {fields.length > 0 && (
            <Badge variant="outline" className="text-xs text-slate-400 font-normal">
              {fields.length} fields
            </Badge>
          )}
          <span className="text-xs text-slate-400">
            — full data model coverage
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
              <Input
                placeholder="Filter fields…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-7 text-xs w-48"
              />
            </div>

            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger className="h-7 text-xs w-36">
                <ArrowUpDown className="h-3 w-3 mr-1 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="missing">Most missing first</SelectItem>
                <SelectItem value="populated">Most populated first</SelectItem>
                <SelectItem value="alpha">Alphabetical</SelectItem>
              </SelectContent>
            </Select>

            <button
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                showZeroOnly
                  ? "bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-800 border-transparent"
                  : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
              onClick={() => setShowZeroOnly((v) => !v)}
            >
              No data only
            </button>

            {fields.length > 0 && (
              <span className="text-xs text-slate-400 ml-auto">
                {sorted.length.toLocaleString()} of {fields.length.toLocaleString()} fields
                {totalLoans > 0 && (
                  <span className="ml-1">
                    — {totalLoans.toLocaleString()} total loans
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading all fields…</span>
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              {search || showZeroOnly ? "No fields match your filters." : "No fields found."}
            </div>
          ) : (
            <div className="overflow-auto max-h-[480px]">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 w-[45%]">
                      Field
                    </th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 w-[25%]">
                      Column
                    </th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 w-[15%]">
                      Populated
                    </th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 w-[15%]">
                      Missing
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((f) => {
                    const hasMissing = f.missingCount > 0;
                    const isUnmapped = f.populatedCount === 0;
                    return (
                      <tr
                        key={f.column}
                        className={`border-b border-slate-50 dark:border-slate-800/50 transition-colors ${
                          hasMissing
                            ? "hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                            : "cursor-default"
                        }`}
                        onClick={() =>
                          hasMissing &&
                          onFieldClick({
                            column: f.column,
                            name: humanLabel(f.column),
                            missingCount: f.missingCount,
                            applicableLoanCount: totalLoans,
                          })
                        }
                      >
                        <td className="px-4 py-1.5">
                          <span
                            className={
                              isUnmapped
                                ? "text-slate-400"
                                : "text-slate-700 dark:text-slate-300"
                            }
                          >
                            {humanLabel(f.column)}
                          </span>
                        </td>
                        <td className="px-4 py-1.5">
                          <span className="font-mono text-[11px] text-slate-400">
                            {f.column}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right font-mono text-slate-500">
                          {f.populatedCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          {f.missingCount === 0 ? (
                            <span className="text-slate-300 dark:text-slate-600 font-mono">—</span>
                          ) : (
                            <span
                              className={`font-mono font-medium flex items-center justify-end gap-1 ${
                                isUnmapped
                                  ? "text-slate-400"
                                  : "text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {f.missingCount.toLocaleString()}
                              {hasMissing && (
                                <ArrowRight className="h-3 w-3 text-slate-400" />
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface FieldHealthViewProps {
  stageGroups: {
    universal: CrucialFieldStageGroup;
    originated: CrucialFieldStageGroup;
    processing: CrucialFieldStageGroup;
  } | null;
  totalLoans: number;
  tenantId: string | null;
}

export function FieldHealthView({ stageGroups, totalLoans, tenantId }: FieldHealthViewProps) {
  const [dialogField, setDialogField] = useState<FieldRef | null>(null);

  const fieldMap = useMemo(
    () => (stageGroups ? buildFieldMap(stageGroups) : new Map()),
    [stageGroups]
  );

  // Build the dynamic "LOS Configuration" concern: fields with 0 populated values
  const configConcern = useMemo<ConcernDef>(() => {
    if (!stageGroups) return { ...CONCERNS[3], columns: [] };
    const unmappedColumns: string[] = [];
    for (const group of Object.values(stageGroups)) {
      for (const f of group.fields) {
        if (f.applicableLoanCount > 0 && f.populatedCount === 0) {
          unmappedColumns.push(f.column);
        }
      }
    }
    return { ...CONCERNS[3], columns: unmappedColumns };
  }, [stageGroups]);

  if (!stageGroups) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">
        Loading data coverage...
      </div>
    );
  }

  // Build the rendered concern list: operational concerns + config at bottom
  const operationalConcerns = CONCERNS.slice(0, 3);

  // Check for any actual issues across operational concerns
  const hasAnyIssue = operationalConcerns.some((c) =>
    c.columns.some((col) => {
      const f = fieldMap.get(col);
      return f && f.missingCount > 0;
    })
  );

  return (
    <div className="space-y-4">
      {/* Top summary — only if everything looks clean */}
      {!hasAnyIssue && (
        <Alert className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-emerald-700 dark:text-emerald-300">
            No data coverage issues found across your pipeline. All key fields are populated on their applicable loans.
          </AlertDescription>
        </Alert>
      )}

      {/* Operational concern cards */}
      {operationalConcerns.map((concern) => (
        <ConcernCard
          key={concern.id}
          concern={concern}
          fieldMap={fieldMap}
          onFieldClick={(f) => setDialogField({ column: f.column, name: f.name, missingCount: f.missingCount, applicableLoanCount: f.applicableLoanCount })}
        />
      ))}

      {/* LOS configuration gaps (only if any exist) */}
      {configConcern.columns.length > 0 && (
        <ConcernCard
          concern={configConcern}
          fieldMap={fieldMap}
          onFieldClick={(f) => setDialogField({ column: f.column, name: f.name, missingCount: f.missingCount, applicableLoanCount: f.applicableLoanCount })}
        />
      )}

      {/* All-fields reference accordion — full 296-column data model */}
      <AllFieldsAccordion
        tenantId={tenantId}
        totalLoans={totalLoans}
        onFieldClick={setDialogField}
      />

      {/* Contextual note */}
      <p className="text-xs text-slate-400 dark:text-slate-500 px-1 leading-relaxed">
        Fields are checked against their applicable loan pool only — e.g.{" "}
        <em>Funding Date</em> is verified on originated/funded loans, not your
        full pipeline. Click any row with a loan count to see the specific loans.
      </p>

      {/* Full field population breakdown */}
      <FieldPopulationStats tenantId={tenantId} losConnectionId={null} />

      {/* Drilldown dialog */}
      <FieldMissingLoansDialog
        open={!!dialogField}
        onClose={() => setDialogField(null)}
        field={dialogField}
        tenantId={tenantId}
      />
    </div>
  );
}

import { useState } from "react";
import { ChevronDown, ChevronRight, AlertCircle, Eye, XCircle, AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type DataQualityWarning,
  type GroupedWarningSummary,
  type StatusInconsistency,
  type Severity,
  type WarningCategory,
  CATEGORY_GROUPS,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_CONFIG,
  WARNING_GROUP_CONFIG,
  SEVERITY_COLORS,
  SEVERITY_ORDER,
} from "./types";
import { WarningLoansDialog } from "./WarningLoansDialog";

const SEVERITY_ICONS: Record<Severity, typeof AlertCircle> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
};

interface WarningsViewProps {
  warnings: DataQualityWarning[];
  groupedSummary: Record<string, GroupedWarningSummary>;
  statusInconsistencies: StatusInconsistency[];
  tenantId: string | null;
}

function CategoryHeader({
  category,
  warnings,
  isOpen,
  onToggle,
}: {
  category: WarningCategory;
  warnings: DataQualityWarning[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const config = CATEGORY_CONFIG[category];
  const groups = CATEGORY_GROUPS[category];
  const critical = warnings.filter((w) => w.severity === "critical").reduce((s, w) => s + w.count, 0);
  const warning = warnings.filter((w) => w.severity === "warning").reduce((s, w) => s + w.count, 0);
  const info = warnings.filter((w) => w.severity === "info").reduce((s, w) => s + w.count, 0);
  const total = critical + warning + info;

  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between p-4 rounded-lg border ${config.borderColor} ${config.bgColor} hover:opacity-90 transition-opacity text-left`}
    >
      <div className="flex items-center gap-3">
        {isOpen ? (
          <ChevronDown className={`h-4 w-4 ${config.color}`} />
        ) : (
          <ChevronRight className={`h-4 w-4 ${config.color}`} />
        )}
        <div>
          <div className={`font-semibold text-sm ${config.color}`}>{category}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {CATEGORY_DESCRIPTIONS[category]}
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {groups.join(" · ")}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        {total === 0 ? (
          <Badge variant="secondary" className="text-slate-500">No issues</Badge>
        ) : (
          <>
            {critical > 0 && (
              <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                {critical.toLocaleString()} critical
              </Badge>
            )}
            {warning > 0 && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {warning.toLocaleString()} warnings
              </Badge>
            )}
            {info > 0 && (
              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                {info.toLocaleString()} info
              </Badge>
            )}
          </>
        )}
      </div>
    </button>
  );
}

interface WarningTableProps {
  warnings: DataQualityWarning[];
  onViewLoans: (warning: DataQualityWarning) => void;
}

function WarningTable({ warnings, onViewLoans }: WarningTableProps) {
  if (warnings.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        No issues found in this category — looking good!
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Severity</TableHead>
          <TableHead className="w-36">Group</TableHead>
          <TableHead>Check</TableHead>
          <TableHead className="w-36">Field</TableHead>
          <TableHead className="text-right w-24">Count</TableHead>
          <TableHead className="text-right w-28">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...warnings]
          .sort((a, b) => {
            if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity])
              return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
            return b.count - a.count;
          })
          .map((w) => {
            const SeverityIcon = SEVERITY_ICONS[w.severity];
            const groupConfig = WARNING_GROUP_CONFIG[w.group];
            return (
              <TableRow key={w.id}>
                <TableCell>
                  <Badge className={SEVERITY_COLORS[w.severity]}>
                    <SeverityIcon className="h-3 w-3 mr-1" />
                    {w.severity}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span
                    className={`text-xs px-2 py-1 rounded ${groupConfig?.bgColor || ""} ${groupConfig?.color || ""}`}
                  >
                    {w.group}
                  </span>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white text-sm">{w.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{w.description}</p>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                  {w.field.replace(/_/g, " ")}
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`font-semibold text-sm ${
                      w.severity === "critical"
                        ? "text-rose-600 dark:text-rose-400"
                        : w.severity === "warning"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-blue-600 dark:text-blue-400"
                    }`}
                  >
                    {w.count.toLocaleString()}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => onViewLoans(w)}>
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    View
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
      </TableBody>
    </Table>
  );
}

const CATEGORIES: WarningCategory[] = ["Loan Lifecycle", "Compliance", "Data Integrity"];

export function WarningsView({
  warnings,
  groupedSummary,
  statusInconsistencies,
  tenantId,
}: WarningsViewProps) {
  const [openCategories, setOpenCategories] = useState<Set<WarningCategory>>(
    new Set(["Loan Lifecycle", "Compliance", "Data Integrity"])
  );
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [selectedWarning, setSelectedWarning] = useState<DataQualityWarning | null>(null);
  const [loansDialogOpen, setLoansDialogOpen] = useState(false);

  const toggleCategory = (cat: WarningCategory) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleViewLoans = (warning: DataQualityWarning) => {
    setSelectedWarning(warning);
    setLoansDialogOpen(true);
  };

  const filteredWarnings = warnings.filter((w) => {
    if (severityFilter !== "all" && w.severity !== severityFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.field.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalIssues = warnings.reduce((s, w) => s + w.count, 0);

  return (
    <div className="space-y-4">
      {statusInconsistencies.length > 0 && (
        <Alert className="border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20">
          <AlertCircle className="h-4 w-4 text-rose-600" />
          <AlertDescription>
            <strong className="text-rose-700 dark:text-rose-300">
              {statusInconsistencies.reduce((s, i) => s + i.count, 0)} status inconsistencies detected
            </strong>
            <span className="text-slate-600 dark:text-slate-400 ml-2">
              — active loans with funding dates, funded loans without dates, etc. See Loan Lifecycle below.
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1">
              <Input
                placeholder="Search checks by name, field, or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-4"
              />
            </div>
            <Select value={severityFilter} onValueChange={(v: Severity | "all") => setSeverityFilter(v)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            {(search || severityFilter !== "all") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSearch(""); setSeverityFilter("all"); }}
              >
                Clear
              </Button>
            )}
            <span className="text-sm text-slate-500 whitespace-nowrap">
              {totalIssues.toLocaleString()} total issues
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Category sections */}
      <div className="space-y-3">
        {CATEGORIES.map((category) => {
          const groups = CATEGORY_GROUPS[category];
          const categoryWarnings = filteredWarnings.filter((w) => groups.includes(w.group));
          const isOpen = openCategories.has(category);

          return (
            <div key={category}>
              <CategoryHeader
                category={category}
                warnings={categoryWarnings}
                isOpen={isOpen}
                onToggle={() => toggleCategory(category)}
              />

              {isOpen && (
                <Card className="mt-1 rounded-tl-none rounded-tr-none border-t-0">
                  <CardContent className="p-0">
                    <WarningTable warnings={categoryWarnings} onViewLoans={handleViewLoans} />
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })}
      </div>

      <WarningLoansDialog
        open={loansDialogOpen}
        onClose={() => setLoansDialogOpen(false)}
        warning={selectedWarning}
        tenantId={tenantId}
      />
    </div>
  );
}

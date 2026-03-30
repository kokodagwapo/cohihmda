import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Info } from "lucide-react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  type EstimatedClosingsDateRangeType,
  useEstimatedClosingsRiskData,
} from "@/hooks/useEstimatedClosingsRiskData";

interface EstimatedClosingsRiskViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

type SortDirection = "asc" | "desc";
type SortConfig = { key: string; direction: SortDirection };

const PIE_COLORS = ["#94a3b8", "#ef4444", "#3b82f6", "#10b981"];
const KPI_DESCRIPTIONS: Record<string, string> = {
  totalActivePipeline:
    "Count of active loans using the canonical site definition: Active Loan status, application date present, and not archived.",
  ecdEmptyOrAfterThisMonth:
    "Active and unfunded loans where ECD is blank or after month-end. This mirrors the Qlik expression using date fields.",
  remainingToFund:
    "Active and unfunded loans with estimated closing date in the current month and not already past today.",
  fundedThisMonth:
    "Loans with a funding date in the current calendar month.",
  maxPossibleFunding:
    "Funded this month plus remaining to fund.",
  fundingYtdUnits:
    "Loans funded from Jan 1 through today in the current year.",
  unitsLastMonthVsPriorPct:
    "Percent change in funded units: (last month - prior month) / prior month.",
  volumeLastMonthVsPriorPct:
    "Percent change in funded volume: (last month - prior month) / prior month.",
};

function KpiLabel({ label, description }: { label: string; description: string }) {
  return (
    <div className="inline-flex items-center gap-1">
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label={`About ${label}`}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {description}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Previous calendar month label, e.g. 2026-Feb (matches backend prev_month window). */
function formatPrevMonthYearMon(reference: Date = new Date()): string {
  const d = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  const y = d.getFullYear();
  const mon = d.toLocaleString("en-US", { month: "short" });
  return `${y}-${mon}`;
}

function formatCurrency(value: number | null | undefined) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function formatBooleanish(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const normalized = String(value).trim().toLowerCase();
  if (["true", "t", "1", "y", "yes"].includes(normalized)) return "Yes";
  if (["false", "f", "0", "n", "no"].includes(normalized)) return "No";
  return String(value);
}

export function EstimatedClosingsRiskView({
  selectedTenantId,
  selectedChannel,
}: EstimatedClosingsRiskViewProps) {
  const [dateRangeType, setDateRangeType] = useState<EstimatedClosingsDateRangeType>("calendar_days");
  const [complexitySort, setComplexitySort] = useState<SortConfig>({ key: "sortOrder", direction: "asc" });
  const [stageSort, setStageSort] = useState<SortConfig>({ key: "sortOrder", direction: "asc" });
  const [detailSort, setDetailSort] = useState<SortConfig>({ key: "loanNumber", direction: "asc" });
  const { data, loading, error } = useEstimatedClosingsRiskData({
    tenantId: selectedTenantId,
    channelGroup: selectedChannel,
    dateRangeType,
  });

  const kpis = data?.kpis;
  const complexityBars = data?.maxPossibleFundingByComplexity ?? [];
  const pieData = data?.activePipelineEcdSlices ?? [];
  const prevMonthYearMon = useMemo(() => formatPrevMonthYearMon(), []);
  const prevMonthUnitsDescription = `Loans funded in ${prevMonthYearMon} (funding date in that calendar month).`;
  const prevMonthVolumeDescription = `Sum of loan amount for loans funded in ${prevMonthYearMon} (funding date in that calendar month).`;

  const complexityTotals = useMemo(() => {
    const rows = data?.remainingToFundByComplexity ?? [];
    const units = rows.reduce((sum, row) => sum + row.unitsRemainingToFund, 0);
    return { pooledFallout: data?.historicalFalloutPooled13Months ?? null, units };
  }, [data?.remainingToFundByComplexity, data?.historicalFalloutPooled13Months]);

  const processingTotals = useMemo(
    () => ({
      units: (data?.remainingToFundByProcessingStage ?? []).reduce((sum, row) => sum + row.unitsRemainingToFund, 0),
    }),
    [data?.remainingToFundByProcessingStage]
  );

  const sortBy = <T extends Record<string, unknown>>(rows: T[], sort: SortConfig): T[] => {
    const sign = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];

      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) {
        return (an - bn) * sign;
      }

      const ad = new Date(String(av)).getTime();
      const bd = new Date(String(bv)).getTime();
      if (!Number.isNaN(ad) && !Number.isNaN(bd)) {
        return (ad - bd) * sign;
      }

      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * sign;
    });
  };

  const complexityRowsSorted = useMemo(
    () => sortBy((data?.remainingToFundByComplexity ?? []) as Record<string, unknown>[], complexitySort),
    [data?.remainingToFundByComplexity, complexitySort]
  );
  const stageRowsSorted = useMemo(
    () => sortBy((data?.remainingToFundByProcessingStage ?? []) as Record<string, unknown>[], stageSort),
    [data?.remainingToFundByProcessingStage, stageSort]
  );
  const detailRowsSorted = useMemo(
    () => sortBy((data?.detail.rows ?? []) as Record<string, unknown>[], detailSort),
    [data?.detail.rows, detailSort]
  );

  const toggleSort = (key: string, current: SortConfig, setSort: (value: SortConfig) => void) => {
    if (current.key === key) {
      setSort({ key, direction: current.direction === "asc" ? "desc" : "asc" });
      return;
    }
    setSort({ key, direction: "asc" });
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: SortDirection }) => {
    if (!active) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
    return dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Estimated Closings and Risk Analysis</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Active pipeline and funding readiness using Estimated Closing Date (ECD).
          </p>
        </div>
        <div className="w-full sm:w-60">
          <Select value={dateRangeType} onValueChange={(v) => setDateRangeType(v as EstimatedClosingsDateRangeType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="calendar_days">Calendar Days</SelectItem>
              <SelectItem value="business_days">Business Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-600 dark:text-slate-300">Loading dashboard data...</div>}
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      {kpis && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Total Active Pipeline" description={KPI_DESCRIPTIONS.totalActivePipeline} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.totalActivePipeline.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="ECD Empty or After This Month" description={KPI_DESCRIPTIONS.ecdEmptyOrAfterThisMonth} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.ecdEmptyOrAfterThisMonth.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Remaining to Fund This Month" description={KPI_DESCRIPTIONS.remainingToFund} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.remainingToFund.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Funded This Month" description={KPI_DESCRIPTIONS.fundedThisMonth} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.fundedThisMonth.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Max Possible Funding" description={KPI_DESCRIPTIONS.maxPossibleFunding} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.maxPossibleFunding.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Funding YTD Units" description={KPI_DESCRIPTIONS.fundingYtdUnits} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.fundingYtdUnits.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label={`${prevMonthYearMon} — Actual (units)`} description={prevMonthUnitsDescription} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.prevMonthActualUnits.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label={`${prevMonthYearMon} — Actual ($)`} description={prevMonthVolumeDescription} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatCurrency(kpis.prevMonthActualVolume)}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Units Last Month vs Prior" description={KPI_DESCRIPTIONS.unitsLastMonthVsPriorPct} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatPercent(kpis.unitsLastMonthVsPriorPct)}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Volume Last Month vs Prior" description={KPI_DESCRIPTIONS.volumeLastMonthVsPriorPct} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatPercent(kpis.volumeLastMonthVsPriorPct)}</CardContent></Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Active Pipeline, Estimated Closing Dates</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="count" nameKey="label" outerRadius={95} label={(entry) => `${entry.label}: ${entry.count}`} >
                  {pieData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Max Possible Funding, by Complexity</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={complexityBars}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucketLabel" />
                <YAxis />
                <RechartsTooltip />
                <Bar dataKey="funded" stackId="a" fill="#3b82f6" name="Funded" />
                <Bar dataKey="notFunded" stackId="a" fill="#ef4444" name="Not Funded" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Remaining to Fund, Experience by Complexity</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button className="inline-flex items-center gap-1" onClick={() => toggleSort("complexityGroup", complexitySort, setComplexitySort)}>
                      Complexity Group
                      <SortIcon active={complexitySort.key === "complexityGroup"} dir={complexitySort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("unitsRemainingToFund", complexitySort, setComplexitySort)}>
                      Units Remaining
                      <SortIcon active={complexitySort.key === "unitsRemainingToFund"} dir={complexitySort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("historicalFalloutLast13Months", complexitySort, setComplexitySort)}>
                      Historical % Fallout (13M)
                      <SortIcon active={complexitySort.key === "historicalFalloutLast13Months"} dir={complexitySort.direction} />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {complexityRowsSorted.map((row) => (
                  <TableRow key={String(row.sortOrder)}>
                    <TableCell>{String(row.complexityGroup)}</TableCell>
                    <TableCell className="text-right">{Number(row.unitsRemainingToFund).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{formatPercent(toNumberOrNull(row.historicalFalloutLast13Months))}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Totals</TableCell>
                  <TableCell className="text-right font-semibold">{complexityTotals.units.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPercent(complexityTotals.pooledFallout)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Remaining to Fund, Experience by Current Processing Stage</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button className="inline-flex items-center gap-1" onClick={() => toggleSort("processingStage", stageSort, setStageSort)}>
                      Processing Stage
                      <SortIcon active={stageSort.key === "processingStage"} dir={stageSort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("unitsRemainingToFund", stageSort, setStageSort)}>
                      Units Remaining
                      <SortIcon active={stageSort.key === "unitsRemainingToFund"} dir={stageSort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("historicalFallout", stageSort, setStageSort)}>
                      Historical Fallout
                      <SortIcon active={stageSort.key === "historicalFallout"} dir={stageSort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("historicalStatusToFundDays", stageSort, setStageSort)}>
                      Historical Status to Fund Days
                      <SortIcon active={stageSort.key === "historicalStatusToFundDays"} dir={stageSort.direction} />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageRowsSorted.map((row) => (
                  <TableRow key={String(row.sortOrder)}>
                    <TableCell>{String(row.processingStage)}</TableCell>
                    <TableCell className="text-right">{Number(row.unitsRemainingToFund).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{formatPercent(toNumberOrNull(row.historicalFallout))}</TableCell>
                    <TableCell className="text-right">
                      {row.historicalStatusToFundDays != null ? Number(row.historicalStatusToFundDays).toFixed(1) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card
        data-loan-details-table
        className="rounded-xl border overflow-hidden border-slate-200/60 bg-white"
      >
        <CardHeader>
          <CardTitle className="text-sm">Loan Detail for Max Possible Funding</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[620px] border-t border-slate-200 dark:border-slate-700">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <TableRow>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("loanNumber", detailSort, setDetailSort)}>Loan Number<SortIcon active={detailSort.key === "loanNumber"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("complexityGroup", detailSort, setDetailSort)}>Complexity Group<SortIcon active={detailSort.key === "complexityGroup"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("complexity", detailSort, setDetailSort)}>Complexity<SortIcon active={detailSort.key === "complexity"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("closingProjectionGroup", detailSort, setDetailSort)}>Closing Projection<SortIcon active={detailSort.key === "closingProjectionGroup"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("units", detailSort, setDetailSort)}>Units<SortIcon active={detailSort.key === "units"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("volume", detailSort, setDetailSort)}>Volume<SortIcon active={detailSort.key === "volume"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("occupancyType", detailSort, setDetailSort)}>Occupancy Type<SortIcon active={detailSort.key === "occupancyType"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("fico", detailSort, setDetailSort)}>FICO<SortIcon active={detailSort.key === "fico"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("ltv", detailSort, setDetailSort)}>LTV<SortIcon active={detailSort.key === "ltv"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("beDti", detailSort, setDetailSort)}>BE DTI<SortIcon active={detailSort.key === "beDti"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("borrowerSelfEmployed", detailSort, setDetailSort)}>Borrower Self Employed<SortIcon active={detailSort.key === "borrowerSelfEmployed"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("qmLoanType", detailSort, setDetailSort)}>QM Loan Type<SortIcon active={detailSort.key === "qmLoanType"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("propertyType", detailSort, setDetailSort)}>Property Type<SortIcon active={detailSort.key === "propertyType"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("loanProgram", detailSort, setDetailSort)}>Loan Program<SortIcon active={detailSort.key === "loanProgram"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("appToDispositionDays", detailSort, setDetailSort)}>App to Disposition Days<SortIcon active={detailSort.key === "appToDispositionDays"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("currentLoanStatus", detailSort, setDetailSort)}>Current Loan Status<SortIcon active={detailSort.key === "currentLoanStatus"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("currentStatusDate", detailSort, setDetailSort)}>Current Status Date<SortIcon active={detailSort.key === "currentStatusDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("lastCompletedMilestone", detailSort, setDetailSort)}>Last Completed Milestone<SortIcon active={detailSort.key === "lastCompletedMilestone"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("loanFolder", detailSort, setDetailSort)}>Loan Folder<SortIcon active={detailSort.key === "loanFolder"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("applicationDate", detailSort, setDetailSort)}>Application Date<SortIcon active={detailSort.key === "applicationDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("fundingDate", detailSort, setDetailSort)}>Funding Date<SortIcon active={detailSort.key === "fundingDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("lockDate", detailSort, setDetailSort)}>Lock Date<SortIcon active={detailSort.key === "lockDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("investorLockDate", detailSort, setDetailSort)}>Investor Lock Date<SortIcon active={detailSort.key === "investorLockDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("estimatedClosingDate", detailSort, setDetailSort)}>Estimated Closing Date<SortIcon active={detailSort.key === "estimatedClosingDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("ctcDate", detailSort, setDetailSort)}>CTC Date<SortIcon active={detailSort.key === "ctcDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("uwFinalApprovalDate", detailSort, setDetailSort)}>UW Final Approval Date<SortIcon active={detailSort.key === "uwFinalApprovalDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("deniedDate", detailSort, setDetailSort)}>Denied Date<SortIcon active={detailSort.key === "deniedDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("conditionalApprovalDate", detailSort, setDetailSort)}>Conditional Approval Date<SortIcon active={detailSort.key === "conditionalApprovalDate"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("branch", detailSort, setDetailSort)}>Branch<SortIcon active={detailSort.key === "branch"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("loanOfficer", detailSort, setDetailSort)}>Loan Officer<SortIcon active={detailSort.key === "loanOfficer"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("processor", detailSort, setDetailSort)}>Processor<SortIcon active={detailSort.key === "processor"} dir={detailSort.direction} /></button></TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => toggleSort("underwriter", detailSort, setDetailSort)}>Underwriter<SortIcon active={detailSort.key === "underwriter"} dir={detailSort.direction} /></button></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detailRowsSorted.map((row, idx) => (
                <TableRow key={`${row.loanNumber as string}-${idx}`}>
                  <TableCell>{String(row.loanNumber ?? "")}</TableCell>
                  <TableCell>{String(row.complexityGroup ?? "")}</TableCell>
                  <TableCell>{row.complexity != null ? Number(row.complexity).toFixed(1) : "-"}</TableCell>
                  <TableCell>{String(row.closingProjectionGroup ?? "")}</TableCell>
                  <TableCell>{Number(row.units ?? 1).toLocaleString()}</TableCell>
                  <TableCell>{formatCurrency(Number(row.volume ?? 0))}</TableCell>
                  <TableCell>{String(row.occupancyType ?? "")}</TableCell>
                  <TableCell>{row.fico != null ? Number(row.fico).toLocaleString() : "-"}</TableCell>
                  <TableCell>{row.ltv != null ? Number(row.ltv).toFixed(1) : "-"}</TableCell>
                  <TableCell>{row.beDti != null ? Number(row.beDti).toFixed(1) : "-"}</TableCell>
                  <TableCell>{formatBooleanish(row.borrowerSelfEmployed)}</TableCell>
                  <TableCell>{String(row.qmLoanType ?? "")}</TableCell>
                  <TableCell>{String(row.propertyType ?? "")}</TableCell>
                  <TableCell>{String(row.loanProgram ?? "")}</TableCell>
                  <TableCell>{row.appToDispositionDays != null ? Number(row.appToDispositionDays).toLocaleString() : "-"}</TableCell>
                  <TableCell>{String(row.currentLoanStatus ?? "")}</TableCell>
                  <TableCell>{String(row.currentStatusDate ?? "")}</TableCell>
                  <TableCell>{String(row.lastCompletedMilestone ?? "")}</TableCell>
                  <TableCell>{String(row.loanFolder ?? "")}</TableCell>
                  <TableCell>{String(row.applicationDate ?? "")}</TableCell>
                  <TableCell>{String(row.fundingDate ?? "")}</TableCell>
                  <TableCell>{String(row.lockDate ?? "")}</TableCell>
                  <TableCell>{String(row.investorLockDate ?? "")}</TableCell>
                  <TableCell>{String(row.estimatedClosingDate ?? "")}</TableCell>
                  <TableCell>{String(row.ctcDate ?? "")}</TableCell>
                  <TableCell>{String(row.uwFinalApprovalDate ?? "")}</TableCell>
                  <TableCell>{String(row.deniedDate ?? "")}</TableCell>
                  <TableCell>{String(row.conditionalApprovalDate ?? "")}</TableCell>
                  <TableCell>{String(row.branch ?? "")}</TableCell>
                  <TableCell>{String(row.loanOfficer ?? "")}</TableCell>
                  <TableCell>{String(row.processor ?? "")}</TableCell>
                  <TableCell>{String(row.underwriter ?? "")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30">
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {(data?.detail.total ?? detailRowsSorted.length).toLocaleString()} {(data?.detail.total ?? detailRowsSorted.length) === 1 ? "loan" : "loans"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


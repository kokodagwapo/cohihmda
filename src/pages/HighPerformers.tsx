import React, { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { useHighPerformersData } from "@/hooks/useHighPerformersData";
import type {
  HighPerformersDateType,
  HighPerformersTimePeriod,
  HighPerformerRow,
} from "@/hooks/useHighPerformersData";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/theme-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExportData } from "@/utils/exportUtils";
import { exportDataAsExcel } from "@/utils/exportUtils";
import { Search, Loader2, Download } from "lucide-react";

const DATE_TYPE_OPTIONS: { value: HighPerformersDateType; label: string }[] = [
  { value: "funding_date", label: "Funded Loans" },
  { value: "closing_date", label: "Closed Loans" },
  { value: "application_date", label: "Applications Taken" },
];

const TIME_PERIOD_OPTIONS: {
  value: HighPerformersTimePeriod;
  label: string;
}[] = [
  { value: "mtd", label: "MTD (Month To Date)" },
  { value: "lm", label: "Last Month" },
  { value: "ytd", label: "YTD (Year To Date)" },
  { value: "ly", label: "Last Year" },
  { value: "rolling_13", label: "Rolling 13 Months" },
];

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPct(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const raw = String(val ?? "");
  const s = raw.replace(/\u2014|\u2013/g, "-"); // Use ASCII hyphen for CSV/Excel compatibility
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface RankingsTableProps {
  title: string;
  nameLabel: string;
  rows: HighPerformerRow[];
  searchQuery: string;
  onSearchChange: (v: string) => void;
  loading?: boolean;
  exportFileName?: string;
}

function RankingsTable({
  title,
  nameLabel,
  rows,
  searchQuery,
  onSearchChange,
  loading,
  exportFileName,
}: RankingsTableProps) {
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, searchQuery]);

  const totals = useMemo(() => {
    const units = filtered.reduce((s, r) => s + r.units, 0);
    const volume = filtered.reduce((s, r) => s + r.volume, 0);
    if (units === 0)
      return {
        units: 0,
        volume: 0,
        pctGovt: 0,
        pctConv: 0,
        pctRefi: 0,
        pctPurch: 0,
      };
    const pctGovt =
      filtered.reduce((s, r) => s + r.pctGovt * r.units, 0) / units;
    const pctConv =
      filtered.reduce((s, r) => s + r.pctConv * r.units, 0) / units;
    const pctRefi =
      filtered.reduce((s, r) => s + r.pctRefi * r.units, 0) / units;
    const pctPurch =
      filtered.reduce((s, r) => s + r.pctPurch * r.units, 0) / units;
    return { units, volume, pctGovt, pctConv, pctRefi, pctPurch };
  }, [filtered]);

  const headers = [nameLabel, "Units", "Volume", "Rank", "% Govt", "% Conv", "% Refi", "% Purch"];
  const exportRows = useMemo(() => {
    const dataRows = filtered.map((r) => [
      r.name,
      r.units,
      formatVolume(r.volume),
      r.rank,
      formatPct(r.pctGovt),
      formatPct(r.pctConv),
      formatPct(r.pctRefi),
      formatPct(r.pctPurch),
    ]);
    if (filtered.length > 0) {
      dataRows.push([
        "Totals",
        totals.units,
        formatVolume(totals.volume),
        "-",
        formatPct(totals.pctGovt),
        formatPct(totals.pctConv),
        formatPct(totals.pctRefi),
        formatPct(totals.pctPurch),
      ]);
    }
    return dataRows;
  }, [filtered, totals]);

  const handleDownloadCsv = () => {
    const base = exportFileName ?? title.replace(/[\s/]+/g, "-").toLowerCase();
    const filename = `${base}-${new Date().toISOString().split("T")[0]}.csv`;
    const csvHeader = headers.map(escapeCsvCell).join(",");
    const csvData = exportRows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
    const csv = [csvHeader, csvData].filter(Boolean).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadExcel = async () => {
    const base = exportFileName ?? title.replace(/[\s/]+/g, "-").toLowerCase();
    const filename = `${base}-${new Date().toISOString().split("T")[0]}`;
    const data: ExportData = {
      title,
      tables: [{ name: title, headers, rows: exportRows }],
    };
    await exportDataAsExcel(data, filename);
  };

  return (
    <Card className="border border-slate-200 dark:border-slate-700">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        {exportFileName != null && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5">
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadCsv}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadExcel}>Excel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="flex items-center flex-1 min-w-0 rounded-md border border-input bg-background">
            <Search className="h-4 w-4 shrink-0 text-slate-400 ml-3" aria-hidden />
            <Input
              placeholder={`Search ${nameLabel}...`}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9 text-sm border-0 pl-2 pr-3 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        </div>
        <div className="h-[320px] overflow-auto overflow-x-auto border-t border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shadow-[0_1px_0_0_rgba(0,0,0,0.1)] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.05)]">
                <th className="text-left py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">{nameLabel}</th>
                <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">Units</th>
                <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">Volume</th>
                <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">Rank</th>
                <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">% Govt</th>
                <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">% Conv</th>
                <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">% Refi</th>
                <th className="text-right py-2 px-3 font-medium bg-slate-50 dark:bg-slate-800">% Purch</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Loading...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    No data for this period
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={`${r.name}-${r.rank}`}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                  >
                    <td className="py-2 px-3 font-medium">{r.name}</td>
                    <td className="text-right py-2 px-3">{r.units}</td>
                    <td className="text-right py-2 px-3">
                      {formatVolume(r.volume)}
                    </td>
                    <td className="text-right py-2 px-3">{r.rank}</td>
                    <td className="text-right py-2 px-3">
                      {formatPct(r.pctGovt)}
                    </td>
                    <td className="text-right py-2 px-3">
                      {formatPct(r.pctConv)}
                    </td>
                    <td className="text-right py-2 px-3">
                      {formatPct(r.pctRefi)}
                    </td>
                    <td className="text-right py-2 px-3">
                      {formatPct(r.pctPurch)}
                    </td>
                  </tr>
                ))
              )}
              {!loading && filtered.length > 0 && (
                <tr className="sticky bottom-0 z-10 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium shadow-[0_-1px_0_0_rgba(0,0,0,0.1)] dark:shadow-[0_-1px_0_0_rgba(255,255,255,0.05)]">
                  <td className="py-2 px-3 bg-slate-50 dark:bg-slate-800">Totals</td>
                  <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">{totals.units}</td>
                  <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">
                    {formatVolume(totals.volume)}
                  </td>
                  <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">—</td>
                  <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">
                    {formatPct(totals.pctGovt)}
                  </td>
                  <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">
                    {formatPct(totals.pctConv)}
                  </td>
                  <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">
                    {formatPct(totals.pctRefi)}
                  </td>
                  <td className="text-right py-2 px-3 bg-slate-50 dark:bg-slate-800">
                    {formatPct(totals.pctPurch)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HighPerformers() {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";
  const { selectedChannel } = useChannelStore();
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId ?? user?.tenant_id ?? null;

  const [dateType, setDateType] = useState<HighPerformersDateType>("funding_date");
  const [leftPeriod, setLeftPeriod] = useState<HighPerformersTimePeriod>("mtd");
  const [rightPeriod, setRightPeriod] = useState<HighPerformersTimePeriod>("ytd");
  const [leftBranchSearch, setLeftBranchSearch] = useState("");
  const [leftLOSearch, setLeftLOSearch] = useState("");
  const [rightBranchSearch, setRightBranchSearch] = useState("");
  const [rightLOSearch, setRightLOSearch] = useState("");

  const { data: leftData, loading: leftLoading, error: leftError } = useHighPerformersData(
    dateType,
    leftPeriod,
    { channelGroup: selectedChannel, tenantId }
  );
  const { data: rightData, loading: rightLoading, error: rightError } = useHighPerformersData(
    dateType,
    rightPeriod,
    { channelGroup: selectedChannel, tenantId }
  );
  const hasError = !!leftError || !!rightError;
  const errorMessage = leftError || rightError;

  const leftPeriodLabel =
    TIME_PERIOD_OPTIONS.find((o) => o.value === leftPeriod)?.label ?? leftPeriod;
  const rightPeriodLabel =
    TIME_PERIOD_OPTIONS.find((o) => o.value === rightPeriod)?.label ?? rightPeriod;

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="High Performers - Leaderboards" />
        <main className="relative flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 max-w-[1800px] mx-auto w-full">
            {hasError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  Unable to load data. {errorMessage}
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2 mb-3">
              {DATE_TYPE_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={dateType === opt.value ? "default" : "outline"}
                  size="sm"
                  className="!h-7 !py-0 !min-h-0 px-3 text-sm"
                  onClick={() => setDateType(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 xl:gap-5">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Select
                    value={leftPeriod}
                    onValueChange={(v) => setLeftPeriod(v as HighPerformersTimePeriod)}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Time period" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_PERIOD_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <RankingsTable
                  title={`Branch Rankings ${leftPeriodLabel}`}
                  nameLabel="Branch"
                  rows={leftData.branchRankings}
                  searchQuery={leftBranchSearch}
                  onSearchChange={setLeftBranchSearch}
                  loading={leftLoading}
                  exportFileName="branch-rankings-left"
                />
                <RankingsTable
                  title={`Loan Officer Rankings ${leftPeriodLabel}`}
                  nameLabel="Loan Officer"
                  rows={leftData.loanOfficerRankings}
                  searchQuery={leftLOSearch}
                  onSearchChange={setLeftLOSearch}
                  loading={leftLoading}
                  exportFileName="loan-officer-rankings-left"
                />
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Select
                    value={rightPeriod}
                    onValueChange={(v) => setRightPeriod(v as HighPerformersTimePeriod)}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Time period" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_PERIOD_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <RankingsTable
                  title={`Branch Rankings ${rightPeriodLabel}`}
                  nameLabel="Branch"
                  rows={rightData.branchRankings}
                  searchQuery={rightBranchSearch}
                  onSearchChange={setRightBranchSearch}
                  loading={rightLoading}
                  exportFileName="branch-rankings-right"
                />
                <RankingsTable
                  title={`Loan Officer Rankings ${rightPeriodLabel}`}
                  nameLabel="Loan Officer"
                  rows={rightData.loanOfficerRankings}
                  searchQuery={rightLOSearch}
                  onSearchChange={setRightLOSearch}
                  loading={rightLoading}
                  exportFileName="loan-officer-rankings-right"
                />
              </div>
            </div>
        </main>
      </div>
    </TopTieringLayout>
  );
}

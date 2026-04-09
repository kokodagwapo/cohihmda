import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  RefreshCw,
  Download,
  Building2,
  Users,
  FileText,
  Activity,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";

interface TenantUsageSummary {
  tenant_id: string;
  tenant_name: string;
  total_sessions: number;
  total_users: number;
  total_loans: number;
  active_users_30d: number;
  sessions_by_month: Record<string, number>;
  avg_session_duration_ms: number | null;
  last_session_at: string | null;
  days_since_last_session: number | null;
}

interface UserUsageRow {
  tenant_name: string;
  user_id: string;
  user_email: string | null;
  total_sessions: number;
  avg_session_duration_ms: number | null;
  last_session_at: string | null;
  days_since_last_session: number | null;
  top_pages: string[];
}

interface PageUsageRow {
  tenant_name: string;
  page_path: string;
  total_views: number;
  unique_users: number;
  last_viewed_at: string | null;
  activity_range: string;
}

interface UsageReportData {
  generated_at: string;
  date_range: { start: string; end: string };
  tenants: TenantUsageSummary[];
  users: UserUsageRow[];
  pages: PageUsageRow[];
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const minutes = ms / 60000;
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function recencyBadge(daysAgo: number | null) {
  if (daysAgo == null)
    return (
      <Badge variant="outline" className="font-light text-xs text-slate-400">
        No Activity
      </Badge>
    );
  if (daysAgo <= 7)
    return (
      <Badge className="font-light text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
        {daysAgo}d ago
      </Badge>
    );
  if (daysAgo <= 30)
    return (
      <Badge className="font-light text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-0">
        {daysAgo}d ago
      </Badge>
    );
  if (daysAgo <= 60)
    return (
      <Badge className="font-light text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
        {daysAgo}d ago
      </Badge>
    );
  return (
    <Badge className="font-light text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0">
      {daysAgo}d ago
    </Badge>
  );
}

export const PlatformUsageReport = () => {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<UsageReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState("120");

  const loadData = async (dayCount = days) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.request<UsageReportData>(
        `/api/admin/usage-report?days=${dayCount}`,
      );
      setData(response);
    } catch (err: any) {
      setError(err.message || "Failed to load usage report");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/admin/usage-report/export?days=${days}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("auth_token") || ""}`,
        },
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Cohi_Usage_Report_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "Failed to export report");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    loadData(days);
  }, [days]);

  const sortedMonths = useMemo(() => {
    if (!data) return [];
    const months = new Set<string>();
    for (const t of data.tenants) {
      for (const m of Object.keys(t.sessions_by_month)) months.add(m);
    }
    return Array.from(months).sort();
  }, [data]);

  const totalSessions = data?.tenants.reduce((s, t) => s + t.total_sessions, 0) ?? 0;
  const totalActiveUsers = data?.tenants.reduce((s, t) => s + t.active_users_30d, 0) ?? 0;
  const activeTenants = data?.tenants.filter((t) => t.total_sessions > 0).length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-indigo-200/40 dark:border-slate-700/50 shadow-lg shadow-indigo-500/10">
        <div>
          <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
            Platform Usage Report
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
            Cross-tenant session activity, user engagement, and feature adoption
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={days} onValueChange={(v) => setDays(v)}>
            <SelectTrigger className="w-[140px] h-9 text-sm font-light">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="120">Last 120 days</SelectItem>
              <SelectItem value="180">Last 6 months</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(days)}
            disabled={loading}
            className="h-9"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || loading || !data}
            className="h-9 gap-2"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-light uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="h-3 w-3" />
              Active Tenants
            </CardDescription>
            <CardTitle className="text-3xl font-thin">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              ) : (
                activeTenants
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-400 font-light">
              With at least 1 session in last {days} days
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-light uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3 w-3" />
              Total Sessions
            </CardDescription>
            <CardTitle className="text-3xl font-thin">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              ) : (
                totalSessions.toLocaleString()
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-400 font-light">
              Across all tenants
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-light uppercase tracking-wider flex items-center gap-1.5">
              <Users className="h-3 w-3" />
              Active Users (30d)
            </CardDescription>
            <CardTitle className="text-3xl font-thin">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              ) : (
                totalActiveUsers
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-400 font-light">
              Distinct users with sessions in last 30 days
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main content tabs */}
      {error ? (
        <Card>
          <CardContent className="py-8">
            <div className="flex items-center gap-2 text-sm text-red-500 justify-center">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              <p className="text-sm text-slate-400 font-light">
                Generating usage report across all tenants...
              </p>
            </div>
          </CardContent>
        </Card>
      ) : data ? (
        <Tabs defaultValue="tenants">
          <TabsList>
            <TabsTrigger value="tenants" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              By Client
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              By User
            </TabsTrigger>
            <TabsTrigger value="pages" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              By Page
            </TabsTrigger>
          </TabsList>

          {/* By Client */}
          <TabsContent value="tenants">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-light flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-indigo-500" />
                  Sessions by Client
                </CardTitle>
                <CardDescription className="font-light">
                  {data.tenants.length} tenants &middot; {sortedMonths.length > 0 ? `${sortedMonths[0]} → ${sortedMonths[sortedMonths.length - 1]}` : "no data"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-light text-xs min-w-[180px]">
                          Client
                        </TableHead>
                        {sortedMonths.map((m) => (
                          <TableHead
                            key={m}
                            className="font-light text-xs text-right"
                          >
                            {new Date(m + "-01").toLocaleDateString("en-US", {
                              month: "short",
                              year: "2-digit",
                            })}
                          </TableHead>
                        ))}
                        <TableHead className="font-light text-xs text-right">
                          Total
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Users
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Avg Duration
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Last Session
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Recency
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.tenants.map((t) => (
                        <TableRow
                          key={t.tenant_id}
                          className={
                            t.total_sessions === 0 ? "opacity-40" : ""
                          }
                        >
                          <TableCell className="font-light text-sm text-slate-700 dark:text-slate-300">
                            {t.tenant_name}
                          </TableCell>
                          {sortedMonths.map((m) => (
                            <TableCell
                              key={m}
                              className="text-right font-light text-sm text-slate-500"
                            >
                              {t.sessions_by_month[m] || "—"}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-medium text-sm">
                            {t.total_sessions}
                          </TableCell>
                          <TableCell className="text-right font-light text-sm text-slate-500">
                            {t.active_users_30d}
                          </TableCell>
                          <TableCell className="text-right font-light text-sm text-slate-500">
                            {formatDuration(t.avg_session_duration_ms)}
                          </TableCell>
                          <TableCell className="text-right font-light text-sm text-slate-500">
                            {formatDate(t.last_session_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            {recencyBadge(t.days_since_last_session)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* By User */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-light flex items-center gap-2">
                  <Users className="h-4 w-4 text-purple-500" />
                  Sessions by User
                </CardTitle>
                <CardDescription className="font-light">
                  {data.users.length} users across all tenants
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-light text-xs min-w-[160px]">
                          Client
                        </TableHead>
                        <TableHead className="font-light text-xs min-w-[200px]">
                          User
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Sessions
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Avg Duration
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Last Session
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Recency
                        </TableHead>
                        <TableHead className="font-light text-xs">
                          Top Pages
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.users.map((u) => (
                        <TableRow key={`${u.tenant_name}:${u.user_id}`}>
                          <TableCell className="font-light text-sm text-slate-700 dark:text-slate-300">
                            {u.tenant_name}
                          </TableCell>
                          <TableCell className="font-light text-sm text-slate-600 dark:text-slate-400">
                            {u.user_email ?? u.user_id}
                          </TableCell>
                          <TableCell className="text-right font-medium text-sm">
                            {u.total_sessions}
                          </TableCell>
                          <TableCell className="text-right font-light text-sm text-slate-500">
                            {formatDuration(u.avg_session_duration_ms)}
                          </TableCell>
                          <TableCell className="text-right font-light text-sm text-slate-500">
                            {formatDate(u.last_session_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            {recencyBadge(u.days_since_last_session)}
                          </TableCell>
                          <TableCell className="font-light text-xs text-slate-400 max-w-[200px] truncate">
                            {u.top_pages.length > 0
                              ? u.top_pages.join(", ")
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* By Page */}
          <TabsContent value="pages">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-light flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-500" />
                  Pages by Client
                </CardTitle>
                <CardDescription className="font-light">
                  {data.pages.length} page/client combinations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-light text-xs min-w-[160px]">
                          Client
                        </TableHead>
                        <TableHead className="font-light text-xs min-w-[200px]">
                          Page
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Views
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Unique Users
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Last Viewed
                        </TableHead>
                        <TableHead className="font-light text-xs text-right">
                          Activity Range
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.pages.map((p, i) => (
                        <TableRow key={`${p.tenant_name}:${p.page_path}:${i}`}>
                          <TableCell className="font-light text-sm text-slate-700 dark:text-slate-300">
                            {p.tenant_name}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400 max-w-[280px] truncate">
                            {p.page_path || "/"}
                          </TableCell>
                          <TableCell className="text-right font-medium text-sm">
                            {p.total_views}
                          </TableCell>
                          <TableCell className="text-right font-light text-sm text-slate-500">
                            {p.unique_users}
                          </TableCell>
                          <TableCell className="text-right font-light text-sm text-slate-500">
                            {formatDate(p.last_viewed_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={`font-light text-xs ${
                                p.activity_range === "< 7 Days"
                                  ? "border-emerald-300 text-emerald-600"
                                  : p.activity_range === "< 30 Days"
                                    ? "border-blue-300 text-blue-600"
                                    : p.activity_range === "31-60 Days"
                                      ? "border-amber-300 text-amber-600"
                                      : "border-red-300 text-red-600"
                              }`}
                            >
                              {p.activity_range}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : null}
    </motion.div>
  );
};

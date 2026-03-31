import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Loader2, RefreshCw, Coins, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

interface TenantUsage {
  tenant_id: string;
  tenant_name: string;
  total_cost: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface UsageResponse {
  usage: TenantUsage[];
  days: number;
  start_date: string;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export const ApiUsageSection = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState("30");

  const loadData = async (dayCount = days) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.request<UsageResponse>(
        `/api/admin/usage/by-tenant?days=${dayCount}`
      );
      setData(response);
    } catch (err: any) {
      setError(err.message || "Failed to load usage data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(days);
  }, [days]);

  const totalCost = data?.usage.reduce((s, r) => s + r.total_cost, 0) ?? 0;
  const totalTokens = data?.usage.reduce((s, r) => s + r.total_tokens, 0) ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-gray-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-slate-200/40 dark:border-slate-700/50 shadow-lg shadow-slate-500/10">
        <div>
          <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
            API Usage
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
            Per-tenant OpenAI token consumption and estimated cost
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={days} onValueChange={(v) => setDays(v)}>
            <SelectTrigger className="w-[120px] h-9 text-sm font-light">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
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
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-light uppercase tracking-wider">
              Total Estimated Cost
            </CardDescription>
            <CardTitle className="text-3xl font-thin">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              ) : (
                formatCost(totalCost)
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-400 font-light">Last {days} days across all tenants</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-light uppercase tracking-wider">
              Total Tokens Used
            </CardDescription>
            <CardTitle className="text-3xl font-thin">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              ) : (
                formatTokens(totalTokens)
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-400 font-light">Across all LLM calls</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-light flex items-center gap-2">
            <Coins className="h-4 w-4 text-yellow-500" />
            Usage by Tenant
          </CardTitle>
          {data && (
            <CardDescription className="font-light">
              {data.start_date} → today · {data.usage.filter(r => r.total_tokens > 0).length} active tenant{data.usage.filter(r => r.total_tokens > 0).length !== 1 ? "s" : ""}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex items-center gap-2 text-sm text-red-500 py-4">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !data || data.usage.length === 0 ? (
            <p className="text-sm text-slate-400 font-light py-4 text-center">
              No usage data yet. Token tracking begins after migration 107 runs on each tenant DB.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-light text-xs">Tenant</TableHead>
                  <TableHead className="font-light text-xs text-right">Prompt Tokens</TableHead>
                  <TableHead className="font-light text-xs text-right">Completion Tokens</TableHead>
                  <TableHead className="font-light text-xs text-right">Total Tokens</TableHead>
                  <TableHead className="font-light text-xs text-right">Est. Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.usage.map((row) => (
                  <TableRow key={row.tenant_id} className={row.total_tokens === 0 ? "opacity-40" : ""}>
                    <TableCell className="font-light text-sm text-slate-700 dark:text-slate-300">
                      {row.tenant_name}
                    </TableCell>
                    <TableCell className="text-right font-light text-sm text-slate-500">
                      {formatTokens(row.prompt_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-light text-sm text-slate-500">
                      {formatTokens(row.completion_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-light text-sm">
                      {formatTokens(row.total_tokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.total_cost > 0 ? (
                        <Badge
                          className={`font-light text-xs ${
                            row.total_cost > 1
                              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0"
                              : row.total_cost > 0.1
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0"
                          }`}
                        >
                          {formatCost(row.total_cost)}
                        </Badge>
                      ) : (
                        <span className="text-slate-300 text-xs font-light">$0.00</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};

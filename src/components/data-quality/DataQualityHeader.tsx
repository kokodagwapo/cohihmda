import { AlertCircle, BarChart3, FileWarning, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DataQualityMetrics } from "./types";

interface DataQualityHeaderProps {
  metrics: DataQualityMetrics | null;
  onRefresh: () => void;
  refreshing: boolean;
}

export function DataQualityHeader({
  metrics,
  onRefresh,
  refreshing,
}: DataQualityHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-light text-slate-900 dark:text-white">
            Data Quality
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Monitor loan data integrity, compliance gaps, and field coverage across your pipeline
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {metrics && (
        <Card>
          <CardContent className="p-5">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-4">
                <div
                  className={`p-3 rounded-xl ${
                    metrics.quality_score >= 90
                      ? "bg-emerald-100 dark:bg-emerald-900/30"
                      : metrics.quality_score >= 70
                      ? "bg-amber-100 dark:bg-amber-900/30"
                      : "bg-rose-100 dark:bg-rose-900/30"
                  }`}
                >
                  <BarChart3
                    className={`h-6 w-6 ${
                      metrics.quality_score >= 90
                        ? "text-emerald-600 dark:text-emerald-400"
                        : metrics.quality_score >= 70
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Quality Score</p>
                  <p
                    className={`text-2xl font-semibold ${
                      metrics.quality_score >= 90
                        ? "text-emerald-700 dark:text-emerald-400"
                        : metrics.quality_score >= 70
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-rose-700 dark:text-rose-400"
                    }`}
                  >
                    {metrics.quality_score}%
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <AlertCircle className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Total Issues</p>
                  <p className="text-2xl font-semibold text-slate-900 dark:text-white">
                    {metrics.total_issues.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-amber-100 dark:bg-amber-900/30">
                  <FileWarning className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Affected Loans</p>
                  <p className="text-2xl font-semibold text-slate-900 dark:text-white">
                    {metrics.loans_with_issues.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-400">
                    of {metrics.total_loans.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-rose-100 dark:bg-rose-900/30">
                  <XCircle className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Critical Issues</p>
                  <p className="text-2xl font-semibold text-rose-600 dark:text-rose-400">
                    {metrics.critical_issues.toLocaleString()}
                  </p>
                  {metrics.warning_issues > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      +{metrics.warning_issues.toLocaleString()} warnings
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

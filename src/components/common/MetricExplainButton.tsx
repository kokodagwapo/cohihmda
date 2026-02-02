import React, { useState, useCallback } from "react";
import { Info, ExternalLink, Loader2, Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  formula: string;
  sqlQuery?: string;
  defaultDateField?: string;
  notes?: string;
}

interface MetricExplanation {
  summary: string;
  howItWorks: string;
  timeframeLogic: string;
  interpretation: string;
  relatedMetrics: string[];
}

interface MetricExplainButtonProps {
  /** The metric ID to explain */
  metricId: string;
  /** Current value of the metric (optional, for context) */
  currentValue?: string | number;
  /** Current period/timeframe (optional) */
  period?: string;
  /** Custom class name for the button */
  className?: string;
  /** Size variant */
  size?: "sm" | "md";
  /** Whether to show only the icon (no text) */
  iconOnly?: boolean;
  /** Tenant ID for fetching metric details */
  tenantId?: string | null;
}

/**
 * MetricExplainButton - Shows metric formula, description, and AI explanation
 *
 * Displays a popover with:
 * - Metric name and description
 * - Qlik formula reference
 * - SQL implementation (for admins)
 * - AI-powered explanation (on-demand)
 * - Link to metrics catalog (for admins)
 *
 * @example
 * <MetricExplainButton
 *   metricId="avg_cycle_time"
 *   currentValue={32}
 *   period="MTD"
 * />
 */
export function MetricExplainButton({
  metricId,
  currentValue,
  period,
  className,
  size = "sm",
  iconOnly = true,
  tenantId,
}: MetricExplainButtonProps) {
  const [metricDef, setMetricDef] = useState<MetricDefinition | null>(null);
  const [explanation, setExplanation] = useState<MetricExplanation | null>(
    null
  );
  const [isLoadingDef, setIsLoadingDef] = useState(false);
  const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Fetch metric definition when popover opens
  const handleOpenChange = useCallback(
    async (open: boolean) => {
      setIsOpen(open);

      if (open && !metricDef) {
        setIsLoadingDef(true);
        setError(null);

        try {
          // Fetch from metrics catalog
          const params = tenantId ? `?tenant_id=${tenantId}` : "";
          const response = await api.request<{ metrics: MetricDefinition[] }>(
            `/api/metrics/catalog${params}`
          );

          const def = response.metrics?.find((m) => m.id === metricId);
          if (def) {
            setMetricDef(def);
          } else {
            setError(`Metric "${metricId}" not found in catalog`);
          }
        } catch (err: any) {
          setError(err.message || "Failed to load metric definition");
        } finally {
          setIsLoadingDef(false);
        }
      }
    },
    [metricId, metricDef, tenantId]
  );

  // Request AI explanation
  const handleGetExplanation = useCallback(async () => {
    if (!metricDef || isLoadingExplanation) return;

    setIsLoadingExplanation(true);
    setError(null);

    try {
      const params = tenantId ? `?tenant_id=${tenantId}` : "";
      const response = await api.request<MetricExplanation>(
        `/api/metrics/ai/explain${params}`,
        {
          method: "POST",
          body: JSON.stringify({ metricId }),
        }
      );
      setExplanation(response);
    } catch (err: any) {
      setError(err.message || "Failed to get AI explanation");
    } finally {
      setIsLoadingExplanation(false);
    }
  }, [metricDef, metricId, isLoadingExplanation, tenantId]);

  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center justify-center rounded-full transition-colors",
            "text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300",
            "hover:bg-slate-100 dark:hover:bg-slate-800",
            size === "sm" ? "p-1" : "p-1.5",
            className
          )}
          title={`How is ${metricId.replace(/_/g, " ")} calculated?`}
        >
          <Info className={iconSize} />
          {!iconOnly && <span className="ml-1 text-xs">Info</span>}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-80 sm:w-96 max-h-[70vh] overflow-y-auto"
        align="start"
        sideOffset={8}
      >
        {isLoadingDef ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            <span className="ml-2 text-sm text-slate-500">Loading...</span>
          </div>
        ) : error && !metricDef ? (
          <div className="text-sm text-red-500 py-4">{error}</div>
        ) : metricDef ? (
          <div className="space-y-4">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-slate-900 dark:text-white">
                  {metricDef.name}
                </h4>
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {metricDef.category}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {metricDef.description}
              </p>
            </div>

            {/* Current Value */}
            {currentValue !== undefined && (
              <div className="p-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <span className="font-medium">Current Value:</span>{" "}
                  {currentValue}
                  {period && <span className="text-blue-500"> ({period})</span>}
                </p>
              </div>
            )}

            {/* How It's Calculated - only show if formula looks like actual logic, not Qlik syntax */}
            {metricDef.formula && !metricDef.formula.includes("{<") && (
              <div>
                <h5 className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  How It's Calculated
                </h5>
                <code className="block p-2 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 overflow-x-auto">
                  {metricDef.formula}
                </code>
              </div>
            )}

            {/* Date Field */}
            {metricDef.defaultDateField && (
              <div>
                <h5 className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Default Date Filter
                </h5>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Filtered by{" "}
                  <code className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                    {metricDef.defaultDateField}
                  </code>
                </p>
              </div>
            )}

            {/* Notes */}
            {metricDef.notes && (
              <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <span className="font-medium">Note:</span> {metricDef.notes}
                </p>
              </div>
            )}

            {/* AI Explanation Section */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              {explanation ? (
                <div className="space-y-3">
                  <h5 className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-purple-500" />
                    AI Explanation
                  </h5>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {explanation.summary}
                  </p>
                  {explanation.interpretation && (
                    <div>
                      <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">
                        Interpretation
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {explanation.interpretation}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={handleGetExplanation}
                  disabled={isLoadingExplanation}
                >
                  {isLoadingExplanation ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Getting explanation...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 mr-1" />
                      Get AI Explanation
                    </>
                  )}
                </Button>
              )}

              {error && explanation === null && (
                <p className="text-xs text-red-500 mt-2">{error}</p>
              )}
            </div>

            {/* Link to Catalog */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
              <a
                href="/admin?section=metrics-catalog"
                className="inline-flex items-center text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View in Metrics Catalog
                <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export default MetricExplainButton;

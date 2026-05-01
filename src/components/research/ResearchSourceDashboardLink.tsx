import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchVisualizationSource } from "@/types/researchWorkbench";

export function ResearchSourceDashboardLink({
  source,
  className,
  compact,
}: {
  source: ResearchVisualizationSource;
  className?: string;
  /** Smaller text for dense layouts (e.g. evidence tables). */
  compact?: boolean;
}) {
  const label = compact ? source.dashboardLabel : `Open ${source.dashboardLabel}`;
  return (
    <Link
      to={source.dashboardPath}
      state={source.navigateState}
      data-testid="research-lineage-dashboard-link"
      aria-label={`Open ${source.dashboardLabel}`}
      className={cn(
        "inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300",
        compact ? "text-[10px]" : "text-xs",
        className,
      )}
    >
      <ExternalLink className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

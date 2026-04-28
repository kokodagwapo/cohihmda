import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ActorStatus = "Active" | "Inactive" | "Unknown";
export type ActorStatusFilterValue = "all" | "active" | "inactive";

export interface ActorStatusSummary {
  totalActors: number;
  matchedActors: number;
  unmatchedActors: number;
  activeActors: number;
  inactiveActors: number;
  unknownActors: number;
}

const options: Array<{ value: ActorStatusFilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active Only" },
  { value: "inactive", label: "Inactive Only" },
];

export function ActorStatusFilter({
  value,
  onChange,
  summary,
  className,
}: {
  value: ActorStatusFilterValue;
  onChange: (value: ActorStatusFilterValue) => void;
  summary?: ActorStatusSummary | null;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid="actor-status-filter">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
        Actor Status
      </span>
      <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={value === option.value ? "secondary" : "ghost"}
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs"
            onClick={() => onChange(option.value)}
            data-testid={`actor-status-filter-${option.value}`}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {summary && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {summary.activeActors} active · {summary.inactiveActors} inactive ·{" "}
          {summary.unknownActors} unknown
        </span>
      )}
    </div>
  );
}

export function ActorStatusBadge({ status }: { status?: ActorStatus | null }) {
  const value = status || "Unknown";
  const className =
    value === "Active"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
      : value === "Inactive"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";

  return (
    <Badge variant="outline" className={cn("text-[10px] font-medium", className)}>
      {value}
    </Badge>
  );
}

export function formatActorLastLogin(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Never";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

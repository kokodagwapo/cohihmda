import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";

export type ActorStatus = "Active" | "Inactive" | "Removed" | "Unknown";
export type ActorStatusFilterValue = "all" | "active" | "inactive";

export interface ActorStatusSummary {
  totalActors: number;
  matchedActors: number;
  unmatchedActors: number;
  activeActors: number;
  inactiveActors: number;
  removedActors?: number;
  unknownActors: number;
}

const options: Array<{ value: ActorStatusFilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active Only" },
  { value: "inactive", label: "Inactive / Removed" },
];

function ActorStatusHelp() {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground/70 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="What actor status means"
            data-testid="actor-status-help"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
          <p className="font-medium text-popover-foreground mb-1.5">
            How we label actors
          </p>
          <p className="text-muted-foreground mb-2">
            We match each loan-book actor (typically by Encompass login id, then
            display name) against your tenant&apos;s synced{" "}
            <span className="text-popover-foreground">Encompass users</span>{" "}
            from the Encompass Users API. Last login comes from that same
            record when available.
          </p>
          <ul className="list-disc space-y-1 pl-3.5 text-muted-foreground">
            <li>
              <span className="text-popover-foreground">Active</span> — matched
              to an Encompass user who is enabled.
            </li>
            <li>
              <span className="text-popover-foreground">Inactive</span> — matched
              to an Encompass user who is disabled.
            </li>
            <li>
              <span className="text-popover-foreground">Removed</span> — no match
              in the current Encompass user sync (loan history may still list
              them).
            </li>
            <li>
              <span className="text-popover-foreground">Unknown</span> — we
              could not classify (for example branch rows, or no user data to
              match against).
            </li>
          </ul>
          <p className="text-muted-foreground mt-2 border-t border-border pt-2">
            <span className="text-popover-foreground">Inactive / Removed</span>{" "}
            shows both disabled Encompass users and actors with no synced match.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Actor Status
        </span>
        <ActorStatusHelp />
      </div>
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
          {summary.activeActors} active · {summary.inactiveActors} inactive
          {summary.removedActors ? <> · {summary.removedActors} removed</> : null}
          {summary.unknownActors ? <> · {summary.unknownActors} unknown</> : null}
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
        : value === "Removed"
          ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
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

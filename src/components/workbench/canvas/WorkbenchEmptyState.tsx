import {
  ChevronDown,
  LayoutDashboard,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DASHBOARD_SECTION_GROUPS } from "@/components/workbench/workbenchSections";

export type WorkbenchEmptyStateProps = {
  embeddedCohiHidden: boolean;
  onOpenCohi: () => void;
  onQuickPrompt: (prompt: string) => void;
  onAddDashboardSection: (sectionId: string, title: string) => void;
};

const QUICK_PROMPTS = [
  {
    label: "Executive Dashboard",
    prompt:
      "Build me a comprehensive executive dashboard with key KPIs, production trends, and pull-through analysis",
  },
  {
    label: "Monthly Performance",
    prompt:
      "Prepare a monthly performance overview with funded volume, pull-through, turn times, and highlights",
  },
  {
    label: "Pipeline Review",
    prompt:
      "Show me a pipeline review dashboard with active loans by stage, aging analysis, and fallout risk",
  },
  {
    label: "Board Presentation",
    prompt:
      "Create a board-ready presentation with executive summary, key metrics, trends, and recommendations",
  },
] as const;

export function WorkbenchEmptyState({
  embeddedCohiHidden,
  onOpenCohi,
  onQuickPrompt,
  onAddDashboardSection,
}: WorkbenchEmptyStateProps) {
  return (
    <div className="flex items-center justify-center p-8 min-h-[400px]">
      <div className="text-center max-w-2xl w-full">
        {!embeddedCohiHidden ? (
          <>
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-200/60 dark:shadow-violet-900/40">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
              What would you like to review?
            </h3>
            <p className="text-sm text-slate-400 dark:text-slate-500 mb-6">
              Ask Cohi to prepare dashboards, analyze performance, or build
              executive presentations.
            </p>
            <div className="max-w-lg mx-auto mb-6">
              <button
                type="button"
                onClick={onOpenCohi}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md hover:border-violet-300 dark:hover:border-violet-600 hover:shadow-lg transition-all group text-left"
              >
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <span className="flex-1 text-sm text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
                  &ldquo;Prepare a board-ready overview of monthly performance&rdquo;
                </span>
                <MessageSquare className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0 group-hover:text-violet-500 transition-colors" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mb-6">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    onOpenCohi();
                    setTimeout(() => onQuickPrompt(q.prompt), 300);
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-violet-300 dark:hover:border-violet-600 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <LayoutDashboard className="w-7 h-7 text-slate-500 dark:text-slate-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
              Your canvas is empty
            </h3>
            <p className="text-sm text-slate-400 dark:text-slate-500 mb-6">
              Add widgets from the library or browse templates below.
            </p>
          </>
        )}

        <div className="flex items-center justify-center gap-4">
          <div className="h-px flex-1 max-w-[60px] bg-slate-200 dark:bg-slate-700" />
          <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            or browse templates
          </span>
          <div className="h-px flex-1 max-w-[60px] bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="flex gap-2 justify-center mt-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-slate-500 dark:text-slate-400 text-xs"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Dashboard Library
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="center"
              className="w-72 max-h-80 overflow-y-auto"
            >
              {DASHBOARD_SECTION_GROUPS.map((group, gi) => (
                <div key={group.label}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400">
                    {group.label}
                  </DropdownMenuLabel>
                  {group.items.map((section) => {
                    const Icon = section.icon;
                    return (
                      <DropdownMenuItem
                        key={section.id}
                        onClick={() =>
                          onAddDashboardSection(section.id, section.title)
                        }
                        className="gap-2"
                      >
                        <Icon
                          className={`h-4 w-4 ${section.iconClass ?? "text-slate-500"}`}
                        />
                        <span>{section.title}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

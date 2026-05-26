import { useState } from "react";
import { LayoutDashboard, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatWorkbenchSectionKey } from "@/lib/workbench/workbenchChatHandoff";
import type { SuggestDashboardAction, WidgetAction } from "@/types/widgetActions";

export function WorkbenchDashboardSuggestionCard({
  actions,
  disabled,
  onAddSuggested,
  onBuildCustom,
}: {
  actions: SuggestDashboardAction[];
  disabled?: boolean;
  onAddSuggested: (action: SuggestDashboardAction) => void;
  onBuildCustom: (action: SuggestDashboardAction) => void;
}) {
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(new Set());

  if (!actions.length) return null;

  return (
    <div className="px-4 pb-3 space-y-2">
      {actions.map((action) => {
        const key = `${action.sectionKey}:${action.explanation}`;
        if (resolvedKeys.has(key)) return null;
        const sectionLabel = formatWorkbenchSectionKey(action.sectionKey);

        return (
          <div
            key={key}
            className="rounded-xl border border-violet-200/80 dark:border-violet-800/60 bg-violet-50/60 dark:bg-violet-950/25 p-3 space-y-2"
          >
            <div className="flex items-start gap-2">
              <LayoutDashboard className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-violet-900 dark:text-violet-100">
                  Suggested dashboard: {sectionLabel}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  {action.explanation}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={disabled}
                className="h-8 text-xs"
                onClick={() => {
                  setResolvedKeys((prev) => new Set(prev).add(key));
                  onAddSuggested(action);
                }}
              >
                <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
                Add {sectionLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                className="h-8 text-xs"
                onClick={() => {
                  setResolvedKeys((prev) => new Set(prev).add(key));
                  onBuildCustom(action);
                }}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Build custom dashboard
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function filterSuggestDashboardActions(
  actions: WidgetAction[] | undefined,
): SuggestDashboardAction[] {
  if (!actions?.length) return [];
  return actions.filter((a): a is SuggestDashboardAction => a.type === "suggest_dashboard");
}

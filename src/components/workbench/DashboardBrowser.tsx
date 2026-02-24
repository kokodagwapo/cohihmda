/**
 * DashboardBrowser
 *
 * Browsable dashboard catalog inside the Cohi panel.
 * Shows multi-widget dashboard sections as expandable cards with widget lists.
 * Users can add an entire section or individual widgets to the canvas.
 */

import React, { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  PlusCircle,
  MessageSquare,
  BarChart3,
  Hash,
  Table2,
  PieChart,
  Filter,
  TrendingUp,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getWidgetsByGroup } from "@/components/widgets/registry";
import type { WidgetCategory } from "@/components/widgets/registry";
import { DASHBOARD_SECTION_GROUPS } from "./workbenchSections";

// ---------------------------------------------------------------------------
// Icons per category
// ---------------------------------------------------------------------------

const categoryIcons: Record<WidgetCategory, React.ReactNode> = {
  kpi: <Hash className="h-3 w-3 text-blue-500" />,
  chart: <BarChart3 className="h-3 w-3 text-emerald-500" />,
  table: <Table2 className="h-3 w-3 text-amber-500" />,
  distribution: <PieChart className="h-3 w-3 text-violet-500" />,
  funnel: <Filter className="h-3 w-3 text-pink-500" />,
  insight: <TrendingUp className="h-3 w-3 text-cyan-500" />,
};

// Map section item IDs → registry group names for expandable widget lists.
const sectionIdToRegistryGroup: Record<string, string> = {
  companyScorecard: "Company Scorecard",
  salesScorecard: "Sales Scorecard",
  operationsScorecard: "Operations Scorecard",
  operationsTrends: "Operations Trends",
  salesTrends: "Sales Trends",
  creditRiskManagement: "Credit Risk",
  /*   loanFunnel: 'Loan Funnel', */
  workflowConversion: "Workflow Conversion",
  topTieringComparison: "TopTiering Comparison",
  leaderboard: "Leaderboard",
  executiveDashboard: "Executive Dashboard",
  highPerformers: "High Performers",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DashboardBrowserProps {
  onAddWidget: (widgetId: string) => void;
  onAddDashboard: (sectionKey: string) => void;
  onAskCohi: (question: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardBrowser({
  onAddWidget,
  onAddDashboard,
  onAskCohi,
}: DashboardBrowserProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroup((prev) => (prev === groupId ? null : groupId));
  }, []);

  return (
    <div className="space-y-4">
      {DASHBOARD_SECTION_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="flex items-center gap-1.5 px-1 mb-2">
            <LayoutDashboard className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              {group.label}
            </span>
          </div>

          <div className="space-y-1">
            {group.items.map((item) => {
              const registryGroup = sectionIdToRegistryGroup[item.id];
              const widgets = registryGroup
                ? getWidgetsByGroup(registryGroup)
                : [];
              const isExpanded = expandedGroup === item.id;
              const Icon = item.icon;
              const kpiCount = widgets.filter(
                (w) => w.category === "kpi",
              ).length;
              const chartCount = widgets.filter(
                (w) => w.category === "chart",
              ).length;
              const tableCount = widgets.filter(
                (w) => w.category === "table" || w.category === "distribution",
              ).length;

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
                >
                  {/* Section header */}
                  <button
                    onClick={() => toggleGroup(item.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />
                    )}
                    <Icon className={cn("h-4 w-4 shrink-0", item.iconClass)} />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex-1 text-left">
                      {item.title}
                    </span>
                    {widgets.length > 0 && (
                      <span className="text-[10px] text-slate-400">
                        {kpiCount > 0 && `${kpiCount} KPI`}
                        {chartCount > 0 && ` ${chartCount} chart`}
                        {tableCount > 0 && ` ${tableCount} table`}
                      </span>
                    )}
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20">
                      {/* Add entire section button */}
                      <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-7 text-xs gap-1"
                          onClick={() => onAddDashboard(item.id)}
                        >
                          <PlusCircle className="h-3 w-3" />
                          Add entire {item.title}
                        </Button>
                      </div>

                      {/* Individual widgets */}
                      {widgets.length > 0 && (
                        <div className="px-2 py-1 space-y-0.5 max-h-[200px] overflow-y-auto">
                          {widgets.map((widget) => (
                            <div
                              key={widget.id}
                              className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-white dark:hover:bg-slate-800 group transition-colors"
                            >
                              {categoryIcons[widget.category] || (
                                <Hash className="h-3 w-3 text-slate-400" />
                              )}
                              <span className="text-[11px] text-slate-600 dark:text-slate-400 flex-1 truncate">
                                {widget.name}
                              </span>
                              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => onAddWidget(widget.id)}
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                                  title="Add to canvas"
                                >
                                  <PlusCircle className="h-3 w-3 text-emerald-500" />
                                </button>
                                <button
                                  onClick={() =>
                                    onAskCohi(
                                      `Explain how the "${widget.name}" widget works and what data it uses`,
                                    )
                                  }
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                                  title="Ask Cohi about this"
                                >
                                  <MessageSquare className="h-3 w-3 text-indigo-500" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

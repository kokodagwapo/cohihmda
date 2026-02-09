/**
 * DashboardBrowser
 *
 * Browsable dashboard catalog inside the Cohi panel.
 * Shows all 9 dashboard groups as expandable cards with widget lists.
 * Users can:
 *  - Click "Add to canvas" to add a single widget or whole section
 *  - Click "Ask Cohi" to ask the assistant about a widget
 */

import React, { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  PlusCircle,
  MessageSquare,
  BarChart3,
  Hash,
  Table2,
  PieChart,
  LayoutDashboard,
  TrendingUp,
  Shield,
  Trophy,
  Filter,
  Calculator,
  LineChart,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getWidgetGroups,
  getWidgetsByGroup,
} from '@/components/widgets/registry';
import type { WidgetCategory } from '@/components/widgets/registry';

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

const groupIcons: Record<string, React.ReactNode> = {
  'Company Scorecard': <LayoutDashboard className="h-4 w-4 text-indigo-500" />,
  'Sales Scorecard': <TrendingUp className="h-4 w-4 text-emerald-500" />,
  'Operations Scorecard': <Calculator className="h-4 w-4 text-amber-500" />,
  'Operations Trends': <LineChart className="h-4 w-4 text-orange-500" />,
  'Sales Trends': <LineChart className="h-4 w-4 text-teal-500" />,
  'Credit Risk': <Shield className="h-4 w-4 text-red-500" />,
  'Loan Funnel': <Filter className="h-4 w-4 text-purple-500" />,
  'TopTiering Comparison': <Trophy className="h-4 w-4 text-yellow-500" />,
  'Leaderboard': <Trophy className="h-4 w-4 text-blue-500" />,
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
  const groups = getWidgetGroups();

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroup((prev) => (prev === group ? null : group));
  }, []);

  // Map group names to section keys for the suggest_dashboard action
  const groupToSectionKey: Record<string, string> = {
    'Company Scorecard': 'companyScorecard',
    'Sales Scorecard': 'salesScorecard',
    'Operations Scorecard': 'operationsScorecard',
    'Operations Trends': 'operationsTrends',
    'Sales Trends': 'salesTrends',
    'Credit Risk': 'creditRiskManagement',
    'Loan Funnel': 'loanFunnel',
    'TopTiering Comparison': 'topTieringComparison',
    'Leaderboard': 'leaderboard',
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 px-1 mb-2">
        <LayoutDashboard className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          Dashboards
        </span>
      </div>

      {groups.map((group) => {
        const widgets = getWidgetsByGroup(group);
        const isExpanded = expandedGroup === group;
        const sectionKey = groupToSectionKey[group];
        const kpiCount = widgets.filter((w) => w.category === 'kpi').length;
        const chartCount = widgets.filter((w) => w.category === 'chart').length;
        const tableCount = widgets.filter((w) => w.category === 'table' || w.category === 'distribution').length;

        return (
          <div
            key={group}
            className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />
              )}
              {groupIcons[group] || <LayoutDashboard className="h-4 w-4 text-slate-400" />}
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex-1 text-left">
                {group}
              </span>
              <span className="text-[10px] text-slate-400">
                {kpiCount > 0 && `${kpiCount} KPI`}
                {chartCount > 0 && ` ${chartCount} chart`}
                {tableCount > 0 && ` ${tableCount} table`}
              </span>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20">
                {/* Add entire dashboard button */}
                {sectionKey && (
                  <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs gap-1"
                      onClick={() => onAddDashboard(sectionKey)}
                    >
                      <PlusCircle className="h-3 w-3" />
                      Add entire {group}
                    </Button>
                  </div>
                )}

                {/* Individual widgets */}
                <div className="px-2 py-1 space-y-0.5 max-h-[200px] overflow-y-auto">
                  {widgets.map((widget) => (
                    <div
                      key={widget.id}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-white dark:hover:bg-slate-800 group transition-colors"
                    >
                      {categoryIcons[widget.category] || <Hash className="h-3 w-3 text-slate-400" />}
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
                            onAskCohi(`Explain how the "${widget.name}" widget works and what data it uses`)
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

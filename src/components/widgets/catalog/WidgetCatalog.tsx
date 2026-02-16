/**
 * WidgetCatalog – browseable, searchable grid of available widgets.
 *
 * Displayed in the workbench sidebar. Users can click a widget
 * to add it to the canvas.
 */

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Search, BarChart3, Hash, Table2, BarChartHorizontal, Lightbulb, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { getAllWidgets, getWidgetGroups } from '../registry';
import type { WidgetDefinition, WidgetCategory } from '../registry/types';

const CATEGORY_ICON: Record<WidgetCategory, React.ElementType> = {
  kpi: Hash,
  chart: BarChart3,
  table: Table2,
  distribution: BarChartHorizontal,
  funnel: BarChart3,
  insight: Lightbulb,
};

const CATEGORY_COLOR: Record<WidgetCategory, string> = {
  kpi: 'text-blue-500 bg-blue-500/10',
  chart: 'text-emerald-500 bg-emerald-500/10',
  table: 'text-amber-500 bg-amber-500/10',
  distribution: 'text-violet-500 bg-violet-500/10',
  funnel: 'text-rose-500 bg-rose-500/10',
  insight: 'text-sky-500 bg-sky-500/10',
};

export interface WidgetCatalogProps {
  /** Callback when user clicks a widget to add it to canvas */
  onAddWidget: (definition: WidgetDefinition) => void;
  className?: string;
}

export function WidgetCatalog({ onAddWidget, className }: WidgetCatalogProps) {
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(getWidgetGroups()));

  const allWidgets = useMemo(() => getAllWidgets(), []);
  const groups = useMemo(() => getWidgetGroups(), []);

  const filteredWidgets = useMemo(() => {
    if (!search.trim()) return allWidgets;
    const q = search.toLowerCase();
    return allWidgets.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.group.toLowerCase().includes(q) ||
        w.category.toLowerCase().includes(q),
    );
  }, [allWidgets, search]);

  const groupedWidgets = useMemo(() => {
    const map = new Map<string, WidgetDefinition[]>();
    for (const g of groups) map.set(g, []);
    for (const w of filteredWidgets) {
      const list = map.get(w.group);
      if (list) list.push(w);
      else map.set(w.group, [w]);
    }
    // Remove empty groups
    for (const [k, v] of map) {
      if (v.length === 0) map.delete(k);
    }
    return map;
  }, [filteredWidgets, groups]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search widgets…"
          className={cn(
            'w-full pl-8 pr-3 py-2 text-xs rounded-lg border',
            'border-slate-200/80 dark:border-slate-700/80',
            'bg-white dark:bg-slate-900',
            'text-slate-800 dark:text-slate-200',
            'placeholder:text-slate-400 dark:placeholder:text-slate-500',
            'focus:outline-none focus:ring-1 focus:ring-blue-400/50',
          )}
        />
      </div>

      {/* Widget groups */}
      <div className="space-y-1">
        {[...groupedWidgets.entries()].map(([group, widgets]) => {
          const isExpanded = expandedGroups.has(group);
          return (
            <div key={group}>
              {/* Group header */}
              <button
                type="button"
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold',
                  'text-slate-600 dark:text-slate-400',
                  'hover:bg-slate-100/80 dark:hover:bg-slate-800/60 transition-colors',
                )}
                onClick={() => toggleGroup(group)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{group}</span>
                <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                  {widgets.length}
                </span>
              </button>

              {/* Widget items */}
              {isExpanded && (
                <div className="ml-2 mt-0.5 space-y-0.5">
                  {widgets.map((w) => {
                    const Icon = CATEGORY_ICON[w.category] ?? Hash;
                    const colorClass = CATEGORY_COLOR[w.category] ?? 'text-slate-500 bg-slate-500/10';
                    return (
                      <button
                        key={w.id}
                        type="button"
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left',
                          'hover:bg-slate-100/80 dark:hover:bg-slate-800/60 transition-colors group',
                        )}
                        onClick={() => onAddWidget(w)}
                        title={w.description}
                      >
                        <div className={cn('h-5 w-5 rounded flex items-center justify-center shrink-0', colorClass)}>
                          <Icon className="h-3 w-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                            {w.name}
                          </p>
                        </div>
                        <Plus className="h-3 w-3 text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {groupedWidgets.size === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
            No widgets match "{search}"
          </p>
        )}
      </div>
    </div>
  );
}

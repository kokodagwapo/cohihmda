/**
 * ReportTemplateGallery
 *
 * Modal dialog for browsing and selecting report templates.
 * Shows built-in mortgage templates and any custom saved templates.
 */

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  X,
  FileText,
  BarChart3,
  Target,
  Clock,
  Users,
  TrendingUp,
  LayoutDashboard,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BUILTIN_REPORT_TEMPLATES } from './reportTemplates';
import type { ReportTemplate, ReportTemplateCategory } from '@/types/reportTypes';

interface ReportTemplateGalleryProps {
  onClose: () => void;
  onSelectTemplate: (template: ReportTemplate) => void;
  tenantId?: string | null;
}

const CATEGORY_CONFIG: Record<
  ReportTemplateCategory,
  { label: string; icon: React.ComponentType<any>; color: string }
> = {
  pipeline: { label: 'Pipeline', icon: BarChart3, color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/30' },
  production: { label: 'Production', icon: TrendingUp, color: 'text-green-500 bg-green-50 dark:bg-green-900/30' },
  executive: { label: 'Executive', icon: LayoutDashboard, color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/30' },
  'pull-through': { label: 'Pull-Through', icon: Target, color: 'text-orange-500 bg-orange-50 dark:bg-orange-900/30' },
  'turn-times': { label: 'Turn Times', icon: Clock, color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-900/30' },
  scorecard: { label: 'Scorecard', icon: Users, color: 'text-pink-500 bg-pink-50 dark:bg-pink-900/30' },
  custom: { label: 'Custom', icon: Sparkles, color: 'text-slate-500 bg-slate-50 dark:bg-slate-800' },
};

export function ReportTemplateGallery({
  onClose,
  onSelectTemplate,
}: ReportTemplateGalleryProps) {
  const [selectedCategory, setSelectedCategory] = useState<ReportTemplateCategory | 'all'>('all');
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);

  const templates = useMemo(() => {
    if (selectedCategory === 'all') return BUILTIN_REPORT_TEMPLATES;
    return BUILTIN_REPORT_TEMPLATES.filter((t) => t.category === selectedCategory);
  }, [selectedCategory]);

  const categories: (ReportTemplateCategory | 'all')[] = [
    'all',
    'pipeline',
    'production',
    'executive',
    'pull-through',
    'turn-times',
    'scorecard',
  ];

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-8">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Report Templates
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Start with a pre-built mortgage report template
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Category filter */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex gap-1.5 overflow-x-auto">
          {categories.map((cat) => {
            const isAll = cat === 'all';
            const config = isAll ? null : CATEGORY_CONFIG[cat];
            return (
              <button
                key={cat}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap',
                  selectedCategory === cat
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 ring-1 ring-blue-200'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                )}
                onClick={() => setSelectedCategory(cat)}
              >
                {isAll ? 'All Templates' : config?.label || cat}
              </button>
            );
          })}
        </div>

        {/* Template grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => {
              const catConfig = CATEGORY_CONFIG[template.category];
              const Icon = catConfig?.icon || FileText;
              const slideCount = template.definition.slides.length;

              return (
                <button
                  key={template.id}
                  className={cn(
                    'group relative text-left border rounded-xl p-4 transition-all',
                    'hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600',
                    hoveredTemplate === template.id
                      ? 'border-blue-400 shadow-md bg-blue-50/50 dark:bg-blue-900/20'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  )}
                  onMouseEnter={() => setHoveredTemplate(template.id)}
                  onMouseLeave={() => setHoveredTemplate(null)}
                  onClick={() => onSelectTemplate(template)}
                >
                  {/* Icon & category */}
                  <div className="flex items-start justify-between mb-3">
                    <div className={cn('p-2 rounded-lg', catConfig?.color)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700 rounded px-1.5 py-0.5">
                      {slideCount} slides
                    </span>
                  </div>

                  {/* Title & description */}
                  <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100 mb-1">
                    {template.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                    {template.description}
                  </p>

                  {/* Slide preview mini-dots */}
                  <div className="flex gap-1 mt-3">
                    {template.definition.slides.slice(0, 8).map((slide, i) => (
                      <div
                        key={i}
                        className="w-6 h-4 rounded-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center"
                        title={slide.title || slide.layout}
                      >
                        <span className="text-[5px] text-slate-400">
                          {slide.layout === 'title' ? 'T' :
                           slide.layout === 'kpi-grid' ? '#' :
                           slide.layout === 'chart-focus' ? '\u2637' :
                           slide.layout === 'table' ? '\u2261' :
                           'C'}
                        </span>
                      </div>
                    ))}
                    {slideCount > 8 && (
                      <span className="text-[8px] text-slate-400 self-center ml-0.5">
                        +{slideCount - 8}
                      </span>
                    )}
                  </div>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 rounded-xl border-2 border-transparent group-hover:border-blue-400 transition-colors pointer-events-none" />
                </button>
              );
            })}
          </div>

          {templates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <FileText className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-sm">No templates in this category</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
          <span className="text-xs text-slate-400">
            {BUILTIN_REPORT_TEMPLATES.length} built-in templates available
          </span>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ReportTemplateGallery;

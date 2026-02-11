/**
 * SlidePanel
 *
 * Left sidebar panel showing slide thumbnails with reordering,
 * add/delete controls, and slide selection.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Copy, GripVertical, Sparkles } from 'lucide-react';
import type { SlideDefinition, SlideLayout } from '@/types/reportTypes';
import { cn } from '@/lib/utils';

interface SlidePanelProps {
  slides: SlideDefinition[];
  selectedSlideId: string | null;
  onSelectSlide: (slideId: string) => void;
  onAddSlide: (layout?: SlideLayout) => void;
  onDeleteSlide: (slideId: string) => void;
  onDuplicateSlide: (slideId: string) => void;
  onReorderSlides: (slides: SlideDefinition[]) => void;
  /** Called with a targeted AI prompt for a specific slide */
  onAiEnhanceSlide?: (slideId: string, prompt: string) => void;
  /** True while AI is processing a request */
  isAiLoading?: boolean;
}

const LAYOUT_ICONS: Record<SlideLayout, string> = {
  title: 'T',
  content: 'C',
  'two-column': '||',
  'chart-focus': '\u2637',
  table: '\u2261',
  'kpi-grid': '#',
  'section-break': '\u2014',
  comparison: '<>',
  blank: ' ',
};

export function SlidePanel({
  slides,
  selectedSlideId,
  onSelectSlide,
  onAddSlide,
  onDeleteSlide,
  onDuplicateSlide,
  onAiEnhanceSlide,
  isAiLoading,
}: SlidePanelProps) {
  const [aiMenuSlideId, setAiMenuSlideId] = useState<string | null>(null);
  return (
    <div className="w-48 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
          Slides ({slides.length})
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onAddSlide('content')}
          title="Add slide"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Slide list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {slides.map((slide, idx) => (
          <div
            key={slide.id}
            className={cn(
              'group relative rounded-md border cursor-pointer transition-all',
              'hover:border-blue-300 hover:shadow-sm',
              selectedSlideId === slide.id
                ? 'border-blue-500 shadow-md bg-white dark:bg-slate-800 ring-1 ring-blue-500/30'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
            )}
            onClick={() => onSelectSlide(slide.id)}
          >
            {/* Slide thumbnail */}
            <div className="p-1.5">
              {/* Slide number */}
              <div className="flex items-center gap-1 mb-1">
                <GripVertical className="h-3 w-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
                <span className="text-[10px] font-mono text-slate-400">{idx + 1}</span>
                <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-700 rounded px-1">
                  {slide.layout}
                </span>
              </div>

              {/* Mini preview */}
              <div
                className="w-full aspect-[16/10] rounded bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 overflow-hidden p-1.5 flex flex-col"
              >
                {slide.title && (
                  <div className="text-[7px] font-bold text-slate-700 dark:text-slate-200 truncate leading-tight">
                    {slide.title}
                  </div>
                )}
                {slide.subtitle && (
                  <div className="text-[6px] text-slate-500 truncate">
                    {slide.subtitle}
                  </div>
                )}
                <div className="flex-1 flex flex-wrap gap-0.5 mt-0.5 min-h-0">
                  {slide.elements.slice(0, 6).map((el) => (
                    <div
                      key={el.id}
                      className="rounded bg-slate-100 dark:bg-slate-700 flex items-center justify-center"
                      style={{
                        width: `${Math.min(el.position.w / 10 * 100 / 10, 48)}%`,
                        height: Math.max(8, Math.min(el.position.h / 7.5 * 100 / 3, 20)),
                      }}
                    >
                      <span className="text-[5px] text-slate-400">
                        {LAYOUT_ICONS[el.type as SlideLayout] || el.type?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                  ))}
                  {slide.elements.length === 0 && (
                    <div className="w-full h-full flex items-center justify-center text-[6px] text-slate-300">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons on hover */}
            <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {onAiEnhanceSlide && (
                <div className="relative">
                  <button
                    className="p-0.5 rounded bg-white dark:bg-slate-700 shadow-sm hover:bg-indigo-50 dark:hover:bg-indigo-900"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAiMenuSlideId(aiMenuSlideId === slide.id ? null : slide.id);
                    }}
                    title="AI enhance this slide"
                    disabled={isAiLoading}
                  >
                    <Sparkles className="h-3 w-3 text-indigo-500" />
                  </button>
                  {aiMenuSlideId === slide.id && (
                    <div
                      className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50 w-44"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {[
                        { label: 'Add executive narrative', prompt: `For slide "${slide.title || `Slide ${idx + 1}`}" (layout: ${slide.layout}), add a narrative text element at the top of the slide explaining what the data shows, why it matters, and what the audience should take away. Write like a senior mortgage analyst preparing a board memo.` },
                        { label: 'Strengthen narrative', prompt: `For slide "${slide.title || `Slide ${idx + 1}`}" (layout: ${slide.layout}), enhance the existing narrative with more specific data citations, mortgage industry terminology, and forward-looking commentary. Make it board-defensible.` },
                        { label: 'Add speaker notes', prompt: `For slide "${slide.title || `Slide ${idx + 1}`}" (layout: ${slide.layout}), add detailed speaker notes with 3-4 talking points for presenting this slide to a board or executive committee. Include specific numbers to mention and anticipate likely questions.` },
                        { label: 'Simplify for board', prompt: `For slide "${slide.title || `Slide ${idx + 1}`}" (layout: ${slide.layout}), simplify this slide for a board-level audience. Remove operational detail, focus on strategic implications, use clean professional formatting with generous whitespace.` },
                      ].map((action) => (
                        <button
                          key={action.label}
                          className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 flex items-center gap-2"
                          onClick={() => {
                            setAiMenuSlideId(null);
                            onAiEnhanceSlide(slide.id, action.prompt);
                          }}
                        >
                          <Sparkles className="h-3 w-3 text-indigo-400 shrink-0" />
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                className="p-0.5 rounded bg-white dark:bg-slate-700 shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900"
                onClick={(e) => { e.stopPropagation(); onDuplicateSlide(slide.id); }}
                title="Duplicate slide"
              >
                <Copy className="h-3 w-3 text-slate-500" />
              </button>
              {slides.length > 1 && (
                <button
                  className="p-0.5 rounded bg-white dark:bg-slate-700 shadow-sm hover:bg-red-50 dark:hover:bg-red-900"
                  onClick={(e) => { e.stopPropagation(); onDeleteSlide(slide.id); }}
                  title="Delete slide"
                >
                  <Trash2 className="h-3 w-3 text-red-400" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add slide button at bottom */}
      <div className="p-2 border-t border-slate-200 dark:border-slate-700">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs gap-1.5"
          onClick={() => onAddSlide('content')}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Slide
        </Button>
      </div>
    </div>
  );
}

export default SlidePanel;

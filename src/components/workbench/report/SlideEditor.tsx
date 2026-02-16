/**
 * SlideEditor
 *
 * Main editing area for a single slide. Elements can be dragged and resized
 * using react-rnd. Shows a scaled preview of the slide content.
 */

import React, { useState, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import { Button } from '@/components/ui/button';
import {
  Type,
  BarChart3,
  Table,
  Hash,
  Image,
  Square,
  Minus,
  Plus,
} from 'lucide-react';
import { SlideElementRenderer } from './SlideElementRenderer';
import type {
  SlideDefinition,
  SlideElement,
  SlideElementType,
  SlideLayout,
  ReportTheme,
  ElementPosition,
  SlideElementConfig,
} from '@/types/reportTypes';
import { cn } from '@/lib/utils';

// Standard PowerPoint slide dimensions in inches
const SLIDE_W_IN = 10;
const SLIDE_H_IN = 7.5;

// Render scale: inches to pixels
const PX_PER_INCH = 96;

interface SlideEditorProps {
  slide: SlideDefinition | null;
  theme: ReportTheme;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (elementId: string, updates: Partial<SlideElement>) => void;
  onAddElement: (type: SlideElementType) => void;
  onDeleteElement: (elementId: string) => void;
  onUpdateSlide: (updates: Partial<SlideDefinition>) => void;
}

const ADD_ELEMENT_OPTIONS: { type: SlideElementType; icon: React.ComponentType<any>; label: string }[] = [
  { type: 'text', icon: Type, label: 'Text' },
  { type: 'chart', icon: BarChart3, label: 'Chart' },
  { type: 'table', icon: Table, label: 'Table' },
  { type: 'kpi', icon: Hash, label: 'KPI' },
  { type: 'image', icon: Image, label: 'Image' },
  { type: 'shape', icon: Square, label: 'Shape' },
];

export function SlideEditor({
  slide,
  theme,
  selectedElementId,
  onSelectElement,
  onUpdateElement,
  onAddElement,
  onDeleteElement,
  onUpdateSlide,
}: SlideEditorProps) {
  const [zoom, setZoom] = useState(0.72); // Fit typical screen

  const scale = zoom;
  const slideWidthPx = SLIDE_W_IN * PX_PER_INCH * scale;
  const slideHeightPx = SLIDE_H_IN * PX_PER_INCH * scale;

  const inchToPx = useCallback(
    (inches: number) => inches * PX_PER_INCH * scale,
    [scale]
  );
  const pxToInch = useCallback(
    (px: number) => px / (PX_PER_INCH * scale),
    [scale]
  );

  if (!slide) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400">
        Select a slide to edit
      </div>
    );
  }

  const bgColor = slide.background?.type === 'color'
    ? slide.background.value
    : slide.layout === 'title'
    ? theme.primaryColor
    : theme.backgroundColor;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Element toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
        <span className="text-xs text-slate-500 mr-2">Add:</span>
        {ADD_ELEMENT_OPTIONS.map(({ type, icon: Icon, label }) => (
          <Button
            key={type}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => onAddElement(type)}
            title={`Add ${label}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
        <div className="flex-1" />
        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="text-[10px] text-slate-500 w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Slide title editor */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-slate-100 dark:border-slate-800">
        <span className="text-xs text-slate-500">Title:</span>
        <input
          type="text"
          value={slide.title || ''}
          onChange={(e) => onUpdateSlide({ title: e.target.value })}
          className="flex-1 text-sm bg-transparent border-none outline-none px-1 py-0.5 text-slate-700 dark:text-slate-200"
          placeholder="Slide title..."
        />
        <select
          value={slide.layout}
          onChange={(e) => onUpdateSlide({ layout: e.target.value as SlideLayout })}
          className="text-xs bg-transparent border border-slate-200 rounded px-1 py-0.5 text-slate-600 dark:text-slate-300"
          title="Slide layout"
        >
          <option value="title">Title</option>
          <option value="content">Content</option>
          <option value="two-column">Two Column</option>
          <option value="chart-focus">Chart Focus</option>
          <option value="table">Table</option>
          <option value="kpi-grid">KPI Grid</option>
          <option value="section-break">Section Break</option>
          <option value="comparison">Comparison</option>
          <option value="blank">Blank</option>
        </select>
      </div>

      {/* Slide canvas */}
      <div
        className="flex-1 overflow-auto flex items-start justify-center p-4 bg-slate-100 dark:bg-slate-950"
        onClick={() => onSelectElement(null)}
      >
        <div
          className="relative shadow-2xl rounded-sm"
          style={{
            width: slideWidthPx,
            height: slideHeightPx,
            backgroundColor: bgColor,
            minWidth: slideWidthPx,
            minHeight: slideHeightPx,
          }}
        >
          {/* Layout-specific title rendering */}
          {slide.layout !== 'blank' && slide.title && slide.layout !== 'title' && (
            <div
              className="absolute left-0 top-0 right-0 flex items-center px-4"
              style={{
                height: inchToPx(0.7),
                backgroundColor: theme.primaryColor,
              }}
            >
              <span
                className="text-white font-bold truncate"
                style={{
                  fontSize: 20 * scale,
                  fontFamily: theme.headerFontFamily,
                }}
              >
                {slide.title}
              </span>
            </div>
          )}

          {/* Title slide special rendering */}
          {slide.layout === 'title' && (
            <>
              <div
                className="absolute flex items-end"
                style={{
                  left: inchToPx(0.8),
                  top: inchToPx(1.5),
                  width: inchToPx(8.4),
                  height: inchToPx(1.5),
                }}
              >
                <span
                  className="text-white font-bold"
                  style={{
                    fontSize: 36 * scale,
                    fontFamily: theme.headerFontFamily,
                  }}
                >
                  {slide.title || 'Untitled Report'}
                </span>
              </div>
              {slide.subtitle && (
                <div
                  className="absolute"
                  style={{
                    left: inchToPx(0.8),
                    top: inchToPx(3.0),
                    width: inchToPx(8.4),
                    fontSize: 18 * scale,
                    color: '#cccccc',
                    fontFamily: theme.fontFamily,
                  }}
                >
                  {slide.subtitle}
                </div>
              )}
            </>
          )}

          {/* Footer */}
          <div
            className="absolute left-0 right-0 bottom-0 flex items-center px-4"
            style={{
              height: inchToPx(0.5),
              backgroundColor: theme.primaryColor,
            }}
          >
            <span className="text-white text-opacity-80" style={{ fontSize: 8 * scale }}>
              {theme.footerText || 'Coheus - Confidential'}
            </span>
          </div>

          {/* Elements */}
          {slide.elements.map((el) => (
            <Rnd
              key={el.id}
              position={{
                x: inchToPx(el.position.x),
                y: inchToPx(el.position.y),
              }}
              size={{
                width: inchToPx(el.position.w),
                height: inchToPx(el.position.h),
              }}
              onDragStop={(_, d) => {
                onUpdateElement(el.id, {
                  position: {
                    ...el.position,
                    x: Math.max(0, pxToInch(d.x)),
                    y: Math.max(0, pxToInch(d.y)),
                  },
                });
              }}
              onResizeStop={(_, __, ref, ___, pos) => {
                onUpdateElement(el.id, {
                  position: {
                    x: pxToInch(pos.x),
                    y: pxToInch(pos.y),
                    w: pxToInch(ref.offsetWidth),
                    h: pxToInch(ref.offsetHeight),
                  },
                });
              }}
              bounds="parent"
              minWidth={inchToPx(0.5)}
              minHeight={inchToPx(0.3)}
              className={cn(
                'group',
                selectedElementId === el.id
                  ? 'ring-2 ring-blue-500 z-20'
                  : 'hover:ring-1 hover:ring-blue-300 z-10'
              )}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onSelectElement(el.id);
              }}
            >
              <SlideElementRenderer element={el} isSelected={selectedElementId === el.id} scale={scale} />
              {/* Delete button */}
              {selectedElementId === el.id && (
                <button
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-red-600 z-30"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteElement(el.id);
                  }}
                >
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
              )}
            </Rnd>
          ))}
        </div>
      </div>

      {/* Speaker notes */}
      <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-1">
        <textarea
          value={slide.speakerNotes || ''}
          onChange={(e) => onUpdateSlide({ speakerNotes: e.target.value })}
          placeholder="Speaker notes..."
          className="w-full text-xs bg-transparent border-none outline-none resize-none h-10 text-slate-500 dark:text-slate-400"
        />
      </div>
    </div>
  );
}

export default SlideEditor;

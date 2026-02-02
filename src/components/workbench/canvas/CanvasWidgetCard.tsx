/**
 * Wraps a canvas grid widget with selection ring and context menu (duplicate, delete).
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Copy, Trash2, EyeOff, Check, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Optional: for dashboard_section widgets, allow hiding sub-sections (e.g. Executive summary). */
export interface HideableSection {
  id: string;
  label: string;
}

interface CanvasWidgetCardProps {
  widgetId: string;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  children: React.ReactNode;
  className?: string;
  displayMode?: 'full' | 'compact' | 'hidden';
  onChangeDisplayMode?: (mode: 'full' | 'compact' | 'hidden') => void;
  /** When set, show a "Hide sections" submenu with checkboxes for each section. */
  hideableSections?: HideableSection[];
  /** Current hidden section ids (checked = hidden). */
  hiddenSections?: string[];
  /** Toggle a section's visibility: (sectionId, hidden). */
  onToggleSection?: (sectionId: string, hidden: boolean) => void;
  /** Bring this widget to front (top layer). */
  onBringToFront?: () => void;
  /** Send this widget to back (bottom layer). */
  onSendToBack?: () => void;
}

export function CanvasWidgetCard({
  widgetId,
  selected,
  onSelect,
  onDuplicate,
  onDelete,
  children,
  className,
  hideableSections = [],
  hiddenSections = [],
  onToggleSection,
  onBringToFront,
  onSendToBack,
  displayMode = 'full',
  onChangeDisplayMode,
}: CanvasWidgetCardProps) {
  const hasHideableSections = hideableSections.length > 0 && typeof onToggleSection === 'function';
  const hasLayerActions = typeof onBringToFront === 'function' || typeof onSendToBack === 'function';
  const hasDisplayModes = typeof onChangeDisplayMode === 'function';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group relative h-full w-full rounded-2xl transition-all flex flex-col bg-white/95 dark:bg-slate-900/70 shadow-slate-200/60 dark:shadow-black/30',
        selected ? 'shadow-xl' : 'shadow-lg',
        className
      )}
    >
      <div className="absolute top-9 right-1 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-7 rounded-lg bg-white/90 dark:bg-slate-800/90 shadow-sm border border-slate-200/80 dark:border-slate-600 canvas-interactive"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4 text-slate-600 dark:text-slate-400" />
              <span className="sr-only">Widget menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
            {hasDisplayModes && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    Display
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(['full', 'compact', 'hidden'] as const).map((mode) => (
                      <DropdownMenuItem
                        key={mode}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChangeDisplayMode?.(mode);
                        }}
                        className="gap-2 capitalize"
                      >
                        {displayMode === mode ? <Check className="h-4 w-4 text-slate-600 dark:text-slate-400" /> : <span className="w-4 h-4" />}
                        {mode}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
            {hasHideableSections && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <EyeOff className="h-4 w-4" />
                    Hide sections
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {hideableSections.map((sec) => {
                      const isHidden = hiddenSections.includes(sec.id);
                      return (
                        <DropdownMenuItem
                          key={sec.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleSection?.(sec.id, !isHidden);
                          }}
                          className="gap-2"
                        >
                          {isHidden ? <Check className="h-4 w-4 text-slate-600 dark:text-slate-400" /> : <span className="w-4 h-4" />}
                          <span className={isHidden ? 'text-slate-500 dark:text-slate-400' : undefined}>{sec.label}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
            {hasLayerActions && (
              <>
                {onBringToFront && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onBringToFront(); }} className="gap-2">
                    <ArrowUpToLine className="h-4 w-4" />
                    Bring to front
                  </DropdownMenuItem>
                )}
                {onSendToBack && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSendToBack(); }} className="gap-2">
                    <ArrowDownToLine className="h-4 w-4" />
                    Send to back
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="gap-2">
              <Copy className="h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="gap-2 text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex-1 min-h-0 overflow-auto group relative">
        {children}
      </div>
    </div>
  );
}

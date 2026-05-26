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
import { MoreVertical, Copy, Trash2, EyeOff, Check, ArrowUpToLine, ArrowDownToLine, FolderInput, Sparkles, FileSpreadsheet, FileText, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Optional: for dashboard_section widgets, allow hiding sub-sections (e.g. Executive summary). */
export interface HideableSection {
  id: string;
  label: string;
}

/** Descriptor for a target group that this widget can be moved into */
export interface TargetGroup {
  id: string;
  title: string;
}

interface CanvasWidgetCardProps {
  widgetId: string;
  selected: boolean;
  onSelect: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
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
  /** Available widget groups that this item can be moved into */
  availableGroups?: TargetGroup[];
  /** Called when the user selects a group to move this item into */
  onMoveToGroup?: (groupId: string) => void;
  /** Called when the user wants to wrap this standalone item in a new group */
  onWrapInGroup?: () => void;
  /** Called when the user wants to edit this widget with Cohi AI */
  onEditWithCohi?: () => void;
  /** Called when the user wants to export this widget's data to Excel */
  onExportExcel?: () => void;
  /** Called when the user wants a chat-style PDF (preview + data table) */
  onExportPdf?: () => void;
  /** When true, show editing ring and badge (widget is being edited via Cohi) */
  editing?: boolean;
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
  availableGroups = [],
  onMoveToGroup,
  onWrapInGroup,
  onEditWithCohi,
  onExportExcel,
  onExportPdf,
  editing = false,
}: CanvasWidgetCardProps) {
  const hasHideableSections = hideableSections.length > 0 && typeof onToggleSection === 'function';
  const hasLayerActions = typeof onBringToFront === 'function' || typeof onSendToBack === 'function';
  const hasDisplayModes = typeof onChangeDisplayMode === 'function';
  const hasGroupActions = (availableGroups.length > 0 && typeof onMoveToGroup === 'function') || typeof onWrapInGroup === 'function';
  const hasAnyMenuActions =
    hasDisplayModes ||
    hasHideableSections ||
    hasLayerActions ||
    hasGroupActions ||
    typeof onEditWithCohi === 'function' ||
    typeof onExportExcel === 'function' ||
    typeof onExportPdf === 'function' ||
    typeof onDuplicate === 'function' ||
    typeof onDelete === 'function';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // When any input is focused (e.g., Radix Dialog text boxes), don't hijack
          // keyboard interactions for widget selection.
          const t = e.target as HTMLElement | null;
          if (t?.closest?.('input, textarea, [contenteditable]')) return;
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        // Shadow-only transition: avoid transition-all (animates every property on hover/layout).
        'group relative h-full w-full rounded-2xl transition-shadow duration-200 ease-out flex flex-col bg-white/95 dark:bg-slate-900/70 shadow-slate-200/60 dark:shadow-black/30',
        selected ? 'shadow-xl' : 'shadow-lg',
        editing && 'ring-2 ring-indigo-500',
        className
      )}
    >
      {editing && (
        <div className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded-md bg-indigo-500 text-white text-[10px] font-medium shadow-sm">
          Editing
        </div>
      )}
      {typeof onEditWithCohi === 'function' && (
        <div className="absolute top-2 right-2 z-10">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 rounded-lg border border-violet-200/90 bg-violet-50 px-2.5 text-xs font-medium text-violet-700 shadow-sm hover:bg-violet-100 dark:border-violet-700/60 dark:bg-violet-950/80 dark:text-violet-200 dark:hover:bg-violet-900/60 canvas-interactive"
            onClick={(e) => {
              e.stopPropagation();
              onEditWithCohi();
            }}
            data-testid="canvas-widget-edit-cohi"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
      )}
      {hasAnyMenuActions && (
      <div className="absolute top-9 right-1 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:opacity-100">
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
            {hasGroupActions && (
              <>
                {availableGroups.length > 0 && onMoveToGroup && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2">
                      <FolderInput className="h-4 w-4" />
                      Move to group
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {availableGroups.map((group) => (
                        <DropdownMenuItem
                          key={group.id}
                          onClick={(e) => { e.stopPropagation(); onMoveToGroup(group.id); }}
                          className="gap-2"
                        >
                          {group.title}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {onWrapInGroup && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onWrapInGroup(); }} className="gap-2">
                    <FolderInput className="h-4 w-4" />
                    Wrap in new group
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            {onEditWithCohi && (
              <>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEditWithCohi(); }} className="gap-2">
                  <MessageSquare className="h-4 w-4 text-violet-500" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {onExportExcel && (
              <>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onExportExcel(); }} className="gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Export to Excel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {onExportPdf && (
              <>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onExportPdf(); }} className="gap-2">
                  <FileText className="h-4 w-4" />
                  Export to PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {onDuplicate && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="gap-2">
              <Copy className="h-4 w-4" />
              Duplicate
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="gap-2 text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto group relative">
        {children}
      </div>
    </div>
  );
}

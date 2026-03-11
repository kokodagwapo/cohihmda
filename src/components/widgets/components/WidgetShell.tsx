/**
 * WidgetShell – common wrapper for all widget components.
 *
 * Provides:
 * - Consistent card styling (rounded, border, backdrop-blur, dark mode)
 * - Title bar with optional actions menu
 * - Loading skeleton state
 * - Error state with retry
 * - Overflow handling
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2, AlertCircle, MoreVertical, Trash2, Copy, Settings2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

export interface WidgetShellProps {
  /** Widget title displayed in the header */
  title?: string;
  /** True while data is loading */
  loading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Retry callback when error occurs */
  onRetry?: () => void;
  /** Remove widget from canvas */
  onRemove?: () => void;
  /** Duplicate widget */
  onDuplicate?: () => void;
  /** Open widget settings */
  onConfigure?: () => void;
  /** Additional class names */
  className?: string;
  /** Whether to show the actions menu (only on canvas, not on dashboard pages) */
  showActions?: boolean;
  /** Whether to render a compact header */
  compact?: boolean;
  children: React.ReactNode;
}

export function WidgetShell({
  title,
  loading = false,
  error = null,
  onRetry,
  onRemove,
  onDuplicate,
  onConfigure,
  className,
  showActions = false,
  compact = false,
  children,
}: WidgetShellProps) {
  return (
    <div
      className={cn(
        'h-full w-full rounded-xl border border-slate-200/70 dark:border-slate-700/70',
        'bg-white/95 dark:bg-slate-900/80 shadow-sm',
        'backdrop-blur-sm overflow-hidden flex flex-col',
        className,
      )}
    >
      {/* Header */}
      {(title || showActions) && (
        <div
          className={cn(
            'flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800',
            compact ? 'px-3 py-1.5' : 'px-4 py-2.5',
          )}
        >
          {title && (
            <h3
              className={cn(
                'font-semibold text-slate-900 dark:text-slate-100 truncate',
                compact ? 'text-xs' : 'text-sm',
              )}
            >
              {title}
            </h3>
          )}
          {showActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {onConfigure && (
                  <DropdownMenuItem onClick={onConfigure} className="gap-2 text-xs">
                    <Settings2 className="h-3.5 w-3.5" />
                    Configure
                  </DropdownMenuItem>
                )}
                {onDuplicate && (
                  <DropdownMenuItem onClick={onDuplicate} className="gap-2 text-xs">
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </DropdownMenuItem>
                )}
                {onRemove && (
                  <DropdownMenuItem onClick={onRemove} className="gap-2 text-xs text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Body */}
      <div className={cn('flex-1 min-h-0', compact ? 'overflow-hidden' : 'overflow-auto')}>
        {loading ? (
          <div className="h-full w-full flex items-center justify-center p-4">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
          </div>
        ) : error ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertCircle className="h-5 w-5 text-rose-500/70" />
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[200px]">{error}</p>
            {onRetry && (
              <Button variant="ghost" size="sm" onClick={onRetry} className="text-xs h-7">
                Retry
              </Button>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

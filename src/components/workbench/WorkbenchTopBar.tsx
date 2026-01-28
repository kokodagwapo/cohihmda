import { useState } from 'react';
import { MessageCircle, Plus, Download, Share2, PanelLeft, LayoutGrid, FileText, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconBadge } from '@/components/workbench/IconBadge';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export interface WorkbenchTopBarProps {
  onOpenSidebar?: () => void;
  onAsk?: (prompt: string) => void;
  className?: string;
}

export function WorkbenchTopBar({ onOpenSidebar, onAsk, className }: WorkbenchTopBarProps) {
  const [askValue, setAskValue] = useState('');
  const isMobile = useIsMobile();

  return (
    <div
      className={cn(
        'flex h-12 sm:h-14 items-center gap-2 sm:gap-3 border-b border-slate-200/70 dark:border-slate-700/50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-3 sm:px-5 shadow-sm shadow-slate-200/30 dark:shadow-none',
        className
      )}
    >
      {/* Mobile: sidebar trigger */}
      {isMobile && onOpenSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-xl hover:bg-violet-100/80 dark:hover:bg-violet-900/30 transition-colors"
          onClick={onOpenSidebar}
          aria-label="Open menu"
        >
          <PanelLeft className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </Button>
      )}

      {/* Ask Cohi */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <div className="relative flex-1 max-w-xl">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 pointer-events-none">
            <MessageCircle className="h-4 w-4" strokeWidth={2} />
          </span>
          <Input
            placeholder="Ask Cohi anything..."
            value={askValue}
            onChange={(e) => setAskValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && askValue.trim()) { onAsk?.(askValue.trim()); setAskValue(''); }
            }}
            className="h-10 pl-11 pr-4 bg-slate-50/80 dark:bg-slate-800/50 border-slate-200/80 dark:border-slate-700/80 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl focus-visible:ring-2 focus-visible:ring-sky-200 dark:focus-visible:ring-sky-800/60 focus-visible:border-sky-300/60 transition-shadow"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 rounded-xl border-slate-200/80 dark:border-slate-700/80 hover:border-emerald-200 dark:hover:border-emerald-800/60 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/20 transition-colors"
            >
              <IconBadge icon={Plus} variant="mint" size="sm" rounded="lg" className="!h-6 !w-6 [&>svg]:h-3 [&>svg]:w-3" />
              <span className="hidden sm:inline text-slate-700 dark:text-slate-300">Create</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-xl border-slate-200/80 dark:border-slate-700/80 shadow-lg">
            <DropdownMenuItem className="gap-2.5 py-2.5 rounded-lg focus:bg-sky-50 dark:focus:bg-sky-900/30">
              <IconBadge icon={LayoutGrid} variant="sky" size="sm" rounded="lg" className="!h-7 !w-7 [&>svg]:h-3.5 [&>svg]:w-3.5" />
              Dashboard
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 py-2.5 rounded-lg focus:bg-amber-50 dark:focus:bg-amber-900/30">
              <IconBadge icon={FileText} variant="amber" size="sm" rounded="lg" className="!h-7 !w-7 [&>svg]:h-3.5 [&>svg]:w-3.5" />
              Report
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 py-2.5 rounded-lg focus:bg-fuchsia-50 dark:focus:bg-fuchsia-900/30">
              <IconBadge icon={Lightbulb} variant="fuchsia" size="sm" rounded="lg" className="!h-7 !w-7 [&>svg]:h-3.5 [&>svg]:w-3.5" />
              Insight
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 rounded-xl text-amber-600/70 dark:text-amber-400/70 cursor-not-allowed"
          disabled
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 rounded-xl text-rose-600/70 dark:text-rose-400/70 cursor-not-allowed"
          disabled
        >
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
      </div>
    </div>
  );
}

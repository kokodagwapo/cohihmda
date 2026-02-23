import type { RefObject } from 'react';
import { PanelLeft } from 'lucide-react';
import { ExportMenu } from '@/components/common/ExportMenu';
import type { ExportData } from '@/utils/exportUtils';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export interface TopTieringTopBarProps {
  title?: string;
  onOpenSidebar?: () => void;
  className?: string;
  exportTargetRef?: RefObject<HTMLElement>;
}

export function TopTieringTopBar({
  title = 'Loan Funnel',
  onOpenSidebar,
  className,
  exportTargetRef,
}: TopTieringTopBarProps) {
  const isMobile = useIsMobile();
  const getExportData = (): ExportData => ({
    title,
    tables: [],
  });

  return (
    <div
      className={cn(
        'flex h-12 sm:h-14 items-center gap-2 sm:gap-3 border-b border-slate-200/70 dark:border-slate-700/50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-3 sm:px-5 shadow-sm shadow-slate-200/30 dark:shadow-none shrink-0',
        className
      )}
    >
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
      <h1 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
        {title}
      </h1>
      <div className="ml-auto">
        {exportTargetRef && (
          <ExportMenu
            title={title}
            targetRef={exportTargetRef}
            getExportData={getExportData}
          />
        )}
      </div>
    </div>
  );
}

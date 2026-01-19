import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface PullThroughModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage: string | null;
  data: Array<{
    id: string;
    name: string;
    loanAmount: number;
    daysInStage: number;
    startDate: string;
    notes?: string;
  }>;
}

export function PullThroughModal({ open, onOpenChange, stage, data }: PullThroughModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 sm:p-6 max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-base sm:text-lg">Pull-Through Stage: {stage}</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {data.length} loans currently in this stage
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 sm:pr-2 -mr-1 sm:-mr-2">
          {data.map((employee) => (
            <div key={employee.id} className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg active:bg-slate-100 dark:active:bg-slate-800/50 transition-colors touch-manipulation">
              <div className="flex items-center justify-between mb-1 sm:mb-2 gap-2">
                <div className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-50 truncate">{employee.name}</div>
                <div className="text-xs sm:text-sm font-semibold text-purple-600 flex-shrink-0">${(employee.loanAmount / 1000).toFixed(0)}K</div>
              </div>
              <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
                Days in stage: {employee.daysInStage} | Started: {employee.startDate}
              </div>
              {employee.notes && (
                <div className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 mt-1 sm:mt-2 italic line-clamp-2">
                  {employee.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}


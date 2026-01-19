import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Clock, User } from 'lucide-react';

interface FalloutEmployee {
  name: string;
  role: string;
  score?: number;
  loans?: number;
  revenue?: number;
  trend?: string;
  rank?: number;
  falloutReason: string;
  daysInPipeline: number;
  lastContact: string;
  branch?: string;
}

interface FalloutModalProps {
  open: boolean;
  category: string | null;
  data: FalloutEmployee[];
  onClose: () => void;
}

export function FalloutModal({ open, category, data, onClose }: FalloutModalProps) {
  const getCategoryIcon = () => {
    return <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-orange-600 dark:text-orange-400" />;
  };

  const getCategoryColor = () => {
    if (!category) return 'text-slate-600 dark:text-slate-400';
    const categoryLower = category.toLowerCase();
    if (categoryLower.includes('withdrawal') || categoryLower.includes('declination')) {
      return 'text-red-600 dark:text-red-400';
    }
    if (categoryLower.includes('rate')) {
      return 'text-blue-600 dark:text-blue-400';
    }
    if (categoryLower.includes('ops')) {
      return 'text-yellow-600 dark:text-yellow-400';
    }
    return 'text-orange-600 dark:text-orange-400';
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="w-[95vw] max-w-3xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 sm:p-6 max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
            {getCategoryIcon()}
            <span>Fallout Analysis: {category || 'Unknown Category'}</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {data.length} {data.length === 1 ? 'employee' : 'employees'} affected by this fallout category
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 sm:space-y-4 pr-1 sm:pr-2 -mr-1 sm:-mr-2 mt-4">
          {data.length === 0 ? (
            <div className="text-center py-8 text-slate-500 dark:text-slate-400">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">No employees found in this category</p>
            </div>
          ) : (
            data.map((employee, idx) => (
              <div
                key={`${employee.name}-${idx}`}
                className="p-4 sm:p-5 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 sm:gap-4 mb-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="p-2 rounded-lg bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                      <User className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-50 truncate">
                        {employee.name}
                      </div>
                      <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {employee.role}
                        {employee.branch && ` • ${employee.branch}`}
                      </div>
                    </div>
                  </div>
                  {employee.score !== undefined && (
                    <div className="flex-shrink-0 text-right">
                      <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-50">
                        Score: {employee.score}
                      </div>
                      {employee.rank && (
                        <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
                          Rank #{employee.rank}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2 sm:space-y-3 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                        Fallout Reason
                      </div>
                      <div className={`text-xs sm:text-sm ${getCategoryColor()}`}>
                        {employee.falloutReason}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-slate-400 dark:text-slate-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
                          Days in Pipeline
                        </div>
                        <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {employee.daysInPipeline} days
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <User className="h-3 w-3 sm:h-4 sm:w-4 text-slate-400 dark:text-slate-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
                          Last Contact
                        </div>
                        <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {employee.lastContact}
                        </div>
                      </div>
                    </div>
                  </div>

                  {(employee.loans !== undefined || employee.revenue !== undefined) && (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                      {employee.loans !== undefined && (
                        <div>
                          <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
                            Loans
                          </div>
                          <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-50">
                            {employee.loans}
                          </div>
                        </div>
                      )}
                      {employee.revenue !== undefined && (
                        <div>
                          <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
                            Revenue
                          </div>
                          <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-50">
                            ${(employee.revenue / 1000).toFixed(0)}K
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


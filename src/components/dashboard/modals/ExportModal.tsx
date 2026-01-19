import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportModal({ open, onOpenChange }: ExportModalProps) {
  const { toast } = useToast();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
            <FileSpreadsheet className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
            Export to Excel
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Choose the reports you want to export
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 sm:space-y-3 py-3 sm:py-4">
          <Button 
            className="w-full justify-start text-xs sm:text-sm h-10 sm:h-auto py-2 sm:py-3" 
            variant="outline" 
            onClick={() => {
              toast({
                title: 'Exporting',
                description: 'TopTiering Performance Report...'
              });
              setTimeout(() => toast({
                title: 'Success',
                description: 'Excel file ready!'
              }), 1500);
            }}
          >
            <FileSpreadsheet className="w-3 h-3 sm:w-4 sm:h-4 mr-2 text-green-600 flex-shrink-0" />
            <span className="truncate">TopTiering Performance</span>
          </Button>
          <Button 
            className="w-full justify-start text-xs sm:text-sm h-10 sm:h-auto py-2 sm:py-3" 
            variant="outline" 
            onClick={() => {
              toast({
                title: 'Exporting',
                description: 'Risk & Flagged Cases...'
              });
              setTimeout(() => toast({
                title: 'Success',
                description: 'Excel file ready!'
              }), 1500);
            }}
          >
            <FileSpreadsheet className="w-3 h-3 sm:w-4 sm:h-4 mr-2 text-green-600 flex-shrink-0" />
            <span className="truncate">Risk & Flagged Cases</span>
          </Button>
          <Button 
            className="w-full justify-start text-xs sm:text-sm h-10 sm:h-auto py-2 sm:py-3" 
            variant="outline" 
            onClick={() => {
              toast({
                title: 'Exporting',
                description: 'All reports...'
              });
              setTimeout(() => toast({
                title: 'Success',
                description: 'Comprehensive Excel file ready!'
              }), 2000);
            }}
          >
            <FileSpreadsheet className="w-3 h-3 sm:w-4 sm:h-4 mr-2 text-green-600 flex-shrink-0" />
            <span className="truncate">All Reports (Combined)</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


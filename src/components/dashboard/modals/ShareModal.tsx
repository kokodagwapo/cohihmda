import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Share2, Lock, Linkedin, Instagram, Facebook } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareModal({ open, onOpenChange }: ShareModalProps) {
  const { toast } = useToast();

  const handleShare = (platform: string, description: string) => {
    toast({
      title: platform,
      description: description
    });
    setTimeout(() => {
      toast({
        title: 'Sent',
        description: `Report shared via ${platform}`
      });
      onOpenChange(false);
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
            <Share2 className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
            Share Report via Messenger
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Send private message with report summary to your contacts
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
          {/* Report Preview */}
          <div className="p-3 sm:p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/50">
            <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 sm:mb-2">
              📊 Executive Report Summary
            </p>
            <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
              Q4 performance shows strong growth across all metrics. Top performers leading with exceptional results.
            </p>
          </div>

          {/* Recipient Input */}
          <div>
            <label className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 mb-1 sm:mb-2 block">
              Select recipient or enter contact
            </label>
            <Input placeholder="Search contacts..." className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-sm h-10" />
          </div>

          {/* Platform Selection */}
          <div className="space-y-1 sm:space-y-2">
            <label className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 block">
              Choose messaging platform
            </label>
            <div className="grid grid-cols-3 gap-2">
              <Button 
                variant="outline" 
                className="flex-col h-auto py-2 sm:py-3 touch-manipulation active:scale-95 transition-transform" 
                onClick={() => handleShare('LinkedIn Message', 'Opening LinkedIn Messenger...')}
              >
                <Linkedin className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 mb-1" />
                <span className="text-[10px] sm:text-xs">LinkedIn</span>
              </Button>
              <Button 
                variant="outline" 
                className="flex-col h-auto py-2 sm:py-3 touch-manipulation active:scale-95 transition-transform" 
                onClick={() => handleShare('Instagram DM', 'Opening Instagram Direct...')}
              >
                <Instagram className="w-5 h-5 sm:w-6 sm:h-6 text-pink-600 mb-1" />
                <span className="text-[10px] sm:text-xs">Instagram</span>
              </Button>
              <Button 
                variant="outline" 
                className="flex-col h-auto py-2 sm:py-3 touch-manipulation active:scale-95 transition-transform" 
                onClick={() => handleShare('Facebook Messenger', 'Opening Messenger...')}
              >
                <Facebook className="w-5 h-5 sm:w-6 sm:h-6 text-blue-700 mb-1" />
                <span className="text-[10px] sm:text-xs">Messenger</span>
              </Button>
            </div>
          </div>

          {/* Additional Options */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
              <Lock className="w-3 h-3 flex-shrink-0" />
              <span>All messages are sent privately and securely</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 text-sm h-10" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


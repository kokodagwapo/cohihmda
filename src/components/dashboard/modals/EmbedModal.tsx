import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Code } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface EmbedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmbedModal({ open, onOpenChange }: EmbedModalProps) {
  const { toast } = useToast();

  const embedCode = `<iframe 
  src="https://aletheia.app/dashboard/embed"
  width="100%" 
  height="800"
  frameborder="0"
  allowfullscreen>
</iframe>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(`<iframe src="https://aletheia.app/dashboard/embed" width="100%" height="800" frameborder="0" allowfullscreen></iframe>`);
    toast({
      title: 'Copied!',
      description: 'Embed code copied to clipboard'
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
            <Code className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
            Embed Dashboard
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Copy this code to embed reports in your website or application
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
          <div className="relative">
            <pre className="p-3 sm:p-4 bg-slate-900 dark:bg-slate-950 text-green-400 rounded-lg text-[10px] sm:text-xs overflow-x-auto">
              {embedCode}
            </pre>
            <Button 
              size="sm" 
              className="absolute top-2 right-2 text-xs px-2 sm:px-3 h-7 sm:h-8" 
              onClick={handleCopy}
            >
              Copy
            </Button>
          </div>
          <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            <p className="font-medium mb-1 sm:mb-2">Options:</p>
            <ul className="space-y-0.5 sm:space-y-1 text-[10px] sm:text-xs">
              <li>• Adjust width and height as needed</li>
              <li>• Supports responsive design</li>
              <li>• Real-time data updates</li>
              <li>• Secure authentication required</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


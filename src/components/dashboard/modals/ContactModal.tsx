import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Phone, MessageSquare, Share2 } from 'lucide-react';

interface Performer {
  name: string;
}

interface ContactModalProps {
  open: boolean;
  type: 'call' | 'message' | 'share' | null;
  performer: Performer | null;
  onClose: () => void;
}

export function ContactModal({ open, type, performer, onClose }: ContactModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="w-[95vw] max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
            {type === 'call' && <Phone className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />}
            {type === 'message' && <MessageSquare className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />}
            {type === 'share' && <Share2 className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />}
            <span className="truncate">
              {type === 'call' && 'Call'}
              {type === 'message' && 'Message'}
              {type === 'share' && 'Share'}
              {' '}{performer?.name}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {type === 'call' && 'Initiate a call with this team member'}
            {type === 'message' && 'Send a message to this team member'}
            {type === 'share' && 'Share this profile via email or social'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3 sm:space-y-4 sm:py-4">
          {type === 'call' && (
            <div className="space-y-2 sm:space-y-3">
              <div className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <Phone className="h-6 w-6 sm:h-8 sm:w-8 text-green-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm sm:text-base text-slate-900 dark:text-slate-100">Mobile</div>
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">+1 (555) 123-4567</div>
                </div>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-xs sm:text-sm px-3">Call</Button>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                <Phone className="h-6 w-6 sm:h-8 sm:w-8 text-slate-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm sm:text-base text-slate-900 dark:text-slate-100">Office</div>
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">+1 (555) 987-6543</div>
                </div>
                <Button size="sm" variant="outline" className="text-xs sm:text-sm px-3">Call</Button>
              </div>
            </div>
          )}
          {type === 'message' && (
            <div className="space-y-2 sm:space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm h-10 sm:h-auto">
                  <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  SMS
                </Button>
                <Button variant="outline" className="text-xs sm:text-sm h-10 sm:h-auto">
                  <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  Teams
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="text-xs sm:text-sm h-10 sm:h-auto">
                  <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  Slack
                </Button>
                <Button variant="outline" className="text-xs sm:text-sm h-10 sm:h-auto">
                  Email
                </Button>
              </div>
            </div>
          )}
          {type === 'share' && (
            <div className="space-y-2 sm:space-y-3">
              <Button className="w-full justify-start text-xs sm:text-sm h-10 sm:h-auto" variant="outline">
                <Share2 className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                Share via Email
              </Button>
              <Button className="w-full justify-start text-xs sm:text-sm h-10 sm:h-auto" variant="outline">
                <Share2 className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                Copy Profile Link
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


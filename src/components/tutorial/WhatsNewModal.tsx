import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTutorial } from '@/contexts/TutorialContext';
import { getUnseenEntries } from '@/data/whatsNew';
import type { WhatsNewEntry } from '@/data/whatsNew';
import { Sparkles, ArrowRight, Rocket, Wrench, Bug } from 'lucide-react';

interface WhatsNewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: WhatsNewEntry[];
}

const categoryConfig = {
  feature: { label: 'New', icon: Rocket, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  improvement: { label: 'Improved', icon: Wrench, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  fix: { label: 'Fixed', icon: Bug, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
};

export function WhatsNewModal({ open, onOpenChange, entries }: WhatsNewModalProps) {
  const navigate = useNavigate();
  const { prefs, markWhatsNewSeen } = useTutorial();

  const unseenEntries = useMemo(
    () => getUnseenEntries(prefs.whats_new_last_seen, entries),
    [prefs.whats_new_last_seen, entries]
  );

  const handleClose = () => {
    markWhatsNewSeen();
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose();
      return;
    }
    onOpenChange(true);
  };

  const entriesToShow = open ? (unseenEntries.length > 0 ? unseenEntries : entries.slice(0, 5)) : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <DialogTitle>What's New in Cohi</DialogTitle>
          </div>
          <DialogDescription>
            {unseenEntries.length > 0
              ? `${unseenEntries.length} update${unseenEntries.length !== 1 ? 's' : ''} since your last visit`
              : 'Recent updates and improvements'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          <div className="space-y-4 pr-2">
            {entriesToShow.map((entry) => {
              const config = categoryConfig[entry.category];
              return (
                <div
                  key={entry.id}
                  className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary" className={config.color}>
                      {config.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm">{entry.title}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{entry.description}</p>
                  {entry.link && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 p-0 h-auto"
                      onClick={() => {
                        handleClose();
                        navigate(entry.link!);
                      }}
                    >
                      {entry.linkLabel || 'Try it'}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

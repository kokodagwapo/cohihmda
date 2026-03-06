import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useTutorial } from '@/contexts/TutorialContext';
import { getUnseenEntries, mergeWhatsNewEntries, whatsNewEntries } from '@/data/whatsNew';
import { useReleaseNotes } from '@/hooks/useReleaseNotes';
import { WhatsNewModal } from './WhatsNewModal';
import { Bell } from 'lucide-react';

export function WhatsNewButton() {
  const [open, setOpen] = useState(false);
  const { prefs } = useTutorial();
  const { whatsNewEntries: releaseNoteEntries } = useReleaseNotes();

  const mergedEntries = useMemo(
    () => mergeWhatsNewEntries(releaseNoteEntries, whatsNewEntries),
    [releaseNoteEntries],
  );

  const unseenCount = useMemo(
    () => getUnseenEntries(prefs.whats_new_last_seen, mergedEntries).length,
    [prefs.whats_new_last_seen, mergedEntries]
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-9 w-9 rounded-lg"
        onClick={() => setOpen(true)}
        aria-label="What's new"
      >
        <Bell className="h-4 w-4" />
        {unseenCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}
      </Button>
      <WhatsNewModal open={open} onOpenChange={setOpen} entries={mergedEntries} />
    </>
  );
}

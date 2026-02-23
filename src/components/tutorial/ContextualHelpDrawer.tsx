import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useTutorial } from '@/contexts/TutorialContext';
import { tourRegistry, type TourId } from '@/data/tourSteps';
import { HelpCircle, ChevronRight, Play, ExternalLink, BookOpen } from 'lucide-react';

export interface ContextualHelpConfig {
  pageTitle: string;
  description: string;
  helpCategorySlug: string;
  relatedTourId?: TourId;
  quickActions?: Array<{
    label: string;
    description: string;
    action: () => void;
  }>;
}

interface ContextualHelpDrawerProps {
  config: ContextualHelpConfig;
}

export function ContextualHelpDrawer({ config }: ContextualHelpDrawerProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { startTour } = useTutorial();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full border-slate-200 dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
          aria-label="Page help"
        >
          <HelpCircle className="w-4 h-4 text-blue-500" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[360px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-blue-500" />
            {config.pageTitle}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {config.description}
          </p>

          {config.relatedTourId && tourRegistry[config.relatedTourId] && (
            <Button
              variant="outline"
              className="w-full gap-2 justify-start"
              onClick={() => {
                setOpen(false);
                startTour(config.relatedTourId!);
              }}
            >
              <Play className="w-4 h-4 text-blue-500" />
              <span>Replay {tourRegistry[config.relatedTourId].label}</span>
            </Button>
          )}

          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Help Articles
            </h4>
            <Button
              variant="ghost"
              className="w-full justify-between text-sm h-auto py-2"
              onClick={() => {
                setOpen(false);
                navigate(`/help/${config.helpCategorySlug}`);
              }}
            >
              <span>View all {config.pageTitle} articles</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>

          {config.quickActions && config.quickActions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Quick Actions</h4>
              {config.quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setOpen(false);
                    action.action();
                  }}
                  className="w-full text-left p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{action.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="pt-4 border-t">
            <Button
              variant="ghost"
              className="w-full justify-center text-sm gap-2"
              onClick={() => {
                setOpen(false);
                navigate('/help');
              }}
            >
              <BookOpen className="w-4 h-4" />
              Browse all Help articles
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

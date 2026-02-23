import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { useLocation } from 'react-router-dom';
import { FeatureTour } from './FeatureTour';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, SkipForward } from 'lucide-react';

export function WelcomeTourTrigger() {
  const { isAuthenticated, user } = useAuth();
  const { isTourCompleted, startTour, isLoading, prefs } = useTutorial();
  const location = useLocation();
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);
  const [tourStarted, setTourStarted] = useState(false);

  useEffect(() => {
    if (
      isAuthenticated &&
      !isLoading &&
      !prefs.onboarding_complete &&
      !isTourCompleted('welcome') &&
      location.pathname === '/insights'
    ) {
      const timer = setTimeout(() => setShowWelcomeDialog(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, isLoading, prefs.onboarding_complete, isTourCompleted, location.pathname]);

  const handleStartTour = () => {
    setShowWelcomeDialog(false);
    setTourStarted(true);
    startTour('welcome');
  };

  const handleSkip = () => {
    setShowWelcomeDialog(false);
  };

  const firstName = user?.full_name?.split(' ')[0] || 'there';

  return (
    <>
      <Dialog open={showWelcomeDialog} onOpenChange={setShowWelcomeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-center mb-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
            </div>
            <DialogTitle className="text-center text-xl">
              Welcome to Cohi, {firstName}!
            </DialogTitle>
            <DialogDescription className="text-center text-base leading-relaxed mt-2">
              Let us give you a quick tour of the platform. It takes less than 2 minutes and will help you get the most out of Cohi's AI-powered analytics.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
            <Button variant="outline" onClick={handleSkip} className="gap-2">
              <SkipForward className="w-4 h-4" />
              Skip for now
            </Button>
            <Button onClick={handleStartTour} className="gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700">
              <Sparkles className="w-4 h-4" />
              Start Tour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tourStarted && <FeatureTour tourId="welcome" />}
    </>
  );
}

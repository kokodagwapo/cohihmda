import { useTutorial } from '@/contexts/TutorialContext';
import { FeatureTour } from './FeatureTour';
import type { TourId } from '@/data/tourSteps';

/**
 * Renders the active tour (Joyride) when startTour() is called from anywhere.
 * Welcome tour is handled by WelcomeTourTrigger; all other tours (admin, workbench, research, etc.)
 * are rendered here so that e.g. "Start Tour" from Help Center works after navigation.
 */
export function ActiveTourRunner() {
  const { activeTourId } = useTutorial();

  if (!activeTourId || activeTourId === 'welcome') return null;

  return <FeatureTour key={activeTourId} tourId={activeTourId as TourId} />;
}

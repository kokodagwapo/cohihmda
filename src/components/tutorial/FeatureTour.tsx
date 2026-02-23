import Joyride, { CallBackProps, STATUS, ACTIONS, EVENTS } from 'react-joyride';
import { useTutorial } from '@/contexts/TutorialContext';
import { tourRegistry, type TourId } from '@/data/tourSteps';

interface FeatureTourProps {
  tourId: TourId;
  autoStart?: boolean;
}

const joyrideStyles = {
  options: {
    arrowColor: 'var(--color-background, #fff)',
    backgroundColor: 'var(--color-background, #fff)',
    overlayColor: 'rgba(0, 0, 0, 0.5)',
    primaryColor: '#3b82f6',
    textColor: 'var(--color-foreground, #1e293b)',
    zIndex: 10000,
  },
  tooltip: {
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    fontSize: '14px',
    maxWidth: '380px',
  },
  tooltipTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '8px',
  },
  tooltipContent: {
    padding: '8px 0',
    lineHeight: '1.6',
  },
  buttonNext: {
    backgroundColor: '#3b82f6',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
  },
  buttonBack: {
    color: '#64748b',
    fontSize: '13px',
    fontWeight: 500,
    marginRight: '8px',
  },
  buttonSkip: {
    color: '#94a3b8',
    fontSize: '13px',
  },
  buttonClose: {
    width: '14px',
    height: '14px',
  },
  spotlight: {
    borderRadius: '12px',
  },
};

export function FeatureTour({ tourId, autoStart = false }: FeatureTourProps) {
  const { activeTourId, isTourCompleted, completeTour, endTour } = useTutorial();

  const tour = tourRegistry[tourId];
  if (!tour) return null;

  const isRunning = activeTourId === tourId;
  const shouldAutoStart = autoStart && !isTourCompleted(tourId);

  const handleCallback = (data: CallBackProps) => {
    const { status, action, type } = data;

    if (status === STATUS.FINISHED) {
      completeTour(tourId);
    } else if (status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
      completeTour(tourId);
    }

    if (type === EVENTS.TOUR_END) {
      endTour(tourId);
    }
  };

  if (!isRunning && !shouldAutoStart) return null;

  return (
    <Joyride
      steps={tour.steps}
      run={isRunning || shouldAutoStart}
      continuous
      showProgress
      showSkipButton
      scrollToFirstStep
      disableScrollParentFix
      callback={handleCallback}
      styles={joyrideStyles}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Done',
        next: 'Next',
        open: 'Open',
        skip: 'Skip tour',
      }}
      floaterProps={{
        disableAnimation: false,
      }}
    />
  );
}

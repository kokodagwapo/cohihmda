import { useState, useCallback, useRef } from 'react';
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
  const { activeTourId, isTourCompleted, completeTour, endTour, tourStepHandlerRef } = useTutorial();
  const [stepIndex, setStepIndex] = useState(0);
  const [isWaiting, setIsWaiting] = useState(false);
  const waitingRef = useRef(false);

  const tour = tourRegistry[tourId];
  if (!tour) return null;

  const isRunning = activeTourId === tourId;
  const shouldAutoStart = autoStart && !isTourCompleted(tourId);

  const handleCallback = useCallback(async (data: CallBackProps) => {
    const { status, action, type, index } = data;

    if (status === STATUS.FINISHED) {
      completeTour(tourId);
      return;
    }
    if (status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
      completeTour(tourId);
      return;
    }
    if (type === EVENTS.TOUR_END) {
      endTour(tourId);
      return;
    }

    if (type === EVENTS.STEP_AFTER) {
      if (action === ACTIONS.NEXT) {
        const handler = tourStepHandlerRef.current;
        if (handler && !waitingRef.current) {
          const result = handler(tourId, index);
          if (result && typeof result.then === 'function') {
            waitingRef.current = true;
            setIsWaiting(true);
            try {
              await result;
            } finally {
              waitingRef.current = false;
              setIsWaiting(false);
            }
          }
        }
        setStepIndex(index + 1);
      } else if (action === ACTIONS.PREV) {
        setStepIndex(index - 1);
      }
    }
  }, [tourId, completeTour, endTour, tourStepHandlerRef]);

  if (!isRunning && !shouldAutoStart) return null;

  return (
    <Joyride
      steps={tour.steps}
      stepIndex={stepIndex}
      run={(isRunning || shouldAutoStart) && !isWaiting}
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

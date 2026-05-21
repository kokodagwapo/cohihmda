import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useChatShell } from '@/contexts/ChatShellContext';
import { isCohiChatTourPage } from '@/lib/cohiChatTour';
import Joyride, {
  CallBackProps,
  STATUS,
  ACTIONS,
  EVENTS,
  type Step,
  type StoreHelpers,
} from 'react-joyride';
import { useTutorial } from '@/contexts/TutorialContext';
import { getTourSteps, tourHasSteps, tourRegistry, type TourId } from '@/data/tourSteps';
import {
  dispatchOpenAppSidebarForTour,
  getCohiSidebarAnchorFromStep,
  isCohiSidebarTourStep,
  isUnifiedChatJoyrideTarget,
  prepareCohiSidebarTourStepFromJoyrideStep,
  recoverUnifiedChatTourStep,
  removeTourSpotlightMirror,
  resetTourSidebarPrepState,
  scheduleJoyrideReflow,
  setTourSidebarLock,
} from '@/lib/tourTargets';

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

/** Joyride portals can outlive React unmount — remove explicitly. */
function purgeJoyrideDom(): void {
  removeTourSpotlightMirror();
  document.querySelectorAll('#react-joyride-portal').forEach((el) => el.remove());
}

export function FeatureTour({ tourId, autoStart = false }: FeatureTourProps) {
  const { pathname } = useLocation();
  const { mode, setMode, isChatHomePage } = useChatShell();
  const {
    activeTourId,
    isTourCompleted,
    completeTour,
    tourStepHandlerRef,
  } = useTutorial();

  const tourMeta = tourRegistry[tourId];
  const steps = getTourSteps(tourId);
  if (!tourMeta || !tourHasSteps(tourId)) return null;

  const isRunning = activeTourId === tourId;
  const shouldAutoStart = autoStart && !isTourCompleted(tourId);
  const tourIsActive = isRunning || shouldAutoStart;

  const [stepIndex, setStepIndex] = useState(0);
  const [joyrideRunning, setJoyrideRunning] = useState(false);
  const joyrideHelpersRef = useRef<StoreHelpers | null>(null);
  const finishingRef = useRef(false);

  const finishTour = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      joyrideHelpersRef.current?.close('tour_complete');
    } catch {
      /* Joyride may already be torn down */
    }
    setJoyrideRunning(false);
    purgeJoyrideDom();
    resetTourSidebarPrepState();
    setTourSidebarLock(false);
    void completeTour(tourId).finally(() => {
      finishingRef.current = false;
    });
  }, [tourId, completeTour]);

  const stopJoyride = useCallback(() => {
    setJoyrideRunning(false);
    purgeJoyrideDom();
    resetTourSidebarPrepState();
    setTourSidebarLock(false);
  }, []);

  useEffect(() => {
    if (!tourIsActive) {
      setJoyrideRunning(false);
      return;
    }
    finishingRef.current = false;
    setStepIndex(0);
    setJoyrideRunning(true);
    resetTourSidebarPrepState();
    setTourSidebarLock(true);
    void dispatchOpenAppSidebarForTour();
    return () => {
      stopJoyride();
    };
  }, [tourIsActive, stopJoyride]);

  const goToStep = useCallback(
    async (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= steps.length) return;
      const nextStep = steps[nextIndex] as Step;
      await prepareCohiSidebarTourStepFromJoyrideStep(nextStep);
      setStepIndex(nextIndex);
      scheduleJoyrideReflow();
    },
    [steps],
  );

  /**
   * With continuous + controlled Joyride, the last-step "Done" button calls
   * helpers.next(), which is a no-op when controlled — so FINISHED never fires.
   */
  useEffect(() => {
    if (!joyrideRunning || stepIndex !== steps.length - 1) return;

    const onPrimaryDone = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-action="primary"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishTour();
    };

    document.addEventListener('click', onPrimaryDone, true);
    return () => document.removeEventListener('click', onPrimaryDone, true);
  }, [joyrideRunning, stepIndex, steps.length, finishTour]);

  const handleCallback = useCallback(
    async (data: CallBackProps) => {
      const { status, action, type, index, step } = data;
      const joyrideStep = step as Step | undefined;

      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        finishTour();
        return;
      }
      if (action === ACTIONS.CLOSE) {
        finishTour();
        return;
      }

      if (type === EVENTS.TOUR_END) {
        stopJoyride();
        return;
      }

      if (type === EVENTS.STEP_BEFORE && isCohiSidebarTourStep(joyrideStep)) {
        await prepareCohiSidebarTourStepFromJoyrideStep(joyrideStep);
        scheduleJoyrideReflow();
        return;
      }

      if (
        type === EVENTS.STEP_BEFORE &&
        tourId === "cohi-chat" &&
        isCohiChatTourPage(pathname) &&
        isUnifiedChatJoyrideTarget(joyrideStep)
      ) {
        const target =
          typeof joyrideStep?.target === "string" ? joyrideStep.target : "";
        if (
          !isChatHomePage &&
          mode === "compact" &&
          target.includes("unified-chat-suggestions")
        ) {
          setMode("tall");
          await recoverUnifiedChatTourStep();
        }
        scheduleJoyrideReflow();
        return;
      }

      if (type === EVENTS.STEP_AFTER) {
        if (action === ACTIONS.NEXT) {
          const nextIndex = index + 1;
          if (nextIndex >= steps.length) {
            finishTour();
            return;
          }
          const handler = tourStepHandlerRef.current;
          // Run layout prep before advancing so shell resize does not drop the next target.
          if (handler && tourId === "cohi-chat") {
            await handler(tourId, index);
          }
          await goToStep(nextIndex);
          if (handler && tourId !== "cohi-chat") {
            await handler(tourId, index);
          }
          scheduleJoyrideReflow();
          return;
        }
        if (action === ACTIONS.PREV) {
          await goToStep(index - 1);
          return;
        }
      }

      if (type === EVENTS.TARGET_NOT_FOUND) {
        if (isCohiSidebarTourStep(joyrideStep)) {
          await prepareCohiSidebarTourStepFromJoyrideStep(joyrideStep);
          scheduleJoyrideReflow();
          return;
        }
        if (tourId === "cohi-chat" && isUnifiedChatJoyrideTarget(joyrideStep)) {
          if (
            isCohiChatTourPage(pathname) &&
            !isChatHomePage &&
            typeof joyrideStep?.target === "string" &&
            joyrideStep.target.includes("unified-chat-suggestions")
          ) {
            setMode("tall");
          }
          await recoverUnifiedChatTourStep();
          await goToStep(index);
          return;
        }
      }
    },
    [
      tourId,
      steps,
      finishTour,
      stopJoyride,
      goToStep,
      tourStepHandlerRef,
      pathname,
      mode,
      setMode,
      isChatHomePage,
    ],
  );

  if (!tourIsActive || !joyrideRunning) return null;

  return (
    <Joyride
      key={`${tourId}-${joyrideRunning}`}
      steps={steps}
      stepIndex={stepIndex}
      run={joyrideRunning}
      continuous
      showProgress
      showSkipButton
      disableScrollParentFix
      callback={handleCallback}
      getHelpers={(helpers) => {
        joyrideHelpersRef.current = helpers;
      }}
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
        disableAnimation: true,
      }}
    />
  );
}

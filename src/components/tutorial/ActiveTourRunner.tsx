import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTutorial } from "@/contexts/TutorialContext";
import { FeatureTour } from "./FeatureTour";
import type { TourId } from "@/data/tourSteps";
import {
  COHI_CHAT_TOUR_PAGE_PATH,
  isCohiChatTourPage,
} from "@/lib/cohiChatTour";

/**
 * Renders the active tour (Joyride) when startTour() is called from anywhere.
 * Welcome tour is handled by WelcomeTourTrigger; all other tours (admin, workbench, research, etc.)
 * are rendered here so that e.g. "Start Tour" from Help Center works after navigation.
 */
export function ActiveTourRunner() {
  const { activeTourId } = useTutorial();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (activeTourId === "cohi-chat" && !isCohiChatTourPage(location.pathname)) {
      navigate(COHI_CHAT_TOUR_PAGE_PATH, { replace: true });
    }
  }, [activeTourId, location.pathname, navigate]);

  if (!activeTourId || activeTourId === "welcome") return null;

  if (activeTourId === "cohi-chat" && !isCohiChatTourPage(location.pathname)) {
    return null;
  }

  return <FeatureTour key={activeTourId} tourId={activeTourId as TourId} />;
}

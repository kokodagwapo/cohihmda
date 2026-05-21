import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTutorial } from "@/contexts/TutorialContext";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageCircle, SkipForward, Sparkles } from "lucide-react";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { tourHasSteps } from "@/data/tourSteps";
import {
  isCohiChatTourLandingPath,
  recordCohiChatAnnounceHandled,
  shouldShowCohiChatChangesAnnounce,
} from "@/lib/cohiChatTourAnnounce";
import { scheduleCohiChatTourStart } from "@/lib/cohiChatTour";

const WELCOME_TOUR_STORAGE_KEY = "cohi-welcome-tour-last-shown";
const COOLDOWN_MS = 48 * 60 * 60 * 1000;

function shouldShowWelcomeTourDialog(): boolean {
  try {
    const raw = localStorage.getItem(WELCOME_TOUR_STORAGE_KEY);
    if (!raw) return true;
    const lastShown = new Date(raw).getTime();
    const now = Date.now();
    if (now - lastShown < COOLDOWN_MS) return false;
    const lastDate = new Date(lastShown).toDateString();
    const today = new Date(now).toDateString();
    return lastDate !== today;
  } catch {
    return true;
  }
}

/**
 * Welcome dialog/tour only runs on /insights — do not block chat announce on /.
 */
function welcomeBlocksChatAnnounce(
  pathname: string,
  activeTourId: string | null,
  onboardingComplete: boolean,
  welcomeTourCompleted: boolean,
): boolean {
  if (activeTourId === "welcome") return true;
  if (welcomeTourCompleted || onboardingComplete) return false;
  if (pathname !== "/insights") return false;
  return shouldShowWelcomeTourDialog();
}

export function CohiChatTourTrigger() {
  const { isAuthenticated } = useAuth();
  const {
    startTour,
    isLoading,
    prefs,
    activeTourId,
    markCohiChatChangesAnnounceHandled,
  } = useTutorial();
  const location = useLocation();
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const welcomeCompleted =
    prefs.onboarding_complete ||
    prefs.tours_completed.includes("welcome");

  const cohiChatTourCompleted = prefs.tours_completed.includes("cohi-chat");

  const dismissAnnounce = useCallback(() => {
    recordCohiChatAnnounceHandled();
    void markCohiChatChangesAnnounceHandled();
  }, [markCohiChatChangesAnnounceHandled]);

  useEffect(() => {
    if (announceTimerRef.current) {
      clearTimeout(announceTimerRef.current);
      announceTimerRef.current = null;
    }

    if (!isCohiChatTourLandingPath(location.pathname)) {
      setShowDialog(false);
      return;
    }

    if (
      !isAuthenticated ||
      isLoading ||
      !isUnifiedChatClientEnabled() ||
      !tourHasSteps("cohi-chat") ||
      cohiChatTourCompleted
    ) {
      return;
    }

    if (
      welcomeBlocksChatAnnounce(
        location.pathname,
        activeTourId,
        prefs.onboarding_complete,
        welcomeCompleted,
      )
    ) {
      return;
    }

    if (activeTourId) return;

    const eligible = shouldShowCohiChatChangesAnnounce({
      serverHandledAt: prefs.cohi_chat_changes_announce_handled_at,
    });
    if (!eligible) return;

    announceTimerRef.current = setTimeout(() => {
      announceTimerRef.current = null;
      setShowDialog(true);
    }, 1000);

    return () => {
      if (announceTimerRef.current) {
        clearTimeout(announceTimerRef.current);
        announceTimerRef.current = null;
      }
    };
  }, [
    isAuthenticated,
    isLoading,
    location.pathname,
    prefs.onboarding_complete,
    prefs.cohi_chat_changes_announce_handled_at,
    prefs.tours_completed,
    activeTourId,
    welcomeCompleted,
    cohiChatTourCompleted,
  ]);

  const handleStartTour = () => {
    setShowDialog(false);
    dismissAnnounce();
    scheduleCohiChatTourStart(navigate, startTour, location.pathname);
  };

  const handleSkip = () => {
    setShowDialog(false);
    dismissAnnounce();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) dismissAnnounce();
    setShowDialog(open);
  };

  return (
    <Dialog open={showDialog} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-lg">
              <MessageCircle className="w-8 h-8 text-white" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">
            Cohi Chat has a new home
          </DialogTitle>
          <DialogDescription className="text-center text-base leading-relaxed mt-2">
            We&apos;ve updated Cohi Chat — one place under the top bar for data
            questions, Research, insights, and Workbench. Take a short tour to see
            what changed, or skip and explore on your own.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
          <Button variant="outline" onClick={handleSkip} className="gap-2">
            <SkipForward className="w-4 h-4" />
            Skip for now
          </Button>
          <Button
            onClick={handleStartTour}
            className="gap-2 bg-gradient-to-r from-violet-500 to-blue-600 hover:from-violet-600 hover:to-blue-700"
          >
            <Sparkles className="w-4 h-4" />
            Tour the changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

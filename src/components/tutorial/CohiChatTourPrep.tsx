/**
 * Prepares layout between Cohi Chat tour steps (unified IA).
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTutorial } from "@/contexts/TutorialContext";
import { useChatShell } from "@/contexts/ChatShellContext";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";

export function CohiChatTourPrep() {
  const { setTourStepHandler } = useTutorial();
  const { setMode } = useChatShell();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!isUnifiedChatClientEnabled()) {
      return;
    }

    setTourStepHandler(async (tourId, index) => {
      if (tourId !== "cohi-chat" || pathname !== "/insights") {
        return;
      }
      if (index === 2) {
        setMode("tall");
      }
    });

    return () => setTourStepHandler(null);
  }, [pathname, setMode, setTourStepHandler]);

  return null;
}

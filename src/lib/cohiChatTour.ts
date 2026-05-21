/**
 * Cohi Chat Joyride tour must run on Insights — chat home (`/`) hides layout controls
 * and uses a different shell layout, which breaks mid-tour targets.
 */
export const COHI_CHAT_TOUR_PAGE_PATH = "/insights";

export const COHI_CHAT_TOUR_START_DELAY_MS = 800;

/**
 * Navigate to Insights when needed, then start the tour.
 * Never starts Joyride on chat home (`/`) — that route hides tour targets.
 */
export function scheduleCohiChatTourStart(
  navigate: (path: string, options?: { replace?: boolean }) => void,
  startTour: (tourId: string) => void,
  currentPathname: string,
): void {
  const start = () => startTour("cohi-chat");
  if (currentPathname === COHI_CHAT_TOUR_PAGE_PATH) {
    start();
    return;
  }
  navigate(COHI_CHAT_TOUR_PAGE_PATH, { replace: true });
  window.setTimeout(start, COHI_CHAT_TOUR_START_DELAY_MS);
}

export function isCohiChatTourPage(pathname: string): boolean {
  return pathname === COHI_CHAT_TOUR_PAGE_PATH;
}

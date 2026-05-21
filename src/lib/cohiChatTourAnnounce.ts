/**
 * First-login-since-release prompt for the unified Cohi Chat tour.
 * Bump COHI_CHAT_CHANGES_RELEASE_DATE when shipping a new chat UX announcement.
 */
export const COHI_CHAT_CHANGES_RELEASE_DATE = "2026-05-20";

/**
 * Routes where the chat-changes announce dialog may appear.
 * The Joyride tour itself always runs on `/insights` only (see `cohiChatTour.ts`).
 */
export const COHI_CHAT_ANNOUNCE_DIALOG_PATHS = ["/", "/insights"] as const;

/** @deprecated Use isCohiChatAnnounceDialogPath — name kept for call sites. */
export const COHI_CHAT_TOUR_LANDING_PATHS = COHI_CHAT_ANNOUNCE_DIALOG_PATHS;

export function isCohiChatAnnounceDialogPath(pathname: string): boolean {
  return (COHI_CHAT_ANNOUNCE_DIALOG_PATHS as readonly string[]).includes(pathname);
}

export function isCohiChatTourLandingPath(pathname: string): boolean {
  return isCohiChatAnnounceDialogPath(pathname);
}

const ANNOUNCE_HANDLED_KEY = "cohi-chat-changes-announce-handled";

export type CohiChatAnnounceEligibility = {
  /** Persisted tutorial pref (per user, cross-device). */
  serverHandledAt?: string | null;
};

/** True when the user has not dismissed/skipped the chat-changes announce. */
export function shouldShowCohiChatChangesAnnounce(
  options: CohiChatAnnounceEligibility = {},
): boolean {
  if (options.serverHandledAt) return false;
  try {
    return localStorage.getItem(ANNOUNCE_HANDLED_KEY) == null;
  } catch {
    return true;
  }
}

export function recordCohiChatAnnounceHandled(): void {
  try {
    localStorage.setItem(ANNOUNCE_HANDLED_KEY, new Date().toISOString());
  } catch {
    /* quota */
  }
}

/** Dev / QA: clear local dismiss flag to re-test the announce dialog. */
export function clearCohiChatAnnounceHandledForTesting(): void {
  try {
    localStorage.removeItem(ANNOUNCE_HANDLED_KEY);
  } catch {
    /* quota */
  }
}

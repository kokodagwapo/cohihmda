/**
 * Stable Joyride anchors for the desktop Reports sidebar (nav column only).
 * Spotlight uses a body-fixed mirror because react-joyride mispositions targets
 * inside fixed + scrollable sidebars (offsetTop vs viewport rect).
 */

export const COHI_TOUR_SIDEBAR = {
  insights: "cohi-tour-sidebar-insights",
  myDashboards: "cohi-tour-sidebar-my-dashboards",
  folders: "cohi-tour-sidebar-folders",
  history: "cohi-tour-sidebar-history",
  fullHistory: "cohi-tour-sidebar-full-history",
  dataExplorer: "cohi-tour-sidebar-data-explorer",
} as const;

export type CohiTourSidebarAnchor = keyof typeof COHI_TOUR_SIDEBAR;

/** Set on sidebar Joyride steps — used to sync the spotlight mirror. */
export const COHI_SIDEBAR_ANCHOR_STEP_DATA_KEY = "cohiSidebarAnchor";

const TOUR_SPOTLIGHT_MIRROR_ID = "cohi-tour-spotlight-mirror";

/** Joyride target for all desktop sidebar steps (synced from real nav anchors). */
export const TOUR_SPOTLIGHT_MIRROR_TARGET = `#${TOUR_SPOTLIGHT_MIRROR_ID}`;

export function cohiTourAnchorId(anchor: CohiTourSidebarAnchor): string {
  return COHI_TOUR_SIDEBAR[anchor];
}

/** Desktop Reports sidebar nav column (excludes mobile sheet duplicates). */
export const DESKTOP_SIDEBAR_TOUR_ROOT = '[data-tour-root="desktop-sidebar-nav"]';

export function desktopSidebarTourSourceSelector(
  anchor: CohiTourSidebarAnchor,
): string {
  return `${DESKTOP_SIDEBAR_TOUR_ROOT} #${cohiTourAnchorId(anchor)}`;
}

/** Joyride step target — always the viewport-synced mirror. */
export function desktopSidebarTourTarget(_anchor: CohiTourSidebarAnchor): string {
  return TOUR_SPOTLIGHT_MIRROR_TARGET;
}

export function getCohiSidebarAnchorFromStep(step?: {
  data?: Record<string, unknown>;
}): CohiTourSidebarAnchor | undefined {
  const anchor = step?.data?.[COHI_SIDEBAR_ANCHOR_STEP_DATA_KEY];
  if (
    typeof anchor === "string" &&
    Object.prototype.hasOwnProperty.call(COHI_TOUR_SIDEBAR, anchor)
  ) {
    return anchor as CohiTourSidebarAnchor;
  }
  return undefined;
}

export function isCohiSidebarTourStep(step?: {
  data?: Record<string, unknown>;
  target?: string | HTMLElement;
}): boolean {
  if (getCohiSidebarAnchorFromStep(step)) return true;
  const target = step?.target;
  return typeof target === "string" && target === TOUR_SPOTLIGHT_MIRROR_TARGET;
}

export function isUnifiedChatJoyrideTarget(step?: {
  target?: string | HTMLElement;
}): boolean {
  const target = step?.target;
  return (
    typeof target === "string" && target.includes('data-tour="unified-chat')
  );
}

/** Wait for chat shell height animation after compact → tall (see CHAT_SHELL_VIEW_TRANSITION). */
export function waitForChatShellLayoutSettle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 520));
}

/** Re-sync Joyride after unified chat shell layout changes. */
export async function recoverUnifiedChatTourStep(): Promise<void> {
  await waitForChatShellLayoutSettle();
  scheduleJoyrideReflow();
  await waitLayoutFrames(2);
  scheduleJoyrideReflow();
}

export function queryDesktopSidebarTourTarget(
  selector: string,
): HTMLElement | null {
  const el = document.querySelector(selector);
  return el instanceof HTMLElement ? el : null;
}

function ensureTourSpotlightMirror(): HTMLDivElement {
  const existing = document.getElementById(TOUR_SPOTLIGHT_MIRROR_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }
  const mirror = document.createElement("div");
  mirror.id = TOUR_SPOTLIGHT_MIRROR_ID;
  mirror.setAttribute("aria-hidden", "true");
  mirror.setAttribute("data-tour-spotlight-mirror", "");
  Object.assign(mirror.style, {
    position: "fixed",
    pointerEvents: "none",
    margin: "0",
    padding: "0",
    border: "none",
    opacity: "0",
    zIndex: "1",
  });
  document.body.appendChild(mirror);
  return mirror;
}

/** Copy viewport rect from the real sidebar control onto the body-fixed mirror. */
export function syncTourSpotlightMirror(sourceSelector: string): boolean {
  const source = queryDesktopSidebarTourTarget(sourceSelector);
  if (!source) {
    return false;
  }
  const rect = source.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    return false;
  }
  const mirror = ensureTourSpotlightMirror();
  mirror.style.top = `${rect.top}px`;
  mirror.style.left = `${rect.left}px`;
  mirror.style.width = `${Math.max(rect.width, 1)}px`;
  mirror.style.height = `${Math.max(rect.height, 1)}px`;
  return true;
}

export function removeTourSpotlightMirror(): void {
  document.getElementById(TOUR_SPOTLIGHT_MIRROR_ID)?.remove();
}

let joyrideReflowTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced single reflow for Joyride after mirror moves (avoids resize feedback loops). */
export function scheduleJoyrideReflow(): void {
  if (joyrideReflowTimer) {
    clearTimeout(joyrideReflowTimer);
  }
  joyrideReflowTimer = setTimeout(() => {
    joyrideReflowTimer = null;
    window.dispatchEvent(new Event("resize"));
  }, 80);
}

function waitLayoutFrames(frameCount = 2): Promise<void> {
  return new Promise((resolve) => {
    let remaining = frameCount;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

/** Opens the app sidebar width only — does not change section expand/collapse. */
export const COHI_TOUR_OPEN_SIDEBAR_EVENT = "cohi-tour-open-app-sidebar";

/** Matches `duration-200` sidebar width transition + layout settle. */
const SIDEBAR_OPEN_TRANSITION_MS = 500;

let sidebarOpenEnsuredForTour = false;

export function resetTourSidebarPrepState(): void {
  sidebarOpenEnsuredForTour = false;
  if (joyrideReflowTimer) {
    clearTimeout(joyrideReflowTimer);
    joyrideReflowTimer = null;
  }
}

export function dispatchOpenAppSidebarForTour(): Promise<void> {
  window.dispatchEvent(new CustomEvent(COHI_TOUR_OPEN_SIDEBAR_EVENT));
  return new Promise((resolve) => {
    window.setTimeout(resolve, SIDEBAR_OPEN_TRANSITION_MS);
  });
}

async function ensureSidebarOpenForTour(): Promise<void> {
  if (sidebarOpenEnsuredForTour) {
    await waitLayoutFrames(1);
    return;
  }
  await dispatchOpenAppSidebarForTour();
  sidebarOpenEnsuredForTour = true;
  await waitLayoutFrames(2);
}

function scrollSidebarTargetIntoViewIfNeeded(selector: string): void {
  const el = queryDesktopSidebarTourTarget(selector);
  if (!el) return;
  const scrollParent = el.closest('[data-sidebar="content"]');
  if (!(scrollParent instanceof HTMLElement)) return;
  const elRect = el.getBoundingClientRect();
  const parentRect = scrollParent.getBoundingClientRect();
  if (elRect.top < parentRect.top || elRect.bottom > parentRect.bottom) {
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }
}

export function cohiTourElementId(dataTour: string): string {
  return `cohi-tour-${dataTour}`;
}

/** dataTour values passed from sidebar components (e.g. `sidebar-folders`). */
export function cohiTourIdFromDataTour(dataTour?: string): string | undefined {
  return dataTour ? cohiTourElementId(dataTour) : undefined;
}

export const COHI_TOUR_ACTIVE_EVENT = "cohi-tour-active";

/** While true, /insights auto-collapse is suppressed so Joyride targets stay expanded. */
export function setTourSidebarLock(active: boolean): void {
  window.dispatchEvent(
    new CustomEvent(COHI_TOUR_ACTIVE_EVENT, { detail: { active } }),
  );
  if (!active) {
    removeTourSpotlightMirror();
    resetTourSidebarPrepState();
  }
}

/** Sync mirror for a sidebar anchor; opens sidebar once per tour if needed. */
export async function prepareDesktopSidebarTourStep(
  anchor: CohiTourSidebarAnchor,
): Promise<void> {
  await ensureSidebarOpenForTour();
  const sourceSelector = desktopSidebarTourSourceSelector(anchor);
  scrollSidebarTargetIntoViewIfNeeded(sourceSelector);
  await waitLayoutFrames(2);
  syncTourSpotlightMirror(sourceSelector);
}

export async function prepareCohiSidebarTourStepFromJoyrideStep(
  step?: { data?: Record<string, unknown> },
): Promise<void> {
  const anchor = getCohiSidebarAnchorFromStep(step);
  if (anchor) {
    await prepareDesktopSidebarTourStep(anchor);
  } else {
    removeTourSpotlightMirror();
  }
}

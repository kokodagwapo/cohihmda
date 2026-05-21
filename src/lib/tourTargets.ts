/**
 * Stable Joyride anchors for the desktop Reports sidebar (nav column only).
 * IDs avoid matching the header sync icon and hidden mobile menu duplicates.
 */

export const COHI_TOUR_SIDEBAR = {
  insights: "cohi-tour-sidebar-insights",
  myDashboards: "cohi-tour-sidebar-my-dashboards",
  folders: "cohi-tour-sidebar-folders",
  history: "cohi-tour-sidebar-history",
  fullHistory: "cohi-tour-sidebar-full-history",
} as const;

export type CohiTourSidebarAnchor = keyof typeof COHI_TOUR_SIDEBAR;

export function cohiTourAnchorId(anchor: CohiTourSidebarAnchor): string {
  return COHI_TOUR_SIDEBAR[anchor];
}

export function desktopSidebarTourTarget(anchor: CohiTourSidebarAnchor): string {
  return `#${cohiTourAnchorId(anchor)}`;
}

export function isDesktopSidebarTourTarget(target: string): boolean {
  return target.startsWith("#cohi-tour-sidebar-");
}

/** Opens the app sidebar width only — does not change section expand/collapse. */
export const COHI_TOUR_OPEN_SIDEBAR_EVENT = "cohi-tour-open-app-sidebar";

/** Matches `duration-200` sidebar width transition + layout settle. */
const SIDEBAR_OPEN_TRANSITION_MS = 500;

export function dispatchOpenAppSidebarForTour(): Promise<void> {
  window.dispatchEvent(new CustomEvent(COHI_TOUR_OPEN_SIDEBAR_EVENT));
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, SIDEBAR_OPEN_TRANSITION_MS);
      });
    });
  });
}

export function cohiTourElementId(dataTour: string): string {
  return `cohi-tour-${dataTour}`;
}

/** dataTour values passed from sidebar components (e.g. `sidebar-folders`). */
export function cohiTourIdFromDataTour(dataTour?: string): string | undefined {
  return dataTour ? cohiTourElementId(dataTour) : undefined;
}

export async function prepareDesktopSidebarTourStep(
  selector: string,
): Promise<void> {
  await dispatchOpenAppSidebarForTour();
  focusDesktopSidebarTourTarget(selector);
  await new Promise((resolve) => window.setTimeout(resolve, 50));
}

export function focusDesktopSidebarTourTarget(selector: string): void {
  const el = document.querySelector(selector);
  if (!el) return;
  const scrollParent = el.closest('[data-sidebar="content"]');
  if (scrollParent instanceof HTMLElement) {
    const elRect = el.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    if (elRect.top < parentRect.top || elRect.bottom > parentRect.bottom) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  window.dispatchEvent(new Event("resize"));
}

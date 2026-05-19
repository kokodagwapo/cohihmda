/**
 * Bridge between centralized workbench chat and the active WorkbenchCanvas.
 */

import type { CanvasStateSnapshot } from "@/types/widgetActions";

export interface WorkbenchCanvasBridgeRegistration {
  draftScopeId: string;
  canvasId: string | null;
  getCanvasSnapshot: () => CanvasStateSnapshot;
  isActive: boolean;
}

let registration: WorkbenchCanvasBridgeRegistration | null = null;

export function registerWorkbenchCanvasBridge(
  next: WorkbenchCanvasBridgeRegistration | null,
): void {
  registration = next;
}

export function getWorkbenchCanvasBridge(): WorkbenchCanvasBridgeRegistration | null {
  return registration;
}

export function getWorkbenchCanvasSnapshotForDraft(
  draftScopeId: string,
): CanvasStateSnapshot | null {
  if (
    !registration?.isActive ||
    registration.draftScopeId !== draftScopeId
  ) {
    return null;
  }
  return registration.getCanvasSnapshot();
}

export function getWorkbenchCanvasIdForDraft(
  draftScopeId: string,
): string | null {
  if (registration?.draftScopeId !== draftScopeId) return null;
  return registration.canvasId;
}

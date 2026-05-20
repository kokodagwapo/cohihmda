/**
 * Persists in-memory layout for unsaved workbench drafts across shell remounts
 * (e.g. stacked ↔ split chat layout) until the canvas is saved.
 */

import type {
  CanvasAnnotation,
  CanvasBackground,
  CanvasLayoutItem,
  CanvasUpload,
} from "@/components/workbench/canvas/types";

const STORAGE_KEY = "cohi_workbench_draft_layouts";

/** Dispatched before chat shell layout mode changes so canvases can flush drafts. */
export const WORKBENCH_FLUSH_DRAFT_LAYOUT_EVENT = "workbench:flush-draft-layout";

export interface WorkbenchDraftLayoutSnapshot {
  items: CanvasLayoutItem[];
  annotations: CanvasAnnotation[];
  uploads: CanvasUpload[];
  background: CanvasBackground;
  updatedAt: number;
}

const memoryCache = new Map<string, WorkbenchDraftLayoutSnapshot>();

function readMap(): Record<string, WorkbenchDraftLayoutSnapshot> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw
      ? (JSON.parse(raw) as Record<string, WorkbenchDraftLayoutSnapshot>)
      : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, WorkbenchDraftLayoutSnapshot>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private browsing */
  }
}

export function saveWorkbenchDraftLayout(
  draftScopeId: string,
  snapshot: Omit<WorkbenchDraftLayoutSnapshot, "updatedAt">,
): void {
  if (!draftScopeId || snapshot.items.length === 0) return;
  const entry: WorkbenchDraftLayoutSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
  };
  memoryCache.set(draftScopeId, entry);
  const map = readMap();
  map[draftScopeId] = entry;
  writeMap(map);
}

export function loadWorkbenchDraftLayout(
  draftScopeId: string,
): WorkbenchDraftLayoutSnapshot | null {
  if (!draftScopeId) return null;
  const fromMemory = memoryCache.get(draftScopeId);
  if (fromMemory?.items?.length) return fromMemory;
  const entry = readMap()[draftScopeId];
  if (!entry?.items?.length) return null;
  memoryCache.set(draftScopeId, entry);
  return entry;
}

export function clearWorkbenchDraftLayout(draftScopeId: string): void {
  if (!draftScopeId) return;
  memoryCache.delete(draftScopeId);
  const map = readMap();
  if (!map[draftScopeId]) return;
  delete map[draftScopeId];
  writeMap(map);
}

export function dispatchWorkbenchFlushDraftLayout(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKBENCH_FLUSH_DRAFT_LAYOUT_EVENT));
}

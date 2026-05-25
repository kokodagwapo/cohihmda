import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import {
  useWidgetSectionStore,
  type SectionFilters,
} from "@/stores/widgetSectionStore";
import type {
  CanvasAnnotation,
  CanvasBackground,
  CanvasLayoutItem,
  CanvasUpload,
} from "@/components/workbench/canvas/types";

export type SaveStatus = "saved" | "saving" | "unsaved" | "idle";

function compactFiltersForPersistence(
  filters: Partial<SectionFilters> | undefined,
): Partial<SectionFilters> | undefined {
  if (!filters) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      if (Object.keys(v as Record<string, unknown>).length === 0) continue;
    }
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? (out as Partial<SectionFilters>) : undefined;
}

export type WorkbenchSaveIndicator = {
  label: string;
  className: string;
  icon: React.ReactNode;
} | null;

export type UseWorkbenchAutosaveParams = {
  items: CanvasLayoutItem[];
  annotations: CanvasAnnotation[];
  canvasBackground: CanvasBackground;
  uploads: CanvasUpload[];
  saveTitle: string;
  canvasId: string | null;
  isOwner: boolean;
  tenantId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (canvasId: string, title: string) => void;
  lastSavedSnapshotRef: React.MutableRefObject<string>;
  manualSavingRef: React.MutableRefObject<boolean>;
  loadCanvasId?: string | null;
  chatDraftScopeId?: string;
};

export function useWorkbenchAutosave({
  items,
  annotations,
  canvasBackground,
  uploads,
  saveTitle,
  canvasId,
  isOwner,
  tenantId,
  onDirtyChange,
  onSaved,
  lastSavedSnapshotRef,
  manualSavingRef,
}: UseWorkbenchAutosaveParams) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedRevision, setSavedRevision] = useState(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentSnapshot = useMemo(() => {
    try {
      return JSON.stringify({
        items,
        annotations,
        bg: canvasBackground,
        uploads,
        title: saveTitle,
      });
    } catch {
      return "";
    }
  }, [items, annotations, canvasBackground, uploads, saveTitle]);

  const buildLayoutWithLatestGroupFilters = useCallback(
    (layoutItems: CanvasLayoutItem[]): CanvasLayoutItem[] => {
      const sections = useWidgetSectionStore.getState().sections;
      return layoutItems.map((it) => {
        if (it.type !== "widget_group" || it.payload.type !== "widget_group")
          return it;
        const current = sections[it.payload.groupId];
        if (!current) return it;
        const mergedSavedFilters = compactFiltersForPersistence({
          ...(it.payload.savedFilters || {}),
          ...current,
        });
        return {
          ...it,
          payload: {
            ...it.payload,
            ...(mergedSavedFilters ? { savedFilters: mergedSavedFilters } : {}),
          },
        };
      });
    },
    [],
  );

  const persistExistingCanvas = useCallback(
    async (options?: { keepalive?: boolean }) => {
      if (!canvasId || !isOwner) return null;

      const title = saveTitle.trim() || "Untitled canvas";
      const persistedLayout = buildLayoutWithLatestGroupFilters(items);
      const content = {
        layoutVersion: "freeform-v1",
        layout: persistedLayout,
        annotations,
        background: canvasBackground,
        uploadsMeta: uploads,
      };
      const snapshot = JSON.stringify({
        items: persistedLayout,
        annotations,
        bg: canvasBackground,
        uploads,
        title: saveTitle,
      });
      const saveTenantQs = tenantId
        ? `?tenant_id=${encodeURIComponent(tenantId)}`
        : "";
      const url = `/api/workbench/canvases/${canvasId}${saveTenantQs}`;
      const body = JSON.stringify({ title, content });

      if (options?.keepalive) {
        void fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body,
          keepalive: true,
        });
        return { title, snapshot };
      }

      await api.request(url, { method: "PUT", body });
      lastSavedSnapshotRef.current = snapshot;
      setSavedRevision((r) => r + 1);
      onSaved?.(canvasId, title);
      return { title, snapshot };
    },
    [
      annotations,
      buildLayoutWithLatestGroupFilters,
      canvasBackground,
      canvasId,
      isOwner,
      items,
      lastSavedSnapshotRef,
      onSaved,
      saveTitle,
      tenantId,
      uploads,
    ],
  );

  const isDirty = useMemo(() => {
    if (!lastSavedSnapshotRef.current) return false;
    return currentSnapshot !== lastSavedSnapshotRef.current;
    // savedRevision: ref updates do not re-render; bump after persist/load
  }, [currentSnapshot, savedRevision]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (isDirty && saveStatus !== "saving") {
      setSaveStatus("unsaved");
    } else if (!isDirty && saveStatus !== "saving") {
      setSaveStatus(canvasId ? "saved" : "idle");
    }
  }, [isDirty, canvasId, saveStatus]);

  useEffect(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (!canvasId || !isDirty || !isOwner) return;

    autosaveTimerRef.current = setTimeout(async () => {
      if (manualSavingRef.current) return;
      setSaveStatus("saving");
      try {
        await persistExistingCanvas();
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    }, 5000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    canvasId,
    currentSnapshot,
    isDirty,
    isOwner,
    manualSavingRef,
    persistExistingCanvas,
  ]);

  useEffect(() => {
    if (!canvasId || !isOwner || !isDirty) return;
    const handlePageHide = () => {
      void persistExistingCanvas({ keepalive: true });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [canvasId, isDirty, isOwner, persistExistingCanvas]);

  const saveIndicator = useMemo((): WorkbenchSaveIndicator => {
    if (!isOwner) {
      if (!canvasId) return null;
      return {
        label: "View only",
        className:
          "text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap flex items-center justify-end gap-1",
        icon: React.createElement(Lock, { className: "h-3 w-3" }),
      };
    }
    if (saveStatus === "saving") {
      return {
        label: "Saving...",
        className:
          "text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap",
        icon: null,
      };
    }
    if (saveStatus === "saved" && canvasId && !isDirty) {
      return {
        label: "Saved",
        className:
          "text-[11px] text-emerald-600 dark:text-emerald-400 whitespace-nowrap",
        icon: null,
      };
    }
    if (saveStatus === "unsaved" && canvasId && isDirty) {
      return {
        label: "Unsaved changes",
        className:
          "text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap",
        icon: null,
      };
    }
    return null;
  }, [canvasId, isDirty, isOwner, saveStatus]);

  const syncSavedSnapshot = useCallback((snapshot: string) => {
    lastSavedSnapshotRef.current = snapshot;
    setSavedRevision((r) => r + 1);
  }, [lastSavedSnapshotRef]);

  return {
    saveStatus,
    setSaveStatus,
    isDirty,
    currentSnapshot,
    saveIndicator,
    persistExistingCanvas,
    buildLayoutWithLatestGroupFilters,
    syncSavedSnapshot,
  };
}

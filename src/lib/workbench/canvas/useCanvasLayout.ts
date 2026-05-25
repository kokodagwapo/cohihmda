import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useCanvasHistory } from "@/hooks/useCanvasHistory";
import type {
  CanvasAnnotation,
  CanvasLayoutItem,
} from "@/components/workbench/canvas/types";

export type UseCanvasLayoutOptions = {
  initialItems: CanvasLayoutItem[];
  initialAnnotations?: CanvasAnnotation[];
  canEdit: boolean;
};

/** Layout history + rect/payload updates and z-order helpers for the workbench canvas. */
export function useCanvasLayout({
  initialItems,
  initialAnnotations = [],
  canEdit,
}: UseCanvasLayoutOptions) {
  const { toast } = useToast();
  const history = useCanvasHistory<CanvasLayoutItem, CanvasAnnotation>(
    initialItems,
    initialAnnotations,
  );
  const {
    items,
    annotations,
    setItems,
    setItemsWithHistory,
    setAnnotations,
    setAnnotationsWithHistory,
    setBothWithHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = history;

  const updateItemRect = useCallback(
    (
      id: string,
      next: Partial<Pick<CanvasLayoutItem, "x" | "y" | "w" | "h">>,
      withHistory = false,
    ) => {
      if (!canEdit) return;
      const clamped = { ...next };
      if (clamped.x !== undefined) clamped.x = Math.max(0, clamped.x);
      if (clamped.y !== undefined) clamped.y = Math.max(0, clamped.y);
      const setter = withHistory ? setItemsWithHistory : setItems;
      setter((prev) =>
        prev.map((i) => (i.i === id ? { ...i, ...clamped } : i)),
      );
    },
    [canEdit, setItems, setItemsWithHistory],
  );

  const updateWidgetPayload = useCallback(
    (
      id: string,
      payload: CanvasLayoutItem["payload"],
      options?: { recordHistory?: boolean },
    ) => {
      if (!canEdit) return;
      const mapper = (prev: CanvasLayoutItem[]) =>
        prev.map((i) => {
          if (i.i !== id) return i;
          try {
            if (JSON.stringify(i.payload) === JSON.stringify(payload)) return i;
          } catch {
            /* update on serialization failure */
          }
          return { ...i, payload };
        });
      if (options?.recordHistory) {
        setItemsWithHistory(mapper);
      } else {
        setItems(mapper);
      }
    },
    [canEdit, setItems, setItemsWithHistory],
  );

  const bringToFront = useCallback(
    (id: string) => {
      setItemsWithHistory((prev) => {
        const idx = prev.findIndex((p) => p.i === id);
        if (idx < 0) return prev;
        const item = prev[idx];
        return [...prev.slice(0, idx), ...prev.slice(idx + 1), item];
      });
      toast({ title: "Brought to front" });
    },
    [setItemsWithHistory, toast],
  );

  const sendToBack = useCallback(
    (id: string) => {
      setItemsWithHistory((prev) => {
        const idx = prev.findIndex((p) => p.i === id);
        if (idx < 0) return prev;
        const item = prev[idx];
        return [item, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
      toast({ title: "Sent to back" });
    },
    [setItemsWithHistory, toast],
  );

  return {
    items,
    annotations,
    setItems,
    setAnnotations,
    setItemsWithHistory,
    setAnnotationsWithHistory,
    setBothWithHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    updateItemRect,
    updateWidgetPayload,
    bringToFront,
    sendToBack,
  };
}

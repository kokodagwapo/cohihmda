import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWorkbenchAutosave } from "./useWorkbenchAutosave";
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

vi.mock("@/lib/api", () => ({
  api: { request: vi.fn().mockResolvedValue({}) },
}));

const baseItem: CanvasLayoutItem = {
  i: "w1",
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  type: "text_block",
  payload: { type: "text_block", content: "x", title: "" },
};

describe("useWorkbenchAutosave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("save indicator transitions saved -> unsaved -> saving -> saved", async () => {
    const snapshot = (items: CanvasLayoutItem[]) =>
      JSON.stringify({
        items,
        annotations: [],
        bg: { type: "color", value: "#fff" },
        uploads: [],
        title: "Test",
      });
    const lastSavedSnapshotRef = { current: snapshot([baseItem]) };
    const manualSavingRef = { current: false };

    const { result, rerender } = renderHook(
      (props: { items: CanvasLayoutItem[] }) =>
        useWorkbenchAutosave({
          items: props.items,
          annotations: [],
          canvasBackground: { type: "color", value: "#fff" },
          uploads: [],
          saveTitle: "Test",
          canvasId: "canvas-1",
          isOwner: true,
          lastSavedSnapshotRef,
          manualSavingRef,
        }),
      { initialProps: { items: [baseItem] } },
    );

    expect(result.current.saveIndicator?.label).toBe("Saved");

    const changed: CanvasLayoutItem = {
      ...baseItem,
      payload: { type: "text_block", content: "changed", title: "" },
    };
    rerender({ items: [changed] });

    await waitFor(() => {
      expect(result.current.saveIndicator?.label).toBe("Unsaved changes");
    });

    act(() => {
      result.current.setSaveStatus("saving");
    });
    expect(result.current.saveIndicator?.label).toBe("Saving...");

    act(() => {
      result.current.syncSavedSnapshot(snapshot([changed]));
      result.current.setSaveStatus("saved");
    });

    await waitFor(() => {
      expect(result.current.saveIndicator?.label).toBe("Saved");
    });
  });
});

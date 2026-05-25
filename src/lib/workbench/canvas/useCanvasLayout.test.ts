import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasLayout } from "./useCanvasLayout";
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("useCanvasLayout", () => {
  it("undo after updateWidgetPayload restores prior payload", () => {
    const initial: CanvasLayoutItem[] = [
      {
        i: "a",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        type: "text_block",
        payload: { type: "text_block", content: "before", title: "" },
      },
    ];
    const { result } = renderHook(() =>
      useCanvasLayout({ initialItems: initial, canEdit: true }),
    );

    act(() => {
      result.current.updateWidgetPayload(
        "a",
        { type: "text_block", content: "after", title: "" },
        { recordHistory: true },
      );
    });
    expect(
      (result.current.items[0].payload as { content: string }).content,
    ).toBe("after");

    act(() => {
      result.current.undo();
    });
    expect(
      (result.current.items[0].payload as { content: string }).content,
    ).toBe("before");
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import {
  clearWorkbenchDraftLayout,
  loadWorkbenchDraftLayout,
  saveWorkbenchDraftLayout,
} from "./workbenchDraftLayoutCache";
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

const draftScopeId = "test-draft-scope";

const sampleItem: CanvasLayoutItem = {
  i: "w1",
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  type: "kpi",
  payload: { type: "kpi", title: "Revenue", config: { type: "kpi", title: "Revenue", data: [] } },
};

describe("workbenchDraftLayoutCache", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearWorkbenchDraftLayout(draftScopeId);
  });

  it("round-trips draft layout by draft scope id", () => {
    saveWorkbenchDraftLayout(draftScopeId, {
      items: [sampleItem],
      annotations: [],
      uploads: [],
      background: { type: "color", value: "#ffffff" },
    });
    const loaded = loadWorkbenchDraftLayout(draftScopeId);
    expect(loaded?.items).toHaveLength(1);
    expect(loaded?.items[0].i).toBe("w1");
  });

  it("clear removes cached layout", () => {
    saveWorkbenchDraftLayout(draftScopeId, {
      items: [sampleItem],
      annotations: [],
      uploads: [],
      background: { type: "color", value: "#ffffff" },
    });
    clearWorkbenchDraftLayout(draftScopeId);
    expect(loadWorkbenchDraftLayout(draftScopeId)).toBeNull();
  });
});

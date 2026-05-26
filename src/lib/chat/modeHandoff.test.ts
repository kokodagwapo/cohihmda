import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveGlobalStreamRouting } from "./modeHandoff";

describe("resolveGlobalStreamRouting", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_UNIFIED_CHAT_MODE_HANDOFF", "true");
  });

  it("uses workbench_canvas scope on my-dashboard canvas for research", () => {
    const pathname = "/my-dashboard/canvas-abc-123";
    const routing = resolveGlobalStreamRouting({
      chatType: "research",
      pathname,
      workbenchCanvasId: null,
    });
    expect(routing.location.surface).toBe("workbench_canvas");
    expect(routing.scope).toEqual({ type: "canvas", id: "canvas-abc-123" });
  });

  it("defaults to global_session for research off canvas routes", () => {
    const routing = resolveGlobalStreamRouting({
      chatType: "research",
      pathname: "/data-chat",
    });
    expect(routing.location.surface).toBe("data_chat_page");
    expect(routing.scope).toEqual({ type: "global_session" });
  });

  it("defaults to global_session for insight_builder on canvas", () => {
    const routing = resolveGlobalStreamRouting({
      chatType: "insight_builder",
      pathname: "/my-dashboard/canvas-xyz",
    });
    expect(routing.scope).toEqual({ type: "global_session" });
  });
});

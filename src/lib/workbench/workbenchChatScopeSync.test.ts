import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  activeContextToScopeRef,
  buildActiveContextFromTab,
  detectGreenfieldWorkbenchPrompt,
  detectNewCanvasIntent,
  getWorkbenchScopeSyncTelemetryCounts,
  isWorkbenchChatScopeSyncEnabled,
  scopeRefsEqual,
  shouldConfirmNewCanvasBeforeSend,
  trackWorkbenchScopeSyncEvent,
} from "./workbenchChatScopeSync";

describe("workbenchChatScopeSync", () => {
  it("isWorkbenchChatScopeSyncEnabled follows unified chat", async () => {
    const { isUnifiedChatClientEnabled } = await import(
      "@/lib/unifiedChatEnvelope"
    );
    expect(isWorkbenchChatScopeSyncEnabled()).toBe(
      isUnifiedChatClientEnabled(),
    );
  });

  it("detectGreenfieldWorkbenchPrompt matches starters and explicit new-canvas phrases", () => {
    expect(detectNewCanvasIntent("put this on a new canvas")).toBe(true);
    expect(detectNewCanvasIntent("create a separate canvas for sales")).toBe(
      true,
    );
    expect(
      detectGreenfieldWorkbenchPrompt(
        "Build an executive dashboard with key KPIs",
      ),
    ).toBe(true);
    expect(
      detectGreenfieldWorkbenchPrompt(
        "Prepare a board-ready overview of this month's performance",
      ),
    ).toBe(true);
    expect(detectNewCanvasIntent("show me a new view of revenue")).toBe(false);
    expect(
      detectGreenfieldWorkbenchPrompt("Summarize pipeline health trends"),
    ).toBe(false);
  });

  it("shouldConfirmNewCanvasBeforeSend after new chat on populated canvas", () => {
    expect(
      shouldConfirmNewCanvasBeforeSend("Build an executive dashboard with key KPIs", {
        firstTurnAfterNewChat: true,
        canvasHasContent: true,
      }),
    ).toBe(true);
    expect(
      shouldConfirmNewCanvasBeforeSend(
        "What needs my attention right now?",
        { firstTurnAfterNewChat: true, canvasHasContent: true },
      ),
    ).toBe(false);
  });

  it("scopeRefsEqual compares type and id", () => {
    expect(
      scopeRefsEqual(
        { type: "canvas", id: "a" },
        { type: "canvas", id: "a" },
      ),
    ).toBe(true);
    expect(
      scopeRefsEqual(
        { type: "canvas", id: "a" },
        { type: "draft", id: "a" },
      ),
    ).toBe(false);
  });

  it("buildActiveContextFromTab maps saved vs draft tabs", () => {
    const saved = buildActiveContextFromTab({
      tabId: "canvas-uuid",
      tabTitle: "Q1 Board",
      tabDraftScopes: {},
    });
    expect(saved.isSavedCanvas).toBe(true);
    expect(saved.canvasId).toBe("canvas-uuid");
    expect(saved.draftScopeId).toContain("canvas-tab:");

    const draft = buildActiveContextFromTab({
      tabId: "new-123",
      tabTitle: "New Canvas",
      tabDraftScopes: { "new-123": "draft-abc" },
    });
    expect(draft.isSavedCanvas).toBe(false);
    expect(draft.canvasId).toBeNull();
    expect(draft.draftScopeId).toBe("draft-abc");
  });

  it("activeContextToScopeRef uses canvas id when saved", () => {
    const ctx = buildActiveContextFromTab({
      tabId: "id-1",
      tabTitle: "T",
      tabDraftScopes: {},
    });
    expect(activeContextToScopeRef(ctx)).toEqual({
      type: "canvas",
      id: "id-1",
      label: "T",
    });
  });

  it("trackWorkbenchScopeSyncEvent increments telemetry", () => {
    trackWorkbenchScopeSyncEvent("scope_switch_prompt_shown");
    const counts = getWorkbenchScopeSyncTelemetryCounts();
    expect(counts.scope_switch_prompt_shown).toBeGreaterThanOrEqual(1);
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  activeContextToScopeRef,
  buildActiveContextFromTab,
  buildWorkbenchChatScopeAfterCanvasSave,
  buildWorkbenchCanvasScopeQueries,
  detectGreenfieldWorkbenchPrompt,
  detectNewCanvasIntent,
  getWorkbenchScopeSyncTelemetryCounts,
  isWorkbenchChatScopeSyncEnabled,
  scopeRefsEqual,
  shouldConfirmNewCanvasBeforeSend,
  shouldPromoteWorkbenchChatScopeOnCanvasSave,
  trackWorkbenchScopeSyncEvent,
  workbenchScopeMatchesActiveContext,
  isGreenfieldWorkbenchTab,
} from "./workbenchChatScopeSync";
import {
  draftScopeIdForCanvasTab,
  rememberWorkbenchDraftTab,
} from "./workbenchChatHandoff";

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
        "Summarize pipeline health and pull-through trends",
        { firstTurnAfterNewChat: true, canvasHasContent: true },
      ),
    ).toBe(false);
  });

  it("shouldConfirmNewCanvasBeforeSend skips greenfield starters on empty canvas", () => {
    expect(
      shouldConfirmNewCanvasBeforeSend(
        "Prepare a board-ready overview of this month's performance",
        { canvasHasContent: false },
      ),
    ).toBe(false);
    expect(
      shouldConfirmNewCanvasBeforeSend(
        "Build an executive dashboard with funded volume, pull-through, and cycle time KPIs",
        { canvasHasContent: true },
      ),
    ).toBe(true);
  });

  it("workbenchScopeMatchesActiveContext treats canvas and canvas-tab draft as same tab", () => {
    const ctx = buildActiveContextFromTab({
      tabId: "canvas-uuid",
      tabTitle: "Q1 Board",
      tabDraftScopes: {},
    });
    expect(
      workbenchScopeMatchesActiveContext(
        { type: "draft", id: draftScopeIdForCanvasTab("canvas-uuid") },
        ctx,
      ),
    ).toBe(true);
    expect(
      workbenchScopeMatchesActiveContext(
        { type: "canvas", id: "canvas-uuid" },
        ctx,
      ),
    ).toBe(true);
    expect(
      workbenchScopeMatchesActiveContext(
        { type: "canvas", id: "other-canvas" },
        ctx,
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

  it("isGreenfieldWorkbenchTab is true for unsaved new-* tabs only", () => {
    expect(
      isGreenfieldWorkbenchTab(
        buildActiveContextFromTab({
          tabId: "new-1",
          tabTitle: "New Canvas",
          tabDraftScopes: { "new-1": "draft-a" },
        }),
      ),
    ).toBe(true);
    expect(
      isGreenfieldWorkbenchTab(
        buildActiveContextFromTab({
          tabId: "canvas-uuid",
          tabTitle: "Board",
          tabDraftScopes: {},
        }),
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

    const draftWithoutMap = buildActiveContextFromTab({
      tabId: "new-456",
      tabTitle: "New Canvas",
      tabDraftScopes: {},
    });
    expect(draftWithoutMap.draftScopeId).not.toContain("new-456");
    expect(draftWithoutMap.draftScopeId).not.toMatch(/^canvas-tab:new-/);
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

  it("shouldPromoteWorkbenchChatScopeOnCanvasSave when conversation matches greenfield draft", () => {
    const detail = {
      canvasId: "saved-uuid",
      title: "High Performers",
      draftScopeId: "draft-green",
    };
    expect(
      shouldPromoteWorkbenchChatScopeOnCanvasSave(detail, {
        type: "draft",
        id: "draft-green",
      }),
    ).toBe(true);
    expect(
      shouldPromoteWorkbenchChatScopeOnCanvasSave(detail, {
        type: "canvas",
        id: "other",
      }),
    ).toBe(false);
  });

  it("buildWorkbenchChatScopeAfterCanvasSave uses canvas scope", () => {
    expect(
      buildWorkbenchChatScopeAfterCanvasSave({
        canvasId: "id-1",
        title: "Board",
      }),
    ).toEqual({ type: "canvas", id: "id-1", label: "Board" });
  });

  it("buildWorkbenchCanvasScopeQueries includes canvas and legacy draft keys", () => {
    const queries = buildWorkbenchCanvasScopeQueries("canvas-uuid");
    expect(queries).toEqual(
      expect.arrayContaining([
        { scope_type: "canvas", scope_key: "canvas-uuid" },
        { scope_type: "draft", scope_key: "canvas-tab:canvas-uuid" },
        { scope_type: "draft", scope_key: "canvas:canvas-uuid" },
      ]),
    );
  });

  it("workbenchScopeMatchesActiveContext links greenfield draft to promoted tab", () => {
    rememberWorkbenchDraftTab("draft-green", "saved-uuid");
    const ctx = buildActiveContextFromTab({
      tabId: "saved-uuid",
      tabTitle: "High Performers",
      tabDraftScopes: {
        "saved-uuid": draftScopeIdForCanvasTab("saved-uuid"),
      },
    });
    expect(
      workbenchScopeMatchesActiveContext(
        { type: "draft", id: "draft-green" },
        ctx,
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  consumePendingWorkbenchActions,
  deliverWorkbenchWidgetActions,
  EXECUTABLE_WORKBENCH_ACTION_TYPES,
  filterExecutableWorkbenchActions,
  gateWorkbenchActionsForUserQuestion,
  describeWorkbenchActionsApplied,
  shouldForceNewWorkbenchConversation,
  buildCarryOverContext,
  shouldForkOnChatTypeChange,
  generateWorkbenchDraftScopeId,
  isMyDashboardCanvasPath,
  setActiveWorkbenchDraftScope,
  getOrCreateActiveWorkbenchDraftScope,
  resetActiveWorkbenchDraftSession,
  bindWorkbenchEditDraftScope,
  draftScopeIdForCanvasTab,
  getMyDashboardCanvasIdFromPath,
  resolveWorkbenchEditDraftScope,
} from "./workbenchChatHandoff";
import { registerWorkbenchCanvasBridge } from "./workbenchCanvasBridge";
import type { WidgetAction } from "@/types/widgetActions";

describe("workbenchChatHandoff", () => {
  it("buildCarryOverContext summarizes recent turns with cap", () => {
    expect(buildCarryOverContext([])).toBe("");
    expect(
      buildCarryOverContext([
        { role: "user", content: "Build MTD dashboard" },
        { role: "assistant", content: "Here is your dashboard." },
      ]),
    ).toContain("Build MTD dashboard");
    const long = buildCarryOverContext(
      [{ role: "user", content: "x".repeat(2000) }],
      { maxChars: 100 },
    );
    expect(long.length).toBeLessThanOrEqual(100);
  });

  it("shouldForkOnChatTypeChange when session has messages", () => {
    expect(
      shouldForkOnChatTypeChange({
        previousChatType: "workbench",
        nextChatType: "chat",
        currentSessionId: "abc",
        messageCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldForkOnChatTypeChange({
        previousChatType: "chat",
        nextChatType: "chat",
        currentSessionId: "abc",
        messageCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldForkOnChatTypeChange({
        previousChatType: "workbench",
        nextChatType: "chat",
        currentSessionId: null,
        messageCount: 2,
      }),
    ).toBe(false);
  });

  it("shouldForceNewWorkbenchConversation only on first compact turn", () => {
    expect(
      shouldForceNewWorkbenchConversation({
        isShellCompact: true,
        currentSessionId: null,
        userTurnCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldForceNewWorkbenchConversation({
        isShellCompact: true,
        currentSessionId: "sess-1",
        userTurnCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldForceNewWorkbenchConversation({
        isShellCompact: false,
        currentSessionId: null,
        userTurnCount: 0,
      }),
    ).toBe(false);
  });

  it("describeWorkbenchActionsApplied distinguishes group updates from creates", () => {
    expect(
      describeWorkbenchActionsApplied([
        {
          type: "modify_group",
          groupId: "g1",
          operations: [{ op: "set_period", period: "YTD" }],
        },
      ] as WidgetAction[]),
    ).toBe("Updated dashboard period");

    expect(
      describeWorkbenchActionsApplied([
        {
          type: "create_widget",
          sql: "SELECT 1",
          title: "A",
          config: { type: "kpi", title: "A", data: [] },
        },
      ] as WidgetAction[]),
    ).toBe("Applied 1 widget to canvas");
  });

  it("filterExecutableWorkbenchActions keeps known types only", () => {
    const actions = [
      { type: "create_widget", sql: "SELECT 1", title: "A", config: { type: "kpi", title: "A", data: [] } },
      { type: "teach", message: "hint" },
    ] as WidgetAction[];
    const filtered = filterExecutableWorkbenchActions(actions);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("create_widget");
  });

  it("filterExecutableWorkbenchActions normalizes modify_registry_widget to modify_widget", () => {
    const filtered = filterExecutableWorkbenchActions([
      {
        type: "modify_registry_widget",
        groupId: "g1",
        widgetId: "w__0",
        configOverrides: { chartType: "line" },
        explanation: "line",
      },
    ] as WidgetAction[]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({
      type: "modify_widget",
      target: "registry",
      groupId: "g1",
      widgetId: "w__0",
      configPatch: { chartType: "line" },
    });
  });

  it("generateWorkbenchDraftScopeId returns non-empty string", () => {
    expect(generateWorkbenchDraftScopeId().length).toBeGreaterThan(8);
  });

  it("EXECUTABLE_WORKBENCH_ACTION_TYPES includes create_widget", () => {
    expect(EXECUTABLE_WORKBENCH_ACTION_TYPES.has("create_widget")).toBe(true);
  });

  it("deliverWorkbenchWidgetActions stashes when canvas is not mounted", () => {
    registerWorkbenchCanvasBridge(null);
    const draftScopeId = "draft-deliver-test";
    const actions = [
      {
        type: "create_widget",
        sql: "SELECT 1",
        title: "A",
        config: { type: "kpi", title: "A", data: [] },
      },
    ] as WidgetAction[];
    deliverWorkbenchWidgetActions(draftScopeId, actions);
    expect(consumePendingWorkbenchActions(draftScopeId)).toHaveLength(1);
    expect(consumePendingWorkbenchActions(draftScopeId)).toHaveLength(0);
  });

  it("deliverWorkbenchWidgetActions uses active bridge draft scope", () => {
    const sessionDraft = "session-draft-id";
    const bridgeDraft = "bridge-draft-id";
    const dispatched: Array<{ draftScopeId?: string }> = [];
    const handler = (e: Event) => {
      dispatched.push((e as CustomEvent).detail);
    };
    window.addEventListener("workbench:apply-cohi-actions", handler);
    registerWorkbenchCanvasBridge({
      draftScopeId: bridgeDraft,
      canvasId: "canvas-1",
      isActive: true,
      getCanvasSnapshot: () => ({
        groups: [],
        standaloneWidgets: [],
        totalItems: 0,
      }),
    });
    const actions = [
      {
        type: "create_widget",
        sql: "SELECT 1",
        title: "A",
        config: { type: "kpi", title: "A", data: [] },
      },
    ] as WidgetAction[];
    deliverWorkbenchWidgetActions(sessionDraft, actions);
    expect(dispatched[0]?.draftScopeId).toBe(bridgeDraft);
    window.removeEventListener("workbench:apply-cohi-actions", handler);
    registerWorkbenchCanvasBridge(null);
  });

  it("setActiveWorkbenchDraftScope updates session storage", () => {
    resetActiveWorkbenchDraftSession();
    setActiveWorkbenchDraftScope("scoped-abc");
    expect(getOrCreateActiveWorkbenchDraftScope()).toBe("scoped-abc");
    resetActiveWorkbenchDraftSession();
  });

  it("isMyDashboardCanvasPath recognizes canvas routes", () => {
    expect(isMyDashboardCanvasPath("/my-dashboard")).toBe(true);
    expect(isMyDashboardCanvasPath("/my-dashboard/uuid-here")).toBe(true);
    expect(isMyDashboardCanvasPath("/workbench")).toBe(false);
  });

  it("draftScopeIdForCanvasTab is stable per canvas id", () => {
    expect(draftScopeIdForCanvasTab("abc-123")).toBe("canvas-tab:abc-123");
    expect(draftScopeIdForCanvasTab("abc-123")).toBe(
      draftScopeIdForCanvasTab("abc-123"),
    );
  });

  it("getMyDashboardCanvasIdFromPath parses saved canvas routes", () => {
    expect(getMyDashboardCanvasIdFromPath("/my-dashboard/canvas-uuid")).toBe(
      "canvas-uuid",
    );
    expect(getMyDashboardCanvasIdFromPath("/my-dashboard/new")).toBeNull();
    expect(getMyDashboardCanvasIdFromPath("/my-dashboard")).toBeNull();
  });

  it("resolveWorkbenchEditDraftScope prefers stable canvas-tab scope", () => {
    expect(
      resolveWorkbenchEditDraftScope({
        draftScopeId: "random-uuid",
        canvasId: "canvas-abc",
      }),
    ).toBe("canvas-tab:canvas-abc");
  });

  it("bindWorkbenchEditDraftScope stores canvas-tab scope in session", () => {
    resetActiveWorkbenchDraftSession();
    bindWorkbenchEditDraftScope({
      draftScopeId: "stale",
      canvasId: "id-1",
    });
    expect(getOrCreateActiveWorkbenchDraftScope()).toBe("canvas-tab:id-1");
    resetActiveWorkbenchDraftSession();
  });

  it("scheduleWorkbenchConversationResume dispatches cohi-chat-resume", async () => {
    const { scheduleWorkbenchConversationResume } = await import(
      "./workbenchChatHandoff"
    );
    const received: string[] = [];
    const handler = (e: Event) => {
      received.push((e as CustomEvent).detail.conversationId);
    };
    window.addEventListener("cohi-chat-resume", handler);
    scheduleWorkbenchConversationResume("conv-123");
    await Promise.resolve();
    expect(received).toEqual(["conv-123"]);
    window.removeEventListener("cohi-chat-resume", handler);
  });
});

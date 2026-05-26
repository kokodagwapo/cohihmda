import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  readDashboardGroundingHandoff,
  resolveModeHandoffContext,
} from "./dashboardGrounding.js";

describe("dashboardGrounding", () => {
  const prev = process.env.UNIFIED_CHAT_DASHBOARD_GROUNDING;

  beforeEach(() => {
    process.env.UNIFIED_CHAT_DASHBOARD_GROUNDING = "true";
    delete process.env.UNIFIED_CHAT_MODE_HANDOFF;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.UNIFIED_CHAT_DASHBOARD_GROUNDING;
    else process.env.UNIFIED_CHAT_DASHBOARD_GROUNDING = prev;
  });

  it("reads canvas-only dashboard grounding without fromConversationId", () => {
    const body = {
      conversationId: "conv-1",
      message: "investigate",
      chat_type: "research",
      context: {
        dashboardGrounding: {
          canvasState: {
            groups: [],
            standaloneWidgets: [{ id: "w1" }],
            totalItems: 1,
          },
          canvasTitle: "Exec board",
        },
      },
    } as Parameters<typeof readDashboardGroundingHandoff>[0];

    const handoff = readDashboardGroundingHandoff(body);
    expect(handoff?.canvasState?.totalItems).toBe(1);
    expect(handoff?.fromConversationId).toBe("conv-1");
    expect(handoff?.canvasTitle).toBe("Exec board");
  });

  it("resolveModeHandoffContext prefers explicit handoff when present", () => {
    const body = {
      conversationId: "c2",
      message: "x",
      chat_type: "research",
      context: {
        modeHandoffContext: {
          fromConversationId: "wb-1",
          fromChatType: "workbench",
          widgetCatalog: "widgets",
        },
        dashboardGrounding: {
          canvasState: { groups: [], standaloneWidgets: [], totalItems: 2 },
        },
      },
    } as Parameters<typeof resolveModeHandoffContext>[0];

    const resolved = resolveModeHandoffContext(body);
    expect(resolved?.fromConversationId).toBe("wb-1");
    expect(resolved?.widgetCatalog).toBe("widgets");
  });
});

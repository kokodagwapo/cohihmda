import { describe, it, expect, afterEach } from "vitest";
import { isModeHandoffEnabled, readModeHandoffContext } from "./modeHandoff.js";

describe("modeHandoff", () => {
  const prev = process.env.UNIFIED_CHAT_MODE_HANDOFF;

  afterEach(() => {
    if (prev === undefined) delete process.env.UNIFIED_CHAT_MODE_HANDOFF;
    else process.env.UNIFIED_CHAT_MODE_HANDOFF = prev;
  });

  it("is enabled by default", () => {
    delete process.env.UNIFIED_CHAT_MODE_HANDOFF;
    expect(isModeHandoffEnabled()).toBe(true);
  });

  it("can be disabled via env", () => {
    process.env.UNIFIED_CHAT_MODE_HANDOFF = "false";
    expect(isModeHandoffEnabled()).toBe(false);
  });

  it("reads modeHandoffContext from unified chat body", () => {
    const body = {
      message: "analyze this board",
      context: {
        modeHandoffContext: {
          fromConversationId: "c1",
          fromChatType: "workbench",
          canvasState: { groups: [], standaloneWidgets: [], totalItems: 1 },
        },
      },
    } as Parameters<typeof readModeHandoffContext>[0];
    const handoff = readModeHandoffContext(body);
    expect(handoff?.fromConversationId).toBe("c1");
  });

  it("returns null when handoff flag is off", () => {
    process.env.UNIFIED_CHAT_MODE_HANDOFF = "false";
    const body = {
      message: "x",
      context: {
        modeHandoffContext: {
          fromConversationId: "c1",
          canvasState: { groups: [], standaloneWidgets: [], totalItems: 1 },
        },
      },
    } as Parameters<typeof readModeHandoffContext>[0];
    expect(readModeHandoffContext(body)).toBeNull();
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { useUnifiedChatRunStore } from "./unifiedChatRunStore";

describe("unifiedChatRunStore", () => {
  beforeEach(() => {
    useUnifiedChatRunStore.setState({ runs: {} });
  });

  it("tracks start and end of a conversation run", () => {
    const id = "conv-1";
    useUnifiedChatRunStore.getState().startRun({
      conversationId: id,
      title: "Test",
      startedAt: Date.now(),
    });
    expect(useUnifiedChatRunStore.getState().isRunning(id)).toBe(true);
    useUnifiedChatRunStore.getState().endRun(id);
    expect(useUnifiedChatRunStore.getState().isRunning(id)).toBe(false);
  });

  it("supports multiple concurrent runs", () => {
    const store = useUnifiedChatRunStore.getState();
    store.startRun({ conversationId: "a", title: "A", startedAt: Date.now() });
    store.startRun({ conversationId: "b", title: "B", startedAt: Date.now() });
    expect(store.runningIds()).toHaveLength(2);
    store.endRun("a");
    expect(store.isRunning("a")).toBe(false);
    expect(store.isRunning("b")).toBe(true);
  });
});

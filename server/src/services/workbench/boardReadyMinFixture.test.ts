import { describe, it, expect } from "vitest";
import { buildBoardReadyMinContent, BOARD_READY_MIN_GROUP_ID } from "./boardReadyMinFixture.js";

describe("boardReadyMinFixture", () => {
  it("builds deterministic board-ready-min layout", () => {
    const content = buildBoardReadyMinContent();
    const layout = (content.layout as Array<{ type: string; payload: { groupId?: string } }>) ?? [];
    expect(layout).toHaveLength(1);
    expect(layout[0]?.type).toBe("widget_group");
    expect(layout[0]?.payload?.groupId).toBe(BOARD_READY_MIN_GROUP_ID);
  });
});

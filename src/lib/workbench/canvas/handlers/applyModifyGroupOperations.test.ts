import { describe, expect, it } from "vitest";
import {
  applyModifyGroupOperations,
  normalizeWidgetGroupItemsList,
} from "./applyModifyGroupOperations";

describe("applyModifyGroupOperations", () => {
  const basePayload = {
    type: "widget_group" as const,
    groupId: "g1",
    title: "Scorecard",
    sectionType: "company-scorecard",
    widgetIds: ["company-scorecard-units", "company-scorecard-volume"],
    items: [
      { kind: "registry" as const, defId: "company-scorecard-units" },
      { kind: "registry" as const, defId: "company-scorecard-volume" },
    ],
  };

  it("removes widget by stable id", () => {
    const { payload, removeMissed } = applyModifyGroupOperations(basePayload, [
      { op: "remove", widgetId: "company-scorecard-volume__1" },
    ]);
    expect(removeMissed).toBe(false);
    expect(normalizeWidgetGroupItemsList(payload)).toHaveLength(1);
    expect(payload.items?.[0].kind === "registry" && payload.items[0].defId).toBe(
      "company-scorecard-units",
    );
  });

  it("flags removeMissed when id not found", () => {
    const { removeMissed } = applyModifyGroupOperations(basePayload, [
      { op: "remove", widgetId: "missing-widget" },
    ]);
    expect(removeMissed).toBe(true);
  });

  it("add_registry appends widget", () => {
    const { payload } = applyModifyGroupOperations(basePayload, [
      { op: "add_registry", defId: "company-scorecard-wac" },
    ]);
    expect(normalizeWidgetGroupItemsList(payload)).toHaveLength(3);
  });
});

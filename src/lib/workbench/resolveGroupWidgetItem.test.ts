import { describe, expect, it } from "vitest";
import {
  groupWidgetItemKey,
  resolveGroupWidgetItemIndex,
} from "./resolveGroupWidgetItem";
import type { GroupWidgetItem } from "@/components/workbench/canvas/types";

describe("resolveGroupWidgetItem", () => {
  const items: GroupWidgetItem[] = [
    { kind: "registry", defId: "company-scorecard-units" },
    {
      kind: "cohi",
      id: "abc",
      sql: "SELECT 1",
      title: "Pull-Through Rate",
      vizConfig: { type: "kpi", yKey: "rate" },
    },
  ];

  it("groupWidgetItemKey matches canvas conventions", () => {
    expect(groupWidgetItemKey(items[0], 0)).toBe("company-scorecard-units__0");
    expect(groupWidgetItemKey(items[1], 1)).toBe("cohi__abc__1");
  });

  it("resolveGroupWidgetItemIndex finds widgets by title fragment", () => {
    expect(resolveGroupWidgetItemIndex(items, "cohi__abc__1")).toBe(1);
    expect(resolveGroupWidgetItemIndex(items, "pull-through")).toBe(1);
    expect(resolveGroupWidgetItemIndex(items, "pull through rate")).toBe(1);
    expect(resolveGroupWidgetItemIndex(items, "missing")).toBe(-1);
  });

  it("resolveGroupWidgetItemIndex matches registry widgets by catalog name", () => {
    const registryItems: GroupWidgetItem[] = [
      { kind: "registry", defId: "sales-scorecard-pull-through" },
    ];
    expect(
      resolveGroupWidgetItemIndex(registryItems, "pull-through rate"),
    ).toBe(0);
  });
});

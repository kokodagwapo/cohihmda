import { describe, expect, it } from "vitest";
import {
  parseRequestedPeriodFromText,
  reconcileWidgetActionPeriods,
  augmentPeriodSwitchActions,
  isAllTimeRequest,
  isChartTypeChangeRequest,
  normalizeWorkbenchWidgetIds,
  augmentGroupRemoveFromQuestion,
  resolveCanvasWidgetKey,
  isPeriodSwitchOnlyRequest,
  shouldBuildExecutiveDashboardOnEmptyCanvas,
} from "./workbenchWidgetPeriodReconcile.js";

describe("workbenchWidgetPeriodReconcile", () => {
  it("parses this month as MTD", () => {
    expect(
      parseRequestedPeriodFromText(
        "Prepare a board-ready overview of this month's performance",
      ),
    ).toBe("MTD");
  });

  it("detects empty canvas board-ready build intent", () => {
    expect(
      shouldBuildExecutiveDashboardOnEmptyCanvas(
        "Prepare a board-ready overview of this month's performance",
        0,
        "MTD",
      ),
    ).toBe(true);
    expect(
      shouldBuildExecutiveDashboardOnEmptyCanvas(
        "Prepare a board-ready overview of this month's performance",
        3,
        "MTD",
      ),
    ).toBe(false);
  });

  it("strips MTD from title and sets defaultPreset", () => {
    const actions = [
      {
        type: "create_widget",
        title: "Funded Units MTD",
        sql: "SELECT COUNT(*) AS units FROM public.loans l WHERE l.funding_date IS NOT NULL",
        filterConfig: { filterable: false, dateColumn: "funding_date" },
      },
    ];
    reconcileWidgetActionPeriods(actions, { requestedPeriod: "MTD" });
    expect(actions[0].title).toBe("Funded Units");
    expect(actions[0].filterConfig?.defaultPreset).toBe("MTD");
    expect(actions[0].filterConfig?.filterable).toBe(true);
  });

  it("overrides LLM YTD when requested period is MTD", () => {
    const actions = [
      {
        type: "create_widget",
        title: "Funded Units",
        filterConfig: { filterable: true, defaultPreset: "YTD" },
      },
    ];
    reconcileWidgetActionPeriods(actions, { requestedPeriod: "MTD" });
    expect(actions[0].filterConfig?.defaultPreset).toBe("MTD");
  });

  it("sets filterable false for all-time requests", () => {
    const actions = [
      {
        type: "create_widget",
        title: "Total Funded Loans",
        filterConfig: { filterable: true, defaultPreset: "YTD" },
      },
    ];
    reconcileWidgetActionPeriods(actions, {
      userQuestion: "total funded loan count all time",
    });
    expect(actions[0].filterConfig?.filterable).toBe(false);
    expect(actions[0].filterConfig?.defaultPreset).toBeNull();
  });

  it("replaces recreate widgets with modify_group set_period on switch-only", () => {
    const actions = [
      { type: "create_widget", title: "Funded Units" },
      { type: "create_widget", title: "Funded Volume" },
    ];
    augmentPeriodSwitchActions(actions, {
      userQuestion: "Switch the whole dashboard to year-to-date",
      canvasState: { totalItems: 4, groups: [{ groupId: "g1" }] },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("modify_group");
    expect(actions[0].operations[0]).toEqual({ op: "set_period", preset: "YTD" });
  });

  it("detects period switch only requests", () => {
    expect(isPeriodSwitchOnlyRequest("Switch the whole dashboard to year-to-date")).toBe(
      true,
    );
    expect(
      isPeriodSwitchOnlyRequest("Switch to YTD and add a branch breakdown chart"),
    ).toBe(false);
    expect(isAllTimeRequest("KPI for all time funded count")).toBe(true);
    expect(
      isChartTypeChangeRequest("Change funded volume from KPI to a bar chart by week"),
    ).toBe(true);
  });

  it("inherits requested period when title has no token", () => {
    const actions = [
      {
        type: "create_widget",
        title: "Funded Volume",
        sql: "SELECT SUM(l.loan_amount) AS volume FROM public.loans l WHERE l.funding_date IS NOT NULL",
        filterConfig: { filterable: true, dateColumn: "funding_date" },
      },
    ];
    reconcileWidgetActionPeriods(actions, {
      userQuestion: "fresh dashboard for this month",
    });
    expect(actions[0].filterConfig?.defaultPreset).toBe("MTD");
  });

  it("resolveCanvasWidgetKey matches title fragments", () => {
    const widgets = [
      { id: "cohi__abc__1", title: "Pull-Through Rate", kind: "cohi" },
      { id: "company-scorecard-units__0", name: "Funded Units", kind: "registry" },
    ];
    expect(resolveCanvasWidgetKey(widgets, "pull-through")).toBe("cohi__abc__1");
    expect(resolveCanvasWidgetKey(widgets, "cohi__abc__1")).toBe("cohi__abc__1");
  });

  it("augmentGroupRemoveFromQuestion injects remove when model omitted it", () => {
    const actions: unknown[] = [
      { type: "teach", message: "Removed pull-through for you." },
    ];
    augmentGroupRemoveFromQuestion(actions, {
      userQuestion: "Remove the pull-through rate widget from the dashboard",
      canvasState: {
        groups: [
          {
            groupId: "grp-1",
            widgets: [
              {
                id: "cohi__pt__2",
                title: "Pull-Through Rate",
                kind: "cohi",
              },
            ],
          },
        ],
      },
    });
    expect(actions[0]).toMatchObject({
      type: "modify_group",
      operations: [{ op: "remove", widgetId: "cohi__pt__2" }],
    });
  });

  it("normalizeWorkbenchWidgetIds fixes modify_group remove ids", () => {
    const actions = [
      {
        type: "modify_group",
        groupId: "grp-1",
        operations: [{ op: "remove", widgetId: "pull-through rate" }],
      },
    ];
    normalizeWorkbenchWidgetIds(actions, {
      groups: [
        {
          groupId: "grp-1",
          widgets: [{ id: "cohi__abc__1", title: "Pull-Through Rate", kind: "cohi" }],
        },
      ],
    });
    expect(
      (actions[0] as { operations: Array<{ widgetId: string }> }).operations[0]
        .widgetId,
    ).toBe("cohi__abc__1");
  });
});

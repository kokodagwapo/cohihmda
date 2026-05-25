import { describe, expect, it } from "vitest";
import {
  parseRequestedPeriodFromText,
  reconcileWidgetActionPeriods,
  augmentPeriodSwitchActions,
  augmentAllTimeStripPeriodOnlyActions,
  augmentAllTimeCreateWidgetFromQuestion,
  augmentAllTimeKpiToGroup,
  augmentAllTimeReconcileModifyGroupAddCohi,
  periodSwitchAssistantMessage,
  stripBuildActionsForAnalyticalQuestion,
  isAnalyticalOnlyRequest,
  isAllTimeRequest,
  isChartTypeChangeRequest,
  normalizeWorkbenchWidgetIds,
  augmentGroupRemoveFromQuestion,
  augmentRestoreWidgetFromQuestion,
  augmentChartTypeFromQuestion,
  parseRequestedChartType,
  findRegistryChartWidgetTarget,
  augmentAddRegistryWidgetFromQuestion,
  findGroupWidgetRemoveTarget,
  extractRemoveWidgetPhrase,
  rewriteGroupedDeleteWidgetActions,
  stripRecreateOnRemoveOnly,
  isRemoveWidgetOnlyRequest,
  isRestoreWidgetRequest,
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

  it("sets filterable false on modify_group add_cohi for all-time", () => {
    const actions = [
      {
        type: "modify_group",
        groupId: "g1",
        operations: [
          {
            op: "add_cohi",
            sql: "SELECT COUNT(*) AS total FROM public.loans l",
            title: "Total Funded Loans MTD",
            filterConfig: { filterable: true, defaultPreset: "MTD" },
          },
        ],
      },
    ];
    reconcileWidgetActionPeriods(actions, {
      userQuestion: "Add one KPI for total funded loans all time",
    });
    const op = (actions[0] as { operations: Array<{ filterConfig?: { filterable?: boolean } }> })
      .operations[0];
    expect(op.filterConfig?.filterable).toBe(false);
    expect((actions[0] as { operations: Array<{ title?: string }> }).operations[0].title).toBe(
      "Total Funded Loans",
    );
  });

  it("seeds create_widget from teach-only all-time on populated canvas", () => {
    const actions = [{ type: "teach", message: "ok" }];
    augmentAllTimeCreateWidgetFromQuestion(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
      canvasState: { totalItems: 3, groups: [{ groupId: "grp-1" }] },
    });
    augmentAllTimeKpiToGroup(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
      canvasState: { totalItems: 3, groups: [{ groupId: "grp-1" }] },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("modify_group");
    const op = (
      actions[0] as { operations: Array<{ filterConfig?: { filterable?: boolean } }> }
    ).operations[0];
    expect(op.filterConfig?.filterable).toBe(false);
  });

  it("strips period-only modify_group on all-time KPI asks", () => {
    const actions = [
      {
        type: "modify_group",
        groupId: "grp-1",
        operations: [{ op: "set_period", period: "YTD" }],
        explanation: "Updated dashboard group",
      },
      { type: "teach", message: "ok" },
    ];
    augmentAllTimeStripPeriodOnlyActions(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("teach");
  });

  it("seeds create_widget when all-time ask has only empty modify_group", () => {
    const actions = [
      {
        type: "modify_group",
        groupId: "grp-1",
        operations: [],
        explanation: "Updated dashboard group",
      },
    ];
    augmentAllTimeCreateWidgetFromQuestion(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
      canvasState: { totalItems: 3, groups: [{ groupId: "grp-1" }] },
    });
    expect(actions.some((a) => (a as { type: string }).type === "create_widget")).toBe(
      true,
    );
  });

  it("all-time funded volume ends as add_cohi with filterable false", () => {
    const actions: unknown[] = [
      {
        type: "modify_group",
        groupId: "grp-1",
        operations: [],
        explanation: "Updated dashboard group",
      },
    ];
    const canvasState = {
      totalItems: 5,
      groups: [
        {
          groupId: "grp-1",
          widgets: [{ id: "w-vol", title: "Funded Volume", kind: "registry" }],
        },
      ],
    };
    augmentAllTimeStripPeriodOnlyActions(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
      canvasState,
    });
    augmentAllTimeCreateWidgetFromQuestion(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
      canvasState,
    });
    augmentAllTimeKpiToGroup(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
      canvasState,
    });
    const mg = actions.find(
      (a) =>
        (a as { type?: string }).type === "modify_group" &&
        (
          (a as { operations?: Array<{ op?: string }> }).operations ?? []
        ).some((o) => o.op === "add_cohi"),
    ) as {
      type: string;
      operations: Array<{
        op: string;
        title?: string;
        filterConfig?: { filterable?: boolean };
      }>;
    };
    expect(mg).toBeDefined();
    const add = mg.operations.find((o) => o.op === "add_cohi");
    expect(add?.filterConfig?.filterable).toBe(false);
    expect(add?.title).toBe("All-time Funded Volume");
  });

  it("seeds create_widget after stripping period-only on all-time", () => {
    const actions = [
      {
        type: "modify_group",
        groupId: "grp-1",
        operations: [{ op: "set_period", preset: "YTD" }],
      },
    ];
    augmentAllTimeStripPeriodOnlyActions(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
      canvasState: { totalItems: 3, groups: [{ groupId: "grp-1" }] },
    });
    expect(actions.some((a) => (a as { type: string }).type === "create_widget")).toBe(
      true,
    );
  });

  it("stamps filterable false on LLM modify_group add_cohi for all-time", () => {
    const actions = [
      {
        type: "modify_group",
        groupId: "grp-1",
        operations: [
          {
            op: "add_cohi",
            sql: "SELECT SUM(amount) AS total FROM public.loans l",
            title: "Total Volume MTD",
            filterConfig: { filterable: true, defaultPreset: "MTD" },
          },
        ],
        explanation: "Updated dashboard group",
      },
    ];
    augmentAllTimeReconcileModifyGroupAddCohi(actions, {
      userQuestion: "Show funded volume as an all-time KPI",
    });
    const op = (
      actions[0] as { operations: Array<{ filterConfig?: { filterable?: boolean } }> }
    ).operations[0];
    expect(op.filterConfig?.filterable).toBe(false);
    expect((actions[0] as { explanation?: string }).explanation).toMatch(/all-time/i);
  });

  it("routes single all-time create_widget into modify_group add_cohi", () => {
    const actions = [
      {
        type: "create_widget",
        title: "Total Funded Loans",
        sql: "SELECT COUNT(*) AS total FROM public.loans l WHERE l.funding_date IS NOT NULL",
        config: { type: "kpi", yKey: "total" },
        filterConfig: { filterable: true, defaultPreset: "YTD" },
      },
    ];
    augmentAllTimeKpiToGroup(actions, {
      userQuestion: "Add one KPI for total funded loans all time",
      canvasState: { totalItems: 5, groups: [{ groupId: "grp-1" }] },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("modify_group");
    expect(actions[0].groupId).toBe("grp-1");
    expect(
      (actions[0] as { operations: Array<{ op: string; filterConfig?: { filterable?: boolean } }> })
        .operations[0].filterConfig?.filterable,
    ).toBe(false);
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

  it("strips recreate widgets when model mixed set_period with create_widget", () => {
    const actions = [
      {
        type: "modify_group",
        groupId: "g1",
        operations: [{ op: "set_title", title: "Executive" }],
      },
      { type: "create_widget", title: "Funded Units" },
      { type: "create_widget", title: "Funded Volume" },
    ];
    augmentPeriodSwitchActions(actions, {
      userQuestion: "Switch the whole dashboard to year-to-date",
      canvasState: { totalItems: 4, groups: [{ groupId: "g1" }] },
    });
    expect(actions.some((a) => a.type === "create_widget")).toBe(false);
    expect(actions[0].type).toBe("modify_group");
    expect(actions[0].operations?.[0]).toEqual({ op: "set_period", preset: "YTD" });
  });

  it("injects set_period from teach-only on period switch", () => {
    const actions = [{ type: "teach", message: "Switching period for you." }];
    augmentPeriodSwitchActions(actions, {
      userQuestion: "Switch the dashboard to last 6 months.",
      canvasState: { totalItems: 4, groups: [{ groupId: "g1" }] },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("modify_group");
    expect(
      (actions[0] as { operations: Array<{ op: string; preset: string }> }).operations[0],
    ).toEqual({ op: "set_period", preset: "L6M" });
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

  it("periodSwitchAssistantMessage when only set_period actions", () => {
    const actions = [
      {
        type: "modify_group",
        groupId: "g1",
        operations: [{ op: "set_period", preset: "YTD" }],
      },
    ];
    expect(
      periodSwitchAssistantMessage(actions, "Switch the whole dashboard to year-to-date"),
    ).toMatch(/Updated dashboard period to YTD/i);
  });

  it("stripBuildActionsForAnalyticalQuestion removes create_widget", () => {
    const actions = [
      { type: "create_widget", title: "Extra" },
      { type: "query_data", sql: "SELECT 1" },
    ];
    stripBuildActionsForAnalyticalQuestion(actions, {
      userQuestion: "Why is pull-through lower this month?",
      canvasTotalItems: 5,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("query_data");
    expect(isAnalyticalOnlyRequest("Why is pull-through lower?")).toBe(true);
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

  it("findGroupWidgetRemoveTarget searches all groups", () => {
    const hit = findGroupWidgetRemoveTarget(
      "Remove the pull-through rate widget from the dashboard",
      {
        groups: [
          {
            groupId: "grp-a",
            widgets: [{ id: "x__0", title: "Funded Units", kind: "registry" }],
          },
          {
            groupId: "grp-b",
            widgets: [
              { id: "cohi__pt__2", title: "Pull-Through Rate", kind: "cohi" },
            ],
          },
        ],
      },
    );
    expect(hit).toEqual({
      groupId: "grp-b",
      widgetId: "cohi__pt__2",
      label: "Pull-Through Rate",
    });
  });

  it("rewriteGroupedDeleteWidgetActions converts grouped delete_widget", () => {
    const actions: unknown[] = [
      {
        type: "delete_widget",
        instanceId: "pull-through rate",
        explanation: "Removed pull-through",
      },
    ];
    rewriteGroupedDeleteWidgetActions(actions, {
      groups: [
        {
          groupId: "grp-1",
          widgets: [{ id: "cohi__abc__1", title: "Pull-Through Rate", kind: "cohi" }],
        },
      ],
    });
    expect(actions[0]).toMatchObject({
      type: "modify_group",
      groupId: "grp-1",
      operations: [{ op: "remove", widgetId: "cohi__abc__1" }],
    });
  });

  it("stripRecreateOnRemoveOnly drops create_widget on remove-only asks", () => {
    expect(isRemoveWidgetOnlyRequest("Remove the pull-through widget")).toBe(true);
    expect(isRemoveWidgetOnlyRequest("Add pull-through back")).toBe(false);
    const actions: unknown[] = [
      { type: "create_widget", title: "Pull-Through Rate" },
      { type: "teach", message: "ok" },
    ];
    stripRecreateOnRemoveOnly(actions, "Remove the pull-through rate widget");
    expect(actions).toHaveLength(1);
    expect((actions[0] as { type: string }).type).toBe("teach");
  });

  it("extractRemoveWidgetPhrase parses funded volume", () => {
    expect(
      extractRemoveWidgetPhrase("Remove the funded volume widget from the dashboard"),
    ).toMatch(/funded volume/i);
  });

  it("removes Funded Volume widget on funded volume ask (deterministic title)", () => {
    const target = findGroupWidgetRemoveTarget(
      "Remove the funded volume widget from the dashboard.",
      {
        groups: [
          {
            groupId: "g1",
            widgets: [{ id: "w-vol", title: "Funded Volume", kind: "registry" }],
          },
        ],
      },
    );
    expect(target?.widgetId).toBe("w-vol");
  });

  it("findGroupWidgetRemoveTarget matches Total Volume from phrase only", () => {
    const hit = findGroupWidgetRemoveTarget(
      "Remove the funded volume widget from the dashboard",
      {
        groups: [
          {
            groupId: "g1",
            widgets: [
              {
                id: "company-scorecard-volume__0",
                name: "Total Volume",
                kind: "registry",
              },
              {
                id: "company-scorecard-units__0",
                name: "Total Units",
                kind: "registry",
              },
            ],
          },
        ],
      },
    );
    expect(hit?.widgetId).toBe("company-scorecard-volume__0");
  });

  it("findGroupWidgetRemoveTarget picks units not volume for funded units", () => {
    const hit = findGroupWidgetRemoveTarget(
      "Remove the funded units widget from the dashboard",
      {
        groups: [
          {
            groupId: "g1",
            widgets: [
              {
                id: "company-scorecard-volume__0",
                name: "Total Volume",
                kind: "registry",
              },
              {
                id: "company-scorecard-units__0",
                name: "Total Units",
                kind: "registry",
              },
            ],
          },
        ],
      },
    );
    expect(hit?.widgetId).toBe("company-scorecard-units__0");
  });

  it("parseRequestedChartType detects line chart", () => {
    expect(parseRequestedChartType("Change pull-through chart to a line chart")).toBe(
      "line",
    );
  });

  it("findRegistryChartWidgetTarget picks pull-through by branch", () => {
    const hit = findRegistryChartWidgetTarget(
      "Change pull-through chart to a line chart",
      {
        groups: [
          {
            groupId: "g1",
            widgets: [
              {
                id: "company-scorecard-pullthrough-by-branch__3",
                name: "Pull-Through by Branch",
                kind: "registry",
              },
              {
                id: "sales-scorecard-pull-through__0",
                name: "Pull-Through Rate",
                kind: "registry",
              },
            ],
          },
        ],
      },
    );
    expect(hit?.widgetId).toBe("company-scorecard-pullthrough-by-branch__3");
  });

  it("augmentChartTypeFromQuestion injects modify_registry_widget line", () => {
    const actions: unknown[] = [{ type: "teach", message: "ok" }];
    augmentChartTypeFromQuestion(actions, {
      userQuestion: "Change pull-through by branch chart to a line chart",
      canvasState: {
        groups: [
          {
            groupId: "grp-1",
            widgets: [
              {
                id: "company-scorecard-pullthrough-by-branch__0",
                name: "Pull-Through by Branch",
                kind: "registry",
              },
            ],
          },
        ],
      },
    });
    expect(actions[0]).toMatchObject({
      type: "modify_registry_widget",
      configOverrides: { chartType: "line" },
    });
  });

  it("augmentAddRegistryWidgetFromQuestion adds WA LTV when missing", () => {
    const actions: unknown[] = [];
    augmentAddRegistryWidgetFromQuestion(actions, {
      userQuestion: "Add WA LTV to the dashboard",
      canvasState: {
        groups: [{ groupId: "grp-1", widgets: [] }],
      },
    });
    expect(actions[0]).toMatchObject({
      operations: [{ op: "add_registry", defId: "company-scorecard-wa-ltv" }],
    });
  });

  it("augmentAddRegistryWidgetFromQuestion adds revenue BPS for margin phrase", () => {
    const actions: unknown[] = [];
    augmentAddRegistryWidgetFromQuestion(actions, {
      userQuestion: "Add margin widget to the dashboard",
      canvasState: {
        groups: [{ groupId: "grp-1", widgets: [] }],
      },
    });
    expect(actions[0]).toMatchObject({
      operations: [{ op: "add_registry", defId: "sales-scorecard-revenue-bps" }],
    });
  });

  it("augmentAddRegistryWidgetFromQuestion adds WAC when missing", () => {
    const actions: unknown[] = [];
    augmentAddRegistryWidgetFromQuestion(actions, {
      userQuestion: "Add weighted average coupon WAC widget to the dashboard",
      canvasState: {
        groups: [
          {
            groupId: "grp-1",
            widgets: [{ id: "company-scorecard-units__0", name: "Total Units" }],
          },
        ],
      },
    });
    expect(actions[0]).toMatchObject({
      type: "modify_group",
      operations: [{ op: "add_registry", defId: "company-scorecard-wac" }],
    });
  });

  it("augmentRestoreWidgetFromQuestion injects pull-through registry add", () => {
    expect(isRestoreWidgetRequest("Add pull-through rate back")).toBe(true);
    const actions: unknown[] = [{ type: "teach", message: "ok" }];
    augmentRestoreWidgetFromQuestion(actions, {
      userQuestion: "Add pull-through rate back to the dashboard",
      canvasState: {
        groups: [{ groupId: "grp-1", widgets: [] }],
      },
    });
    expect(actions[0]).toMatchObject({
      type: "modify_group",
      operations: [{ op: "add_registry", defId: "sales-scorecard-pull-through" }],
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

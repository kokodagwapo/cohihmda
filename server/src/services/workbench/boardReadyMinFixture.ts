/**
 * Deterministic workbench canvas layout for e2e (board-ready-min).
 * Widget titles/ids align with agency-eval remove/chart anchors.
 */

export const BOARD_READY_MIN_GROUP_ID = "board-ready-min-grp";

export function buildBoardReadyMinContent(): Record<string, unknown> {
  return {
    layoutVersion: "freeform-v1",
    metadata: {
      fixture: "board-ready-min",
      seededBy: "workbench-test-seed",
    },
    layout: [
      {
        i: "board-ready-min-group",
        x: 24,
        y: 24,
        w: 920,
        h: 720,
        type: "widget_group",
        payload: {
          type: "widget_group",
          groupId: BOARD_READY_MIN_GROUP_ID,
          title: "Board Ready Min",
          sectionType: "company-scorecard",
          widgetIds: [
            "sales-scorecard-volume",
            "sales-scorecard-pull-through",
            "company-scorecard-pullthrough-by-branch",
          ],
          filterSync: true,
          items: [
            { kind: "registry" as const, defId: "sales-scorecard-volume" },
            { kind: "registry" as const, defId: "sales-scorecard-pull-through" },
            {
              kind: "registry" as const,
              defId: "company-scorecard-pullthrough-by-branch",
            },
          ],
        },
      },
    ],
    annotations: [],
    background: { type: "color", value: "#ffffff" },
    uploadsMeta: [],
  };
}

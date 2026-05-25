import { describe, expect, it } from "vitest";
import { reconcileActionsForEval, runAgencyEval } from "./runAgencyEval.js";
import { expectChartType } from "./assertions.js";

describe("runAgencyEval", () => {
  it("reconcile injects remove for funded volume", () => {
    const actions = reconcileActionsForEval(
      "Remove the funded volume widget from the dashboard.",
      {
        groups: [
          {
            groupId: "grp-1",
            widgets: [
              { id: "company-scorecard-volume__0", name: "Total Volume" },
              { id: "company-scorecard-units__0", name: "Total Units" },
            ],
          },
        ],
      },
      [{ type: "teach", message: "ok" }],
    );
    expect(actions.some((a) => a.type === "modify_group")).toBe(true);
  });

  it("reconcile injects line chart type", () => {
    const actions = reconcileActionsForEval(
      "Change pull-through by branch chart to a line chart.",
      {
        groups: [
          {
            groupId: "grp-1",
            widgets: [
              {
                id: "company-scorecard-pullthrough-by-branch__0",
                name: "Pull-Through by Branch",
              },
            ],
          },
        ],
      },
      [],
    );
    expect(() => expectChartType(actions, "line")).not.toThrow();
  });

  it("runAgencyEval passes anchor suite", () => {
    const { failed } = runAgencyEval();
    expect(failed).toBe(0);
  });
});

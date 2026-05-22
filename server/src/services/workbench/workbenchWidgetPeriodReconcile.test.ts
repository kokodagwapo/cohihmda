import { describe, expect, it } from "vitest";
import {
  parseRequestedPeriodFromText,
  reconcileWidgetActionPeriods,
} from "./workbenchWidgetPeriodReconcile.js";

describe("workbenchWidgetPeriodReconcile", () => {
  it("parses this month as MTD", () => {
    expect(
      parseRequestedPeriodFromText(
        "Prepare a board-ready overview of this month's performance",
      ),
    ).toBe("MTD");
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
});

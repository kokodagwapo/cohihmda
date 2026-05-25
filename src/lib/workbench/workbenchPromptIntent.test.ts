import { describe, expect, it } from "vitest";
import {
  extractRemoveWidgetPhrase,
  isAllTimeRequest,
  isAnalyticalOnlyRequest,
  isAnalyticalWorkbenchQuestion,
  isChartTypeChangeRequest,
  isPeriodSwitchOnlyRequest,
  isRemoveWidgetOnlyQuestion,
  isRemoveWidgetOnlyRequest,
  isRestoreWidgetRequest,
} from "./workbenchPromptIntent";

describe("workbenchPromptIntent", () => {
  it("isAnalyticalOnlyRequest detects why questions", () => {
    expect(isAnalyticalOnlyRequest("Why is pull-through lower?")).toBe(true);
    expect(isAnalyticalWorkbenchQuestion("Why is pull-through lower?")).toBe(
      true,
    );
  });

  it("isAnalyticalOnlyRequest rejects build intents", () => {
    expect(isAnalyticalOnlyRequest("Add a new KPI for volume")).toBe(false);
  });

  it("isRemoveWidgetOnlyRequest", () => {
    expect(isRemoveWidgetOnlyRequest("Remove the pull-through widget")).toBe(
      true,
    );
    expect(isRemoveWidgetOnlyQuestion("Remove the pull-through widget")).toBe(
      true,
    );
    expect(isRemoveWidgetOnlyRequest("Add pull-through back")).toBe(false);
  });

  it("isPeriodSwitchOnlyRequest", () => {
    expect(isPeriodSwitchOnlyRequest("Switch the dashboard to last 6 months")).toBe(
      true,
    );
    expect(isPeriodSwitchOnlyRequest("Add another widget")).toBe(false);
  });

  it("isChartTypeChangeRequest", () => {
    expect(
      isChartTypeChangeRequest("Change pull-through chart to a line chart"),
    ).toBe(true);
  });

  it("isAllTimeRequest", () => {
    expect(isAllTimeRequest("Show funded volume as an all-time KPI")).toBe(true);
  });

  it("isRestoreWidgetRequest", () => {
    expect(isRestoreWidgetRequest("Add pull-through rate back")).toBe(true);
  });

  it("extractRemoveWidgetPhrase", () => {
    expect(
      extractRemoveWidgetPhrase(
        "Remove the funded volume widget from the dashboard",
      ),
    ).toMatch(/funded volume/i);
  });
});

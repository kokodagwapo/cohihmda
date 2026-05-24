import { describe, expect, it } from "vitest";
import {
  buildGroupSavedFiltersFromFilterConfig,
  filterConfigToInitialState,
  mapWorkbenchPresetToPeriodPreset,
} from "./workbenchPresetMapping";

describe("workbenchPresetMapping", () => {
  it("maps LLM MTD to UI mtd preset", () => {
    expect(mapWorkbenchPresetToPeriodPreset("MTD")).toBe("mtd");
    expect(mapWorkbenchPresetToPeriodPreset("L12M")).toBe("rolling-12");
  });

  it("builds group savedFilters with periodSelection dateRange", () => {
    const saved = buildGroupSavedFiltersFromFilterConfig({
      filterable: true,
      dateColumn: "funding_date",
      defaultPreset: "MTD",
    });
    expect(saved?.periodSelection?.preset).toBe("mtd");
    expect(saved?.periodSelection?.dateRange?.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(saved?.dateField).toBe("funding_date");
  });

  it("returns undefined saved state when filterable is false (all-time)", () => {
    expect(
      filterConfigToInitialState({
        filterable: false,
        dateColumn: "funding_date",
        defaultPreset: null,
      }),
    ).toBeUndefined();
    expect(
      buildGroupSavedFiltersFromFilterConfig({
        filterable: false,
        dateColumn: "funding_date",
        defaultPreset: null,
      }),
    ).toBeUndefined();
  });

  it("filterConfigToInitialState includes mapped preset and dateRange", () => {
    const state = filterConfigToInitialState({
      filterable: true,
      dateColumn: "funding_date",
      defaultPreset: "MTD",
    });
    expect(state?.preset).toBe("mtd");
    expect(state?.dateRange?.start).toBeTruthy();
  });
});

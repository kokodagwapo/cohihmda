import { describe, it, expect } from "vitest";
import { mapToOpsDateRange, mapToTopTieringTimeFilter } from "./periodAdapters";
import type { SectionFilters } from "@/stores/widgetSectionStore";
import type { PeriodPreset } from "@/components/ui/DatePeriodPicker";

function filtersWithPreset(preset: PeriodPreset): SectionFilters {
  return {
    periodSelection: { type: "preset", preset, dateRange: { start: "2025-01-01", end: "2025-04-01" } },
  } as SectionFilters;
}

describe("periodAdapters", () => {
  it("mapToOpsDateRange maps rolling-12 to 12-months", () => {
    expect(mapToOpsDateRange(filtersWithPreset("rolling-12"))).toBe("12-months");
  });

  it("mapToTopTieringTimeFilter maps ytd preset", () => {
    expect(mapToTopTieringTimeFilter(filtersWithPreset("ytd")).timeFilter).toBe("ytd");
  });
});

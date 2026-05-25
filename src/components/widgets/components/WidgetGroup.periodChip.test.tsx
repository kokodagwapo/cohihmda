import { describe, it, expect, vi } from "vitest";
import { getPeriodPresetMeta } from "@/components/ui/DatePeriodPicker";

describe("WidgetGroup period chip label", () => {
  it('exposes "Last 6 Months" for rolling-6 preset', () => {
    expect(getPeriodPresetMeta("rolling-6").title).toBe("Last 6 Months");
  });
});

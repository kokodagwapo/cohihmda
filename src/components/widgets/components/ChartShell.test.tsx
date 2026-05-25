import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ChartShell,
  chartShellContentHeight,
  CHART_TYPE_STRIP_H,
  normalizeChartCardType,
} from "@/components/widgets/components/ChartShell";

describe("ChartShell", () => {
  it("normalizeChartCardType defaults invalid to bar", () => {
    expect(normalizeChartCardType("line")).toBe("line");
    expect(normalizeChartCardType("donut")).toBe("bar");
  });

  it("chartShellContentHeight subtracts strip height when strip shown", () => {
    expect(chartShellContentHeight(200, false)).toBe(200);
    expect(chartShellContentHeight(200, true)).toBe(200 - CHART_TYPE_STRIP_H);
    expect(chartShellContentHeight(50, true)).toBe(80);
  });

  it("renders standard type strip and fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChartShell
        showChartTypeStrip
        chartType="bar"
        onChartTypeChange={onChange}
      >
        <div data-testid="chart-body">body</div>
      </ChartShell>,
    );
    expect(screen.getByTestId("chart-body")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /line/i }));
    expect(onChange).toHaveBeenCalledWith("line");
  });

  it("disables type strip when chartTypeStripDisabled", () => {
    render(
      <ChartShell
        showChartTypeStrip
        chartType="bar"
        onChartTypeChange={vi.fn()}
        chartTypeStripDisabled
      >
        <div>body</div>
      </ChartShell>,
    );
    const lineBtn = screen.getByRole("button", { name: /line/i });
    expect(lineBtn).toHaveProperty("disabled", true);
  });

  it("renders custom type strip for cohi-compatible types", () => {
    render(
      <ChartShell customTypeStrip={<div data-testid="cohi-strip">cohi</div>}>
        <div>body</div>
      </ChartShell>,
    );
    expect(screen.getByTestId("cohi-strip")).toBeTruthy();
    expect(screen.queryByText("Type:")).toBeNull();
  });
});

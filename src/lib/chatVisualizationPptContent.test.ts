import { describe, expect, it } from "vitest";
import {
  buildChatVizExportContent,
  CHAT_VIZ_PPT_CELL_MAX_LEN,
  CHAT_VIZ_PPT_MAX_COLUMNS,
} from "@/lib/chatVisualizationPptContent";
import type { VisualizationConfig } from "@/hooks/useCohiChat";

const sampleViz: VisualizationConfig = {
  type: "bar",
  title: "Revenue by Region",
  data: [
    { region: "North", revenue: 1200000 },
    { region: "South", revenue: 980000 },
    { region: "East", revenue: 1500000 },
    { region: "West", revenue: 1100000 },
  ],
  xKey: "region",
  yKey: "revenue",
};

describe("buildChatVizExportContent", () => {
  it("builds chart metadata and caps table columns", () => {
    const wideRow: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) {
      wideRow[`col_${i}`] = `value_${i}`;
    }
    const viz: VisualizationConfig = {
      ...sampleViz,
      data: [wideRow],
    };

    const content = buildChatVizExportContent({ viz });
    expect(content.title).toBe("Revenue by Region");
    expect(content.chartTypeLabel).toBe("Chart Type: Bar");
    expect(content.tablePages).toHaveLength(1);
    expect(content.tablePages[0].columns).toHaveLength(CHAT_VIZ_PPT_MAX_COLUMNS);
  });

  it("truncates cell values and paginates rows", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      region: `R${i}`,
      revenue: "x".repeat(40),
    }));
    const content = buildChatVizExportContent({
      viz: { ...sampleViz, data: rows },
    });

    expect(content.tablePages.length).toBeGreaterThan(1);
    const firstCell = content.tablePages[0].rows[0].revenue;
    expect(String(firstCell).length).toBeLessThanOrEqual(CHAT_VIZ_PPT_CELL_MAX_LEN);
    expect(content.tablePages[0].slideTitle).toContain("Data");
  });

  it("includes optional description and image url", () => {
    const content = buildChatVizExportContent({
      viz: sampleViz,
      description: "Q4 summary",
      chartImageDataUrl: "data:image/png;base64,abc",
    });
    expect(content.description).toBe("Q4 summary");
    expect(content.chartImageDataUrl).toContain("data:image/png");
  });
});

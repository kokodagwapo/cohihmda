import { describe, expect, it } from "vitest";
import { buildChatVizExportContent } from "@/lib/chatVisualizationPptContent";
import { buildChatVisualizationReportDefinition } from "@/lib/chatVisualizationPptSeed";
import { REPORT_THEMES } from "@/types/reportTypes";
import type { VisualizationConfig } from "@/hooks/useCohiChat";

const sampleViz: VisualizationConfig = {
  type: "line",
  title: "Trend",
  data: [{ month: "Jan", value: 10 }],
  xKey: "month",
  yKey: "value",
};

describe("buildChatVisualizationReportDefinition", () => {
  it("produces chart-focus slide with image and table slides in editor style", () => {
    const content = buildChatVizExportContent({
      viz: sampleViz,
      chartImageDataUrl: "data:image/png;base64,test",
    });
    const def = buildChatVisualizationReportDefinition(content);

    expect(def.theme.name).toBe(REPORT_THEMES.professional.name);
    expect(def.title).toBe("Trend");
    expect(def.slides.length).toBeGreaterThanOrEqual(2);

    const chartSlide = def.slides[0];
    expect(chartSlide.layout).toBe("chart-focus");
    expect(chartSlide.title).toBe("Trend");

    const imageEl = chartSlide.elements.find((e) => e.type === "image");
    expect(imageEl).toBeTruthy();
    expect((imageEl!.config as { src?: string }).src).toContain("data:image/png");

    const tableSlide = def.slides.find((s) => s.layout === "table");
    expect(tableSlide).toBeTruthy();
    expect(tableSlide!.elements.some((e) => e.type === "table")).toBe(true);
  });

  it("uses placeholder text when no chart image", () => {
    const content = buildChatVizExportContent({ viz: sampleViz });
    const def = buildChatVisualizationReportDefinition(content);
    const chartSlide = def.slides[0];
    expect(chartSlide.elements.some((e) => e.type === "image")).toBe(false);
    expect(
      chartSlide.elements.some(
        (e) =>
          e.type === "text" &&
          String((e.config as { content?: string }).content).includes(
            "Chart preview unavailable",
          ),
      ),
    ).toBe(true);
  });
});

import type { ChatVizExportContent } from "@/lib/chatVisualizationPptContent";
import {
  CHAT_VIZ_PPT_PLACEHOLDER,
  chatVizPptFooterText,
} from "@/lib/chatVisualizationPptContent";
import type {
  ImageElementConfig,
  ReportDefinition,
  SlideDefinition,
  SlideElement,
  TableElementConfig,
  TextElementConfig,
} from "@/types/reportTypes";
import { REPORT_THEMES } from "@/types/reportTypes";

function generateId(prefix = "el"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function textElement(
  content: string,
  position: { x: number; y: number; w: number; h: number },
  style: Partial<TextElementConfig> = {},
): SlideElement {
  return {
    id: generateId("text"),
    type: "text",
    position,
    config: {
      type: "text",
      content,
      fontSize: 10,
      color: "#475569",
      lineSpacing: 1.2,
      ...style,
    } as TextElementConfig,
  };
}

/**
 * Map chat export content into a Report Builder definition (workbench editor style).
 */
export function buildChatVisualizationReportDefinition(
  content: ChatVizExportContent,
): ReportDefinition {
  const slides: SlideDefinition[] = [];
  const hasDescription = !!content.description?.trim();
  const chartTopY = hasDescription ? 1.45 : 1.0;
  const chartH = hasDescription ? 4.55 : 5.0;

  const chartSlideElements: SlideElement[] = [
    textElement(content.chartTypeLabel, {
      x: 0.5,
      y: 0.78,
      w: 9,
      h: 0.28,
    }, {
      fontSize: 9,
      color: "#64748b",
    }),
  ];

  if (hasDescription) {
    chartSlideElements.push(
      textElement(content.description!, {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
      }),
    );
  }

  if (content.chartImageDataUrl) {
    chartSlideElements.push({
      id: generateId("image"),
      type: "image",
      position: { x: 0.5, y: chartTopY, w: 9, h: chartH },
      config: {
        type: "image",
        src: content.chartImageDataUrl,
        alt: content.title,
        objectFit: "contain",
      } as ImageElementConfig,
    });
  } else {
    chartSlideElements.push(
      textElement(CHAT_VIZ_PPT_PLACEHOLDER, {
        x: 0.5,
        y: chartTopY + 1.2,
        w: 9,
        h: 0.6,
      }, {
        fontSize: 12,
        color: "#94a3b8",
        align: "center",
      }),
    );
  }

  chartSlideElements.push(
    textElement(chatVizPptFooterText(), {
      x: 0.5,
      y: 6.85,
      w: 9,
      h: 0.35,
    }, {
      fontSize: 8,
      color: "#94a3b8",
      align: "center",
    }),
  );

  slides.push({
    id: generateId("slide"),
    layout: "chart-focus",
    title: content.title,
    speakerNotes: `Chart: ${content.title}. Discuss trends and notable data points.`,
    elements: chartSlideElements,
  });

  for (const page of content.tablePages) {
    slides.push({
      id: generateId("slide"),
      layout: "table",
      title: page.slideTitle,
      speakerNotes: `Data table: ${content.title}. Review detailed rows.`,
      elements: [
        textElement(page.rangeLabel, {
          x: 0.5,
          y: 0.78,
          w: 9,
          h: 0.22,
        }, {
          fontSize: 8,
          color: "#94a3b8",
          align: "right",
        }),
        {
          id: generateId("table"),
          type: "table",
          position: { x: 0.5, y: 1.05, w: 9, h: 5.2 },
          config: {
            type: "table",
            columns: page.columns,
            data: page.rows,
            fontSize: 8,
          } as TableElementConfig,
        },
        textElement(chatVizPptFooterText(), {
          x: 0.5,
          y: 6.85,
          w: 9,
          h: 0.35,
        }, {
          fontSize: 8,
          color: "#94a3b8",
          align: "center",
        }),
      ],
    });
  }

  const now = new Date().toISOString();

  return {
    id: generateId("report"),
    title: content.title,
    theme: REPORT_THEMES.professional,
    slides,
    metadata: {
      createdAt: now,
      dataAsOf: now,
      generatedBy: "user",
    },
  };
}

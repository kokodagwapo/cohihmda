import { describe, it, expect } from "vitest";
import { convertChatToCanvasItems } from "@/utils/chatToCanvas";
import type { ChatMessage } from "@/hooks/useCohiChat";
import {
  WORKBENCH_LEGACY_CHART_ID,
  WORKBENCH_LEGACY_KPI_ID,
  WORKBENCH_LEGACY_TABLE_ID,
} from "@/components/widgets/registry/legacyWorkbenchWidgets";

function assistantMessage(
  partial: Partial<ChatMessage> & { visualization: NonNullable<ChatMessage["visualization"]> },
): ChatMessage {
  return {
    id: partial.id ?? "msg-1",
    role: "assistant",
    content: partial.content ?? "",
    timestamp: new Date(),
    ...partial,
  };
}

describe("convertChatToCanvasItems", () => {
  it("emits registry_widget for static KPI snapshots (not legacy kpi payload)", () => {
    const items = convertChatToCanvasItems([
      assistantMessage({
        visualization: {
          type: "kpi",
          title: "Volume",
          data: [],
          kpiConfig: { label: "Volume", value: 100, format: "currency" },
        },
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("registry_widget");
    expect(items[0].payload).toMatchObject({
      type: "registry_widget",
      definitionId: WORKBENCH_LEGACY_KPI_ID,
      config: { label: "Volume", value: 100, format: "currency" },
    });
  });

  it("emits registry_widget for static table snapshots", () => {
    const items = convertChatToCanvasItems([
      assistantMessage({
        visualization: {
          type: "table",
          title: "T",
          data: [{ a: 1 }],
          tableConfig: {
            columns: [{ key: "a", label: "A" }],
          },
        },
      }),
    ]);
    expect(items[0].payload).toMatchObject({
      definitionId: WORKBENCH_LEGACY_TABLE_ID,
    });
  });

  it("emits registry_widget for static chart snapshots", () => {
    const viz = {
      type: "bar" as const,
      title: "Chart",
      data: [{ x: "A", y: 1 }],
      xKey: "x",
      yKey: "y",
    };
    const items = convertChatToCanvasItems([
      assistantMessage({ visualization: viz }),
    ]);
    expect(items[0].payload).toMatchObject({
      definitionId: WORKBENCH_LEGACY_CHART_ID,
      config: { vizConfig: viz },
    });
  });

  it("bundles SQL messages into widget_group with cohi items", () => {
    const items = convertChatToCanvasItems([
      assistantMessage({
        id: "sql-1",
        sqlQuery: "SELECT 1",
        visualization: {
          type: "bar",
          title: "SQL Chart",
          data: [],
          xKey: "x",
          yKey: "y",
        },
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("widget_group");
    const payload = items[0].payload as { items?: { kind: string }[] };
    expect(payload.items?.[0]?.kind).toBe("cohi");
  });
});

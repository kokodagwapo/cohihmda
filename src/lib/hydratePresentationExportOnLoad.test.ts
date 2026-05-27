import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/hooks/useCohiChat";
import { hydratePresentationExportsOnLoad } from "@/lib/hydratePresentationExportOnLoad";

describe("hydratePresentationExportsOnLoad", () => {
  it("restores research report PPT card from persisted metadata", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "Make a powerpoint of pipeline health",
        timestamp: new Date(),
      },
      {
        id: "a1",
        role: "assistant",
        content: "Research started…",
        timestamp: new Date(),
      },
    ];

    const hydrated = hydratePresentationExportsOnLoad(messages, [
      {
        assistantMessageId: "a1",
        metadata: {
          presentationExport: {
            prefilterHit: true,
            wantsPresentationExport: true,
            mode: "create",
            action: "export_research_report",
            confidence: 0.9,
            deferred: true,
          },
        },
      },
    ]);

    expect(hydrated[1]?.pptExport).toMatchObject({
      exportKind: "research_report",
      status: "building",
    });
  });

  it("restores viz PPT card when a visualization exists on a prior turn", () => {
    const messages: ChatMessage[] = [
      {
        id: "a0",
        role: "assistant",
        content: "Here is the chart",
        timestamp: new Date(),
        visualization: {
          type: "bar",
          title: "Pipeline Health",
          data: [],
        } as ChatMessage["visualization"],
      },
      {
        id: "u1",
        role: "user",
        content: "put that in slides",
        timestamp: new Date(),
      },
      {
        id: "a1",
        role: "assistant",
        content: "I'll prepare a PowerPoint from your last chart.",
        timestamp: new Date(),
      },
    ];

    const hydrated = hydratePresentationExportsOnLoad(messages, [
      {
        assistantMessageId: "a1",
        metadata: {
          presentationExport: {
            prefilterHit: true,
            wantsPresentationExport: true,
            mode: "convert",
            action: "export_viz",
            confidence: 0.9,
          },
        },
      },
    ]);

    expect(hydrated[2]?.pptExport).toMatchObject({
      title: "Pipeline Health",
      status: "ready",
      messageId: "a0",
    });
  });
});

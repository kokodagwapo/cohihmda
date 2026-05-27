import type { ChatMessage } from "@/hooks/useCohiChat";
import {
  exportAssistantVisualizationAsPpt,
} from "@/lib/chatPptExport";
import {
  parsePresentationExportMetadata,
  type ChatMessagePptExport,
} from "@/lib/presentationExportTypes";
import { writeChatVizExportToBlob } from "@/lib/chatVisualizationPptContent";
import {
  resolvePresentationExportTargetMessage,
} from "@/lib/pptMessageResolver";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import { dispatchOpenWorkbenchPptEditor } from "@/lib/workbench/workbenchChatHandoff";

export type ApplyPresentationExportArgs = {
  messages: ChatMessage[];
  assistantMessageId: string;
  chatType: UnifiedChatType;
  metadata?: Record<string, unknown>;
  userQuestion?: string;
  onOpenWorkbenchEditor?: () => void | Promise<void>;
};

function attachPptExportToMessage(
  messages: ChatMessage[],
  targetMessageId: string,
  pptExport: ChatMessagePptExport,
): ChatMessage[] {
  return messages.map((m) =>
    m.id === targetMessageId ? { ...m, pptExport } : m,
  );
}

/**
 * After a unified chat turn, run NL presentation export when server metadata requests it.
 */
export async function applyPresentationExportAfterTurn(
  args: ApplyPresentationExportArgs,
): Promise<ChatMessage[]> {
  const meta = parsePresentationExportMetadata(args.metadata);
  if (!meta?.wantsPresentationExport) {
    return args.messages;
  }

  if (meta.action === "open_workbench_editor") {
    if (args.onOpenWorkbenchEditor) {
      await args.onOpenWorkbenchEditor();
    } else {
      dispatchOpenWorkbenchPptEditor({
        messages: args.messages,
        mode: meta.mode,
        latestAssistantId: args.assistantMessageId,
        userQuestion: args.userQuestion,
      });
    }
    return args.messages;
  }

  if (meta.action === "export_research_report") {
    const pptExport: ChatMessagePptExport = {
      title: "Research report",
      slideCount: 0,
      exportKind: "research_report",
      status: meta.deferred ? "building" : "ready",
    };
    return args.messages.map((m) =>
      m.id === args.assistantMessageId ? { ...m, pptExport } : m,
    );
  }

  if (meta.action !== "export_viz") {
    return args.messages;
  }

  const target = resolvePresentationExportTargetMessage(
    args.messages,
    meta.mode,
    meta.mode === "create" ? args.assistantMessageId : undefined,
  );

  if (!target?.visualization) {
    return args.messages.map((m) =>
      m.id === args.assistantMessageId
        ? {
            ...m,
            content:
              m.content +
              "\n\nI couldn't find a chart to export. Run an analysis first, then ask for a PowerPoint or slides.",
          }
        : m,
    );
  }

  const attachToId =
    meta.mode === "convert" && target.id !== args.assistantMessageId
      ? args.assistantMessageId
      : target.id;

  try {
    const { exportContent, chartEmbedded } =
      await exportAssistantVisualizationAsPpt({
        viz: target.visualization,
        title: target.visualization.title,
        messageId: target.id,
        download: false,
      });

    const { blob } = await writeChatVizExportToBlob(exportContent);
    const blobUrl = URL.createObjectURL(blob);
    const slideCount = 1 + exportContent.tablePages.length;

    const pptExport: ChatMessagePptExport = {
      title: exportContent.title,
      slideCount,
      exportContent,
      messageId: target.id,
      chartEmbedded,
      blobUrl,
      status: "ready",
    };

    return attachPptExportToMessage(args.messages, attachToId, pptExport);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build presentation";
    const errorAttachId = target?.id ?? args.assistantMessageId;
    return attachPptExportToMessage(args.messages, errorAttachId, {
      title: target.visualization.title || "Visualization",
      slideCount: 0,
      status: "error",
      errorMessage: message,
    });
  }
}

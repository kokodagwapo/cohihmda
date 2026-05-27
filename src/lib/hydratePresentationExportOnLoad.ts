import type { ChatMessage } from "@/hooks/useCohiChat";
import { applyPresentationExportAfterTurn } from "@/lib/applyPresentationExportAfterTurn";
import {
  parsePresentationExportMetadata,
  type ChatMessagePptExport,
  type PresentationExportMetadataPayload,
} from "@/lib/presentationExportTypes";
import { resolvePresentationExportTargetMessage } from "@/lib/pptMessageResolver";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";

export type LoadedTurnPresentationMeta = {
  assistantMessageId: string;
  metadata?: Record<string, unknown>;
};

function attachPptExport(
  messages: ChatMessage[],
  targetMessageId: string,
  pptExport: ChatMessagePptExport,
): ChatMessage[] {
  return messages.map((m) =>
    m.id === targetMessageId ? { ...m, pptExport } : m,
  );
}

function attachMessageIdForPptExport(
  messages: ChatMessage[],
  meta: PresentationExportMetadataPayload,
  assistantMessageId: string,
): string {
  if (meta.action === "export_research_report") {
    return assistantMessageId;
  }
  if (meta.action !== "export_viz") {
    return assistantMessageId;
  }

  const target = resolvePresentationExportTargetMessage(
    messages,
    meta.mode,
    meta.mode === "create" ? assistantMessageId : undefined,
  );
  if (!target) return assistantMessageId;
  if (meta.mode === "convert" && target.id !== assistantMessageId) {
    return assistantMessageId;
  }
  return target.id;
}

function syncPptExportFromMetadata(
  messages: ChatMessage[],
  meta: PresentationExportMetadataPayload,
  assistantMessageId: string,
): ChatMessage[] | null {
  if (!meta.wantsPresentationExport || meta.action === "open_workbench_editor") {
    return null;
  }

  if (meta.action === "export_research_report") {
    const attachToId = attachMessageIdForPptExport(
      messages,
      meta,
      assistantMessageId,
    );
    return attachPptExport(messages, attachToId, {
      title: "Research report",
      slideCount: 0,
      exportKind: "research_report",
      status: meta.deferred ? "building" : "ready",
    });
  }

  if (meta.action !== "export_viz") {
    return null;
  }

  const target = resolvePresentationExportTargetMessage(
    messages,
    meta.mode,
    meta.mode === "create" ? assistantMessageId : undefined,
  );
  if (!target?.visualization) {
    return null;
  }

  const attachToId = attachMessageIdForPptExport(
    messages,
    meta,
    assistantMessageId,
  );
  return attachPptExport(messages, attachToId, {
    title: target.visualization.title || "Visualization",
    slideCount: 0,
    messageId: target.id,
    status: "ready",
  });
}

/**
 * Restore PPT export cards when reloading a conversation from persistence.
 */
export function hydratePresentationExportsOnLoad(
  messages: ChatMessage[],
  turns: LoadedTurnPresentationMeta[],
): ChatMessage[] {
  let result = messages;
  for (const turn of turns) {
    const meta = parsePresentationExportMetadata(turn.metadata);
    if (!meta) continue;
    const updated = syncPptExportFromMetadata(
      result,
      meta,
      turn.assistantMessageId,
    );
    if (updated) result = updated;
  }
  return result;
}

/**
 * Rebuild viz PPT blobs/export content after history reload (blob URLs are not persisted).
 */
export async function enrichVizPresentationExportsOnLoad(
  messages: ChatMessage[],
  turns: LoadedTurnPresentationMeta[],
  chatType: UnifiedChatType,
): Promise<ChatMessage[]> {
  let result = messages;
  for (const turn of turns) {
    const meta = parsePresentationExportMetadata(turn.metadata);
    if (meta?.action !== "export_viz") continue;
    result = await applyPresentationExportAfterTurn({
      messages: result,
      assistantMessageId: turn.assistantMessageId,
      chatType,
      metadata: turn.metadata,
    });
  }
  return result;
}

import type { ChatMessage } from "@/hooks/useCohiChat";
import type { PresentationExportMode } from "@/lib/presentationExportIntent";

/** Last assistant message with a visualization (for NL PPT export). */
export function findLastAssistantMessageWithVisualization(
  messages: ChatMessage[],
  options?: { excludeMessageIds?: string[] },
): ChatMessage | undefined {
  const exclude = new Set(options?.excludeMessageIds ?? []);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || exclude.has(m.id)) continue;
    if (m.visualization && !m.error) return m;
  }
  return undefined;
}

/**
 * Resolve export target for presentation NL.
 * convert: viz from the prior assistant turn (before latest user message).
 * create: viz on the latest assistant turn.
 */
export function resolvePresentationExportTargetMessage(
  messages: ChatMessage[],
  mode: PresentationExportMode,
  latestAssistantId?: string,
): ChatMessage | undefined {
  if (mode === "convert") {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    const beforeConvert = lastUserIdx >= 0 ? messages.slice(0, lastUserIdx) : messages;
    return findLastAssistantMessageWithVisualization(beforeConvert, {
      excludeMessageIds: latestAssistantId ? [latestAssistantId] : undefined,
    });
  }

  if (latestAssistantId) {
    const latest = messages.find((m) => m.id === latestAssistantId);
    if (latest?.visualization && !latest.error) return latest;
  }

  return findLastAssistantMessageWithVisualization(messages);
}

export function slideCountFromExportContent(tablePages: number): number {
  return 1 + tablePages;
}

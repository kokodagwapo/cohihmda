/**
 * Stable clientMessageId for insight-builder approve (COHI-387 idempotency).
 */

import type { InsightBuilderSendDraft } from "@/lib/unifiedChatSend";

function formatUuidFromBytes(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Deterministic UUID for a draft approve so duplicate submits get 409 idempotency. */
export async function insightBuilderApproveClientMessageId(
  draft: InsightBuilderSendDraft,
): Promise<string> {
  const canonical = JSON.stringify({
    title: draft.title.trim(),
    prompt_text: draft.prompt_text.trim(),
    schedule: draft.schedule,
    prompt_tag: draft.prompt_tag ?? "",
    specifiers: draft.specifiers ?? {},
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const bytes = new Uint8Array(hash.slice(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return formatUuidFromBytes(bytes);
}

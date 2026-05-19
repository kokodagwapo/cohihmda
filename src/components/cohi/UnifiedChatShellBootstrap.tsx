/**
 * Resume unified chat from legacy URL query params (COHI-403 §4.5).
 */

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { createUnifiedChatClient } from "@/lib/unifiedChatClient";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";

export interface UnifiedChatShellBootstrapProps {
  tenantId?: string;
  onResume?: (conversationId: string, chatType: UnifiedChatType) => void;
}

export function UnifiedChatShellBootstrap({
  tenantId,
  onResume,
}: UnifiedChatShellBootstrapProps) {
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (!isUnifiedChatClientEnabled() || !onResume) return;
    const resume = params.get("resume");
    const mode = params.get("mode") ?? params.get("chat_mode");
    if (!resume) return;

    const chatType =
      mode === "research"
        ? "research"
        : mode === "insight_builder"
          ? "insight_builder"
          : mode === "workbench"
            ? "workbench"
            : "chat";

    const run = async () => {
      try {
        const client = createUnifiedChatClient(tenantId);
        const row = await client.getConversation(resume);
        onResume(row.id, (row.chat_type as UnifiedChatType) ?? chatType);
      } catch {
        const client = createUnifiedChatClient(tenantId);
        const list = await client.listConversations({
          limit: 50,
          chat_type: chatType === "research" ? "research" : undefined,
        });
        const match = list.find(
          (c) => c.legacy_ref === resume || c.id === resume,
        );
        if (match) onResume(match.id, match.chat_type);
      } finally {
        const next = new URLSearchParams(params);
        next.delete("resume");
        next.delete("session");
        setParams(next, { replace: true });
      }
    };

    void run();
  }, [params, tenantId, onResume, setParams]);

  return null;
}

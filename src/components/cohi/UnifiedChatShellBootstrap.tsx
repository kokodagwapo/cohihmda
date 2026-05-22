/**
 * Resume unified chat from legacy URL query params (COHI-403 §4.5).
 */

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createUnifiedChatClient } from "@/lib/unifiedChatClient";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import { navigateForWorkbenchConversationResume } from "@/lib/workbench/workbenchChatHandoff";

export interface UnifiedChatShellBootstrapProps {
  tenantId?: string;
  onResume?: (conversationId: string, chatType: UnifiedChatType) => void;
}

export function UnifiedChatShellBootstrap({
  tenantId,
  onResume,
}: UnifiedChatShellBootstrapProps) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

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
        const resolvedType = (row.chat_type as UnifiedChatType) ?? chatType;
        const scopeType = row.scope?.type;
        const scopeId = row.scope?.id;
        if (
          resolvedType === "workbench" &&
          scopeId &&
          (scopeType === "canvas" || scopeType === "draft") &&
          navigateForWorkbenchConversationResume(navigate, {
            conversationId: row.id,
            scopeType,
            scopeId,
          })
        ) {
          onResume(row.id, "workbench");
          return;
        }
        onResume(row.id, resolvedType);
      } catch {
        const client = createUnifiedChatClient(tenantId);
        if (chatType === "research") {
          try {
            const opened = await client.openSharedResearch(resume);
            onResume(opened.id, opened.chat_type ?? "research");
            return;
          } catch {
            /* fall through to list lookup */
          }
        }
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

import { useState, useCallback, useRef } from "react";
import {
  postUnifiedChatV1,
  parseGlobalUnifiedEnvelope,
  type UnifiedChatBlock,
} from "@/lib/unifiedChatEnvelope";

export type UnifiedBlock = UnifiedChatBlock;

export interface UnifiedChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: UnifiedBlock[];
  timestamp: Date;
  isLoading?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface UseUnifiedChatOptions {
  tenantId?: string;
  /** default: import.meta.env.VITE_UNIFIED_CHAT === "true" */
  enabled?: boolean;
  location?: {
    surface:
      | "site"
      | "workbench_canvas"
      | "workbench_hub"
      | "insight_modal"
      | "data_chat_page";
    route?: string;
  };
  scope?: {
    type:
      | "global_session"
      | "canvas"
      | "draft"
      | "insight"
      | "widget_edit"
      | "workbench_hub";
    id?: string;
  };
  context?: Record<string, unknown>;
  onError?: (e: Error) => void;
}

function useUnifiedByDefault(): boolean {
  try {
    return import.meta.env.VITE_UNIFIED_CHAT === "true";
  } catch {
    return false;
  }
}

/**
 * Thin client for POST /api/chat/v1/messages (optional surfaces).
 * Prefer useCohiChat / useWorkbenchCohi when integrated with panels.
 */
export function useUnifiedChat(options: UseUnifiedChatOptions = {}) {
  const {
    tenantId,
    enabled = useUnifiedByDefault(),
    location = { surface: "site" },
    scope = { type: "global_session" },
    context,
    onError,
  } = options;

  const [messages, setMessages] = useState<UnifiedChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const idCounter = useRef(0);

  const nextId = useCallback(() => {
    idCounter.current += 1;
    return `u-${Date.now()}-${idCounter.current}`;
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!enabled || !text.trim() || isLoading) return;
      const userId = nextId();
      const asstId = nextId();
      setMessages((m) => [
        ...m,
        {
          id: userId,
          role: "user",
          content: text.trim(),
          timestamp: new Date(),
        },
        {
          id: asstId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isLoading: true,
        },
      ]);
      setIsLoading(true);
      try {
        const res = await postUnifiedChatV1(
          {
            message: text.trim(),
            conversationId: conversationId ?? undefined,
            clientMessageId: crypto.randomUUID(),
            location,
            scope,
            context,
            history: messages.slice(-6).map((x) => ({
              role: x.role,
              content: x.content,
            })),
          },
          tenantId ?? null,
        );
        setConversationId(res.conversationId);
        const parsed = parseGlobalUnifiedEnvelope(res);
        const prose = parsed.message;
        setMessages((m) =>
          m.map((x) =>
            x.id === asstId
              ? {
                  ...x,
                  isLoading: false,
                  content: prose || "(no text block)",
                  blocks: res.turn.blocks,
                  metadata: res.metadata,
                }
              : x,
          ),
        );
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        onError?.(err);
        setMessages((m) =>
          m.map((x) =>
            x.id === asstId
              ? {
                  ...x,
                  isLoading: false,
                  error: err.message || "Request failed",
                  content: "Sorry, something went wrong.",
                }
              : x,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [
      enabled,
      isLoading,
      tenantId,
      location,
      scope,
      context,
      messages,
      conversationId,
      nextId,
      onError,
    ],
  );

  return {
    messages,
    sendMessage,
    isLoading,
    conversationId,
    setConversationId,
    enabled,
  };
}

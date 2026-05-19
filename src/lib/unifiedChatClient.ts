/**
 * Unified Chat v1 client SDK (COHI-396).
 * POST /messages, POST /messages:stream, conversations CRUD, permissions.
 */

import { api } from "@/lib/api";
import {
  isUnifiedChatClientEnabled,
  resolveDefaultTenantId,
  type UnifiedChatBlock,
  type UnifiedChatV1Response,
} from "@/lib/unifiedChatEnvelope";

export type {
  UnifiedChatBlock,
  UnifiedChatV1Response,
} from "@/lib/unifiedChatEnvelope";
export { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";

/** Stable hub scope keys (COHI-395 AC2). */
export const WORKBENCH_HUB_SCOPE_IDS = {
  favorites: "hub:favorites",
  shared: "hub:shared",
  teamFolders: "hub:team-folders",
} as const;

export type UnifiedChatType =
  | "chat"
  | "research"
  | "insight_builder"
  | "workbench";

export type UnifiedScopeType =
  | "global_session"
  | "canvas"
  | "draft"
  | "insight"
  | "widget_edit"
  | "workbench_hub";

export interface UnifiedChatScope {
  type: UnifiedScopeType;
  id?: string;
}

export interface UnifiedChatLocation {
  surface:
    | "site"
    | "workbench_canvas"
    | "workbench_hub"
    | "insight_modal"
    | "data_chat_page";
  route?: string;
  locale?: string;
}

export interface UnifiedChatMessageRequest {
  message: string;
  chat_type?: UnifiedChatType;
  conversationId?: string;
  clientMessageId?: string;
  scope?: UnifiedChatScope;
  location?: UnifiedChatLocation;
  context?: Record<string, unknown>;
  history?: { role: "user" | "assistant"; content: string }[];
  options?: {
    stream?: boolean;
    includeRag?: boolean;
    includeLiveCanvasData?: boolean;
    maxHistoryTurns?: number;
    research?: { deepAnalysis?: boolean };
  };
}

export interface UnifiedConversationSummary {
  id: string;
  title: string;
  scope: UnifiedChatScope;
  chat_type: UnifiedChatType;
  legacy_ref?: string | null;
  legacy_source?: string | null;
  folder_id?: string | null;
  created_at?: string;
  updated_at: string;
  phase?: string | null;
}

export interface UnifiedChatFolder {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  created_at: string;
  updated_at: string;
}

export interface UnifiedChatPermissions {
  cohiChat: boolean;
  chatTypes: UnifiedChatType[];
}

export type ChatStreamEvent = {
  event: string;
  conversationId?: string;
  turnId?: string;
  blockIndex?: number;
  blockType?: string;
  delta?: string;
  block?: UnifiedChatBlock;
  /** Present on turn.started / turn.completed (e.g. researchShellExpand for COHI-404). */
  metadata?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
};

export interface StreamTurnResult {
  conversationId: string;
  turnId: string;
  blocks: UnifiedChatBlock[];
  metadata?: Record<string, unknown>;
}

function withTenant(basePath: string, tid: string | null): string {
  if (!tid) return basePath;
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}tenant_id=${encodeURIComponent(tid)}`;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const CHAT_V1_CONVERSATIONS_PATH = "/api/chat/v1/conversations";
const CHAT_V1_FOLDERS_PATH = "/api/chat/v1/folders";

function invalidateUnifiedChatConversationCache() {
  api.invalidateCacheFor(CHAT_V1_CONVERSATIONS_PATH);
}

function invalidateUnifiedChatFolderCache() {
  api.invalidateCacheFor(CHAT_V1_FOLDERS_PATH);
}

export class UnifiedChatClient {
  constructor(private tenantId?: string | null) {}

  private async tid(): Promise<string | null> {
    return resolveDefaultTenantId(this.tenantId ?? undefined);
  }

  async getPermissions(): Promise<UnifiedChatPermissions> {
    const path = withTenant("/api/chat/v1/permissions", await this.tid());
    return api.request<UnifiedChatPermissions>(path);
  }

  async listConversations(query?: {
    scope_type?: string;
    scope_key?: string;
    chat_type?: UnifiedChatType;
    q?: string;
    folder_id?: string;
    include_subfolders?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<UnifiedConversationSummary[]> {
    const tid = await this.tid();
    const params = new URLSearchParams();
    if (query?.scope_type) params.set("scope_type", query.scope_type);
    if (query?.scope_key !== undefined) params.set("scope_key", query.scope_key);
    if (query?.chat_type) params.set("chat_type", query.chat_type);
    if (query?.q) params.set("q", query.q);
    if (query?.folder_id) params.set("folder_id", query.folder_id);
    if (query?.include_subfolders === false) {
      params.set("include_subfolders", "false");
    }
    if (query?.limit !== undefined) params.set("limit", String(query.limit));
    if (query?.offset !== undefined) params.set("offset", String(query.offset));
    const qs = params.toString();
    const path = withTenant(
      `${CHAT_V1_CONVERSATIONS_PATH}${qs ? `?${qs}` : ""}`,
      tid,
    );
    const res = await api.request<{ conversations: UnifiedConversationSummary[] }>(
      path,
    );
    return res.conversations ?? [];
  }

  async getConversation(id: string): Promise<{
    id: string;
    title: string;
    scope: UnifiedChatScope;
    chat_type: UnifiedChatType;
    messages: unknown[];
    legacy_ref?: string | null;
  }> {
    const path = withTenant(`/api/chat/v1/conversations/${id}`, await this.tid());
    return api.request(path);
  }

  async createConversation(body: {
    scope: UnifiedChatScope;
    chat_type?: UnifiedChatType;
    title?: string;
    legacy_ref?: string | null;
  }): Promise<string> {
    const path = withTenant(CHAT_V1_CONVERSATIONS_PATH, await this.tid());
    const res = await api.request<{ conversationId: string }>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    invalidateUnifiedChatConversationCache();
    return res.conversationId;
  }

  async deleteConversation(id: string): Promise<void> {
    const path = withTenant(`${CHAT_V1_CONVERSATIONS_PATH}/${id}`, await this.tid());
    await api.request(path, { method: "DELETE" });
    invalidateUnifiedChatConversationCache();
  }

  async patchConversation(
    id: string,
    body: { title?: string; folder_id?: string | null },
  ): Promise<unknown> {
    const path = withTenant(`${CHAT_V1_CONVERSATIONS_PATH}/${id}`, await this.tid());
    const result = await api.request(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    invalidateUnifiedChatConversationCache();
    return result;
  }

  async listFolders(): Promise<UnifiedChatFolder[]> {
    const path = withTenant(CHAT_V1_FOLDERS_PATH, await this.tid());
    const res = await api.request<{ folders: UnifiedChatFolder[] }>(path);
    return res.folders ?? [];
  }

  async createFolder(body: {
    name: string;
    parent_id?: string | null;
  }): Promise<UnifiedChatFolder> {
    const path = withTenant(CHAT_V1_FOLDERS_PATH, await this.tid());
    const res = await api.request<{ folder: UnifiedChatFolder }>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    invalidateUnifiedChatFolderCache();
    return res.folder;
  }

  async renameFolder(id: string, name: string): Promise<UnifiedChatFolder> {
    const path = withTenant(`${CHAT_V1_FOLDERS_PATH}/${id}`, await this.tid());
    const res = await api.request<{ folder: UnifiedChatFolder }>(path, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    invalidateUnifiedChatFolderCache();
    return res.folder;
  }

  async moveFolder(
    id: string,
    parentId: string | null,
  ): Promise<UnifiedChatFolder> {
    const path = withTenant(`${CHAT_V1_FOLDERS_PATH}/${id}`, await this.tid());
    const res = await api.request<{ folder: UnifiedChatFolder }>(path, {
      method: "PATCH",
      body: JSON.stringify({ parent_id: parentId }),
    });
    invalidateUnifiedChatFolderCache();
    return res.folder;
  }

  async deleteFolder(id: string): Promise<void> {
    const path = withTenant(`${CHAT_V1_FOLDERS_PATH}/${id}`, await this.tid());
    await api.request(path, { method: "DELETE" });
    invalidateUnifiedChatFolderCache();
    invalidateUnifiedChatConversationCache();
  }

  async rebindConversation(
    id: string,
    body: { scope: UnifiedChatScope; chat_type?: UnifiedChatType },
  ): Promise<unknown> {
    const path = withTenant(
      `/api/chat/v1/conversations/${id}/rebind`,
      await this.tid(),
    );
    return api.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async postMessage(
    body: UnifiedChatMessageRequest,
  ): Promise<UnifiedChatV1Response> {
    const path = withTenant("/api/chat/v1/messages", await this.tid());
    return api.request<UnifiedChatV1Response>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Parse SSE from POST /messages:stream; invokes onEvent for each ChatStreamEvent.
   */
  async postMessageStream(
    body: UnifiedChatMessageRequest,
    onEvent: (ev: ChatStreamEvent) => void,
  ): Promise<StreamTurnResult> {
    const tid = await this.tid();
    const path = withTenant("/api/chat/v1/messages:stream", tid);
    const response = await fetch(path, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const err = (await response.json()) as { message?: string };
        message = err.message ?? message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Stream body unavailable");

    const decoder = new TextDecoder();
    let buffer = "";
    let conversationId = "";
    let turnId = "";
    const blocks: UnifiedChatBlock[] = [];
    const textByBlock = new Map<number, string>();
    let metadata: Record<string, unknown> | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const ev = JSON.parse(json) as ChatStreamEvent;
            onEvent(ev);
            if (ev.conversationId) conversationId = ev.conversationId;
            if (ev.turnId) turnId = ev.turnId;
            if (ev.event === "turn.completed" && ev.metadata) {
              metadata = { ...metadata, ...ev.metadata };
            }
            if (ev.event === "turn.started" && ev.metadata) {
              metadata = { ...metadata, ...ev.metadata };
            }
            if (ev.event === "block.delta" && ev.delta != null) {
              const idx = ev.blockIndex ?? 0;
              if (ev.blockType === "text" || !ev.blockType) {
                const prev = textByBlock.get(idx) ?? "";
                textByBlock.set(idx, prev + ev.delta);
                blocks[idx] = {
                  type: "text",
                  markdown: textByBlock.get(idx) ?? "",
                };
              }
            }
            if (ev.event === "block.completed" && ev.block) {
              const idx = ev.blockIndex ?? blocks.length;
              blocks[idx] = ev.block as UnifiedChatBlock;
              if (
                (ev.block as UnifiedChatBlock).type === "text" &&
                !(ev.block as { markdown?: string }).markdown &&
                textByBlock.has(idx)
              ) {
                blocks[idx] = {
                  type: "text",
                  markdown: textByBlock.get(idx) ?? "",
                };
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
    }

    return {
      conversationId,
      turnId,
      blocks: blocks.filter(Boolean),
      metadata,
    };
  }
}

export function createUnifiedChatClient(tenantId?: string | null): UnifiedChatClient {
  return new UnifiedChatClient(tenantId);
}

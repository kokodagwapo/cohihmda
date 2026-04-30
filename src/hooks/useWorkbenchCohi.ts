/**
 * useWorkbenchCohi
 *
 * Manages the Cohi chat state within the workbench context.
 * Sends canvas state and widget catalog as context with every message
 * so the LLM can suggest/add existing widgets, create new ones, or teach.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import type {
  WorkbenchChatMessage,
  WidgetAction,
  CanvasStateSnapshot,
} from '@/types/widgetActions';
import type { CanvasLayoutItem } from '@/components/workbench/canvas/types';
import type { GroupWidgetItem } from '@/components/workbench/canvas/types';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import { useWidgetSectionStore } from '@/stores/widgetSectionStore';
import { getWidgetDefinition } from '@/components/widgets/registry';

// ---------------------------------------------------------------------------
// Tenant resolution helper – mirrors logic from useCohiChat
// ---------------------------------------------------------------------------
let _defaultTenantId: string | null | undefined = undefined;

async function resolveEffectiveTenantId(
  explicitTenantId?: string | null
): Promise<string | null> {
  if (explicitTenantId) return explicitTenantId;
  if (_defaultTenantId !== undefined) return _defaultTenantId;
  try {
    const response = await api.request<
      { tenants: { id: string }[] } | { id: string }[]
    >('/api/tenants');
    const list = Array.isArray(response)
      ? response
      : (response as any).tenants || [];
    const first = list[0];
    if (first?.id) {
      _defaultTenantId = first.id;
      return _defaultTenantId;
    }
  } catch {
    // ignore – will proceed without tenant
  }
  _defaultTenantId = null;
  return null;
}

/** Build the base URL with tenant_id query parameter */
function withTenant(basePath: string, tid: string | null): string {
  if (!tid) return basePath;
  const sep = basePath.includes('?') ? '&' : '?';
  return `${basePath}${sep}tenant_id=${encodeURIComponent(tid)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkbenchCohiResponse {
  message: string;
  actions?: WidgetAction[];
  teachingNotes?: string;
  suggestedQuestions?: string[];
  error?: string;
}

/** Metadata about an insight that spawned this canvas (from deep-dive). */
export interface SourceInsightContext {
  id: number;
  headline: string;
  source: string;
  bucket: string;
  detail_query?: Record<string, any> | null;
}

export interface UseWorkbenchCohiOptions {
  tenantId?: string | null;
  /** Current canvas items – used to build CanvasStateSnapshot */
  canvasItems?: CanvasLayoutItem[];
  /** Widget catalog summary string (from widgetCatalogSerializer) */
  widgetCatalog?: string;
  /** Stable conversation scope key: canvas:<id> or draft:<uuid> */
  conversationScopeId?: string | null;
  /** Real canvas id (if saved) for payload context */
  canvasId?: string | null;
  /** Source insight context when canvas was created via deep-dive */
  sourceInsight?: SourceInsightContext | null;
  /** ID of the widget the user is editing (from "Edit with Cohi") — marked as selected in snapshot */
  selectedWidgetId?: string | null;
  onError?: (error: Error) => void;
  /** Called when the AI returns executable actions — auto-executes them on the canvas */
  onAutoExecuteActions?: (actions: WidgetAction[]) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkbenchCohi(options: UseWorkbenchCohiOptions = {}) {
  const { tenantId, canvasItems = [], widgetCatalog = '', conversationScopeId, canvasId, sourceInsight, selectedWidgetId, onError, onAutoExecuteActions } = options;

  const [messages, setMessages] = useState<WorkbenchChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Build default suggestions — context-aware when spawned from an insight
  const defaultSuggestions = useMemo(() => {
    if (sourceInsight?.headline) {
      return [
        `What's driving this: "${sourceInsight.headline.substring(0, 60)}"?`,
        'Break this down by loan officer',
        'Show me the trend over the last 12 months',
        'Compare this to prior year performance',
      ];
    }
    return [
      'Prepare a board-ready overview of this month\'s performance',
      'Summarize pipeline health and pull-through trends',
      'What needs my attention right now?',
      'Build an executive dashboard with key KPIs',
    ];
  }, [sourceInsight?.headline]);

  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(defaultSuggestions);

  // Update suggestions when sourceInsight changes
  useEffect(() => {
    setSuggestedQuestions(defaultSuggestions);
  }, [defaultSuggestions]);

  const messageIdCounter = useRef(0);

  // -------------------------------------------------------------------------
  // Load most recent conversation for this canvas on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    // Scope-scoped chat: reset when switching canvas/draft scope.
    setConversationId(null);
    setMessages([]);

    (async () => {
      try {
        // Must have a concrete scope key (canvas:* or draft:*).
        if (!conversationScopeId) {
          setConversationId(null);
          return;
        }
        const tid = await resolveEffectiveTenantId(tenantId);
        if (!tid || cancelled) return;

        const base = `/api/cohi-chat/workbench/conversations?canvasId=${encodeURIComponent(conversationScopeId)}&limit=1`;
        const response = await api.request<{
          conversations: {
            id: string;
            title: string;
            messages: WorkbenchChatMessage[];
          }[];
        }>(withTenant(base, tid));

        if (cancelled) return;

        const conv = response.conversations?.[0];
        if (conv && conv.messages.length > 0) {
          setConversationId(conv.id);
          const loadedMessages = conv.messages.map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          }));
          setMessages(loadedMessages);
          // Set counter to the max numeric ID seen so new messages never collide
          const maxId = loadedMessages.reduce((max: number, m: WorkbenchChatMessage) => {
            const num = parseInt(String(m.id ?? '').replace('wb-msg-', ''), 10);
            return isNaN(num) ? max : Math.max(max, num);
          }, 0);
          messageIdCounter.current = maxId;
        }
      } catch {
        // Silently fail – conversation persistence is optional
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, conversationScopeId]);

  // -------------------------------------------------------------------------
  // Build canvas state snapshot from current items
  // -------------------------------------------------------------------------

  const buildCanvasSnapshot = useCallback((): CanvasStateSnapshot => {
    const groups: CanvasStateSnapshot['groups'] = [];
    const standaloneWidgets: CanvasStateSnapshot['standaloneWidgets'] = [];

    // Read filter state for widget groups
    const sectionState = useWidgetSectionStore.getState().sections;

    for (const item of canvasItems) {
      if (item.payload.type === 'widget_group') {
        // Resolve active filters for this group
        const sectionFilters = sectionState[item.payload.groupId];
        const filters: CanvasStateSnapshot['groups'][0]['filters'] = sectionFilters
          ? {
              dateRange: sectionFilters.periodSelection?.preset
                || (sectionFilters.dateRange
                  ? `${sectionFilters.dateRange.start} to ${sectionFilters.dateRange.end}`
                  : `${sectionFilters.year}`),
              dateField: sectionFilters.dateField || undefined,
              branch: sectionFilters.branch !== 'all' ? sectionFilters.branch : undefined,
              loanOfficer: sectionFilters.loanOfficer !== 'all' ? sectionFilters.loanOfficer : undefined,
            }
          : undefined;

        // Build widget list and include grid layouts for agent context
        const items = item.payload.items ?? item.payload.widgetIds?.map((defId: string) => ({ kind: 'registry' as const, defId })) ?? [];
        const widgets: CanvasStateSnapshot['groups'][0]['widgets'] = [];
        function itemKey(groupItem: GroupWidgetItem, idx: number): string {
          if (groupItem.kind === 'registry') return `${groupItem.defId}__${idx}`;
          return `cohi__${groupItem.id}__${idx}`;
        }
        items.forEach((groupItem: GroupWidgetItem, idx: number) => {
          const key = itemKey(groupItem, idx);
          if (groupItem.kind === 'registry') {
            const def = getWidgetDefinition(groupItem.defId);
            widgets.push({
              id: key,
              kind: 'registry',
              defId: groupItem.defId,
              name: def?.name,
            });
          } else {
            widgets.push({
              id: key,
              kind: 'cohi',
              title: groupItem.title,
            });
          }
        });

        groups.push({
          groupId: item.payload.groupId,
          title: item.payload.title,
          sectionType: item.payload.sectionType,
          widgetIds: item.payload.widgetIds,
          widgets: widgets.length > 0 ? widgets : undefined,
          widgetLayouts: item.payload.widgetLayouts,
          filters,
        });
      } else {
        const isCohiWidget = item.payload.type === 'cohi_widget';
        const cohiPayload = isCohiWidget ? (item.payload as any) : undefined;
        standaloneWidgets.push({
          id: item.i,
          type: item.payload.type,
          title:
            'title' in item.payload
              ? (item.payload as any).title
              : undefined,
          sourceType: cohiPayload?.sourceType,
          sourceSessionId: cohiPayload?.sourceSessionId,
          sourceArtifactId: cohiPayload?.sourceArtifactId,
          artifactCapabilities: cohiPayload?.artifactCapabilities,
          sql: cohiPayload?.sql,
          selected: item.i === selectedWidgetId,
        });
      }
    }

    // Collect rendered widget data from the canvas data store
    const dataSnapshot = useCanvasDataStore.getState().getSnapshot();
    const widgetData = dataSnapshot.map((entry) => ({
      itemId: entry.itemId,
      widgetName: entry.widgetName,
      category: entry.category,
      data: entry.data,
    }));

    return {
      groups,
      standaloneWidgets,
      totalItems: canvasItems.length,
      widgetData: widgetData.length > 0 ? widgetData : undefined,
    };
  }, [canvasItems, selectedWidgetId]);

  // -------------------------------------------------------------------------
  // Send a message
  // -------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMsgId = `wb-msg-${++messageIdCounter.current}`;
      const userMessage: WorkbenchChatMessage = {
        id: userMsgId,
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
      };

      // Add user message and a loading placeholder
      const loadingId = `wb-msg-${++messageIdCounter.current}`;
      const loadingMessage: WorkbenchChatMessage = {
        id: loadingId,
        role: 'assistant',
        content: '',
        isLoading: true,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, loadingMessage]);
      setIsLoading(true);

      try {
        const canvasState = buildCanvasSnapshot();

        // Build conversation history for context (last 6 messages)
        const history = messages.slice(-6).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const effectiveTid = await resolveEffectiveTenantId(tenantId);

        const response = await api.request<WorkbenchCohiResponse>(
          withTenant('/api/cohi-chat/workbench', effectiveTid),
          {
            method: 'POST',
            body: JSON.stringify({
              question: content.trim(),
              canvasState,
              widgetCatalog,
              conversationHistory: history,
              tenantId: effectiveTid,
            }),
          }
        );

        const assistantMessage: WorkbenchChatMessage = {
          id: loadingId,
          role: 'assistant',
          content: response.message || 'I processed your request.',
          actions: response.actions,
          teachingNotes: response.teachingNotes,
          timestamp: new Date(),
          error: response.error,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === loadingId ? assistantMessage : m))
        );

        // Auto-execute canvas-modifying actions so widgets appear immediately
        if (response.actions?.length && onAutoExecuteActions) {
          const executableTypes = new Set([
            'add_existing_widget', 'create_widget', 'create_canvas',
            'suggest_dashboard', 'modify_widget', 'modify_group',
            'modify_registry_widget', 'create_dashboard', 'convert_to_sql_widget',
            'delete_widget',
          ]);
          const autoActions = response.actions.filter((a) => executableTypes.has(a.type));
          if (autoActions.length > 0) {
            onAutoExecuteActions(autoActions);
          }
        }

        if (response.suggestedQuestions?.length) {
          setSuggestedQuestions(response.suggestedQuestions);
        }

        // Persist messages (fire-and-forget)
        if (effectiveTid && conversationScopeId) {
          (async () => {
            try {
              let convId = conversationId;
              if (!convId) {
                // Create a new conversation
                const conv = await api.request<{ id: string }>(
                  withTenant('/api/cohi-chat/workbench/conversations', effectiveTid),
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      canvasId: conversationScopeId,
                      title: content.trim().substring(0, 60),
                    }),
                  }
                );
                convId = conv.id;
                setConversationId(convId);
              }

              // Append both user and assistant messages
              await api.request(
                withTenant(`/api/cohi-chat/workbench/conversations/${convId}/messages`, effectiveTid),
                {
                  method: 'POST',
                  body: JSON.stringify({
                    id: userMsgId,
                    role: 'user',
                    content: content.trim(),
                    timestamp: new Date().toISOString(),
                  }),
                }
              );
              await api.request(
                withTenant(`/api/cohi-chat/workbench/conversations/${convId}/messages`, effectiveTid),
                {
                  method: 'POST',
                  body: JSON.stringify({
                    id: loadingId,
                    role: 'assistant',
                    content: response.message || '',
                    actions: response.actions,
                    teachingNotes: response.teachingNotes,
                    timestamp: new Date().toISOString(),
                  }),
                }
              );
            } catch {
              // Persistence failure is non-critical
            }
          })();
        }
      } catch (error: any) {
        console.error('[WorkbenchCohi] Error:', error);

        const errorMessage: WorkbenchChatMessage = {
          id: loadingId,
          role: 'assistant',
          content: 'Sorry, I encountered an error processing your request.',
          error: error.message || 'Unknown error',
          timestamp: new Date(),
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === loadingId ? errorMessage : m))
        );

        onError?.(error);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, messages, buildCanvasSnapshot, widgetCatalog, tenantId, conversationScopeId, canvasId, conversationId, onError]
  );

  // -------------------------------------------------------------------------
  // Clear conversation
  // -------------------------------------------------------------------------

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    messageIdCounter.current = 0;
    setSuggestedQuestions([
      'What dashboards are available?',
      'Add the Company Scorecard',
      'Show me loan volume by branch',
      'Explain pull-through rate',
    ]);
  }, []);

  return {
    messages,
    isLoading,
    suggestedQuestions,
    sendMessage,
    clearMessages,
  };
}

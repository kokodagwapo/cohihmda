/**
 * EditWidgetDialog
 *
 * Full-screen dialog for conversational widget editing with Cohi.
 * Left panel: Live preview of the widget (updates as edits are applied).
 * Right panel: Chat interface for multi-turn conversation about the widget.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import {
  Loader2,
  Send,
  Sparkles,
  X,
  User,
  Bot,
  CheckCircle2,
  ArrowRightLeft,
  Database,
  ChevronDown,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CohiWidgetRenderer } from '@/components/workbench/canvas/CohiWidgetRenderer';
import { api } from '@/lib/api';
import type { VisualizationConfig } from '@/hooks/useCohiChat';
import type { GroupWidgetItem } from '@/components/workbench/canvas/types';
import type { DateFilter } from '@/hooks/useCohiWidgetData';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Whether this message resulted in a widget modification */
  modified?: boolean;
  loading?: boolean;
}

interface FieldInfo {
  name: string;
  label: string;
  type: string;
  category: string;
}

interface FieldCategory {
  id: string;
  label: string;
}

type RightTab = 'chat' | 'fields';

interface EditWidgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Extract<GroupWidgetItem, { kind: 'cohi' }>;
  tenantId?: string | null;
  dateFilter?: DateFilter | null;
  /** Called when the user accepts the edits */
  onSave: (updated: { sql: string; vizConfig: VisualizationConfig; title: string; explanation?: string }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditWidgetDialog({
  open,
  onOpenChange,
  item,
  tenantId,
  dateFilter,
  onSave,
}: EditWidgetDialogProps) {
  // Live preview state (updates each time Cohi modifies the widget)
  const [liveSql, setLiveSql] = useState(item.sql);
  const [liveVizConfig, setLiveVizConfig] = useState<VisualizationConfig>(item.vizConfig);
  const [liveTitle, setLiveTitle] = useState(item.title);
  const [liveExplanation, setLiveExplanation] = useState(item.explanation);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Right panel tab
  const [rightTab, setRightTab] = useState<RightTab>('chat');

  // Field introspection state
  const [usedFields, setUsedFields] = useState<FieldInfo[]>([]);
  const [availableFields, setAvailableFields] = useState<FieldInfo[]>([]);
  const [fieldCategories, setFieldCategories] = useState<FieldCategory[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const [swappingField, setSwappingField] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const fieldSearchRef = useRef<HTMLInputElement>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset state when dialog opens with a new item
  useEffect(() => {
    if (open) {
      setLiveSql(item.sql);
      setLiveVizConfig(item.vizConfig);
      setLiveTitle(item.title);
      setLiveExplanation(item.explanation);
      setMessages([]);
      setInput('');
      setHasChanges(false);
      setRightTab('chat');
      setSwappingField(null);
      setFieldSearch('');
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open, item.id]);

  // Fetch fields when dialog opens or SQL changes
  const fetchFields = useCallback(async () => {
    if (!tenantId) return;
    setFieldsLoading(true);
    try {
      const tenantQs = `?tenant_id=${encodeURIComponent(tenantId)}`;
      const result = await api.request<{
        usedFields: FieldInfo[];
        availableFields: FieldInfo[];
        categories: FieldCategory[];
      }>(`/api/cohi-chat/widget-fields${tenantQs}`, {
        method: 'POST',
        body: JSON.stringify({ sql: liveSql }),
      });
      setUsedFields(result.usedFields);
      setAvailableFields(result.availableFields);
      setFieldCategories(result.categories);
    } catch {
      // Silently fail — fields panel will just be empty
    } finally {
      setFieldsLoading(false);
    }
  }, [tenantId, liveSql]);

  useEffect(() => {
    if (open && tenantId) fetchFields();
  }, [open, liveSql, tenantId]);

  // Filter available fields for swap picker
  const filteredSwapFields = useMemo(() => {
    if (!swappingField) return [];
    const currentField = usedFields.find((f) => f.name === swappingField);
    const search = fieldSearch.toLowerCase();
    return availableFields
      .filter((f) => f.name !== swappingField)
      .filter((f) => {
        if (!search) return true;
        return f.label.toLowerCase().includes(search) || f.name.toLowerCase().includes(search);
      })
      .sort((a, b) => {
        // Prioritize same category as the field being swapped
        if (currentField) {
          const aMatch = a.category === currentField.category ? 0 : 1;
          const bMatch = b.category === currentField.category ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
          // Then same type
          const aType = a.type === currentField.type ? 0 : 1;
          const bType = b.type === currentField.type ? 0 : 1;
          if (aType !== bType) return aType - bType;
        }
        return a.label.localeCompare(b.label);
      });
  }, [swappingField, availableFields, usedFields, fieldSearch]);

  // Group filtered swap fields by category
  const groupedSwapFields = useMemo(() => {
    const groups: Record<string, FieldInfo[]> = {};
    for (const f of filteredSwapFields) {
      if (!groups[f.category]) groups[f.category] = [];
      groups[f.category].push(f);
    }
    return groups;
  }, [filteredSwapFields]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Build conversation history for the API (exclude loading placeholders)
  const buildHistory = useCallback(() => {
    return messages
      .filter((m) => !m.loading)
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };
    const loadingMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      loading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');
    setSending(true);

    try {
      const tenantQs = tenantId
        ? `?tenant_id=${encodeURIComponent(tenantId)}`
        : '';
      const result = await api.request<{
        sql: string;
        vizConfig: VisualizationConfig;
        message: string;
        modified: boolean;
      }>(`/api/cohi-chat/edit-widget${tenantQs}`, {
        method: 'POST',
        body: JSON.stringify({
          sql: liveSql,
          vizConfig: liveVizConfig,
          instruction: text,
          history: buildHistory(),
        }),
      });

      // Replace loading message with the real response
      const assistantMsg: ChatMessage = {
        id: loadingMsg.id,
        role: 'assistant',
        content: result.message,
        modified: result.modified,
      };

      setMessages((prev) =>
        prev.map((m) => (m.id === loadingMsg.id ? assistantMsg : m)),
      );

      // If the widget was modified, update the live preview
      if (result.modified) {
        setLiveSql(result.sql);
        setLiveVizConfig(result.vizConfig);
        if (result.vizConfig.title) setLiveTitle(result.vizConfig.title);
        setHasChanges(true);
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: loadingMsg.id,
        role: 'assistant',
        content: `Sorry, I ran into an error: ${err.message || 'Unknown error'}. Please try again.`,
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === loadingMsg.id ? errorMsg : m)),
      );
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, sending, liveSql, liveVizConfig, tenantId, buildHistory]);

  /** Stop ALL key events from bubbling to canvas/grid-layout underneath */
  const stopKeyPropagation = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Handle field swap — sends instruction to Cohi via the chat
  const handleFieldSwap = useCallback(
    (oldField: FieldInfo, newField: FieldInfo) => {
      setSwappingField(null);
      setFieldSearch('');
      setRightTab('chat');
      // Auto-send a structured instruction
      const instruction = `Replace the "${oldField.label}" field with "${newField.label}" in this widget`;
      setInput(instruction);
      // Auto-send after a tick
      setTimeout(() => {
        const fakeInput = instruction;
        setInput('');
        // Directly trigger send with this instruction
        const userMsg: ChatMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: fakeInput,
        };
        const loadingMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: '',
          loading: true,
        };
        setMessages((prev) => [...prev, userMsg, loadingMsg]);
        setSending(true);

        const tenantQs = tenantId
          ? `?tenant_id=${encodeURIComponent(tenantId)}`
          : '';
        api
          .request<{
            sql: string;
            vizConfig: VisualizationConfig;
            message: string;
            modified: boolean;
          }>(`/api/cohi-chat/edit-widget${tenantQs}`, {
            method: 'POST',
            body: JSON.stringify({
              sql: liveSql,
              vizConfig: liveVizConfig,
              instruction: fakeInput,
              history: messages
                .filter((m) => !m.loading)
                .map((m) => ({ role: m.role, content: m.content })),
            }),
          })
          .then((result) => {
            const assistantMsg: ChatMessage = {
              id: loadingMsg.id,
              role: 'assistant',
              content: result.message,
              modified: result.modified,
            };
            setMessages((prev) =>
              prev.map((m) => (m.id === loadingMsg.id ? assistantMsg : m)),
            );
            if (result.modified) {
              setLiveSql(result.sql);
              setLiveVizConfig(result.vizConfig);
              if (result.vizConfig.title) setLiveTitle(result.vizConfig.title);
              setHasChanges(true);
            }
          })
          .catch((err: any) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === loadingMsg.id
                  ? { ...m, loading: false, content: `Error: ${err.message || 'Unknown error'}` }
                  : m,
              ),
            );
          })
          .finally(() => {
            setSending(false);
          });
      }, 50);
    },
    [tenantId, liveSql, liveVizConfig, messages],
  );

  const handleSave = useCallback(() => {
    onSave({
      sql: liveSql,
      vizConfig: liveVizConfig,
      title: liveTitle,
      explanation: liveExplanation,
    });
    onOpenChange(false);
  }, [liveSql, liveVizConfig, liveTitle, liveExplanation, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] w-[95vw] max-h-[90vh] h-[90vh] p-0 gap-0 overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onKeyDown={stopKeyPropagation}
        onKeyUp={stopKeyPropagation}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
              Edit with Cohi
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500 truncate">
              — {liveTitle}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasChanges && (
              <Button
                size="sm"
                className="h-7 px-3 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                onClick={handleSave}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Apply Changes
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body: preview + chat */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ─── Left: Live widget preview ─── */}
          <div className="flex-1 min-w-0 flex flex-col bg-slate-50 dark:bg-slate-950/40 border-r border-slate-200 dark:border-slate-700">
            <div className="px-3 py-2 text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-200/60 dark:border-slate-700/60 shrink-0">
              Live Preview
            </div>
            <div className="flex-1 min-h-0 p-4 overflow-auto">
              <div className="w-full h-full min-h-[400px] rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
                <CohiWidgetRenderer
                  sql={liveSql}
                  vizConfig={liveVizConfig}
                  title={liveTitle}
                  explanation={liveExplanation}
                  tenantId={tenantId}
                  width={800}
                  height={500}
                  groupDateFilter={dateFilter}
                />
              </div>
            </div>
          </div>

          {/* ─── Right: Tabbed panel (Chat / Fields) ─── */}
          <div className="w-[400px] shrink-0 flex flex-col bg-white dark:bg-slate-900">
            {/* Tab bar */}
            <div className="flex border-b border-slate-200/60 dark:border-slate-700/60 shrink-0">
              <button
                type="button"
                onClick={() => setRightTab('chat')}
                className={cn(
                  'flex-1 px-3 py-2 text-[11px] font-medium transition-colors',
                  rightTab === 'chat'
                    ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-500'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400',
                )}
              >
                <Sparkles className="h-3 w-3 inline mr-1 -mt-0.5" />
                Chat
              </button>
              <button
                type="button"
                onClick={() => { setRightTab('fields'); if (!usedFields.length && !fieldsLoading) fetchFields(); }}
                className={cn(
                  'flex-1 px-3 py-2 text-[11px] font-medium transition-colors',
                  rightTab === 'fields'
                    ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-500'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400',
                )}
              >
                <Database className="h-3 w-3 inline mr-1 -mt-0.5" />
                Fields ({usedFields.length})
              </button>
            </div>

            {/* ── Fields tab ── */}
            {rightTab === 'fields' && (
              <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
                {fieldsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-violet-500 mr-2" />
                    <span className="text-xs text-slate-400">Loading fields...</span>
                  </div>
                ) : usedFields.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">
                    No fields detected in this widget.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-2">
                      These are the data fields this widget uses. Click swap to replace one with a different field.
                    </p>
                    {usedFields.map((field) => (
                      <div key={field.name} className="group">
                        <div className="flex items-center justify-between rounded-lg px-2.5 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                              {field.label}
                            </div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">
                              {field.type} · {fieldCategories.find((c) => c.id === field.category)?.label || field.category}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSwappingField(swappingField === field.name ? null : field.name);
                              setFieldSearch('');
                              setExpandedCategory(null);
                              setTimeout(() => fieldSearchRef.current?.focus(), 100);
                            }}
                            className={cn(
                              'shrink-0 ml-2 p-1 rounded text-xs transition-colors',
                              swappingField === field.name
                                ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400'
                                : 'text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:text-violet-400 dark:hover:bg-violet-900/30',
                            )}
                            title="Swap this field"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Swap picker */}
                        {swappingField === field.name && (
                          <div className="mt-1 ml-2 rounded-lg border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/50 dark:bg-violet-950/20 p-2">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Search className="h-3 w-3 text-slate-400 shrink-0" />
                              <input
                                ref={fieldSearchRef}
                                type="text"
                                value={fieldSearch}
                                onChange={(e) => setFieldSearch(e.target.value)}
                                onKeyDown={stopKeyPropagation}
                                onKeyUp={stopKeyPropagation}
                                placeholder="Search fields..."
                                className="flex-1 min-w-0 h-6 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                              />
                            </div>
                            <div className="max-h-[240px] overflow-y-auto space-y-1">
                              {Object.entries(groupedSwapFields).map(([cat, fields]) => {
                                const catLabel = fieldCategories.find((c) => c.id === cat)?.label || cat;
                                const isExpanded = expandedCategory === cat || !!fieldSearch;
                                return (
                                  <div key={cat}>
                                    <button
                                      type="button"
                                      onClick={() => setExpandedCategory(isExpanded && !fieldSearch ? null : cat)}
                                      className="w-full flex items-center gap-1 px-1.5 py-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                                    >
                                      <ChevronDown className={cn('h-3 w-3 transition-transform', !isExpanded && '-rotate-90')} />
                                      {catLabel}
                                      <span className="text-slate-300 dark:text-slate-600 ml-auto">{fields.length}</span>
                                    </button>
                                    {isExpanded && fields.map((f) => (
                                      <button
                                        key={f.name}
                                        type="button"
                                        onClick={() => {
                                          const currentField = usedFields.find((uf) => uf.name === swappingField);
                                          if (currentField) handleFieldSwap(currentField, f);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-violet-100 dark:hover:bg-violet-900/30 text-slate-700 dark:text-slate-300 transition-colors flex items-center justify-between"
                                      >
                                        <span className="truncate">{f.label}</span>
                                        <span className="text-[9px] text-slate-400 dark:text-slate-500 ml-2 shrink-0">{f.type}</span>
                                      </button>
                                    ))}
                                  </div>
                                );
                              })}
                              {filteredSwapFields.length === 0 && (
                                <p className="text-[10px] text-slate-400 text-center py-2">
                                  No matching fields found
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Chat tab (Messages) ── */}
            <div className={cn('flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3', rightTab !== 'chat' && 'hidden')}>
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <Sparkles className="h-8 w-8 mx-auto mb-3 text-violet-300 dark:text-violet-600" />
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mb-1">
                    Ask Cohi to edit this widget
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 max-w-[280px] mx-auto">
                    Try things like "why is approved percentage all zeros?",
                    "group by week instead of month", or "add a filter for funded loans only"
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex gap-2',
                    msg.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="shrink-0 w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-violet-600 text-white rounded-br-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-bl-sm',
                    )}
                  >
                    {msg.loading ? (
                      <div className="flex items-center gap-2 py-1">
                        <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
                        <span className="text-slate-400 dark:text-slate-500">
                          Thinking...
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                        {msg.modified && (
                          <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-slate-200/50 dark:border-slate-700/50 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="h-3 w-3" />
                            Widget updated — see preview
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="shrink-0 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center mt-0.5">
                      <User className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Input (chat tab only) */}
            <div className={cn('shrink-0 border-t border-slate-200 dark:border-slate-700 p-3', rightTab !== 'chat' && 'hidden')}>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onKeyUp={stopKeyPropagation}
                  placeholder="Ask Cohi to modify this widget..."
                  rows={2}
                  className="flex-1 min-w-0 resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-400/50 focus:border-violet-400"
                  disabled={sending}
                />
                <Button
                  size="sm"
                  className="h-8 w-8 p-0 bg-violet-600 hover:bg-violet-700 text-white shrink-0"
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  title="Send message"
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
                Press Enter to send, Shift+Enter for new line
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

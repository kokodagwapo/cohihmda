/**
 * WorkbenchCohiPanel
 *
 * Slide-over chat panel inside the workbench. Docks to the right side.
 * Sends canvas state as context so Cohi can suggest, add, or modify widgets.
 * Shows action cards that users can execute with one click.
 *
 * Chat-first surface aligned with global Cohi Insights — dashboard/schema browsers
 * live on the canvas Add menu and natural-language chat, not separate panel tabs.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Send,
  Sparkles,
  PlusCircle,
  LayoutDashboard,
  Info,
  Trash2,
  Loader2,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Search,
  Code,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { WorkbenchChatMessage, WidgetAction } from '@/types/widgetActions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const DEFAULT_AUTO_SUGGESTIONS = [
  'What is driving our biggest month-over-month change right now?',
  'Break this down by branch and loan officer',
  'Which metrics look abnormal and why?',
];

export interface WorkbenchCohiPanelProps {
  open: boolean;
  onClose: () => void;
  messages: WorkbenchChatMessage[];
  isLoading: boolean;
  suggestedQuestions: string[];
  onSendMessage: (content: string) => void;
  onClearMessages: () => void;
  onExecuteAction: (action: WidgetAction) => void;
  /** Widget currently being edited via Cohi; shows dismissible banner with "Stop editing" */
  editingWidget?: { id: string; title: string } | null;
  /** Called when user clicks X on the editing banner to stop editing */
  onStopEditing?: () => void;
}

// ---------------------------------------------------------------------------
// ActionCard – renders a single WidgetAction as a clickable card
// ---------------------------------------------------------------------------

function ActionCard({
  action,
  onExecute,
}: {
  action: WidgetAction;
  onExecute: (a: WidgetAction) => void;
}) {
  const [sqlExpanded, setSqlExpanded] = useState(false);

  const iconMap: Record<WidgetAction['type'], React.ReactNode> = {
    add_existing_widget: <PlusCircle className="h-4 w-4 text-emerald-500" />,
    create_widget: <Sparkles className="h-4 w-4 text-indigo-500" />,
    create_canvas: <LayoutDashboard className="h-4 w-4 text-blue-500" />,
    modify_widget: <Sparkles className="h-4 w-4 text-amber-500" />,
    delete_widget: <Trash2 className="h-4 w-4 text-red-500" />,
    suggest_dashboard: <LayoutDashboard className="h-4 w-4 text-blue-500" />,
    explain_widget: <Info className="h-4 w-4 text-sky-500" />,
    explain_schema: <BookOpen className="h-4 w-4 text-violet-500" />,
    query_data: <Search className="h-4 w-4 text-cyan-500" />,
  };

  const labelMap: Record<WidgetAction['type'], string> = {
    add_existing_widget: 'Add widget',
    create_widget: 'Create widget',
    create_canvas: 'Create canvas',
    modify_widget: 'Modify widget',
    delete_widget: 'Remove widget',
    suggest_dashboard: 'Add dashboard',
    explain_widget: 'Explain',
    explain_schema: 'Explain fields',
    query_data: 'Data query',
  };

  const isExecutable = ['add_existing_widget', 'create_widget', 'create_canvas', 'modify_widget', 'delete_widget', 'suggest_dashboard'].includes(action.type);

  // Special rendering for query_data actions
  if (action.type === 'query_data') {
    return (
      <div className="rounded-lg border border-cyan-200/60 dark:border-cyan-800/40 bg-cyan-50/30 dark:bg-cyan-950/20 p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Search className="h-4 w-4 text-cyan-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Live query executed
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {action.explanation}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSqlExpanded(!sqlExpanded)}
          className="flex items-center gap-1 text-[10px] text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 transition-colors"
        >
          <Code className="h-3 w-3" />
          {sqlExpanded ? 'Hide SQL' : 'Show SQL'}
          {sqlExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {sqlExpanded && (
          <pre className="text-[10px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {action.sql}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        {iconMap[action.type]}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {labelMap[action.type]}
            {'title' in action && action.title && (
              <span className="ml-1 text-slate-500 font-normal">
                — {action.title}
              </span>
            )}
            {'widgetId' in action && action.type === 'add_existing_widget' && !('title' in action && action.title) && (
              <span className="ml-1 text-slate-500 font-normal">
                ({action.widgetId})
              </span>
            )}
            {'sectionKey' in action && action.type === 'suggest_dashboard' && (
              <span className="ml-1 text-slate-500 font-normal">
                ({action.sectionKey})
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
            {action.explanation}
          </p>
        </div>
      </div>
      {isExecutable && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          Applied to canvas
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeachingNotes – collapsible teaching section
// ---------------------------------------------------------------------------

function TeachingNotes({ notes }: { notes: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-2.5 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 w-full"
      >
        <Lightbulb className="h-3.5 w-3.5" />
        <span>How this works</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronDown className="h-3 w-3 ml-auto" />
        )}
      </button>
      {expanded && (
        <p className="text-xs text-amber-600 dark:text-amber-300 mt-1.5 whitespace-pre-wrap">
          {notes}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  onExecuteAction,
}: {
  message: WorkbenchChatMessage;
  onExecuteAction: (a: WidgetAction) => void;
}) {
  const isUser = message.role === 'user';

  if (message.isLoading) {
    return (
      <div className="flex w-full min-w-0 pr-2 justify-start">
        <div className="rounded-2xl min-w-0 w-full max-w-[calc(100%-8px)] border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/60 shadow-sm">
          <div className="flex items-center gap-3 px-4 py-3">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Analyzing your canvas…
              </span>
              <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden w-28">
                <div className="h-full w-full animate-pulse bg-blue-500 rounded-full opacity-80" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex w-full min-w-0 pr-2 justify-end">
        <div className="rounded-2xl max-w-[88%] bg-gradient-to-br from-blue-500 to-indigo-600 text-white px-4 py-2.5 shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 pr-2 justify-start">
      <div className="rounded-2xl min-w-0 w-full max-w-[calc(100%-8px)] border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/60 shadow-sm">
        <div className="px-4 py-2.5">
          <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
            {message.content}
          </p>
        </div>

        {message.error && (
          <p className="text-xs text-red-600 dark:text-red-400 px-4 pb-2">{message.error}</p>
        )}

        {message.actions && message.actions.length > 0 && (
          <div className="space-y-2 px-4 pb-3">
            {message.actions.map((action, idx) => (
              <ActionCard
                key={`${message.id}-action-${idx}`}
                action={action}
                onExecute={onExecuteAction}
              />
            ))}
          </div>
        )}

        {message.teachingNotes && (
          <div className="px-4 pb-3">
            <TeachingNotes notes={message.teachingNotes} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function WorkbenchCohiPanel({
  open,
  onClose,
  messages,
  isLoading,
  suggestedQuestions,
  onSendMessage,
  onClearMessages,
  onExecuteAction,
  editingWidget = null,
  onStopEditing,
}: WorkbenchCohiPanelProps) {
  const [input, setInput] = useState('');

  // Use generic agentic suggestions as fallback when none are provided by the hook
  const effectiveSuggestions =
    suggestedQuestions.length > 0
      ? suggestedQuestions
      : DEFAULT_AUTO_SUGGESTIONS;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput('');
  }, [input, isLoading, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!open) return null;

  return (
    <div
      data-testid="workbench-cohi-panel"
      className={cn(
        'w-[min(520px,100%)] min-w-[280px] sm:w-[496px] shrink-0 flex flex-col h-full min-h-0 overflow-hidden',
        'bg-gradient-to-b from-violet-50/95 via-white/95 to-rose-50/80 dark:from-slate-950/98 dark:via-indigo-950/30 dark:to-slate-950/98 backdrop-blur-xl',
        'border-l border-violet-200/50 dark:border-indigo-900/50',
        'shadow-[0_-4px_24px_-4px_rgba(139,92,246,0.06)] dark:shadow-[0_-4px_32px_-4px_rgba(99,102,241,0.12)]',
      )}
    >
      <div className="relative z-[20] flex items-center justify-between gap-2 px-4 py-3.5 border-b border-violet-100/80 dark:border-indigo-900/60 bg-gradient-to-r from-violet-50/90 to-indigo-50/80 dark:from-indigo-950/50 dark:to-violet-950/40 shrink-0">
        <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/25 ring-1 ring-white/30">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1 py-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-[15px] font-semibold text-slate-800 dark:text-white tracking-tight truncate min-w-0">
                Cohi Insights
              </h2>
              <Badge
                variant="secondary"
                className="bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-[10px] px-2.5 py-0.5 border-0 shrink-0 font-medium rounded-full"
              >
                AI
              </Badge>
            </div>
            <p className="text-[11px] text-slate-600/90 dark:text-slate-400/90 font-normal mt-0.5 leading-snug line-clamp-2">
              Canvas, widgets &amp; your data
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors"
            onClick={onClearMessages}
            title="Clear conversation"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl text-slate-500 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-100/80 dark:hover:bg-rose-500/15 transition-colors"
            onClick={onClose}
            title="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {editingWidget && onStopEditing && (
        <div className="flex items-center justify-between gap-2 px-4 py-2 bg-violet-50/90 dark:bg-indigo-950/40 border-b border-violet-100 dark:border-indigo-900/50 shrink-0">
          <span className="text-xs font-medium text-indigo-800 dark:text-indigo-200 truncate">
            Editing: {editingWidget.title}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 shrink-0 text-indigo-600 dark:text-indigo-400"
            onClick={onStopEditing}
            title="Stop editing"
          >
            Stop
          </Button>
        </div>
      )}

      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 min-h-0 min-w-0">
          <div className="space-y-5 min-w-0 w-full">
            {messages.length === 0 ? (
              <div className="py-12 px-2">
                <div className="space-y-1 max-w-[300px] mx-auto">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-medium mb-4 text-center">
                    Try asking
                  </p>
                  {effectiveSuggestions.slice(0, 4).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onSendMessage(q)}
                      className="group block w-full text-left py-2.5 px-0 text-[13px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors duration-150 border-b border-transparent hover:border-slate-200 dark:hover:border-slate-700 last:border-0"
                    >
                      <span className="font-normal">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onExecuteAction={onExecuteAction}
                />
              ))
            )}
          </div>
        </div>

        {messages.length > 0 && effectiveSuggestions.length > 0 && !isLoading && (
          <div className="px-4 py-2.5 border-t border-slate-200/70 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-800/40 shrink-0">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
              <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 font-medium">
                Suggestions
              </span>
              {effectiveSuggestions.slice(0, 3).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onSendMessage(q)}
                  className="shrink-0 text-xs px-3 py-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-600/60 hover:border-blue-300 dark:hover:border-blue-500/50 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-all text-slate-600 dark:text-slate-300 font-medium"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 border-t border-slate-200/70 dark:border-slate-700/70 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What should we change or analyze on this canvas?"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200/80 dark:border-slate-600/60 bg-white dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 min-h-[44px] max-h-[100px]"
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 100)}px`;
              }}
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/25 h-10 w-10 shrink-0"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Send className="w-4 h-4 text-white" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

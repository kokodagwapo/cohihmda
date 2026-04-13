/**
 * WorkbenchCohiPanel
 *
 * Slide-over chat panel inside the workbench. Docks to the right side.
 * Sends canvas state as context so Cohi can suggest, add, or modify widgets.
 * Shows action cards that users can execute with one click.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Send,
  Sparkles,
  Bot,
  User,
  PlusCircle,
  LayoutDashboard,
  Info,
  Trash2,
  Loader2,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  MessageSquare,
  Database,
  Search,
  Code,
  FlaskConical,
  Landmark,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkbenchChatMessage, WidgetAction } from '@/types/widgetActions';
import { DashboardBrowser } from './DashboardBrowser';
import { SchemaExplorer } from './SchemaExplorer';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CohiPanelTab = 'chat' | 'dashboards' | 'schema';

export const PERSONA_META: Record<string, { name: string; description: string; Icon: React.ElementType; color: string }> = {
  'mortgage-expert': {
    name: 'Mortgage Expert',
    description: 'Compliance, pipeline, industry context',
    Icon: Landmark,
    color: 'text-indigo-600 dark:text-indigo-400',
  },
  'data-scientist': {
    name: 'Data Scientist',
    description: 'Statistical analysis, distributions, trends',
    Icon: FlaskConical,
    color: 'text-violet-600 dark:text-violet-400',
  },
};

export const PERSONA_SUGGESTIONS: Record<string, string[]> = {
  'mortgage-expert': [
    'Show loans at risk of lock expiration this week',
    'What does our denial rate look like by product type?',
    'Analyze pipeline velocity by loan officer vs. prior month',
  ],
  'data-scientist': [
    'Analyze the distribution of loan amounts by product type',
    'Show statistical outliers in processing times this quarter',
    'Build a trend analysis of monthly volume with percentile breakdown',
  ],
};

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
  /** Active agent persona ID */
  activePersonaId?: string;
  /** Called when user selects a different persona — parent should update state */
  onPersonaChange?: (personaId: string) => void;
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
      <div className="flex items-start gap-2 py-2">
        <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Thinking...
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex items-start gap-2 py-2', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
          isUser
            ? 'bg-slate-200 dark:bg-slate-700'
            : 'bg-indigo-100 dark:bg-indigo-900/40'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-slate-600 dark:text-slate-300" />
        ) : (
          <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        )}
      </div>

      <div
        className={cn(
          'flex-1 min-w-0 space-y-2',
          isUser ? 'text-right' : 'text-left'
        )}
      >
        <div
          className={cn(
            'inline-block rounded-xl px-3 py-2 text-sm max-w-full',
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm'
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {message.error && (
          <p className="text-xs text-red-500 px-1">{message.error}</p>
        )}

        {/* Action cards */}
        {message.actions && message.actions.length > 0 && (
          <div className="space-y-2 mt-2">
            {message.actions.map((action, idx) => (
              <ActionCard
                key={`${message.id}-action-${idx}`}
                action={action}
                onExecute={onExecuteAction}
              />
            ))}
          </div>
        )}

        {/* Teaching notes */}
        {message.teachingNotes && (
          <TeachingNotes notes={message.teachingNotes} />
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
  activePersonaId = 'mortgage-expert',
  onPersonaChange,
}: WorkbenchCohiPanelProps) {
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<CohiPanelTab>('chat');

  const personaMeta = PERSONA_META[activePersonaId] ?? PERSONA_META['mortgage-expert'];
  const PersonaIcon = personaMeta.Icon;

  // Use persona-specific suggestions as fallback when none are provided by the hook
  const effectiveSuggestions =
    suggestedQuestions.length > 0
      ? suggestedQuestions
      : (PERSONA_SUGGESTIONS[activePersonaId] ?? []);

  const handlePersonaClick = useCallback(
    (personaId: string) => {
      if (personaId === activePersonaId) return;
      onPersonaChange?.(personaId);
      // Clear conversation when switching personas so context is fresh
      onClearMessages();
    },
    [activePersonaId, onPersonaChange, onClearMessages]
  );
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

  // Handle dashboard browser actions
  const handleAddWidget = useCallback(
    (widgetId: string) => {
      onExecuteAction({
        type: 'add_existing_widget',
        widgetId,
        explanation: `Added from dashboard browser`,
      });
    },
    [onExecuteAction]
  );

  const handleAddDashboard = useCallback(
    (sectionKey: string) => {
      onExecuteAction({
        type: 'suggest_dashboard',
        sectionKey,
        explanation: `Added from dashboard browser`,
      });
    },
    [onExecuteAction]
  );

  const handleAskCohi = useCallback(
    (question: string) => {
      setActiveTab('chat');
      onSendMessage(question);
    },
    [onSendMessage]
  );

  if (!open) return null;

  return (
    <div className="w-[380px] shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-700 shrink-0">
        <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/40">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
              <Sparkles className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cohi</span>
          </div>

          {/* Persona toggle — segmented two-button selector */}
          <div className="flex items-center gap-0.5 bg-white/60 dark:bg-slate-800/60 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
            {Object.entries(PERSONA_META).map(([id, meta]) => {
              const Icon = meta.Icon;
              const isActive = id === activePersonaId;
              return (
                <button
                  key={id}
                  onClick={() => handlePersonaClick(id)}
                  title={`${meta.name}: ${meta.description}`}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all',
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span className="hidden sm:inline">{meta.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1">
            {activeTab === 'chat' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
                onClick={onClearMessages}
                title="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Editing widget banner */}
        {editingWidget && onStopEditing && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-100 dark:border-indigo-900/50">
            <span className="text-xs font-medium text-indigo-800 dark:text-indigo-200 truncate">
              Editing: {editingWidget.title}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200"
              onClick={onStopEditing}
              title="Stop editing"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex px-2 gap-1 bg-slate-50/50 dark:bg-slate-800/30">
          {([
            { key: 'chat' as const, icon: <MessageSquare className="h-3 w-3" />, label: 'Chat' },
            { key: 'dashboards' as const, icon: <LayoutDashboard className="h-3 w-3" />, label: 'Dashboards' },
            { key: 'schema' as const, icon: <Database className="h-3 w-3" />, label: 'Schema' },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'dashboards' && (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <DashboardBrowser
            onAddWidget={handleAddWidget}
            onAddDashboard={handleAddDashboard}
            onAskCohi={handleAskCohi}
          />
        </div>
      )}

      {activeTab === 'schema' && (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <SchemaExplorer onAskCohi={handleAskCohi} />
        </div>
      )}

      {activeTab === 'chat' && (
      <>
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-md">
              <PersonaIcon className="h-7 w-7 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {personaMeta.name} Mode
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {personaMeta.description}. Ask me anything about your pipeline data.
              </p>
            </div>
            {/* Suggested questions */}
            <div className="space-y-1.5 w-full">
              {effectiveSuggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => onSendMessage(q)}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-300 dark:hover:border-violet-600 text-slate-600 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300 transition-all"
                >
                  {q}
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

      {/* Input area */}
      <div className="border-t border-slate-200 dark:border-slate-700 p-3">
        {/* Quick suggestions when conversation is active */}
        {messages.length > 0 && effectiveSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {effectiveSuggestions.slice(0, 3).map((q) => (
              <button
                key={q}
                onClick={() => onSendMessage(q)}
                className="text-[10px] px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors truncate max-w-[180px]"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Cohi — prepare a briefing, analyze trends, build a deck..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 min-h-[36px] max-h-[100px]"
            style={{ height: 'auto', overflow: 'hidden' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 100)}px`;
            }}
          />
          <Button
            size="sm"
            className="h-9 w-9 p-0 shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

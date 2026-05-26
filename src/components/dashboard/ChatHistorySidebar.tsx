/**
 * Chat History Sidebar
 * Slide-over panel that displays the user's saved chat sessions,
 * grouped by time period, with rename, delete, and load capabilities.
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Pencil,
  Trash2,
  X,
  Loader2,
  Search,
  Check,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/hooks/useCohiChat";
import { ConversationRunningIndicator } from "@/components/cohi/ConversationRunningIndicator";

// ============================================================================
// Types
// ============================================================================

interface ChatHistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoading: boolean;
  loadingSessionId: string | null;
  onFetchSessions: () => void;
  onLoadSession: (sessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onNewSession: () => void;
  /** Workbench: clarifies list is scoped to the active canvas tab. */
  scopeSubtitle?: string | null;
}

interface SessionGroup {
  label: string;
  sessions: ChatSession[];
}

// ============================================================================
// Helpers
// ============================================================================

function groupSessionsByTime(sessions: ChatSession[]): SessionGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(todayStart);
  monthStart.setDate(monthStart.getDate() - 30);

  const groups: Record<string, ChatSession[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    "Previous 30 Days": [],
    Older: [],
  };

  for (const session of sessions) {
    const date = new Date(session.lastMessageAt || session.createdAt);
    if (date >= todayStart) {
      groups["Today"].push(session);
    } else if (date >= yesterdayStart) {
      groups["Yesterday"].push(session);
    } else if (date >= weekStart) {
      groups["Previous 7 Days"].push(session);
    } else if (date >= monthStart) {
      groups["Previous 30 Days"].push(session);
    } else {
      groups["Older"].push(session);
    }
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, sessions: items }));
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ============================================================================
// Sub-components
// ============================================================================

function SessionItem({
  session,
  isActive,
  loadingSessionId,
  onLoad,
  onDelete,
  onRename,
}: {
  session: ChatSession;
  isActive: boolean;
  loadingSessionId: string | null;
  onLoad: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleRename = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      setEditTitle(session.title);
      setIsEditing(false);
    }
  };

  if (showDeleteConfirm) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
        <span className="text-xs text-red-700 dark:text-red-300 flex-1 truncate">
          Delete this chat?
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/40"
          onClick={() => {
            onDelete();
            setShowDeleteConfirm(false);
          }}
        >
          <Check className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="cohi-chat-history-item"
      data-session-id={session.id}
      className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors",
        isActive
          ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent"
      )}
      onClick={() => {
        if (!isEditing && loadingSessionId !== session.id) onLoad();
      }}
    >
      <div className="mt-0.5 shrink-0">
        {loadingSessionId === session.id ? (
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
        ) : (
          <MessageSquare
            className={cn(
              "w-4 h-4",
              isActive
                ? "text-blue-500"
                : "text-slate-400 dark:text-slate-500"
            )}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <Input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            className="h-6 text-xs px-1.5 py-0"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <p
            className={cn(
              "text-sm font-medium truncate leading-tight flex items-center gap-1.5",
              isActive
                ? "text-blue-700 dark:text-blue-300"
                : "text-slate-700 dark:text-slate-200"
            )}
          >
            <span className="truncate flex-1 min-w-0">{session.title}</span>
            <ConversationRunningIndicator conversationId={session.id} />
          </p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {formatRelativeTime(session.lastMessageAt || session.createdAt)}
          </span>
          {session.messageCount > 0 && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      {!isEditing && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
            onClick={(e) => {
              e.stopPropagation();
              setEditTitle(session.title);
              setIsEditing(true);
            }}
            title="Rename"
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
            onClick={(e) => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 animate-pulse">
      <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-700 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="h-3.5 w-3/4 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-2.5 w-1/3 bg-slate-100 dark:bg-slate-800 rounded mt-1.5" />
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ChatHistorySidebar({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  isLoading,
  loadingSessionId,
  onFetchSessions,
  onLoadSession,
  onDeleteSession,
  onRenameSession,
  onNewSession,
  scopeSubtitle,
}: ChatHistorySidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const onFetchSessionsRef = useRef(onFetchSessions);
  onFetchSessionsRef.current = onFetchSessions;

  // Fetch only when the panel opens — not on every parent re-render (avoids API storms).
  useEffect(() => {
    if (!isOpen) return;
    onFetchSessionsRef.current();
    setSearchQuery("");
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Let the toggle button handle its own open/close state to avoid
      // close-then-immediate-reopen races during rapid clicks.
      if (target.closest('[data-chat-history-toggle="true"]')) return;

      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDownOutside, true);
    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDownOutside,
        true
      );
    };
  }, [isOpen, onClose]);

  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  const groups = groupSessionsByTime(filteredSessions);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-[10] bg-black/10 dark:bg-black/20"
            onPointerDown={onClose}
          />
          {/* Sidebar panel */}
          <motion.div
            ref={panelRef}
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            data-testid="chat-history-sidebar"
            className="absolute left-0 top-0 bottom-0 z-[11] w-[280px] max-w-[85%] flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-slate-200 dark:border-slate-700">
              <div className="flex flex-col min-w-0 gap-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                    Chat History
                  </h3>
                </div>
                {scopeSubtitle ? (
                  <p
                    className="text-[11px] text-slate-500 dark:text-slate-400 pl-6 truncate"
                    data-testid="chat-history-scope-subtitle"
                  >
                    {scopeSubtitle}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                onClick={onClose}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search conversations..."
                  className="h-8 text-xs pl-8 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>

            {/* New conversation button */}
            <div className="px-3 pt-2 pb-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 text-xs gap-1.5 border-dashed"
                onClick={() => {
                  onNewSession();
                  onClose();
                }}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                New conversation
              </Button>
            </div>

            {/* Session list */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-2 py-1">
                {isLoading ? (
                  <div className="space-y-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <SessionSkeleton key={i} />
                    ))}
                  </div>
                ) : groups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <MessageSquare className="w-5 h-5 text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {searchQuery
                        ? "No matching conversations"
                        : "No saved conversations yet"}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      {searchQuery
                        ? "Try a different search term"
                        : "Start chatting with Cohi to see your history here"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groups.map((group) => (
                      <div key={group.label}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-3 py-1.5">
                          {group.label}
                        </p>
                        <div className="space-y-0.5">
                          {group.sessions.map((session) => (
                            <SessionItem
                              key={session.id}
                              session={session}
                              isActive={session.id === activeSessionId}
                              loadingSessionId={loadingSessionId}
                              onLoad={() => {
                                onLoadSession(session.id);
                                onClose();
                              }}
                              onDelete={() => onDeleteSession(session.id)}
                              onRename={(title) =>
                                onRenameSession(session.id, title)
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

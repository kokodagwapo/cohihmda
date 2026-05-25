/**
 * Workbench chat scope coupling UI: tab-switch confirm, new-canvas intent, mismatch actions.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  activeContextToScopeRef,
  COHI_WORKBENCH_ACTIVE_CONTEXT_EVENT,
  consumeWorkbenchNewChatPendingFirstSend,
  getLatestWorkbenchActiveContext,
  isWorkbenchCanvasPopulated,
  isWorkbenchChatScopeSyncEnabled,
  shouldConfirmNewCanvasBeforeSend,
  readPersistedWorkbenchConversationScope,
  requestWorkbenchNewCanvasTab,
  scopeRefsEqual,
  trackWorkbenchScopeSyncEvent,
  type WorkbenchActiveContext,
  type WorkbenchChatScopeRef,
  type WorkbenchScopeMismatchActionsDetail,
} from "@/lib/workbench/workbenchChatScopeSync";
import type { SendMessageOptions } from "@/hooks/useCohiChat";

export interface UseWorkbenchChatScopeGuardArgs {
  activeChatType: string;
  workbenchChatScope: WorkbenchChatScopeRef | null;
  workbenchScopePinned: boolean;
  workbenchPinnedScopeLabel: string | null;
  pendingScopeSwitchTarget: WorkbenchActiveContext | null;
  setPendingScopeSwitchTarget: (ctx: WorkbenchActiveContext | null) => void;
  scopeMismatchActions: WorkbenchScopeMismatchActionsDetail | null;
  acceptPendingWorkbenchScopeSwitch: () => Promise<void>;
  cancelPendingWorkbenchScopeSwitch: () => void;
  syncChatToActiveCanvas: (ctx: WorkbenchActiveContext) => Promise<void>;
  resolveScopeMismatchActions: (mode: "active" | "conversation") => void;
  sendMessage: (message: string, options?: SendMessageOptions) => Promise<void>;
  onNewCanvasPreflightDismiss?: (message: string) => void;
  onOpenCanvasThreads?: () => void;
}

export function useWorkbenchChatScopeGuard(args: UseWorkbenchChatScopeGuardArgs) {
  const {
    activeChatType,
    workbenchChatScope,
    workbenchScopePinned,
    workbenchPinnedScopeLabel,
    pendingScopeSwitchTarget,
    setPendingScopeSwitchTarget,
    scopeMismatchActions,
    acceptPendingWorkbenchScopeSwitch,
    cancelPendingWorkbenchScopeSwitch,
    syncChatToActiveCanvas,
    resolveScopeMismatchActions,
    sendMessage,
    onNewCanvasPreflightDismiss,
  } = args;

  const enabled =
    isWorkbenchChatScopeSyncEnabled() && activeChatType === "workbench";

  const [scopeSwitchOpen, setScopeSwitchOpen] = useState(false);
  const [newCanvasOpen, setNewCanvasOpen] = useState(false);
  const [mismatchOpen, setMismatchOpen] = useState(false);
  const pendingSendRef = useRef<{
    message: string;
    options?: SendMessageOptions;
  } | null>(null);
  const skipNextContextCheckRef = useRef(false);

  const resolveConversationScope = useCallback((): WorkbenchChatScopeRef | null => {
    return (
      workbenchChatScope ??
      readPersistedWorkbenchConversationScope() ??
      null
    );
  }, [workbenchChatScope]);

  const maybePromptScopeSwitch = useCallback(
    (ctx: WorkbenchActiveContext) => {
      const conversationScope = resolveConversationScope();
      if (!conversationScope) return;
      const nextScope = activeContextToScopeRef(ctx);
      if (scopeRefsEqual(conversationScope, nextScope)) return;
      trackWorkbenchScopeSyncEvent("scope_switch_prompt_shown");
      setPendingScopeSwitchTarget(ctx);
      setScopeSwitchOpen(true);
    },
    [resolveConversationScope, setPendingScopeSwitchTarget],
  );

  const handleActiveCanvasContext = useCallback(
    (ctx: WorkbenchActiveContext) => {
      if (workbenchScopePinned) {
        maybePromptScopeSwitch(ctx);
        return;
      }
      const conversationScope = resolveConversationScope();
      const nextScope = activeContextToScopeRef(ctx);
      if (!conversationScope || scopeRefsEqual(conversationScope, nextScope)) {
        void syncChatToActiveCanvas(ctx);
        return;
      }
      maybePromptScopeSwitch(ctx);
    },
    [
      workbenchScopePinned,
      resolveConversationScope,
      syncChatToActiveCanvas,
      maybePromptScopeSwitch,
    ],
  );

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: Event) => {
      if (skipNextContextCheckRef.current) {
        skipNextContextCheckRef.current = false;
        return;
      }
      const ctx = (e as CustomEvent<WorkbenchActiveContext>).detail;
      if (!ctx) return;
      handleActiveCanvasContext(ctx);
    };
    window.addEventListener(COHI_WORKBENCH_ACTIVE_CONTEXT_EVENT, handler);
    return () =>
      window.removeEventListener(COHI_WORKBENCH_ACTIVE_CONTEXT_EVENT, handler);
  }, [enabled, handleActiveCanvasContext]);

  useEffect(() => {
    if (scopeMismatchActions) {
      setMismatchOpen(true);
    }
  }, [scopeMismatchActions]);

  const preflightWorkbenchSend = useCallback(
    async (message: string, options?: SendMessageOptions): Promise<boolean> => {
      if (!enabled) {
        await sendMessage(message, options);
        return true;
      }
      const firstTurnAfterNewChat = consumeWorkbenchNewChatPendingFirstSend();
      if (
        shouldConfirmNewCanvasBeforeSend(message, {
          firstTurnAfterNewChat,
          canvasHasContent: isWorkbenchCanvasPopulated(),
        })
      ) {
        trackWorkbenchScopeSyncEvent("new_canvas_intent_prompt_shown");
        pendingSendRef.current = { message, options };
        setNewCanvasOpen(true);
        return false;
      }
      await sendMessage(message, options);
      return true;
    },
    [enabled, sendMessage],
  );

  const confirmScopeSwitch = useCallback(async () => {
    setScopeSwitchOpen(false);
    skipNextContextCheckRef.current = true;
    await acceptPendingWorkbenchScopeSwitch();
    setPendingScopeSwitchTarget(null);
  }, [acceptPendingWorkbenchScopeSwitch, setPendingScopeSwitchTarget]);

  const cancelScopeSwitch = useCallback(() => {
    setScopeSwitchOpen(false);
    cancelPendingWorkbenchScopeSwitch();
  }, [cancelPendingWorkbenchScopeSwitch]);

  const confirmNewCanvas = useCallback(async () => {
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    setNewCanvasOpen(false);
    if (!pending) return;
    try {
      trackWorkbenchScopeSyncEvent("new_canvas_intent_confirmed");
      skipNextContextCheckRef.current = true;
      await requestWorkbenchNewCanvasTab();
      await sendMessage(pending.message, {
        ...pending.options,
        forceNewConversation: true,
      });
    } catch (err) {
      console.warn("[WorkbenchChatScopeGuard] new canvas tab:", err);
    }
  }, [sendMessage]);

  const dismissNewCanvas = useCallback(() => {
    setNewCanvasOpen(false);
    trackWorkbenchScopeSyncEvent("new_canvas_intent_dismissed");
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    if (pending) {
      onNewCanvasPreflightDismiss?.(pending.message);
    }
  }, [onNewCanvasPreflightDismiss]);

  const useCurrentCanvasForNewCanvas = useCallback(async () => {
    trackWorkbenchScopeSyncEvent("new_canvas_intent_cancelled");
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    setNewCanvasOpen(false);
    if (!pending) return;
    await sendMessage(pending.message, pending.options);
  }, [sendMessage]);

  const activeTabTitle =
    getLatestWorkbenchActiveContext()?.tabTitle ?? "Active canvas";

  const pinnedBanner =
    enabled && workbenchScopePinned ? (
      <div
        className="mx-3 mb-2 rounded-lg border border-amber-200/80 bg-amber-50/90 dark:border-amber-800/50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 flex flex-wrap items-center gap-2"
        data-testid="workbench-chat-scope-pinned-banner"
      >
        <span>
          Chat pinned to{" "}
          <strong>{workbenchPinnedScopeLabel ?? "another canvas"}</strong>.
          Active tab: <strong>{activeTabTitle}</strong>.
        </span>
        {pendingScopeSwitchTarget && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => {
              trackWorkbenchScopeSyncEvent("scope_switch_prompt_shown");
              setScopeSwitchOpen(true);
            }}
          >
            Switch chat to {pendingScopeSwitchTarget.tabTitle}
          </Button>
        )}
      </div>
    ) : null;

  const dialogs: ReactNode = enabled ? (
    <>
      <AlertDialog open={scopeSwitchOpen} onOpenChange={setScopeSwitchOpen}>
        <AlertDialogContent data-testid="workbench-scope-switch-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Switch chat to this canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              You switched to{" "}
              <strong>{pendingScopeSwitchTarget?.tabTitle ?? "another canvas"}</strong>
              . Load the latest chat for this canvas, or keep the current conversation
              pinned to the previous canvas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelScopeSwitch}>
              Keep current chat
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmScopeSwitch()}>
              Switch chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={newCanvasOpen}
        onOpenChange={(open) => {
          if (!open && pendingSendRef.current) dismissNewCanvas();
          else setNewCanvasOpen(open);
        }}
      >
        <AlertDialogContent data-testid="workbench-new-canvas-intent-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Open a new canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              Your message looks like you want a separate canvas. We can open a new
              blank tab and start a new chat thread there, or keep working on the
              current canvas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              data-testid="workbench-new-canvas-dismiss"
              onClick={dismissNewCanvas}
            >
              Cancel
            </Button>
            <AlertDialogCancel
              onClick={(e) => {
                e.preventDefault();
                void useCurrentCanvasForNewCanvas();
              }}
            >
              Use current canvas
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmNewCanvas()}>
              New canvas + chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={mismatchOpen} onOpenChange={setMismatchOpen}>
        <AlertDialogContent data-testid="workbench-scope-mismatch-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply widgets to which canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              Cohi returned widget changes for a different canvas than the one you have
              active. Choose where to apply them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setMismatchOpen(false);
                resolveScopeMismatchActions("conversation");
              }}
            >
              Conversation canvas
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setMismatchOpen(false);
                resolveScopeMismatchActions("active");
              }}
            >
              Active tab ({activeTabTitle})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  ) : null;

  return {
    enabled,
    preflightWorkbenchSend,
    pinnedBanner,
    dialogs,
  };
}

/**
 * Workbench draft → canvas rebind (COHI-395 AC4 / Wave 5 406).
 */

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createUnifiedChatClient,
  type UnifiedChatType,
} from "@/lib/unifiedChatClient";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { useToast } from "@/hooks/use-toast";

export interface UnifiedChatRebindBannerProps {
  tenantId?: string;
  conversationId: string | null;
  chatType: UnifiedChatType;
}

export function UnifiedChatRebindBanner({
  tenantId,
  conversationId,
  chatType,
}: UnifiedChatRebindBannerProps) {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [isRebinding, setIsRebinding] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const canvasId = searchParams.get("canvas");

  if (
    dismissed ||
    !isUnifiedChatClientEnabled() ||
    chatType !== "workbench" ||
    !conversationId ||
    !canvasId
  ) {
    return null;
  }

  const handleRebind = async () => {
    setIsRebinding(true);
    try {
      const client = createUnifiedChatClient(tenantId);
      await client.rebindConversation(conversationId, {
        scope: { type: "canvas", id: canvasId },
        chat_type: "workbench",
      });
      toast({
        title: "Conversation linked",
        description: "This chat is now tied to the open canvas.",
      });
      setDismissed(true);
    } catch (err) {
      toast({
        title: "Could not link conversation",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setIsRebinding(false);
    }
  };

  return (
    <div className="mb-3 flex items-start gap-2 rounded-xl border border-violet-200/80 dark:border-violet-800/60 bg-violet-50/80 dark:bg-violet-950/30 px-3 py-2.5 text-sm">
      <Link2 className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800 dark:text-slate-200">
          Continue on this canvas?
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
          Link this workbench chat to the canvas you have open so follow-ups use
          canvas context.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={isRebinding}
            onClick={() => void handleRebind()}
          >
            {isRebinding ? "Linking…" : "Continue on this canvas"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setDismissed(true)}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnifiedChatRunStore } from "@/stores/unifiedChatRunStore";

export function ConversationRunningIndicator({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const running = useUnifiedChatRunStore((s) => !!s.runs[conversationId]);
  if (!running) return null;
  return (
    <Loader2
      data-testid="conversation-running-spinner"
      className={cn("h-3.5 w-3.5 shrink-0 animate-spin text-violet-500", className)}
      aria-label="Still generating"
    />
  );
}

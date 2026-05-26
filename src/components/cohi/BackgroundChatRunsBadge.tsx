import { Loader2 } from "lucide-react";
import { useUnifiedChatRunStore } from "@/stores/unifiedChatRunStore";

/** Shows how many other conversations are still streaming (excludes active). */
export function BackgroundChatRunsBadge({
  activeConversationId,
}: {
  activeConversationId: string | null;
}) {
  const count = useUnifiedChatRunStore((s) => {
    if (!activeConversationId) return 0;
    const ids = Object.keys(s.runs);
    return ids.filter((id) => id !== activeConversationId).length;
  });

  if (count <= 0) return null;

  return (
    <p className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-violet-600 dark:text-violet-400 bg-violet-50/80 dark:bg-violet-950/40 border-b border-violet-100/80 dark:border-violet-900/40">
      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
      {count === 1
        ? "1 other chat is still generating — see history for progress"
        : `${count} other chats are still generating — see history for progress`}
    </p>
  );
}

import { Link2 } from "lucide-react";
import type { ConversationForkLinks } from "@/hooks/useCohiChat";
import { cn } from "@/lib/utils";

export function ConversationForkChips({
  links,
  conversationTitles,
  onNavigate,
  className,
}: {
  links: ConversationForkLinks | null;
  conversationTitles?: Record<string, string>;
  onNavigate: (conversationId: string) => void;
  className?: string;
}) {
  if (!links) return null;

  const parentTitle =
    links.parentTitle ??
    (links.parentConversationId
      ? conversationTitles?.[links.parentConversationId]
      : null);
  const childTitle =
    links.forkedToTitle ??
    (links.forkedToConversationId
      ? conversationTitles?.[links.forkedToConversationId]
      : null);

  if (!links.parentConversationId && !links.forkedToConversationId) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-[10px] text-violet-600 dark:text-violet-400",
        className,
      )}
      data-testid="conversation-fork-chips"
    >
      {links.parentConversationId ? (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded-full border border-violet-200/80 bg-violet-50/80 px-2 py-0.5 font-medium hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-950/40 dark:hover:bg-violet-900/50"
          onClick={() => onNavigate(links.parentConversationId!)}
        >
          <Link2 className="h-2.5 w-2.5 shrink-0" />
          Continued from {parentTitle ?? "previous chat"}
        </button>
      ) : null}
      {links.forkedToConversationId ? (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-slate-50/80 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:bg-slate-800/50"
          onClick={() => onNavigate(links.forkedToConversationId!)}
        >
          <Link2 className="h-2.5 w-2.5 shrink-0" />
          Continued in {childTitle ?? "new chat"}
        </button>
      ) : null}
    </div>
  );
}

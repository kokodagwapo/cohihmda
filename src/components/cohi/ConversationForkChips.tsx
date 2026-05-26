import { Link2, X } from "lucide-react";
import type { ConversationForkLinks } from "@/hooks/useCohiChat";
import { cn } from "@/lib/utils";

export function ConversationForkChips({
  links,
  conversationTitles,
  onNavigate,
  onDismissPendingLink,
  className,
}: {
  links: ConversationForkLinks | null;
  conversationTitles?: Record<string, string>;
  onNavigate: (conversationId: string) => void;
  /** When set, show X on the parent chip to drop carry-over before the first send. */
  onDismissPendingLink?: () => void;
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

  const formatForkLabel = (title: string | null | undefined, fallback: string) => {
    const trimmed = title?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
  };

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
        <span
          className={cn(
            "inline-flex max-w-[min(100%,20rem)] items-center rounded-full border border-violet-200/80 bg-violet-50/80 dark:border-violet-800/60 dark:bg-violet-950/40",
            onDismissPendingLink ? "pr-0.5" : "",
          )}
        >
          <button
            type="button"
            title={formatForkLabel(parentTitle, "Previous chat")}
            className="inline-flex min-w-0 flex-1 items-center gap-0.5 py-0.5 pl-2 pr-1 font-medium hover:bg-violet-100 dark:hover:bg-violet-900/50 rounded-l-full"
            onClick={() => onNavigate(links.parentConversationId!)}
          >
            <Link2 className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">
              Continued from {formatForkLabel(parentTitle, "previous chat")}
            </span>
          </button>
          {onDismissPendingLink ? (
            <button
              type="button"
              aria-label="Remove link to previous chat"
              title="Remove link to previous chat"
              className="inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-violet-500 hover:bg-violet-200/80 hover:text-violet-800 dark:text-violet-400 dark:hover:bg-violet-800/60 dark:hover:text-violet-200"
              onClick={(e) => {
                e.stopPropagation();
                onDismissPendingLink();
              }}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </span>
      ) : null}
      {links.forkedToConversationId ? (
        <button
          type="button"
          title={formatForkLabel(childTitle, "New chat")}
          className="inline-flex max-w-[min(100%,20rem)] items-center gap-0.5 rounded-full border border-slate-200/80 bg-slate-50/80 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:bg-slate-800/50"
          onClick={() => onNavigate(links.forkedToConversationId!)}
        >
          <Link2 className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">
            Continued in {formatForkLabel(childTitle, "new chat")}
          </span>
        </button>
      ) : null}
    </div>
  );
}

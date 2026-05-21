import { motion, AnimatePresence } from "framer-motion";
import type { ChatShellExpandMode } from "@/contexts/ChatShellContext";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import {
  CHAT_TYPE_DEFAULT_SUGGESTIONS,
  CHAT_TYPE_DESCRIPTIONS,
  getChatTypeLabel,
} from "@/lib/unifiedChatSuggestedPrompts";
import {
  getChatTypeActiveBorderClassName,
  getChatTypePillClassName,
} from "@/lib/unifiedChatTypeStyles";
import { cn } from "@/lib/utils";

export type ChatTypePromptCardsLayout = "hidden" | "row" | "grid";

/** Fixed card width in tall shell row layout (gap shrinks before cards do). */
export const ROW_PROMPT_CARD_WIDTH_PX = 280;
const ROW_PROMPT_GAP_MIN_PX = 5;
const ROW_PROMPT_GAP_MAX_PX = 40; // 2.5rem

/** Gap shrinks toward {@link ROW_PROMPT_GAP_MIN_PX}; scroll only after that floor. */
export function rowPromptCardsGapCss(
  cardCount: number,
  cardWidthPx = ROW_PROMPT_CARD_WIDTH_PX,
): string {
  if (cardCount <= 1) return "0px";
  const gaps = cardCount - 1;
  return `clamp(${ROW_PROMPT_GAP_MIN_PX}px, calc((100% - ${cardCount * cardWidthPx}px) / ${gaps}), ${ROW_PROMPT_GAP_MAX_PX}px)`;
}

const UNIFIED_CHAT_TYPE_ORDER: UnifiedChatType[] = [
  "chat",
  "research",
  "insight_builder",
  "workbench",
];

export function resolveChatTypePromptCardsLayout(
  panelLayout: "rail" | "shell",
  shellExpandMode: ChatShellExpandMode,
  isPanelFullscreen = false,
): ChatTypePromptCardsLayout {
  if (panelLayout === "shell" && shellExpandMode === "compact") {
    return "hidden";
  }
  if (
    panelLayout === "shell" &&
    (shellExpandMode === "tall" || shellExpandMode === "full")
  ) {
    return "row";
  }
  if (panelLayout === "rail" && isPanelFullscreen) {
    return "row";
  }
  return "grid";
}

export interface ChatTypeSuggestedPromptCardsProps {
  allowedTypes: UnifiedChatType[];
  layout: ChatTypePromptCardsLayout;
  activeChatType?: UnifiedChatType;
  /** Which card shows example prompts; null = all collapsed. */
  expandedChatType?: UnifiedChatType | null;
  onCardSelect?: (chatType: UnifiedChatType) => void;
  /** Per-type overrides (e.g. live suggestions for the active chat type). */
  suggestionsByType?: Partial<Record<UnifiedChatType, string[]>>;
  maxPromptsPerCard?: number;
  onPromptClick: (prompt: string, chatType: UnifiedChatType) => void;
  className?: string;
}

export function ChatTypeSuggestedPromptCards({
  allowedTypes,
  layout,
  activeChatType,
  expandedChatType = null,
  onCardSelect,
  suggestionsByType,
  maxPromptsPerCard = 3,
  onPromptClick,
  className,
}: ChatTypeSuggestedPromptCardsProps) {
  if (layout === "hidden") return null;

  const types = UNIFIED_CHAT_TYPE_ORDER.filter((t) => allowedTypes.includes(t));
  if (types.length === 0) return null;

  const cards = types.map((chatType, cardIndex) => {
    const prompts = (
      suggestionsByType?.[chatType]?.length
        ? suggestionsByType[chatType]
        : CHAT_TYPE_DEFAULT_SUGGESTIONS[chatType]
    )?.slice(0, maxPromptsPerCard);
    const isActive = chatType === activeChatType;
    const isExpanded = expandedChatType === chatType;

    return (
      <motion.article
        key={chatType}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 + cardIndex * 0.04 }}
        className={cn(
          "flex flex-col rounded-xl border bg-white/90 dark:bg-slate-900/80 shadow-sm overflow-hidden",
          layout === "row" && "w-[280px] min-w-[280px] shrink-0 snap-center self-center",
          layout === "grid" && "min-w-0 self-center",
          isActive
            ? getChatTypeActiveBorderClassName(chatType)
            : "border-slate-200/80 dark:border-slate-700/70",
        )}
      >
        <button
          type="button"
          onClick={() => onCardSelect?.(chatType)}
          className={cn(
            "w-full text-left px-3 pt-3 transition-colors",
            isExpanded ? "pb-2" : "pb-3",
            onCardSelect &&
              "hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer",
            isExpanded && "border-b border-slate-100 dark:border-slate-800/80",
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md",
                getChatTypePillClassName(chatType),
              )}
            >
              {getChatTypeLabel(chatType)}
            </span>
          </div>
          <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {CHAT_TYPE_DESCRIPTIONS[chatType]}
          </p>
        </button>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="prompts"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="flex flex-col px-2 pb-2 pt-0.5 gap-0.5">
                {prompts && prompts.length > 0 ? (
                  prompts.map((prompt, promptIndex) => (
                    <button
                      key={`${chatType}-${promptIndex}`}
                      type="button"
                      onClick={() => onPromptClick(prompt, chatType)}
                      className="w-full text-left rounded-lg px-2 py-2 text-[12px] leading-snug text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                    >
                      {prompt}
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-3 text-[11px] text-slate-400 dark:text-slate-500 italic">
                    Suggestions coming soon
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.article>
    );
  });

  const shellMotion = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3 },
  };

  if (layout === "row") {
    return (
      <motion.div
        {...shellMotion}
        data-tour="unified-chat-suggestions"
        className={cn(
          "min-w-0 w-full overflow-x-auto overflow-y-hidden pb-1 scrollbar-thin snap-x snap-mandatory",
          className,
        )}
      >
        <div
          className="flex w-full min-w-max justify-center items-center snap-x snap-mandatory"
          style={{ gap: rowPromptCardsGapCss(types.length) }}
        >
          {cards}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      {...shellMotion}
      data-tour="unified-chat-suggestions"
      className={cn(
        "min-w-0 grid w-full grid-cols-2 gap-3 items-center",
        className,
      )}
    >
      {cards}
    </motion.div>
  );
}

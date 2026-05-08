/**
 * Shared floating “Cohi” launcher — blue gradient vertical chip on the right edge.
 * Used by site-wide chat and Workbench so look-and-feel stays consistent.
 */

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export interface CohiChatDockChipProps {
  onClick: () => void;
  /** Screen reader / tooltip label */
  ariaLabel?: string;
  title?: string;
  /** When true, chip shows pressed / active affordance (e.g. panel open) */
  pressed?: boolean;
  "data-testid"?: string;
}

export function CohiChatDockChip({
  onClick,
  ariaLabel = "Open Cohi Insights",
  title = "Cohi – Ask about your pipeline & performance",
  pressed,
  "data-testid": dataTestId,
}: CohiChatDockChipProps) {
  return (
    <motion.button
      type="button"
      data-testid={dataTestId}
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 20, opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      title={title}
      className={
        "fixed right-0 top-1/2 -translate-y-1/2 z-50 flex flex-col items-center gap-2 px-2.5 py-4 rounded-l-xl " +
        "shadow-[0_4px_24px_rgba(59,130,246,0.25)] dark:shadow-[0_4px_24px_rgba(99,102,241,0.2)] " +
        "bg-gradient-to-b from-blue-600 to-indigo-600 text-white border border-l-0 border-white/10 " +
        "hover:from-blue-500 hover:to-indigo-500 hover:shadow-[0_6px_28px_rgba(59,130,246,0.35)] " +
        "transition-all duration-200 hover:pl-3 group " +
        (pressed
          ? "ring-2 ring-white/40 ring-offset-2 ring-offset-transparent "
          : "")
      }
    >
      <Sparkles
        className="w-5 h-5 text-white drop-shadow-sm"
        strokeWidth={1.75}
      />
      <span
        className="text-xs font-semibold tracking-tight"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        Cohi
      </span>
    </motion.button>
  );
}

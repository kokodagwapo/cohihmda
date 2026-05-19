import { Minimize2, PanelRight, UnfoldVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useChatShell,
  type ChatShellExpandMode,
} from "@/contexts/ChatShellContext";

const MODES: {
  id: ChatShellExpandMode;
  label: string;
  icon: typeof UnfoldVertical;
}[] = [
  { id: "compact", label: "Compact", icon: Minimize2 },
  { id: "tall", label: "Taller", icon: UnfoldVertical },
  { id: "split", label: "Split", icon: PanelRight },
];

export interface ChatShellExpandControlsProps {
  className?: string;
  /** Match CohiChatPanel header icon buttons when embedded in the title row. */
  variant?: "toolbar" | "header";
}

export function ChatShellExpandControls({
  className,
  variant = "toolbar",
}: ChatShellExpandControlsProps) {
  const { mode, setMode, isChatHomePage } = useChatShell();
  const isMobile = useIsMobile();

  if (isChatHomePage) {
    return null;
  }
  const visibleModes = isMobile
    ? MODES.filter((m) => m.id !== "split")
    : MODES;

  const isHeader = variant === "header";

  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role="group"
      aria-label="Chat layout"
    >
      {visibleModes.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            isHeader
              ? "h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors"
              : "h-7 w-7 rounded-lg",
            mode === id &&
              (isHeader
                ? "bg-violet-100/80 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300"
                : "bg-violet-100/90 dark:bg-violet-500/25 text-violet-700 dark:text-violet-200"),
          )}
          title={label}
          aria-pressed={mode === id}
          onClick={() => setMode(id)}
        >
          <Icon className={isHeader ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </Button>
      ))}
    </div>
  );
}

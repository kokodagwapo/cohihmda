import { Bug, X } from "lucide-react";
import { useDebugMode } from "@/contexts/DebugModeContext";

export function DebugModeIndicator() {
  const { isDebugMode, toggleDebugMode, canDebug } = useDebugMode();

  if (!canDebug || !isDebugMode) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-900/80 border border-amber-300 dark:border-amber-700 px-3 py-1.5 shadow-lg backdrop-blur-sm select-none">
      <Bug className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
        Debug Mode
      </span>
      <span className="text-[10px] text-amber-500 dark:text-amber-400 hidden sm:inline">
        Ctrl+Shift+D
      </span>
      <button
        onClick={toggleDebugMode}
        className="ml-1 p-0.5 rounded-full hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
        title="Disable debug mode"
      >
        <X className="h-3 w-3 text-amber-600 dark:text-amber-400" />
      </button>
    </div>
  );
}

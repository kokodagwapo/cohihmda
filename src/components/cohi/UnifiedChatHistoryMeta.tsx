import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Pill for folder / chat type on Full History and sidebar history (COHI-403). */
export function HistoryMetaPill({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

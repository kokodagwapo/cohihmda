import type { ReactNode } from "react";
import { DASHBOARD_PAGE_CONTENT_STACK } from "@/components/cohi/pageContentStyles";
import { cn } from "@/lib/utils";

export interface DashboardPageContentProps {
  children: ReactNode;
  className?: string;
}

/** Constrains dashboard widgets to the chat column with uniform section gaps. */
export function DashboardPageContent({
  children,
  className,
}: DashboardPageContentProps) {
  return (
    <div className={cn(DASHBOARD_PAGE_CONTENT_STACK, className)}>{children}</div>
  );
}

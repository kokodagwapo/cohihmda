import type { ReactNode } from "react";
import {
  DASHBOARD_MAIN_CLASSNAME,
  DASHBOARD_PAGE_CONTENT_STACK,
} from "@/components/cohi/pageContentStyles";
import { cn } from "@/lib/utils";

export interface DashboardPageMainProps {
  children: ReactNode;
  className?: string;
  /** When false, children are not wrapped in the 1800px column (e.g. fullscreen scorecard). */
  constrainContent?: boolean;
}

/** Standard scrollable dashboard body aligned with the unified chat shell column. */
export function DashboardPageMain({
  children,
  className,
  constrainContent = true,
}: DashboardPageMainProps) {
  return (
    <main className={cn(DASHBOARD_MAIN_CLASSNAME, className)}>
      {constrainContent ? (
        <div className={DASHBOARD_PAGE_CONTENT_STACK}>{children}</div>
      ) : (
        children
      )}
    </main>
  );
}

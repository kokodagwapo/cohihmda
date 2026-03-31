import { useCallback, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import CohiBuilderApp from "@/cohibuilder/CohiBuilderApp";
import "@/cohibuilder/cohibuilder.css";

type CohiBuilderEmbeddedProps = {
  /** Rendered in builder header after portfolio search (e.g. page-level tabs) */
  headerAfterSearch?: ReactNode;
};

/**
 * Full Cohi Builder app (ported from CBuilder) embedded in Coheus Capture Analysis.
 */
export function CohiBuilderEmbedded({ headerAfterSearch }: CohiBuilderEmbeddedProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  /** Inside Coheus Capture Analysis: only the main app sidebar (ReportsSidebar) — never the Builder left rail. */
  const hideSidebar = true;
  const syncNavigation = useCallback(
    (to: string) => {
      navigate(to, { replace: false });
    },
    [navigate],
  );

  return (
    <div className="cohibuilder-root rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-slate-50/40 dark:bg-slate-950/40 overflow-hidden min-h-[min(85vh,920px)] shadow-[0_1px_3px_rgba(15,23,42,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
      <CohiBuilderApp
        syncNavigation={syncNavigation}
        onExit={() => navigate("/insights")}
        hideSidebar={hideSidebar}
        headerAfterSearch={headerAfterSearch}
        routerSearchKey={location.search}
      />
    </div>
  );
}

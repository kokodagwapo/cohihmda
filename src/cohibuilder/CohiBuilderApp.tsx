import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, type ReactNode } from "react";
import Layout from "./components/Layout";
import { PortfolioMapSearchProvider } from "./contexts/PortfolioMapSearchContext";
import { FunnelPeriodProvider } from "./contexts/FunnelPeriodContext";
import Dashboard from "./components/Dashboard";
import LoanDetail from "./components/LoanDetail";
import LenderSettings from "./components/LenderSettings";
import BorrowerSurvey from "./components/BorrowerSurvey";
import Integrations from "./components/Integrations";
import DrawManagement from "./components/DrawManagement";
import RESPAMonitoring from "./components/RESPAMonitoring";
import LoanList from "./components/LoanList";
import RiskBreakdown from "./components/RiskBreakdown";
import HelocDetails from "./components/HelocDetails";
import RESPADetail from "./components/RESPADetail";
import DrawDetail from "./components/DrawDetail";
import LenderDetail from "./components/LenderDetail";
import PortfolioMap from "./components/PortfolioMap";
import CaptureRateDrilldown from "./components/CaptureRateDrilldown";
import RateLockDrilldown from "./components/RateLockDrilldown";
import {
  type AppRoute,
  type NavIds,
  readRouteFromLocation,
  routeToPath,
  buildNextRoute,
} from "./lib/urlNavigation";
export type CohiBuilderAppProps = {
  /** React Router navigation — keeps /capture-analysis?… in sync */
  syncNavigation?: (to: string) => void;
  /** Home / exit builder → main Coheus app */
  onExit?: () => void;
  /** When true (URL hideNav=1), Builder left rail stays off-canvas until opened from header menu */
  hideSidebar?: boolean;
  /** Inserted in Layout header after the search field */
  headerAfterSearch?: ReactNode;
  /** When React Router search changes (e.g. top nav deep link), re-sync builder route from URL */
  routerSearchKey?: string;
};

function withHideNavParam(path: string, hideSidebar: boolean): string {
  try {
    const u = new URL(path, window.location.origin);
    if (hideSidebar) u.searchParams.set("hideNav", "1");
    else u.searchParams.delete("hideNav");
    return `${u.pathname}${u.search}`;
  } catch {
    if (!hideSidebar) return path;
    const joiner = path.includes("?") ? "&" : "?";
    return path.includes("hideNav=") ? path : `${path}${joiner}hideNav=1`;
  }
}

export default function CohiBuilderApp({
  syncNavigation,
  onExit,
  hideSidebar = false,
  headerAfterSearch,
  routerSearchKey,
}: CohiBuilderAppProps = {}) {
  const [route, setRoute] = useState<AppRoute>(() => readRouteFromLocation());
  const skipHistorySync = useRef(false);

  const goToView = useCallback((view: string, patch?: Partial<NavIds>) => {
    setRoute((prev) => buildNextRoute(prev, view, patch));
  }, []);

  useEffect(() => {
    if (routerSearchKey === undefined) return;
    skipHistorySync.current = true;
    setRoute(readRouteFromLocation());
  }, [routerSearchKey]);

  useLayoutEffect(() => {
    if (skipHistorySync.current) {
      skipHistorySync.current = false;
      return;
    }
    const next = withHideNavParam(routeToPath(route), hideSidebar);
    const cur =
      window.location.pathname + (window.location.search || "");
    if (next !== cur) {
      if (syncNavigation) {
        syncNavigation(next);
      } else {
        window.history.pushState({}, "", next);
      }
    }
  }, [route, syncNavigation, hideSidebar]);

  useEffect(() => {
    const onPop = () => {
      skipHistorySync.current = true;
      setRoute(readRouteFromLocation());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const activeView = route.mode === "app" ? route.view : "dashboard";
  const selectedLoanId = route.mode === "app" ? route.loanId : null;
  const selectedAppId = route.mode === "app" ? route.appId : null;
  const selectedDrawId = route.mode === "app" ? route.drawId : null;
  const selectedLenderId = route.mode === "app" ? route.lenderId : null;

  const handleLoanDrillDown = (loanId: number) => {
    goToView("loan-detail", {
      loanId,
      appId: null,
      drawId: null,
      lenderId: null,
    });
  };

  const handleAppDrillDown = (appId: string) => {
    goToView("respa-detail", {
      appId,
      loanId: null,
      drawId: null,
      lenderId: null,
    });
  };

  const handleDrawDrillDown = (drawId: string) => {
    goToView("draw-detail", {
      drawId,
      loanId: null,
      appId: null,
      lenderId: null,
    });
  };

  const handleLenderDrillDown = (lenderId: number) => {
    goToView("lender-detail", {
      lenderId,
      loanId: null,
      appId: null,
      drawId: null,
    });
  };

  const handleStatDrillDown = (type: string) => {
    switch (type) {
      case "active":
      case "active-builds":
        goToView("active-builds");
        break;
      case "capture":
      case "capture-rate":
        goToView("capture-rate");
        break;
      case "locks":
      case "locks-expiring":
      case "rate-lock-coverage":
        goToView("respa");
        break;
      case "expiring":
      case "expiring-soon":
      case "expiring-docs":
        goToView("expiring-docs");
        break;
      case "risk":
      case "high-risk":
      case "high-risk-loans":
        goToView("high-risk-loans");
        break;
      case "non-qm":
        goToView("non-qm-loans");
        break;
      case "all":
        goToView("all-loans");
        break;
      default:
        goToView("dashboard");
    }
  };

  const renderView = () => {
    if (route.mode !== "app") return null;
    switch (route.view) {
      case "dashboard":
        return (
          <Dashboard
            onLoanClick={handleLoanDrillDown}
            onStatClick={handleStatDrillDown}
            onViewMap={() => goToView("portfolio-map")}
            onOpenView={(view) => goToView(view)}
          />
        );
      case "portfolio-map":
        return (
          <PortfolioMap
            onLoanClick={handleLoanDrillDown}
            onBack={() => goToView("dashboard")}
            selectedLoanId={selectedLoanId}
          />
        );
      case "loan-detail":
        return (
          <LoanDetail
            loanId={selectedLoanId}
            onBack={() => goToView("dashboard")}
            onViewRisk={(id) => {
              goToView("risk-breakdown", {
                loanId: id,
                appId: null,
                drawId: null,
                lenderId: null,
              });
            }}
            onViewHeloc={(id) => {
              goToView("heloc-details", {
                loanId: id,
                appId: null,
                drawId: null,
                lenderId: null,
              });
            }}
          />
        );
      case "risk-breakdown":
        return (
          <RiskBreakdown
            loanId={selectedLoanId}
            onBack={() =>
              selectedLoanId != null
                ? goToView("loan-detail", {
                    loanId: selectedLoanId,
                    appId: null,
                    drawId: null,
                    lenderId: null,
                  })
                : goToView("dashboard")
            }
          />
        );
      case "heloc-details":
        return (
          <HelocDetails
            loanId={selectedLoanId}
            onBack={() =>
              selectedLoanId != null
                ? goToView("loan-detail", {
                    loanId: selectedLoanId,
                    appId: null,
                    drawId: null,
                    lenderId: null,
                  })
                : goToView("dashboard")
            }
          />
        );
      case "active-builds":
        return (
          <LoanList
            title="Active Loans"
            filterType="active"
            onBack={() => goToView("dashboard")}
            onLoanClick={handleLoanDrillDown}
          />
        );
      case "expiring-docs":
        return (
          <LoanList
            title="Docs Expiring Soon"
            filterType="expiring"
            onBack={() => goToView("dashboard")}
            onLoanClick={handleLoanDrillDown}
          />
        );
      case "locks-expiring":
        return (
          <LoanList
            title="Rate Locks Expiring Soon"
            filterType="locks-expiring"
            onBack={() => goToView("dashboard")}
            onLoanClick={handleLoanDrillDown}
          />
        );
      case "high-risk-loans":
        return (
          <LoanList
            title="High Fallout Risk"
            filterType="high-risk"
            onBack={() => goToView("dashboard")}
            onLoanClick={handleLoanDrillDown}
          />
        );
      case "non-qm-loans":
        return (
          <LoanList
            title="Non-QM Portfolio"
            filterType="non-qm"
            onBack={() => goToView("dashboard")}
            onLoanClick={handleLoanDrillDown}
          />
        );
      case "all-loans":
        return (
          <LoanList
            title="All Portfolio Loans"
            filterType="all"
            onBack={() => goToView("dashboard")}
            onLoanClick={handleLoanDrillDown}
          />
        );
      case "capture-rate":
        return (
          <CaptureRateDrilldown
            onBack={() => goToView("dashboard")}
            onOpenMapView={() => goToView("portfolio-map")}
          />
        );
      case "rate-lock-coverage":
        return (
          <RateLockDrilldown
            onBack={() => goToView("dashboard")}
            onLoanClick={handleLoanDrillDown}
          />
        );
      case "draws":
        return <DrawManagement onDrawClick={handleDrawDrillDown} />;
      case "draw-detail":
        return (
          <DrawDetail
            drawId={selectedDrawId || ""}
            onBack={() => goToView("draws")}
          />
        );
      case "lenders":
        return <LenderSettings onLenderClick={handleLenderDrillDown} />;
      case "lender-detail":
        return (
          <LenderDetail
            lenderId={selectedLenderId || 0}
            onBack={() => goToView("lenders")}
          />
        );
      case "survey":
        return <BorrowerSurvey />;
      case "integrations":
        return <Integrations />;
      case "respa":
        return <RESPAMonitoring onAppClick={handleAppDrillDown} />;
      case "respa-detail":
        return (
          <RESPADetail
            appId={selectedAppId}
            onBack={() => goToView("respa")}
          />
        );
      default:
        return (
          <Dashboard
            onLoanClick={handleLoanDrillDown}
            onStatClick={handleStatDrillDown}
            onViewMap={() => goToView("portfolio-map")}
            onOpenView={(view) => goToView(view)}
          />
        );
    }
  };

  return (
    <PortfolioMapSearchProvider>
      <FunnelPeriodProvider>
      <Layout
        activeView={activeView}
        setActiveView={goToView}
        onSelectLoan={(loanId) => {
          goToView("loan-detail", {
            loanId,
            appId: null,
            drawId: null,
            lenderId: null,
          });
        }}
        onExit={onExit}
        embedded
        hideSidebar={hideSidebar}
        headerAfterSearch={headerAfterSearch}
      >
        {route.mode === "app" ? (
          renderView()
        ) : (
          <Dashboard
            onLoanClick={handleLoanDrillDown}
            onStatClick={handleStatDrillDown}
            onViewMap={() => goToView("portfolio-map")}
            onOpenView={(view) => goToView(view)}
          />
        )}
      </Layout>
      </FunnelPeriodProvider>
    </PortfolioMapSearchProvider>
  );
}

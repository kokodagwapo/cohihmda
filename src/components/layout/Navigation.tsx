import { Button } from "@/components/ui/button";
import { CoheusLogo } from "@/components/ui/CoheusLogo";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserMenu } from "@/components/layout/UserMenu";
import { useAuth } from "@/contexts/AuthContext";
import {
  Menu,
  X,
  TrendingUp,
  LayoutGrid,
  LayoutPanelLeft,
  ChevronDown,
  Zap,
  Newspaper,
  Trophy,
  Target,
  BarChart3,
  Filter,
  ClipboardList,
  ArrowLeftRight,
  Users,
  Settings,
  Calculator,
  LineChart,
  Shield,
  Building2,
  Grid3X3,
  FlaskConical,
  FileText,
  HelpCircle,
  DollarSign,
  Pin,
  PinOff,
  Lock,
  Layers,
  Database,
  Mail,
} from "lucide-react";
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ChannelSelector } from "@/components/dashboard/ChannelSelector";
import { TenantSelector } from "@/components/dashboard/TenantSelector";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { usePinnedDashboardsStore, type PinnedItem } from "@/stores/pinnedDashboardsStore";
import { WhatsNewButton } from "@/components/tutorial/WhatsNewButton";
import {
  SidebarRouteSearch,
  type SidebarRouteSearchTarget,
} from "@/components/dashboard/SidebarRouteSearch";
import { fetchSidebarSearchTargets } from "@/data/sidebarSearchTargets";
import { useWorkbenchNav } from "@/hooks/useWorkbenchNav";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";

export interface NavigationProps {
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  onSectionClick?: (sectionId: string) => void;
}

// Dashboard section configuration (matching ReportsSidebar)
const dashboardSectionsConfig = [
  { id: "CohiInsights", label: "Cohi Insights", icon: Zap },
  { id: "industryNews", label: "Cohi Mortgage News", icon: Newspaper },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "executiveDashboard", label: "Business Overview", icon: Target },
  {
    id: "closingFalloutForecast",
    label: "Closing & Fallout Forecast",
    icon: BarChart3,
  },
];

// Insights top nav dropdown: only Cohi Insights + Cohi Mortgage News (Leaderboard, Business Overview, Closing & Fallout hidden)
const insightsMenuConfig = dashboardSectionsConfig.filter(
  (s) => s.id === "CohiInsights" || s.id === "industryNews",
);

// Reorganized Top Tiering menu structure with better grouping (iconColor matches sidemenu)
const topTieringMenuGroups = {
  general: {
    label: "General",
    items: [
      {
        id: "actors",
        label: "Actors",
        icon: Users,
        iconColor: "blue" as const,
      },
      {
        id: "companyScorecard",
        label: "Company Scorecard",
        icon: ClipboardList,
        iconColor: "indigo" as const,
      },
      {
        id: "falloutForecastPage",
        label: "Fallout Report",
        icon: BarChart3,
        iconColor: "indigo" as const,
      },
      {
        id: "loanComplexity",
        label: "Loan Complexity",
        icon: Layers,
        iconColor: "indigo" as const,
      },
      {
        id: "loanDetail",
        label: "Loan Detail",
        icon: FileText,
        iconColor: "blue" as const,
      },
      {
        id: "captureAnalysis",
        label: "Capture Analysis",
        icon: BarChart3,
        iconColor: "emerald" as const,
      },
      {
        id: "businessOverview",
        label: "Business Overview",
        icon: Target,
        iconColor: "blue" as const,
      },
    ],
  },
  performance: {
    label: "Financial Modeling",
    items: [
      {
        id: "financialModeling",
        label: "Financial Modeling Sandbox",
        icon: Calculator,
        iconColor: "blue" as const,
      },
    ],
  },
  // compliance: not yet ready for production
  // compliance: {
  //   label: "Compliance",
  //   items: [
  //     { id: "hmda", label: "HMDA", icon: FileText, iconColor: "indigo" as const },
  //   ],
  // },
  sales: {
    label: "Sales",
    icon: Users,
    items: [
      {
        id: "topTieringComparison",
        label: "TopTiering Comparison",
        icon: ArrowLeftRight,
        iconColor: "blue" as const,
      },
      {
        id: "highPerformers",
        label: "High Performers",
        icon: Trophy,
        iconColor: "amber" as const,
      },
      {
        id: "leaderboard",
        label: "Leaderboard",
        icon: Trophy,
        iconColor: "amber" as const,
      },
      {
        id: "pricingDashboard",
        label: "Pricing Dashboard",
        icon: DollarSign,
        iconColor: "emerald" as const,
      },
      {
        id: "salesScorecard",
        label: "Sales Scorecard",
        icon: Target,
        iconColor: "blue" as const,
      },
      {
        id: "salesScorecardOverview",
        label: "Sales Scorecard Overview",
        icon: BarChart3,
        iconColor: "blue" as const,
      },
      {
        id: "salesCompanyOverview",
        label: "Sales Company Overview",
        icon: Building2,
        iconColor: "blue" as const,
      },
      {
        id: "salesTrends",
        label: "Sales Trends",
        icon: TrendingUp,
        iconColor: "emerald" as const,
      },
      {
        id: "productionTrends",
        label: "Production Trends",
        icon: LineChart,
        iconColor: "emerald" as const,
      },
      {
        id: "productionSummaryByWeek",
        label: "Production Summary by Week",
        icon: LineChart,
        iconColor: "emerald" as const,
      },
    ],
  },
  secondaryMarket: {
    label: "Secondary Market",
    items: [
      {
        id: "pipelineAnalysis",
        label: "Pipeline Analysis",
        icon: LineChart,
        iconColor: "emerald" as const,
      },
      {
        id: "lockStratification",
        label: "Lock Stratification",
        icon: Lock,
        iconColor: "blue" as const,
      },
    ],
  },
  operations: {
    label: "Operations",
    icon: Settings,
    items: [
      {
        id: "operationsScorecard",
        label: "Operations Scorecard",
        icon: Target,
        iconColor: "blue" as const,
      },
      {
        id: "operationsTrends",
        label: "Operations Trends",
        icon: LineChart,
        iconColor: "indigo" as const,
      },
      {
        id: "creditRiskManagement",
        label: "Credit Risk Management",
        icon: Shield,
        iconColor: "emerald" as const,
      },
      {
        id: "workflowConversion",
        label: "Workflow Conversion",
        icon: BarChart3,
        iconColor: "blue" as const,
      },
      {
        id: "estimatedClosingsRisk",
        label: "Estimated Closings and Risk Analysis",
        icon: BarChart3,
        iconColor: "emerald" as const,
      },
      {
        id: "activeWorkload",
        label: "Active Workload",
        icon: BarChart3,
        iconColor: "blue" as const,
      },
      {
        id: "dataQuality",
        label: "Data Quality",
        icon: Database,
        iconColor: "emerald" as const,
      },
    ],
  },
};

// Icon colors matching sidemenu – bg tint + icon color
const iconStyleMap: Record<string, { bg: string; icon: string }> = {
  amber: {
    bg: "bg-amber-500/10 dark:bg-amber-500/20",
    icon: "text-amber-500 dark:text-amber-400",
  },
  violet: {
    bg: "bg-violet-500/10 dark:bg-violet-500/20",
    icon: "text-violet-500 dark:text-violet-400",
  },
  blue: {
    bg: "bg-blue-500/10 dark:bg-blue-500/20",
    icon: "text-blue-500 dark:text-blue-400",
  },
  indigo: {
    bg: "bg-indigo-500/10 dark:bg-indigo-500/20",
    icon: "text-indigo-500 dark:text-indigo-400",
  },
  emerald: {
    bg: "bg-emerald-500/10 dark:bg-emerald-500/20",
    icon: "text-emerald-500 dark:text-emerald-400",
  },
};

// Tailwind class constants for nav pills and dropdown items
const topNavPillBase =
  "relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors duration-200 group border";
const topNavPillActive =
  "text-slate-900 dark:text-slate-100 bg-white/90 dark:bg-slate-900/70 border-slate-200/80 dark:border-slate-700/80 shadow-sm";
const topNavPillDefault =
  "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/40 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100";

const dropdownItemBase =
  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative overflow-hidden";
const dropdownItemActive =
  "text-slate-900 dark:text-slate-100 bg-slate-100/90 dark:bg-slate-800/80 shadow-sm";
const dropdownItemFocus =
  "text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800";
const dropdownItemDefault =
  "text-slate-700 dark:text-slate-300 bg-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100";

// Minimal variant for Dashboards submenu (compact)
const compactItemBase =
  "flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 group";
const compactItemActive =
  "text-slate-900 dark:text-slate-100 bg-slate-100/80 dark:bg-slate-800/70";
const compactItemDefault =
  "text-slate-600 dark:text-slate-400 bg-transparent hover:bg-slate-100/70 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-slate-100";

// Route mapping for navigation
const routeMap: Record<string, string> = {
  // loanFunnel: "/loan-funnel", // hidden – page references removed
  creditRiskManagement: "/credit-risk-management",
  companyScorecard: "/company-scorecard",
  topTieringComparison: "/performance/toptiering-comparison",
  workflowConversion: "/workflow-conversion",
  businessOverview: "/business-overview",
  pipelineAnalysis: "/pipeline-analysis",
  loanComplexity: "/loan-complexity",
  loanDetail: "/loan-detail",
  falloutForecastPage: "/fallout-forecast",
  pricingDashboard: "/pricing-dashboard",
  lockStratification: "/lock-stratification",
  highPerformers: "/high-performers",
  leaderboard: "/leaderboard",
  actors: "/actors",
  salesScorecard: "/sales-scorecard",
  salesScorecardOverview: "/sales-scorecard-overview",
  salesCompanyOverview: "/sales-company-overview",
  salesTrends: "/sales-trends",
  productionTrends: "/production-trends",
  productionSummaryByWeek: "/production-summary-by-week",
  operationsScorecard: "/performance/operation-scorecard",
  operationsTrends: "/performance/operation-scorecard-trends",
  estimatedClosingsRisk: "/performance/estimated-closings-risk",
  activeWorkload: "/performance/active-workload",
  financialModeling: "/performance/financial-modeling-sandbox",
  captureAnalysis: "/capture-analysis",
  dataQuality: "/data-quality",
};

/** Match pathname + search when route targets include query params. */
function navTargetMatches(pathname: string, search: string, target: string): boolean {
  const q = target.indexOf("?");
  const path = q >= 0 ? target.slice(0, q) : target;
  if (pathname !== path) return false;
  if (q < 0) return true;
  const want = new URLSearchParams(target.slice(q + 1));
  const have = new URLSearchParams(search || "");
  for (const [key, val] of want.entries()) {
    if (have.get(key) !== val) return false;
  }
  return true;
}

export function Navigation(
  {
    onMenuToggle,
    menuOpen,
    onSectionClick,
  }: NavigationProps = {} as NavigationProps,
) {
  const navigate = useNavigate();
  const location = useLocation();
  const unifiedChatIa = isUnifiedChatClientEnabled();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Global channel selection from store
  const { selectedChannel, setSelectedChannel } = useChannelStore();

  // Global tenant selection from store (for super_admin viewing other tenants)
  const { selectedTenantId, setSelectedTenantId } = useTenantStore();

  // Pinned dashboards (pin from top nav, appear in sidebar)
  const { pinned, togglePinned, isPinned } = usePinnedDashboardsStore();
  const {
    ownedCanvases,
    sharedCanvases,
    favoriteCanvases,
    ownedSessions,
    sharedSessions,
    favoriteUpdatingIds,
    toggleCanvasFavorite,
  } = useWorkbenchNav();

  // Check if user is a platform admin (can view other tenants)
  const isPlatformAdmin =
    user?.role === "super_admin" || user?.role === "platform_admin";

  const isDashboard = location.pathname === "/insights";
  const isWorkbench =
    location.pathname === "/my-dashboard" ||
    location.pathname.startsWith("/workbench");
  const isAdminPage = location.pathname.startsWith("/admin");

  // Dropdown state
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [topTieringOpen, setTopTieringOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [allPagesOpen, setAllPagesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarSearchTargets, setSidebarSearchTargets] = useState<SidebarRouteSearchTarget[]>([]);
  const insightsRef = useRef<HTMLDivElement>(null);
  const topTieringRef = useRef<HTMLDivElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const researchRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const allPagesRef = useRef<HTMLDivElement>(null);
  const insightsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const topTieringTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const workbenchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const researchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const helpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const allPagesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const insightsMenuRef = useRef<HTMLDivElement>(null);
  const topTieringMenuRef = useRef<HTMLDivElement>(null);

  // Get display name from user
  useEffect(() => {
    if (user?.full_name) {
      const first = String(user.full_name).trim().split(/\s+/)[0];
      setDisplayName(first || null);
    } else if (user?.email) {
      const emailPrefix = String(user.email).split("@")[0] ?? "";
      const capitalizedName = emailPrefix
        ? emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1)
        : "";
      setDisplayName(capitalizedName || null);
    } else {
      setDisplayName(null);
    }
  }, [user]);

  const effectiveTenantId = selectedTenantId || user?.tenant_id || null;

  useEffect(() => {
    let alive = true;
    if (!isAuthenticated) {
      setSidebarSearchTargets([]);
      return;
    }
    if (!effectiveTenantId) {
      setSidebarSearchTargets([]);
      return;
    }

    fetchSidebarSearchTargets(effectiveTenantId)
      .then((targets) => {
        if (alive) setSidebarSearchTargets(targets);
      })
      .catch((err) => {
        console.warn("[Navigation] Failed to load sidebar search targets:", err);
        if (alive) setSidebarSearchTargets([]);
      });

    return () => {
      alive = false;
    };
  }, [isAuthenticated, effectiveTenantId]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        insightsRef.current &&
        !insightsRef.current.contains(event.target as Node)
      ) {
        setInsightsOpen(false);
        setFocusedIndex(-1);
      }
      if (
        topTieringRef.current &&
        !topTieringRef.current.contains(event.target as Node)
      ) {
        setTopTieringOpen(false);
        setFocusedIndex(-1);
      }
      if (
        allPagesRef.current &&
        !allPagesRef.current.contains(event.target as Node)
      ) {
        setAllPagesOpen(false);
      }
      if (
        workbenchRef.current &&
        !workbenchRef.current.contains(event.target as Node)
      ) {
        setWorkbenchOpen(false);
      }
      if (
        researchRef.current &&
        !researchRef.current.contains(event.target as Node)
      ) {
        setResearchOpen(false);
      }
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) {
        setHelpOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard navigation handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, menuType: "insights" | "toptiering") => {
      if (menuType === "insights" && !insightsOpen) return;
      if (menuType === "toptiering" && !topTieringOpen) return;

      const items =
        menuType === "insights"
          ? insightsMenuConfig
          : Object.values(topTieringMenuGroups).flatMap((group) =>
              group.items.map((item) => ({ ...item, groupId: group.label })),
            );

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < items.length) {
            const item = items[focusedIndex];
            if (menuType === "insights") {
              scrollToSection(item.id);
            } else {
              handleTopTieringClick(item.id);
            }
          }
          break;
        case "Escape":
          e.preventDefault();
          if (menuType === "insights") {
            setInsightsOpen(false);
          } else {
            setTopTieringOpen(false);
          }
          setFocusedIndex(-1);
          break;
      }
    },
    [insightsOpen, topTieringOpen, focusedIndex],
  );

  const handleLogout = async () => {
    await logout();

    // Redirect to admin login if logging out from admin page
    if (isAdminPage) {
      navigate("/login?returnTo=/admin");
    } else {
      navigate("/");
    }
  };

  // Map section IDs to actual HTML element IDs
  const getSectionElementId = (sectionId: string): string => {
    const sectionIdMap: Record<string, string> = {
      CohiInsights: "CohiInsights",
      industryNews: "industryNews",
      leaderboard: "leaderboard",
      executiveDashboard: "executiveDashboard",
      closingFalloutForecast: "closingFalloutForecast",
    };
    return sectionIdMap[sectionId] || `section-${sectionId}`;
  };

  const scrollToSection = (sectionId: string) => {
    const elementId = getSectionElementId(sectionId);

    if (location.pathname !== "/insights") {
      navigate("/insights");
      setTimeout(() => {
        const scrollToElement = () => {
          const element = document.getElementById(elementId);
          if (element) {
            const headerOffset = 80;
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition =
              elementPosition + window.pageYOffset - headerOffset;
            window.scrollTo({
              top: offsetPosition,
              behavior: "smooth",
            });
          } else {
            setTimeout(scrollToElement, 100);
          }
        };
        scrollToElement();
      }, 300);
    } else {
      const element = document.getElementById(elementId);
      if (element) {
        const headerOffset = 80;
        const elementPosition = element.getBoundingClientRect().top;
        const offsetPosition =
          elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({
          top: offsetPosition,
          behavior: "smooth",
        });
      }
    }

    if (onSectionClick) {
      onSectionClick(sectionId);
    }
    setInsightsOpen(false);
    setTopTieringOpen(false);
    setFocusedIndex(-1);
  };

  const handleTopTieringClick = (itemId: string, customRoute?: string) => {
    setTopTieringOpen(false);
    setFocusedIndex(-1);

    const route = customRoute || routeMap[itemId];
    if (route) {
      navigate(route);
    }
  };

  const openHelpMenu = useCallback(() => {
    if (helpTimeoutRef.current) {
      clearTimeout(helpTimeoutRef.current);
      helpTimeoutRef.current = null;
    }
    setHelpOpen(true);
  }, []);

  const closeHelpMenuWithDelay = useCallback(() => {
    if (helpTimeoutRef.current) {
      clearTimeout(helpTimeoutRef.current);
    }
    helpTimeoutRef.current = setTimeout(() => {
      setHelpOpen(false);
      helpTimeoutRef.current = null;
    }, 150);
  }, []);

  const isInsightsPage = location.pathname === "/insights";
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const isActive = (path: string) => location.pathname === path;

  // Check if current page is a TopTiering page
  const isTopTieringPage = useMemo(() => {
    const topTieringRoutes = [
      "/credit-risk-management",
      "/company-scorecard",
      "/performance/toptiering-comparison",
      "/workflow-conversion",
      "/business-overview",
      "/leaderboard",
      "/pipeline-analysis",
      "/loan-complexity",
      "/loan-detail",
      "/fallout-forecast",
      "/pricing-dashboard",
      "/lock-stratification",
      "/high-performers",
      "/sales-scorecard",
      "/sales-scorecard-overview",
      "/sales-company-overview",
      "/sales-trends",
      "/production-trends",
      "/production-summary-by-week",
      "/performance/operation-scorecard",
      "/performance/operation-scorecard-trends",
      "/performance/estimated-closings-risk",
      "/performance/active-workload",
      "/performance/financial-modeling-sandbox",
      "/capture-analysis",
      "/data-quality",
    ];
    return topTieringRoutes.some(
      (route) =>
        location.pathname === route || location.pathname.startsWith(route),
    );
  }, [location.pathname]);

  // Get current page label for mobile
  const getCurrentPageLabel = () => {
    if (isInsightsPage) return "Insights";
    if (isTopTieringPage) {
      const entry = Object.entries(routeMap).find(([, route]) =>
        navTargetMatches(location.pathname, location.search, route),
      );
      if (entry) {
        const [itemId] = entry;
        for (const group of Object.values(topTieringMenuGroups)) {
          const item = group.items.find((i) => i.id === itemId);
          if (item) return item.label;
        }
      }
      return "Top Tiering";
    }
    if (location.pathname === "/my-dashboard") return "My Workbench";
    if (location.pathname.startsWith("/workbench/distributions")) {
      return "Communications Center";
    }
    if (location.pathname === "/" || location.pathname === "/cohi-chat") {
      return "Cohi Chat";
    }
    return "Navigation";
  };

  // Render mobile menu content
  const renderMobileMenu = () => (
    <div className="flex flex-col h-full">
      <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-700">
        <SheetTitle className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <LayoutGrid className="w-5 h-5" />
          Navigation
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {/* Tenant Selector - Mobile (collapsible section) */}
        {isPlatformAdmin && (
          <div className="pb-4 border-b border-slate-200 dark:border-slate-700">
            <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" />
              Tenant Context
            </div>
            <TenantSelector
              selectedTenantId={selectedTenantId}
              onTenantChange={setSelectedTenantId}
              compact={true}
            />
          </div>
        )}

        {/* Insights Section */}
        <div>
          <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Dashboard
          </div>
          <div className="space-y-1">
            {insightsMenuConfig.map((section) => {
              const Icon = section.icon;
              const isSectionActive =
                isInsightsPage && location.hash === `#section-${section.id}`;
              return (
                <button
                  key={section.id}
                  onClick={() => {
                    scrollToSection(section.id);
                    setMobileMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                    isSectionActive
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Top Tiering Section */}
        <div>
          <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" />
            Top Tiering
          </div>
          <div className="space-y-4">
            {/* Core Analytics */}
            <div>
              <div className="px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                General
              </div>
              <div className="space-y-1">
                {topTieringMenuGroups.general.items.map((item) => {
                  const Icon = item.icon;
                  const itemRoute = routeMap[item.id];
                  const isItemActive =
                    itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        handleTopTieringClick(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                        isItemActive
                          ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Performance */}
            <div>
              <div className="px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                Performance
              </div>
              <div className="space-y-1">
                {topTieringMenuGroups.performance.items.map((item) => {
                  const Icon = item.icon;
                  const itemRoute = routeMap[item.id];
                  const isItemActive =
                    itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        handleTopTieringClick(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                        isItemActive
                          ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sales */}
            <div>
              <div className="px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" />
                Sales
              </div>
              <div className="space-y-1 pl-4">
                {topTieringMenuGroups.sales.items.map((item) => {
                  const Icon = item.icon;
                  const itemRoute = routeMap[item.id];
                  const isItemActive =
                    itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        handleTopTieringClick(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                        isItemActive
                          ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Operations */}
            <div>
              <div className="px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" />
                Operations
              </div>
              <div className="space-y-1 pl-4">
                {topTieringMenuGroups.operations.items.map((item) => {
                  const Icon = item.icon;
                  const itemRoute = routeMap[item.id];
                  const isItemActive =
                    itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        handleTopTieringClick(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-left",
                        isItemActive
                          ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span className="min-w-0 flex-1 leading-snug break-words whitespace-normal">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Workbench */}
        <div className="space-y-1">
          <button
            onClick={() => {
              navigate("/workbench");
              setMobileMenuOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              location.pathname.startsWith("/workbench")
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
            )}
            data-track="nav_workbench"
          >
            <LayoutPanelLeft className="w-4 h-4 flex-shrink-0" />
            <span>Workbench</span>
          </button>
          {unifiedChatIa && (
            <button
              type="button"
              data-track="nav_communications_center_mobile"
              data-tour="nav-communications-center"
              onClick={() => {
                navigate("/workbench/distributions");
                setMobileMenuOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                location.pathname.startsWith("/workbench/distributions")
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
              )}
            >
              <Mail className="w-4 h-4 flex-shrink-0" />
              <span>Communications Center</span>
            </button>
          )}
          {ownedCanvases.slice(0, 5).map((canvas) => (
            <button
              key={canvas.id}
              onClick={() => {
                navigate(`/my-dashboard/${canvas.id}`);
                setMobileMenuOpen(false);
              }}
              className="w-full text-left text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 px-8 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {canvas.title}
            </button>
          ))}
        </div>

        {!unifiedChatIa && (
        <div className="space-y-1">
          <button
            data-track="nav_research"
            onClick={() => {
              navigate("/research");
              setMobileMenuOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              location.pathname.startsWith("/research")
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
            )}
          >
            <FlaskConical className="w-4 h-4 flex-shrink-0" />
            <span>Research Lab</span>
          </button>
          {ownedSessions.slice(0, 5).map((session) => (
            <button
              key={session.id}
              onClick={() => {
                navigate(`/research/session?session=${encodeURIComponent(session.id)}`);
                setMobileMenuOpen(false);
              }}
              className="w-full text-left text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 px-8 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {session.topic || "Untitled Session"}
            </button>
          ))}
          <button
            onClick={() => {
              navigate("/research/data-explorer");
              setMobileMenuOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-2 px-8 py-1.5 rounded-md text-xs font-medium transition-all",
              location.pathname === "/research/data-explorer"
                ? "text-blue-600 dark:text-blue-400"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
            )}
          >
            Data Explorer
          </button>
        </div>
        )}

        {/* Help */}
        <div className="space-y-1">
          <button
            onClick={() => {
              navigate("/help");
              setMobileMenuOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            data-track="nav_help_center"
          >
            <HelpCircle className="w-4 h-4 flex-shrink-0" />
            <span>Help Center</span>
          </button>
          <button
            onClick={() => {
              navigate("/feedback", {
                state: {
                  sourcePath: location.pathname,
                  sourceSearch: location.search,
                },
              });
              setMobileMenuOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            data-track="nav_feedback"
          >
            <HelpCircle className="w-4 h-4 flex-shrink-0" />
            <span>Feedback</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200/50 bg-white/80 backdrop-blur-xl dark:border-slate-800/50 dark:bg-slate-950/70 shadow-[0_8px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-3">
          {/* Left: Logo */}
          <div className="flex items-center min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/"
                  data-track="nav_home"
                  className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:opacity-90 transition-opacity"
                  aria-label="Go to home page"
                >
                  <CoheusLogo className="h-9 sm:h-10 md:h-11" height={44} />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top">Home</TooltipContent>
            </Tooltip>
          </div>

          {/* Center: Main Navigation with Dropdowns (Desktop) - matches feb1cohi */}
          {isAuthenticated && (
            <div className="hidden lg:flex flex-1 justify-center items-center gap-2">
              {/* Insights Dropdown removed from header */}
              {false && (
              <div
                ref={insightsRef}
                className="relative"
                onMouseEnter={() => {
                  if (insightsTimeoutRef.current)
                    clearTimeout(insightsTimeoutRef.current);
                  setInsightsOpen(true);
                }}
                onMouseLeave={() => {
                  insightsTimeoutRef.current = setTimeout(
                    () => setInsightsOpen(false),
                    150,
                  );
                }}
              >
                <button
                  data-track="nav_insights"
                  onClick={() => {
                    if (!isInsightsPage) {
                      navigate("/insights");
                    } else {
                      setInsightsOpen(!insightsOpen);
                    }
                  }}
                  onKeyDown={(e) => handleKeyDown(e, "insights")}
                  aria-haspopup="true"
                  aria-expanded={insightsOpen}
                  aria-label="Insights menu"
                  className={cn(
                    topNavPillBase,
                    insightsOpen || isInsightsPage
                      ? topNavPillActive
                      : topNavPillDefault,
                  )}
                >
                  <LayoutGrid
                    className={cn(
                      "w-4 h-4 transition-colors duration-200",
                      insightsOpen || isInsightsPage
                        ? "text-slate-900 dark:text-slate-100"
                        : "text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200",
                    )}
                  />
                  <span>Insights</span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 transition-all duration-200",
                      insightsOpen && "rotate-180",
                      insightsOpen || isInsightsPage
                        ? "text-slate-900 dark:text-slate-100"
                        : "text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200",
                    )}
                  />
                </button>

                <AnimatePresence>
                  {insightsOpen && (
                    <motion.div
                      ref={insightsMenuRef}
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full left-0 mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden z-50 w-[240px] backdrop-blur-sm"
                      role="menu"
                      aria-label="Insights submenu"
                    >
                      <div className="p-4 bg-gradient-to-br from-slate-50/50 to-white dark:from-slate-800/50 dark:to-slate-900 border-b border-slate-100 dark:border-slate-800">
                        <div className="px-2 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Dashboard Sections
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="flex flex-col gap-2">
                          {insightsMenuConfig.map((section, index) => {
                            const Icon = section.icon;
                            const style =
                              section.id === "CohiInsights"
                                ? iconStyleMap.indigo
                                : iconStyleMap.amber;
                            const isSectionActive =
                              isInsightsPage &&
                              location.hash === `#section-${section.id}`;
                            const isFocused = focusedIndex === index;
                            return (
                              <button
                                key={section.id}
                                data-track={`nav_section_${section.id}`}
                                onClick={() => scrollToSection(section.id)}
                                onFocus={() => setFocusedIndex(index)}
                                className={cn(
                                  dropdownItemBase,
                                  isSectionActive
                                    ? dropdownItemActive
                                    : isFocused
                                      ? dropdownItemFocus
                                      : dropdownItemDefault,
                                )}
                                role="menuitem"
                              >
                                <div
                                  className={cn(
                                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300",
                                    style.bg,
                                    isSectionActive &&
                                      "ring-1 ring-slate-200/60 dark:ring-slate-700/60",
                                  )}
                                >
                                  <Icon
                                    className={cn(
                                      "w-4 h-4 transition-all duration-300",
                                      style.icon,
                                      isSectionActive && "scale-110",
                                    )}
                                  />
                                </div>
                                <span className="whitespace-nowrap text-left">
                                  {section.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              )}

              {/* Top Tiering Dropdown */}
              <div
                ref={topTieringRef}
                className="relative"
                onMouseEnter={() => {
                  if (topTieringTimeoutRef.current)
                    clearTimeout(topTieringTimeoutRef.current);
                  setTopTieringOpen(true);
                }}
                onMouseLeave={() => {
                  topTieringTimeoutRef.current = setTimeout(
                    () => setTopTieringOpen(false),
                    150,
                  );
                }}
              >
                <button
                  onClick={() => {
                    if (!isTopTieringPage) {
                      navigate("/performance/toptiering-comparison");
                    } else {
                      setTopTieringOpen(!topTieringOpen);
                    }
                  }}
                  onKeyDown={(e) => handleKeyDown(e, "toptiering")}
                  aria-haspopup="true"
                  aria-expanded={topTieringOpen}
                  aria-label="Dashboards menu"
                  className={cn(
                    topNavPillBase,
                    topTieringOpen || isTopTieringPage
                      ? topNavPillActive
                      : topNavPillDefault,
                  )}
                >
                  <TrendingUp
                    className={cn(
                      "w-4 h-4 transition-colors duration-200",
                      topTieringOpen || isTopTieringPage
                        ? "text-slate-900 dark:text-slate-100"
                        : "text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200",
                    )}
                  />
                  <span>Dashboards</span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 transition-all duration-200",
                      topTieringOpen && "rotate-180",
                      topTieringOpen || isTopTieringPage
                        ? "text-slate-900 dark:text-slate-100"
                        : "text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200",
                    )}
                  />
                </button>

                <AnimatePresence>
                  {topTieringOpen && (
                    <motion.div
                      key="top-tiering-mega-menu"
                      ref={topTieringMenuRef}
                      initial={{ opacity: 0, y: 8, scale: 0.95, x: "-50%" }}
                      animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
                      exit={{ opacity: 0, y: 8, scale: 0.95, x: "-50%" }}
                      transition={{ duration: 0.15 }}
                      className="fixed left-1/2 top-16 z-[60] flex w-[min(1112px,calc(100vw-2rem))] max-h-[calc(100dvh-5rem)] flex-col bg-transparent pt-1.5 origin-top"
                      role="menu"
                      aria-label="Dashboards submenu"
                    >
                      <div className="flex-1 min-h-0 flex flex-col rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)] border border-slate-200/60 dark:border-slate-700/60 overflow-hidden bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl">
                      <div className="h-0.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 opacity-60 shrink-0" aria-hidden />
                      <div className="px-4 sm:px-5 lg:px-6 py-4 overflow-y-auto scrollbar-hide flex-1 min-h-0">
                        <div className="grid w-full grid-cols-4 gap-x-4 gap-y-0">

                        {/* Column 1: General */}
                        <div>
                          <div className="px-1 py-1 mb-1 flex items-center gap-1.5">
                            <div className="w-0.5 h-3.5 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500 opacity-70" />
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              General
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {topTieringMenuGroups.general.items.map((item) => {
                              const Icon = item.icon;
                              const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                              const itemRoute = routeMap[item.id];
                              const isItemActive = itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                              const pinItem: PinnedItem = { type: "route", id: item.id, path: itemRoute || "", label: item.label };
                              const pinned = isPinned(pinItem);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleTopTieringClick(item.id)}
                                  className={cn(compactItemBase, isItemActive ? compactItemActive : compactItemDefault)}
                                  role="menuitem"
                                >
                                  <div className={cn("w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                    <Icon className={cn("w-3 h-3", style.icon, isItemActive && "scale-110")} />
                                  </div>
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <span className="truncate text-left">{item.label}</span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); togglePinned(pinItem); }}
                                      className="shrink-0 ml-auto p-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                                      title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                                      aria-label={pinned ? "Unpin" : "Pin to sidebar"}
                                    >
                                      {pinned ? (
                                        <PinOff className="w-3 h-3 text-amber-500" />
                                      ) : (
                                        <Pin className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                                      )}
                                    </button>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Column 2: Sales */}
                        <div>
                          <div className="px-1 py-1 mb-1 flex items-center gap-1.5">
                            <div className="w-0.5 h-3.5 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500 opacity-70" />
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              Sales
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {topTieringMenuGroups.sales.items.map((item) => {
                              const Icon = item.icon;
                              const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                              const itemRoute = routeMap[item.id];
                              const isItemActive = itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                              const pinItem: PinnedItem = { type: "route", id: item.id, path: itemRoute || "", label: item.label };
                              const pinned = isPinned(pinItem);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleTopTieringClick(item.id)}
                                  className={cn(compactItemBase, isItemActive ? compactItemActive : compactItemDefault)}
                                  role="menuitem"
                                >
                                  <div className={cn("w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                    <Icon className={cn("w-3 h-3", style.icon, isItemActive && "scale-110")} />
                                  </div>
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <span className="truncate text-left">{item.label}</span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); togglePinned(pinItem); }}
                                      className="shrink-0 ml-auto p-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                                      title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                                      aria-label={pinned ? "Unpin" : "Pin to sidebar"}
                                    >
                                      {pinned ? (
                                        <PinOff className="w-3 h-3 text-amber-500" />
                                      ) : (
                                        <Pin className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                                      )}
                                    </button>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Column 3: Operations */}
                        <div>
                          <div className="px-1 py-1 mb-1 flex items-center gap-1.5">
                            <div className="w-0.5 h-3.5 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500 opacity-70" />
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              Operations
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {topTieringMenuGroups.operations.items.map((item) => {
                              const Icon = item.icon;
                              const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                              const itemRoute = routeMap[item.id];
                              const isItemActive = itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                              const pinItem: PinnedItem = { type: "route", id: item.id, path: itemRoute || "", label: item.label };
                              const pinned = isPinned(pinItem);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleTopTieringClick(item.id)}
                                  className={cn(
                                    compactItemBase,
                                    "items-start",
                                    isItemActive ? compactItemActive : compactItemDefault,
                                  )}
                                  role="menuitem"
                                >
                                  <div
                                    className={cn(
                                      "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5",
                                      style.bg,
                                      isItemActive && "ring-1 ring-emerald-400/50",
                                    )}
                                  >
                                    <Icon className={cn("w-3 h-3", style.icon, isItemActive && "scale-110")} />
                                  </div>
                                  <div className="flex items-start gap-1 flex-1 min-w-0">
                                    <span className="text-left leading-snug break-words whitespace-normal flex-1 min-w-0 pr-0.5">
                                      {item.label}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); togglePinned(pinItem); }}
                                      className="shrink-0 ml-auto p-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                                      title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                                      aria-label={pinned ? "Unpin" : "Pin to sidebar"}
                                    >
                                      {pinned ? (
                                        <PinOff className="w-3 h-3 text-amber-500" />
                                      ) : (
                                        <Pin className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                                      )}
                                    </button>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {/* Compliance section hidden — not yet ready for production */}
                        </div>

                        {/* Column 4: Secondary Market + Financial Modeling */}
                        <div>
                          <div className="px-1 py-1 mb-1 flex items-center gap-1.5">
                            <div className="w-0.5 h-3.5 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500 opacity-70" />
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              Secondary Market
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {topTieringMenuGroups.secondaryMarket.items.map((item) => {
                              const Icon = item.icon;
                              const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                              const itemRoute = routeMap[item.id];
                              const isItemActive = itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                              const pinItem: PinnedItem = { type: "route", id: item.id, path: itemRoute || "", label: item.label };
                              const pinned = isPinned(pinItem);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleTopTieringClick(item.id)}
                                  className={cn(compactItemBase, isItemActive ? compactItemActive : compactItemDefault)}
                                  role="menuitem"
                                >
                                  <div className={cn("w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                    <Icon className={cn("w-3 h-3", style.icon, isItemActive && "scale-110")} />
                                  </div>
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <span className="truncate text-left">{item.label}</span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); togglePinned(pinItem); }}
                                      className="shrink-0 ml-auto p-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                                      title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                                      aria-label={pinned ? "Unpin" : "Pin to sidebar"}
                                    >
                                      {pinned ? (
                                        <PinOff className="w-3 h-3 text-amber-500" />
                                      ) : (
                                        <Pin className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                                      )}
                                    </button>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          <div className="px-1 py-1 mt-2.5 mb-1 flex items-center gap-1.5">
                            <div className="w-0.5 h-3.5 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500 opacity-70" />
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              Financial Modeling
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {topTieringMenuGroups.performance.items.map((item) => {
                              const Icon = item.icon;
                              const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                              const itemRoute = routeMap[item.id];
                              const isItemActive = itemRoute && navTargetMatches(location.pathname, location.search, itemRoute);
                              const pinItem: PinnedItem = { type: "route", id: item.id, path: itemRoute || "", label: item.label };
                              const pinned = isPinned(pinItem);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleTopTieringClick(item.id)}
                                  className={cn(compactItemBase, isItemActive ? compactItemActive : compactItemDefault)}
                                  role="menuitem"
                                >
                                  <div className={cn("w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                    <Icon className={cn("w-3 h-3", style.icon, isItemActive && "scale-110")} />
                                  </div>
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <span className="truncate text-left">{item.label}</span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); togglePinned(pinItem); }}
                                      className="shrink-0 ml-auto p-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                                      title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                                      aria-label={pinned ? "Unpin" : "Pin to sidebar"}
                                    >
                                      {pinned ? (
                                        <PinOff className="w-3 h-3 text-amber-500" />
                                      ) : (
                                        <Pin className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                                      )}
                                    </button>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        </div>
                      </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Workbench Dropdown */}
              <div
                ref={workbenchRef}
                className="relative"
                onMouseEnter={() => {
                  if (workbenchTimeoutRef.current) clearTimeout(workbenchTimeoutRef.current);
                  setWorkbenchOpen(true);
                }}
                onMouseLeave={() => {
                  workbenchTimeoutRef.current = setTimeout(() => setWorkbenchOpen(false), 150);
                }}
              >
                <button
                  data-track="nav_workbench_header"
                  onClick={() => {
                    navigate("/workbench");
                    setWorkbenchOpen((prev) => !prev);
                  }}
                  aria-haspopup="true"
                  aria-expanded={workbenchOpen}
                  className={cn(topNavPillBase, (workbenchOpen || isWorkbench) ? topNavPillActive : topNavPillDefault)}
                >
                  <LayoutPanelLeft className="w-4 h-4" />
                  <span>Workbench</span>
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-all duration-200", workbenchOpen && "rotate-180")} />
                </button>
                <AnimatePresence>
                  {workbenchOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full left-0 mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden z-50 w-[360px] max-h-[70vh] overflow-y-auto"
                    >
                      <div className="p-3 space-y-3">
                        <div>
                          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">My Canvases</p>
                          {ownedCanvases.slice(0, 8).map((canvas) => (
                            <div key={canvas.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/60">
                              <button className="flex-1 text-left text-sm truncate" onClick={() => { navigate(`/my-dashboard/${canvas.id}`); setWorkbenchOpen(false); }}>
                                {canvas.title}
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggleCanvasFavorite(canvas.id, !canvas.favorited)}
                                disabled={favoriteUpdatingIds.has(canvas.id)}
                                className="shrink-0 p-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                              >
                                {canvas.favorited ? <PinOff className="w-3.5 h-3.5 text-amber-500" /> : <Pin className="w-3.5 h-3.5 text-slate-400" />}
                              </button>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Shared</p>
                          {sharedCanvases.slice(0, 8).map((canvas) => (
                            <div key={canvas.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/60">
                              <button className="flex-1 text-left text-sm truncate" onClick={() => { navigate(`/my-dashboard/${canvas.id}`); setWorkbenchOpen(false); }}>
                                {canvas.title}
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggleCanvasFavorite(canvas.id, !canvas.favorited)}
                                disabled={favoriteUpdatingIds.has(canvas.id)}
                                className="shrink-0 p-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                              >
                                {canvas.favorited ? <PinOff className="w-3.5 h-3.5 text-amber-500" /> : <Pin className="w-3.5 h-3.5 text-slate-400" />}
                              </button>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Favorites</p>
                          {favoriteCanvases.slice(0, 8).map((canvas) => (
                            <button key={canvas.id} className="w-full text-left text-sm truncate rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/60" onClick={() => { navigate(`/my-dashboard/${canvas.id}`); setWorkbenchOpen(false); }}>
                              {canvas.title}
                            </button>
                          ))}
                        </div>
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                          <button className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline" onClick={() => { navigate("/workbench"); setWorkbenchOpen(false); }}>View All</button>
                          <button className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline" onClick={() => { navigate("/my-dashboard/new"); setWorkbenchOpen(false); }}>New Canvas</button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {!unifiedChatIa ? (
              <div
                ref={researchRef}
                className="relative"
                onMouseEnter={() => {
                  if (researchTimeoutRef.current) clearTimeout(researchTimeoutRef.current);
                  setResearchOpen(true);
                }}
                onMouseLeave={() => {
                  researchTimeoutRef.current = setTimeout(() => setResearchOpen(false), 150);
                }}
              >
                <button
                  data-track="nav_research_header"
                  onClick={() => {
                    navigate("/research");
                    setResearchOpen((prev) => !prev);
                  }}
                  aria-haspopup="true"
                  aria-expanded={researchOpen}
                  className={cn(topNavPillBase, (researchOpen || location.pathname.startsWith("/research")) ? topNavPillActive : topNavPillDefault)}
                >
                  <FlaskConical className="w-4 h-4" />
                  <span>Research Lab</span>
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-all duration-200", researchOpen && "rotate-180")} />
                </button>
                <AnimatePresence>
                  {researchOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full left-0 mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden z-50 w-[340px] max-h-[70vh] overflow-y-auto"
                    >
                      <div className="p-3 space-y-3">
                        <div>
                          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">My Sessions</p>
                          {ownedSessions.slice(0, 8).map((s) => (
                            <button key={s.id} className="w-full text-left text-sm truncate rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/60" onClick={() => { navigate(`/research/session?session=${encodeURIComponent(s.id)}`); setResearchOpen(false); }}>
                              {s.topic || "Untitled Session"}
                            </button>
                          ))}
                        </div>
                        <div>
                          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Shared Sessions</p>
                          {sharedSessions.slice(0, 8).map((s) => (
                            <button key={s.id} className="w-full text-left text-sm truncate rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/60" onClick={() => { navigate(`/research/session?session=${encodeURIComponent(s.id)}`); setResearchOpen(false); }}>
                              {s.topic || "Untitled Session"}
                            </button>
                          ))}
                        </div>
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                          <button className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline" onClick={() => { navigate("/research"); setResearchOpen(false); }}>View All</button>
                          <div className="flex items-center gap-2">
                            <button className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline" onClick={() => { navigate("/research/data-explorer"); setResearchOpen(false); }}>Data Explorer</button>
                            <button className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline" onClick={() => { navigate("/research/session"); setResearchOpen(false); }}>New Session</button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              ) : (
                <button
                  type="button"
                  data-track="nav_communications_center"
                  data-tour="nav-communications-center"
                  onClick={() => navigate("/workbench/distributions")}
                  className={cn(
                    topNavPillBase,
                    location.pathname.startsWith("/workbench/distributions")
                      ? topNavPillActive
                      : topNavPillDefault,
                  )}
                >
                  <Mail className="w-4 h-4" />
                  <span>Communications Center</span>
                </button>
              )}

              {/* Divider */}
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

              {/* Search Dashboards - replaces My Workbench & Research Lab pills */}
              <div className="w-[220px] min-w-[180px] max-w-[280px]">
                <SidebarRouteSearch targets={sidebarSearchTargets} collapsed={false} />
              </div>
            </div>
          )}

          {/* Right: Actions */}
          <div className="ml-auto flex items-center gap-2">
            {/* Mobile Menu Button */}
            {isAuthenticated && (
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden h-9 w-9 rounded-lg"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="h-5 w-5" strokeWidth={2} />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[85vw] sm:w-[320px] p-0">
                  {renderMobileMenu()}
                </SheetContent>
              </Sheet>
            )}

            {/* Mobile: Current page indicator */}
            {isAuthenticated && (
              <div className="lg:hidden flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors duration-200 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm">
                <span className="truncate max-w-[120px]">
                  {getCurrentPageLabel()}
                </span>
              </div>
            )}

            {/* Tenant + Channel selectors - nav-style pill */}
            {isAuthenticated && !isAdminPage && (
              <div className="hidden lg:flex items-center gap-2 rounded-lg border border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/50 px-2 py-1.5">
                {isPlatformAdmin && (
                  <>
                    <TenantSelector
                      selectedTenantId={selectedTenantId}
                      onTenantChange={setSelectedTenantId}
                      compact={true}
                    />
                    <div
                      className="h-6 w-px bg-slate-200 dark:bg-slate-600"
                      aria-hidden
                    />
                  </>
                )}
                <ChannelSelector
                  selectedChannel={selectedChannel}
                  onChannelChange={setSelectedChannel}
                  selectedTenantId={selectedTenantId}
                  compact={true}
                  useChannelGroups={true}
                />
              </div>
            )}

            {/* Help & What's New */}
            {isAuthenticated && (
              <div className="hidden lg:flex items-center gap-1">
                <div
                  ref={helpRef}
                  className="relative"
                  onMouseEnter={openHelpMenu}
                  onMouseLeave={closeHelpMenuWithDelay}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-lg text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    aria-label="Help options"
                    aria-haspopup="true"
                    aria-expanded={helpOpen}
                    onClick={() => setHelpOpen((prev) => !prev)}
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                  <AnimatePresence>
                    {helpOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full right-0 mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden z-50 w-44"
                        role="menu"
                        aria-label="Help options"
                      >
                        <button
                          onClick={() => {
                            navigate("/help");
                            setHelpOpen(false);
                          }}
                          data-track="nav_help_center"
                          className="w-full text-left px-2 py-1.5 text-sm rounded-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                          role="menuitem"
                        >
                          Help Center
                        </button>
                        <button
                          onClick={() => {
                            navigate("/feedback", {
                              state: {
                                sourcePath: location.pathname,
                                sourceSearch: location.search,
                              },
                            });
                            setHelpOpen(false);
                          }}
                          data-track="nav_feedback"
                          className="w-full text-left px-2 py-1.5 text-sm rounded-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                          role="menuitem"
                        >
                          Feedback
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <WhatsNewButton />
              </div>
            )}

            {/* Divider before theme + user (matches center nav) */}
            {isAuthenticated && (
              <div
                className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden lg:block"
                aria-hidden
              />
            )}

            {isAuthenticated ? (
              <UserMenu
                isAuthenticated={isAuthenticated}
                isAdminPage={isAdminPage}
                currentUser={user}
                displayName={displayName}
                currentPath={location.pathname}
                onNavigate={navigate}
                onLogout={handleLogout}
                isAdmin={isAdmin()}
              />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/login")}
                className="text-[13px] font-medium tracking-wide px-3 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-lg transition-colors"
              >
                Sign In
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

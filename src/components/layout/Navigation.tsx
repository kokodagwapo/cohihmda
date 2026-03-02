import { Button } from "@/components/ui/button";
import { CoheusLogo } from "@/components/ui/CoheusLogo";
import { ThemeIconToggle } from "@/components/theme-icon-toggle";
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
import { WhatsNewButton } from "@/components/tutorial/WhatsNewButton";

export interface NavigationProps {
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  onSectionClick?: (sectionId: string) => void;
}

// Dashboard section configuration (matching ReportsSidebar)
const dashboardSectionsConfig = [
  { id: "aletheiaInsights", label: "Cohi Daily Briefings", icon: Zap },
  { id: "industryNews", label: "Mortgage News", icon: Newspaper },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "executiveDashboard", label: "Business Overview", icon: Target },
  {
    id: "closingFalloutForecast",
    label: "Closing & Fallout Forecast",
    icon: BarChart3,
  },
];

// Insights top nav dropdown: only Cohi Daily Briefings + Mortgage News (Leaderboard, Business Overview, Closing & Fallout hidden)
const insightsMenuConfig = dashboardSectionsConfig.filter(
  (s) => s.id === "aletheiaInsights" || s.id === "industryNews",
);

// Reorganized Top Tiering menu structure with better grouping (iconColor matches sidemenu)
const topTieringMenuGroups = {
  coreAnalytics: {
    label: "TopTiering",
    items: [
      /*       {
        id: "loanFunnel",
        label: "Loan Funnel",
        icon: Filter,
        iconColor: "blue" as const,
      }, */
      {
        id: "topTieringComparison",
        label: "TopTiering Comparison",
        icon: ArrowLeftRight,
        iconColor: "blue" as const,
      },
      {
        id: "creditRiskManagement",
        label: "Credit Risk Management",
        icon: Shield,
        iconColor: "emerald" as const,
      },
      {
        id: "companyScorecard",
        label: "Company Scorecard",
        icon: ClipboardList,
        iconColor: "indigo" as const,
      },
      {
        id: "pricingDashboard",
        label: "Pricing Dashboard",
        icon: DollarSign,
        iconColor: "emerald" as const,
      },
      {
        id: "workflowConversion",
        label: "Workflow Conversion",
        icon: BarChart3,
        iconColor: "blue" as const,
      },
      {
        id: "pipelineAnalysis",
        label: "Pipeline Analysis",
        icon: LineChart,
        iconColor: "emerald" as const,
      },
      {
        id: "highPerformers",
        label: "High Performers",
        icon: Trophy,
        iconColor: "amber" as const,
      },
      {
        id: "actors",
        label: "Actors",
        icon: Users,
        iconColor: "blue" as const,
      },
      {
        id: "loanDetail",
        label: "Loan Detail",
        icon: FileText,
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
  sales: {
    label: "Sales",
    icon: Users,
    items: [
      {
        id: "salesScorecard",
        label: "Scorecard",
        icon: Target,
        iconColor: "blue" as const,
      },
      {
        id: "salesTrends",
        label: "Trends",
        icon: TrendingUp,
        iconColor: "emerald" as const,
      },
    ],
  },
  operations: {
    label: "Operations",
    icon: Settings,
    items: [
      {
        id: "operationsScorecard",
        label: "Scorecard",
        icon: Target,
        iconColor: "blue" as const,
      },
      {
        id: "operationsTrends",
        label: "Trends",
        icon: LineChart,
        iconColor: "indigo" as const,
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
  "flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border group relative overflow-hidden";
const dropdownItemActive =
  "text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-700/80 shadow-sm";
const dropdownItemFocus =
  "text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 border-slate-200/80 dark:border-slate-700/80";
const dropdownItemDefault =
  "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/40 border-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-200/80 dark:hover:border-slate-700/80";

// Route mapping for navigation
const routeMap: Record<string, string> = {
  loanFunnel: "/loan-funnel",
  creditRiskManagement: "/credit-risk-management",
  companyScorecard: "/company-scorecard",
  topTieringComparison: "/performance/toptiering-comparison",
  workflowConversion: "/workflow-conversion",
  pipelineAnalysis: "/pipeline-analysis",
  loanDetail: "/loan-detail",
  pricingDashboard: "/pricing-dashboard",
  highPerformers: "/high-performers",
  actors: "/actors",
  salesScorecard: "/sales-scorecard",
  salesTrends: "/sales-trends",
  operationsScorecard: "/performance/operation-scorecard",
  operationsTrends: "/performance/operation-scorecard-trends",
  financialModeling: "/performance/financial-modeling-sandbox",
};

export function Navigation(
  {
    onMenuToggle,
    menuOpen,
    onSectionClick,
  }: NavigationProps = {} as NavigationProps,
) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Global channel selection from store
  const { selectedChannel, setSelectedChannel } = useChannelStore();

  // Global tenant selection from store (for super_admin viewing other tenants)
  const { selectedTenantId, setSelectedTenantId } = useTenantStore();

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
  const [topTieringSubOpen, setTopTieringSubOpen] = useState(false);
  const [allPagesOpen, setAllPagesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const insightsRef = useRef<HTMLDivElement>(null);
  const topTieringRef = useRef<HTMLDivElement>(null);
  const allPagesRef = useRef<HTMLDivElement>(null);
  const insightsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const topTieringTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const topTieringAutoCloseRef = useRef<NodeJS.Timeout | null>(null);
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
      aletheiaInsights: "aletheiaInsights",
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

  const isInsightsPage = location.pathname === "/insights";
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const isActive = (path: string) => location.pathname === path;

  // Check if current page is a TopTiering page
  const isTopTieringPage = useMemo(() => {
    const topTieringRoutes = [
      "/loan-funnel",
      "/credit-risk-management",
      "/company-scorecard",
      "/performance/toptiering-comparison",
      "/workflow-conversion",
      "/pipeline-analysis",
      "/loan-detail",
      "/high-performers",
      "/sales-scorecard",
      "/sales-trends",
      "/performance/operation-scorecard",
      "/performance/operation-scorecard-trends",
      "/performance/financial-modeling-sandbox",
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
      const currentRoute = location.pathname;
      const entry = Object.entries(routeMap).find(
        ([_, route]) => route === currentRoute,
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
    if (location.pathname === "/cohi-chat") return "Cohi Chat";
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
                Core Analytics
              </div>
              <div className="space-y-1">
                {topTieringMenuGroups.coreAnalytics.items.map((item) => {
                  const Icon = item.icon;
                  const itemRoute = routeMap[item.id];
                  const isItemActive =
                    itemRoute && location.pathname === itemRoute;
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
                    itemRoute && location.pathname === itemRoute;
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
                    itemRoute && location.pathname === itemRoute;
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
                    itemRoute && location.pathname === itemRoute;
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
          </div>
        </div>

        {/* My Workbench */}
        <div>
          <button
            onClick={() => {
              navigate("/my-dashboard");
              setMobileMenuOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              isActive("/my-dashboard")
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
            )}
            data-track="nav_workbench"
          >
            <LayoutPanelLeft className="w-4 h-4 flex-shrink-0" />
            <span>My Workbench</span>
          </button>
        </div>

        {/* Research Lab */}
        <div>
          <button
            data-track="nav_research"
            onClick={() => {
              navigate("/research");
              setMobileMenuOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              isActive("/research")
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
            )}
          >
            <FlaskConical className="w-4 h-4 flex-shrink-0" />
            <span>Research Lab</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200/50 bg-white/80 backdrop-blur-xl dark:border-slate-800/50 dark:bg-slate-950/70"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-3">
          {/* Left: Logo */}
          <div className="flex items-center min-w-0">
            <Link
              to="/"
              data-track="nav_home"
              className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:opacity-90 transition-opacity"
              aria-label="Go to home page"
            >
              <CoheusLogo className="h-9 sm:h-10 md:h-11" height={44} />
            </Link>
          </div>

          {/* Center: Main Navigation with Dropdowns (Desktop) - matches feb1cohi */}
          {isAuthenticated && (
            <div className="hidden lg:flex flex-1 justify-center items-center gap-2">
              {/* Insights Dropdown */}
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
                              section.id === "aletheiaInsights"
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

              {/* Top Tiering Dropdown */}
              <div
                ref={topTieringRef}
                className="relative"
                onMouseEnter={() => {
                  if (topTieringTimeoutRef.current)
                    clearTimeout(topTieringTimeoutRef.current);
                  if (topTieringAutoCloseRef.current)
                    clearTimeout(topTieringAutoCloseRef.current);
                  setTopTieringSubOpen(true);
                  setTopTieringOpen(true);
                  topTieringAutoCloseRef.current = setTimeout(() => {
                    topTieringAutoCloseRef.current = null;
                    setTopTieringOpen(false);
                  }, 6000);
                }}
                onMouseLeave={() => {
                  if (topTieringAutoCloseRef.current)
                    clearTimeout(topTieringAutoCloseRef.current);
                  topTieringAutoCloseRef.current = null;
                  topTieringTimeoutRef.current = setTimeout(
                    () => setTopTieringOpen(false),
                    150,
                  );
                }}
              >
                <button
                  onClick={() => {
                    if (!isTopTieringPage) {
                      navigate("/loan-funnel");
                    } else {
                      const next = !topTieringOpen;
                      if (next) {
                        if (topTieringAutoCloseRef.current)
                          clearTimeout(topTieringAutoCloseRef.current);
                        setTopTieringSubOpen(true);
                        setTopTieringOpen(true);
                        topTieringAutoCloseRef.current = setTimeout(() => {
                          topTieringAutoCloseRef.current = null;
                          setTopTieringOpen(false);
                        }, 6000);
                      } else {
                        if (topTieringAutoCloseRef.current)
                          clearTimeout(topTieringAutoCloseRef.current);
                        topTieringAutoCloseRef.current = null;
                        setTopTieringOpen(false);
                      }
                    }
                  }}
                  onKeyDown={(e) => handleKeyDown(e, "toptiering")}
                  aria-haspopup="true"
                  aria-expanded={topTieringOpen}
                  aria-label="Dashboard menu"
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
                  <span>Dashboard</span>
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
                      ref={topTieringMenuRef}
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full left-0 mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden z-50 min-w-[280px] sm:min-w-[360px] lg:min-w-[480px] backdrop-blur-sm"
                      role="menu"
                      aria-label="Dashboard submenu"
                    >
                      <div className="p-5 space-y-5">
                        {/* Dashboard - main category */}
                        <div>
                          <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <div className="w-1 h-4 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full" />
                            Dashboard
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              {
                                id: "leaderboard",
                                label: "Leaderboard",
                                icon: Trophy,
                                hash: "#section-leaderboard",
                                iconColor: "amber" as const,
                              },
                              {
                                id: "executiveDashboard",
                                label: "Business Overview",
                                icon: Target,
                                hash: "#section-executiveDashboard",
                                iconColor: "blue" as const,
                              },
                              {
                                id: "closingFalloutForecast",
                                label: "Closing & Fallout Forecast",
                                icon: BarChart3,
                                hash: "#section-closingFalloutForecast",
                                iconColor: "indigo" as const,
                              },
                            ].map((item) => {
                              const Icon = item.icon;
                              const style =
                                iconStyleMap[item.iconColor] ||
                                iconStyleMap.blue;
                              const itemRoute =
                                (item as { route?: string }).route ??
                                (item.hash
                                  ? `/insights${item.hash}`
                                  : routeMap[item.id]);
                              const isItemActive = itemRoute
                                ? location.pathname ===
                                    itemRoute.split("#")[0] &&
                                  (itemRoute.includes("#")
                                    ? location.hash === `#section-${item.id}`
                                    : true)
                                : false;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => {
                                    if (item.hash) {
                                      scrollToSection(item.id);
                                    } else {
                                      handleTopTieringClick(
                                        item.id,
                                        (item as { route?: string }).route,
                                      );
                                    }
                                  }}
                                  className={cn(
                                    dropdownItemBase,
                                    isItemActive
                                      ? dropdownItemActive
                                      : dropdownItemDefault,
                                  )}
                                  role="menuitem"
                                >
                                  <div
                                    className={cn(
                                      "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300",
                                      style.bg,
                                      isItemActive &&
                                        "ring-1 ring-emerald-400/50",
                                    )}
                                  >
                                    <Icon
                                      className={cn(
                                        "w-4 h-4",
                                        style.icon,
                                        isItemActive && "scale-110",
                                      )}
                                    />
                                  </div>
                                  <span className="whitespace-nowrap text-left">
                                    {item.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Top Tiering Submenu */}
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              setTopTieringSubOpen((prev) => !prev)
                            }
                            className={cn(
                              dropdownItemBase,
                              topTieringSubOpen
                                ? dropdownItemActive
                                : dropdownItemDefault,
                              "w-full justify-between",
                            )}
                          >
                            <span className="flex items-center gap-2.5">
                              <ArrowLeftRight className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                              Top Tiering
                            </span>
                            <ChevronDown
                              className={cn(
                                "w-4 h-4 transition-transform",
                                topTieringSubOpen && "rotate-180",
                              )}
                            />
                          </button>

                          {topTieringSubOpen && (
                            <div className="mt-3 space-y-5">
                              <div>
                                <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                  <div className="w-1 h-4 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full" />
                                  Core Analytics
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {topTieringMenuGroups.coreAnalytics.items.map(
                                    (item) => {
                                      const Icon = item.icon;
                                      const style =
                                        iconStyleMap[item.iconColor] ||
                                        iconStyleMap.blue;
                                      const itemRoute = routeMap[item.id];
                                      const isItemActive =
                                        itemRoute &&
                                        location.pathname === itemRoute;
                                      return (
                                        <button
                                          key={item.id}
                                          onClick={() =>
                                            handleTopTieringClick(item.id)
                                          }
                                          className={cn(
                                            dropdownItemBase,
                                            isItemActive
                                              ? dropdownItemActive
                                              : dropdownItemDefault,
                                          )}
                                          role="menuitem"
                                        >
                                          <div
                                            className={cn(
                                              "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300",
                                              style.bg,
                                              isItemActive &&
                                                "ring-1 ring-emerald-400/50",
                                            )}
                                          >
                                            <Icon
                                              className={cn(
                                                "w-4 h-4",
                                                style.icon,
                                                isItemActive && "scale-110",
                                              )}
                                            />
                                          </div>
                                          <span className="whitespace-nowrap text-left">
                                            {item.label}
                                          </span>
                                        </button>
                                      );
                                    },
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200/80 dark:border-slate-700/80">
                                <div>
                                  <div className="flex items-center gap-2 mb-3 px-2">
                                    <Users className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                      Sales
                                    </div>
                                  </div>
                                  <div className="space-y-1.5">
                                    {topTieringMenuGroups.sales.items.map(
                                      (item) => {
                                        const Icon = item.icon;
                                        const style =
                                          iconStyleMap[item.iconColor] ||
                                          iconStyleMap.blue;
                                        const itemRoute = routeMap[item.id];
                                        const isItemActive =
                                          itemRoute &&
                                          location.pathname === itemRoute;
                                        return (
                                          <button
                                            key={item.id}
                                            onClick={() =>
                                              handleTopTieringClick(item.id)
                                            }
                                            className={cn(
                                              dropdownItemBase,
                                              isItemActive
                                                ? dropdownItemActive
                                                : dropdownItemDefault,
                                            )}
                                            role="menuitem"
                                          >
                                            <div
                                              className={cn(
                                                "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300",
                                                style.bg,
                                                isItemActive &&
                                                  "ring-1 ring-emerald-400/50",
                                              )}
                                            >
                                              <Icon
                                                className={cn(
                                                  "w-3.5 h-3.5",
                                                  style.icon,
                                                  isItemActive && "scale-110",
                                                )}
                                              />
                                            </div>
                                            <span className="whitespace-nowrap">
                                              {item.label}
                                            </span>
                                          </button>
                                        );
                                      },
                                    )}
                                  </div>
                                </div>

                                <div>
                                  <div className="flex items-center gap-2 mb-3 px-2">
                                    <Settings className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                      Operations
                                    </div>
                                  </div>
                                  <div className="space-y-1.5">
                                    {topTieringMenuGroups.operations.items.map(
                                      (item) => {
                                        const Icon = item.icon;
                                        const style =
                                          iconStyleMap[item.iconColor] ||
                                          iconStyleMap.blue;
                                        const itemRoute = routeMap[item.id];
                                        const isItemActive =
                                          itemRoute &&
                                          location.pathname === itemRoute;
                                        return (
                                          <button
                                            key={item.id}
                                            onClick={() =>
                                              handleTopTieringClick(item.id)
                                            }
                                            className={cn(
                                              dropdownItemBase,
                                              isItemActive
                                                ? dropdownItemActive
                                                : dropdownItemDefault,
                                            )}
                                            role="menuitem"
                                          >
                                            <div
                                              className={cn(
                                                "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300",
                                                style.bg,
                                                isItemActive &&
                                                  "ring-1 ring-emerald-400/50",
                                              )}
                                            >
                                              <Icon
                                                className={cn(
                                                  "w-3.5 h-3.5",
                                                  style.icon,
                                                  isItemActive && "scale-110",
                                                )}
                                              />
                                            </div>
                                            <span className="whitespace-nowrap">
                                              {item.label}
                                            </span>
                                          </button>
                                        );
                                      },
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="pt-3 border-t border-slate-200/80 dark:border-slate-700/80">
                                <div className="flex items-center gap-2 mb-3 px-2">
                                  <Calculator className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Financial Modeling
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  {topTieringMenuGroups.performance.items.map(
                                    (item) => {
                                      const Icon = item.icon;
                                      const style =
                                        iconStyleMap[item.iconColor] ||
                                        iconStyleMap.blue;
                                      const itemRoute = routeMap[item.id];
                                      const isItemActive =
                                        itemRoute &&
                                        location.pathname === itemRoute;
                                      return (
                                        <button
                                          key={item.id}
                                          onClick={() =>
                                            handleTopTieringClick(item.id)
                                          }
                                          className={cn(
                                            dropdownItemBase,
                                            isItemActive
                                              ? dropdownItemActive
                                              : dropdownItemDefault,
                                          )}
                                          role="menuitem"
                                        >
                                          <div
                                            className={cn(
                                              "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300",
                                              style.bg,
                                              isItemActive &&
                                                "ring-1 ring-emerald-400/50",
                                            )}
                                          >
                                            <Icon
                                              className={cn(
                                                "w-3.5 h-3.5",
                                                style.icon,
                                                isItemActive && "scale-110",
                                              )}
                                            />
                                          </div>
                                          <span className="whitespace-nowrap">
                                            {item.label}
                                          </span>
                                        </button>
                                      );
                                    },
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Divider */}
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

              {/* My Workbench - Direct Navigation */}
              <button
                onClick={() => navigate("/my-dashboard")}
                className={cn(
                  topNavPillBase,
                  isActive("/my-dashboard")
                    ? topNavPillActive
                    : topNavPillDefault,
                )}
                aria-label="My Workbench"
              >
                <Grid3X3
                  className={cn(
                    "w-4 h-4 transition-colors duration-200",
                    isActive("/my-dashboard")
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200",
                  )}
                />
                <span>My Workbench</span>
              </button>

              {/* Research Lab - Direct Navigation */}
              <button
                onClick={() => navigate("/research")}
                className={cn(
                  topNavPillBase,
                  isActive("/research") ? topNavPillActive : topNavPillDefault,
                )}
                aria-label="Research Lab"
              >
                <FlaskConical
                  className={cn(
                    "w-4 h-4 transition-colors duration-200",
                    isActive("/research")
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200",
                  )}
                />
                <span>Research Lab</span>
              </button>
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg"
                  onClick={() => navigate("/help")}
                  aria-label="Help center"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
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

            <ThemeIconToggle />

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

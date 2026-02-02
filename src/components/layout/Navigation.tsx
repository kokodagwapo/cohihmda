import { Button } from "@/components/ui/button";
import { CoheusLogo } from "@/components/ui/CoheusLogo";
import { ThemeIconToggle } from "@/components/theme-icon-toggle";
import { UserMenu } from "@/components/layout/UserMenu";
import { useAuth } from "@/contexts/AuthContext";
import { Menu, X, TrendingUp, LayoutGrid, LayoutDashboard, ChevronDown, Zap, Newspaper, Trophy, Target, BarChart3, Filter, ClipboardList, ArrowLeftRight, Users, Settings, Calculator, LineChart, Shield, Sparkles, Building2, Grid3X3 } from "lucide-react";
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ChannelSelector } from "@/components/dashboard/ChannelSelector";
import { TenantSelector } from "@/components/dashboard/TenantSelector";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";

export interface NavigationProps {
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  onSectionClick?: (sectionId: string) => void;
}

// Dashboard section configuration (matching ReportsSidebar)
const dashboardSectionsConfig = [
  { id: 'aletheiaInsights', label: 'Cohi Daily Briefings', icon: Zap },
  { id: 'industryNews', label: 'Mortgage News', icon: Newspaper },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'executiveDashboard', label: 'Business Overview', icon: Target },
  { id: 'closingFalloutForecast', label: 'Closing & Fallout Forecast', icon: BarChart3 },
];

// Reorganized Top Tiering menu structure with better grouping (iconColor matches sidemenu)
const topTieringMenuGroups = {
  coreAnalytics: {
    label: 'TopTiering',
    items: [
      { id: 'loanFunnel', label: 'Loan Funnel', icon: Filter, iconColor: 'blue' as const },
      { id: 'topTieringComparison', label: 'TopTiering Comparison', icon: ArrowLeftRight, iconColor: 'blue' as const },
      { id: 'creditRiskManagement', label: 'Credit Risk Management', icon: Shield, iconColor: 'emerald' as const },
      { id: 'companyScorecard', label: 'Company Scorecard', icon: ClipboardList, iconColor: 'indigo' as const },
    ]
  },
  performance: {
    label: 'Financial Modeling',
    items: [
      { id: 'financialModeling', label: 'Financial Modeling Sandbox', icon: Calculator, iconColor: 'blue' as const },
    ]
  },
  sales: {
    label: 'Sales',
    icon: Users,
    items: [
      { id: 'salesScorecard', label: 'Scorecard', icon: Target, iconColor: 'blue' as const },
      { id: 'salesTrends', label: 'Trends', icon: TrendingUp, iconColor: 'emerald' as const },
    ]
  },
  operations: {
    label: 'Operations',
    icon: Settings,
    items: [
      { id: 'operationsScorecard', label: 'Scorecard', icon: Target, iconColor: 'blue' as const },
      { id: 'operationsTrends', label: 'Trends', icon: LineChart, iconColor: 'indigo' as const },
    ]
  },
};

// Icon colors matching sidemenu – bg tint + icon color
const iconStyleMap: Record<string, { bg: string; icon: string }> = {
  amber: { bg: 'bg-amber-500/10 dark:bg-amber-500/20', icon: 'text-amber-500 dark:text-amber-400' },
  blue: { bg: 'bg-blue-500/10 dark:bg-blue-500/20', icon: 'text-blue-500 dark:text-blue-400' },
  indigo: { bg: 'bg-indigo-500/10 dark:bg-indigo-500/20', icon: 'text-indigo-500 dark:text-indigo-400' },
  emerald: { bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', icon: 'text-emerald-500 dark:text-emerald-400' },
};

// Route mapping for navigation
const routeMap: Record<string, string> = {
  'loanFunnel': '/loan-funnel',
  'creditRiskManagement': '/credit-risk-management',
  'companyScorecard': '/company-scorecard',
  'topTieringComparison': '/performance/toptiering-comparison',
  'salesScorecard': '/sales-scorecard',
  'salesTrends': '/sales-trends',
  'operationsScorecard': '/performance/operation-scorecard',
  'operationsTrends': '/performance/operation-scorecard-trends',
  'financialModeling': '/performance/financial-modeling-sandbox',
};

export function Navigation({ onMenuToggle, menuOpen, onSectionClick }: NavigationProps = {} as NavigationProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [displayName, setDisplayName] = useState<string | null>(null);
  
  // Global channel selection from store
  const { selectedChannel, setSelectedChannel } = useChannelStore();
  
  // Global tenant selection from store (for super_admin viewing other tenants)
  const { selectedTenantId, setSelectedTenantId } = useTenantStore();
  
  // Check if user is a platform admin (can view other tenants)
  const isPlatformAdmin = user?.role === 'super_admin' || user?.role === 'platform_admin';
  
  const isDashboard = location.pathname === '/insights';
  const isWorkbench = location.pathname === '/my-dashboard' || location.pathname.startsWith('/workbench');
  const isAdminPage = location.pathname.startsWith('/admin');

  // Dropdown state
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [topTieringOpen, setTopTieringOpen] = useState(false);
  const [allPagesOpen, setAllPagesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const insightsRef = useRef<HTMLDivElement>(null);
  const topTieringRef = useRef<HTMLDivElement>(null);
  const allPagesRef = useRef<HTMLDivElement>(null);
  const insightsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const topTieringTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
      const capitalizedName = emailPrefix ? emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1) : "";
      setDisplayName(capitalizedName || null);
    } else {
      setDisplayName(null);
    }
  }, [user]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (insightsRef.current && !insightsRef.current.contains(event.target as Node)) {
        setInsightsOpen(false);
        setFocusedIndex(-1);
      }
      if (topTieringRef.current && !topTieringRef.current.contains(event.target as Node)) {
        setTopTieringOpen(false);
        setFocusedIndex(-1);
      }
      if (allPagesRef.current && !allPagesRef.current.contains(event.target as Node)) {
        setAllPagesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent, menuType: 'insights' | 'toptiering') => {
    if (menuType === 'insights' && !insightsOpen) return;
    if (menuType === 'toptiering' && !topTieringOpen) return;

    const items = menuType === 'insights' 
      ? dashboardSectionsConfig 
      : Object.values(topTieringMenuGroups).flatMap(group => 
          group.items.map(item => ({ ...item, groupId: group.label }))
        );

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => (prev < items.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => (prev > 0 ? prev - 1 : items.length - 1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < items.length) {
          const item = items[focusedIndex];
          if (menuType === 'insights') {
            scrollToSection(item.id);
          } else {
            handleTopTieringClick(item.id);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (menuType === 'insights') {
          setInsightsOpen(false);
        } else {
          setTopTieringOpen(false);
        }
        setFocusedIndex(-1);
        break;
    }
  }, [insightsOpen, topTieringOpen, focusedIndex]);

  const handleLogout = async () => {
    await logout();
    
    // Redirect to admin login if logging out from admin page
    if (isAdminPage) {
      navigate('/login?returnTo=/admin');
    } else {
      navigate('/');
    }
  };

  // Map section IDs to actual HTML element IDs
  const getSectionElementId = (sectionId: string): string => {
    const sectionIdMap: Record<string, string> = {
      'aletheiaInsights': 'aletheiaInsights',
      'industryNews': 'industryNews',
      'leaderboard': 'leaderboard',
      'executiveDashboard': 'executiveDashboard',
      'closingFalloutForecast': 'closingFalloutForecast',
    };
    return sectionIdMap[sectionId] || `section-${sectionId}`;
  };

  const scrollToSection = (sectionId: string) => {
    const elementId = getSectionElementId(sectionId);
    
    if (location.pathname !== '/insights') {
      navigate('/insights');
      setTimeout(() => {
        const scrollToElement = () => {
          const element = document.getElementById(elementId);
          if (element) {
            const headerOffset = 80;
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
            window.scrollTo({
              top: offsetPosition,
              behavior: 'smooth'
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
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
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

  const isInsightsPage = location.pathname === '/insights';
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const isActive = (path: string) => location.pathname === path;
  
  // Check if current page is a TopTiering page
  const isTopTieringPage = useMemo(() => {
    const topTieringRoutes = [
      '/loan-funnel',
      '/credit-risk-management',
      '/company-scorecard',
      '/performance/toptiering-comparison',
      '/sales-scorecard',
      '/sales-trends',
      '/performance/operation-scorecard',
      '/performance/operation-scorecard-trends',
      '/performance/financial-modeling-sandbox',
    ];
    return topTieringRoutes.some(route => location.pathname === route || location.pathname.startsWith(route));
  }, [location.pathname]);

  // Get current page label for mobile
  const getCurrentPageLabel = () => {
    if (isInsightsPage) return 'Insights';
    if (isTopTieringPage) {
      const currentRoute = location.pathname;
      const entry = Object.entries(routeMap).find(([_, route]) => route === currentRoute);
      if (entry) {
        const [itemId] = entry;
        for (const group of Object.values(topTieringMenuGroups)) {
          const item = group.items.find(i => i.id === itemId);
          if (item) return item.label;
        }
      }
      return 'Top Tiering';
    }
    if (location.pathname === '/my-dashboard') return 'My Workbench';
    if (location.pathname === '/data-chat') return 'Data Chat';
    return 'Navigation';
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
            {dashboardSectionsConfig.map((section) => {
              const Icon = section.icon;
              const isSectionActive = isInsightsPage && location.hash === `#section-${section.id}`;
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
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  const isItemActive = itemRoute && location.pathname === itemRoute;
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
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  const isItemActive = itemRoute && location.pathname === itemRoute;
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
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  const isItemActive = itemRoute && location.pathname === itemRoute;
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
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  const isItemActive = itemRoute && location.pathname === itemRoute;
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
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
              navigate('/my-dashboard');
              setMobileMenuOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              isActive('/my-dashboard')
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            )}
          >
            <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
            <span>My Workbench</span>
          </button>
        </div>

        {/* Data Chat */}
        <div>
          <button
            onClick={() => {
              navigate('/data-chat');
              setMobileMenuOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              isActive('/data-chat')
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            )}
          >
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            <span>Data Chat</span>
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
              className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:opacity-90 transition-opacity"
              aria-label="Go to home page"
            >
              <CoheusLogo className="h-9 sm:h-10 md:h-11" height={44} />
            </Link>
          </div>

          {/* Center: Main Navigation with Dropdowns (Desktop) */}
          {isAuthenticated && (
            <div className="hidden lg:flex flex-1 justify-center items-center gap-2">
              {/* Insights Dropdown */}
              <div 
                ref={insightsRef}
                className="relative"
                onMouseEnter={() => {
                  if (insightsTimeoutRef.current) clearTimeout(insightsTimeoutRef.current);
                  setInsightsOpen(true);
                }}
                onMouseLeave={() => {
                  insightsTimeoutRef.current = setTimeout(() => setInsightsOpen(false), 150);
                }}
              >
                <button
                  onClick={() => {
                    if (!isInsightsPage) {
                      navigate('/insights');
                    } else {
                      setInsightsOpen(!insightsOpen);
                    }
                  }}
                  onKeyDown={(e) => handleKeyDown(e, 'insights')}
                  aria-haspopup="true"
                  aria-expanded={insightsOpen}
                  aria-label="Insights menu"
                  className={cn(
                    "relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 group",
                    (insightsOpen || isInsightsPage)
                      ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30 dark:shadow-blue-500/20 scale-105"
                      : "text-slate-700 dark:text-slate-300 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 dark:hover:from-blue-950/30 dark:hover:to-indigo-950/30 hover:text-blue-700 dark:hover:text-blue-400 hover:shadow-md hover:shadow-blue-500/10 dark:hover:shadow-blue-500/5"
                  )}
                >
                  <LayoutGrid className={cn(
                    "w-4 h-4 transition-all duration-300",
                    (insightsOpen || isInsightsPage) 
                      ? "text-white" 
                      : "text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:scale-110"
                  )} />
                  <span>Insights</span>
                  <ChevronDown className={cn(
                    "w-3.5 h-3.5 transition-all duration-300",
                    insightsOpen && "rotate-180",
                    (insightsOpen || isInsightsPage) 
                      ? "text-white" 
                      : "text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-400"
                  )} />
                  {(insightsOpen || isInsightsPage) && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-white/80 shadow-lg" />
                  )}
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
                          {dashboardSectionsConfig.map((section, index) => {
                            const Icon = section.icon;
                            const isSectionActive = isInsightsPage && location.hash === `#section-${section.id}`;
                            const isFocused = focusedIndex === index;
                            return (
                              <button
                                key={section.id}
                                onClick={() => scrollToSection(section.id)}
                                onFocus={() => setFocusedIndex(index)}
                                className={cn(
                                  "flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                  isSectionActive
                                    ? "text-blue-700 dark:text-blue-300 bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 dark:from-blue-950/40 dark:via-indigo-950/40 dark:to-blue-950/40 border-blue-300 dark:border-blue-700 shadow-md shadow-blue-500/20 dark:shadow-blue-500/10 scale-[1.02]"
                                    : isFocused
                                    ? "text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 shadow-sm"
                                    : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 dark:hover:from-blue-950/30 dark:hover:to-indigo-950/30 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-md hover:shadow-blue-500/10 dark:hover:shadow-blue-500/5 hover:scale-[1.01] border-transparent"
                                )}
                                role="menuitem"
                              >
                                <Icon className={cn(
                                  "w-4 h-4 flex-shrink-0 transition-all duration-300",
                                  isSectionActive 
                                    ? "text-blue-600 dark:text-blue-400 scale-110" 
                                    : "text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:scale-110"
                                )} />
                                <span className="whitespace-nowrap text-left">{section.label}</span>
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
                  if (topTieringTimeoutRef.current) clearTimeout(topTieringTimeoutRef.current);
                  setTopTieringOpen(true);
                }}
                onMouseLeave={() => {
                  topTieringTimeoutRef.current = setTimeout(() => setTopTieringOpen(false), 150);
                }}
              >
                <button
                  onClick={() => {
                    if (!isTopTieringPage) {
                      navigate('/loan-funnel');
                    } else {
                      setTopTieringOpen(!topTieringOpen);
                    }
                  }}
                  onKeyDown={(e) => handleKeyDown(e, 'toptiering')}
                  aria-haspopup="true"
                  aria-expanded={topTieringOpen}
                  aria-label="Dashboard menu"
                  className={cn(
                    "relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 group",
                    (topTieringOpen || isTopTieringPage)
                      ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 dark:shadow-emerald-500/20 scale-105"
                      : "text-slate-700 dark:text-slate-300 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50 dark:hover:from-emerald-950/30 dark:hover:to-teal-950/30 hover:text-emerald-700 dark:hover:text-emerald-400 hover:shadow-md hover:shadow-emerald-500/10 dark:hover:shadow-emerald-500/5"
                  )}
                >
                  <TrendingUp className={cn(
                    "w-4 h-4 transition-all duration-300",
                    (topTieringOpen || isTopTieringPage) 
                      ? "text-white" 
                      : "text-slate-500 dark:text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:scale-110"
                  )} />
                  <span>Dashboard</span>
                  <ChevronDown className={cn(
                    "w-3.5 h-3.5 transition-all duration-300",
                    topTieringOpen && "rotate-180",
                    (topTieringOpen || isTopTieringPage) 
                      ? "text-white" 
                      : "text-slate-400 dark:text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400"
                  )} />
                  {(topTieringOpen || isTopTieringPage) && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-white/80 shadow-lg" />
                  )}
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
                        {/* Dashboard Section - Links to Insights page sections */}
                        <div>
                          <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <div className="w-1 h-4 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full" />
                            Dashboard
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { id: 'leaderboard', label: 'Leaderboard', icon: Trophy, hash: '#section-leaderboard', iconColor: 'amber' as const },
                              { id: 'executiveDashboard', label: 'Business Overview', icon: Target, hash: '#section-executiveDashboard', iconColor: 'blue' as const },
                              { id: 'topTieringLink', label: 'Top Tiering', icon: ArrowLeftRight, iconColor: 'blue' as const, route: '/loan-funnel' },
                              { id: 'closingFalloutForecast', label: 'Closing & Fallout Forecast', icon: BarChart3, hash: '#section-closingFalloutForecast', iconColor: 'indigo' as const },
                            ].map((item) => {
                              const Icon = item.icon;
                              const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                              const itemRoute = (item as { route?: string }).route ?? (item.hash ? `/insights${item.hash}` : routeMap[item.id]);
                              const isItemActive = itemRoute
                                ? location.pathname === itemRoute.split('#')[0] &&
                                  (itemRoute.includes('#') ? location.hash === `#section-${item.id}` : true)
                                : false;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => {
                                    if (item.hash) {
                                      scrollToSection(item.id);
                                    } else {
                                      handleTopTieringClick(item.id, (item as { route?: string }).route);
                                    }
                                  }}
                                  className={cn(
                                    "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                    isItemActive
                                      ? "text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-50 via-emerald-50 to-emerald-50 dark:from-emerald-950/40 dark:via-emerald-950/40 dark:to-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-md shadow-emerald-500/20 dark:shadow-emerald-500/10 scale-[1.02]"
                                      : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-blue-50 hover:via-indigo-50 hover:to-blue-50 dark:hover:from-blue-950/30 dark:hover:via-indigo-950/30 dark:hover:to-blue-950/30 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-md hover:shadow-blue-500/10 dark:hover:shadow-blue-500/5 hover:scale-[1.01] border-transparent"
                                  )}
                                  role="menuitem"
                                >
                                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                    <Icon className={cn("w-4 h-4", style.icon, isItemActive && "scale-110")} />
                                  </div>
                                  <span className="whitespace-nowrap text-left">{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Top Tiering Section */}
                        <div>
                          <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <div className="w-1 h-4 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full" />
                            Top Tiering
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {topTieringMenuGroups.coreAnalytics.items.map((item) => {
                              const Icon = item.icon;
                              const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                              const itemRoute = routeMap[item.id];
                              const isItemActive = itemRoute && location.pathname === itemRoute;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleTopTieringClick(item.id)}
                                  className={cn(
                                    "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                    isItemActive
                                      ? "text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-50 via-emerald-50 to-emerald-50 dark:from-emerald-950/40 dark:via-emerald-950/40 dark:to-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-md shadow-emerald-500/20 dark:shadow-emerald-500/10 scale-[1.02]"
                                      : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-blue-50 hover:via-indigo-50 hover:to-blue-50 dark:hover:from-blue-950/30 dark:hover:via-indigo-950/30 dark:hover:to-blue-950/30 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-md hover:shadow-blue-500/10 dark:hover:shadow-blue-500/5 hover:scale-[1.01] border-transparent"
                                  )}
                                  role="menuitem"
                                >
                                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                    <Icon className={cn("w-4 h-4", style.icon, isItemActive && "scale-110")} />
                                  </div>
                                  <span className="whitespace-nowrap text-left">{item.label}</span>
                                </button>
                              );
                            })}
                          </div>

                          {/* Sales & Operations */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 mt-3 border-t border-slate-200/80 dark:border-slate-700/80">
                            {/* Sales */}
                            <div>
                              <div className="flex items-center gap-2 mb-3 px-2">
                                <Users className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                  Sales
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                {topTieringMenuGroups.sales.items.map((item) => {
                                  const Icon = item.icon;
                                  const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                                  const itemRoute = routeMap[item.id];
                                  const isItemActive = itemRoute && location.pathname === itemRoute;
                                  return (
                                    <button
                                      key={item.id}
                                      onClick={() => handleTopTieringClick(item.id)}
                                      className={cn(
                                        "w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                        isItemActive
                                          ? "text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-50 via-emerald-50 to-emerald-50 dark:from-emerald-950/40 dark:via-emerald-950/40 dark:to-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-md shadow-emerald-500/20 dark:shadow-emerald-500/10 scale-[1.02]"
                                          : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-blue-50 hover:via-indigo-50 hover:to-blue-50 dark:hover:from-blue-950/30 dark:hover:via-indigo-950/30 dark:hover:to-blue-950/30 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-md hover:shadow-blue-500/10 dark:hover:shadow-blue-500/5 hover:scale-[1.01] border-transparent"
                                      )}
                                      role="menuitem"
                                    >
                                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                        <Icon className={cn("w-3.5 h-3.5", style.icon, isItemActive && "scale-110")} />
                                      </div>
                                      <span className="whitespace-nowrap">{item.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Operations */}
                            <div>
                              <div className="flex items-center gap-2 mb-3 px-2">
                                <Settings className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                  Operations
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                {topTieringMenuGroups.operations.items.map((item) => {
                                  const Icon = item.icon;
                                  const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                                  const itemRoute = routeMap[item.id];
                                  const isItemActive = itemRoute && location.pathname === itemRoute;
                                  return (
                                    <button
                                      key={item.id}
                                      onClick={() => handleTopTieringClick(item.id)}
                                      className={cn(
                                        "w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                        isItemActive
                                          ? "text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-50 via-emerald-50 to-emerald-50 dark:from-emerald-950/40 dark:via-emerald-950/40 dark:to-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-md shadow-emerald-500/20 dark:shadow-emerald-500/10 scale-[1.02]"
                                          : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-blue-50 hover:via-indigo-50 hover:to-blue-50 dark:hover:from-blue-950/30 dark:hover:via-indigo-950/30 dark:hover:to-blue-950/30 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-md hover:shadow-blue-500/10 dark:hover:shadow-blue-500/5 hover:scale-[1.01] border-transparent"
                                      )}
                                      role="menuitem"
                                    >
                                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                        <Icon className={cn("w-3.5 h-3.5", style.icon, isItemActive && "scale-110")} />
                                      </div>
                                      <span className="whitespace-nowrap">{item.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* Financial Modeling */}
                          <div className="pt-3 mt-3 border-t border-slate-200/80 dark:border-slate-700/80">
                            <div className="flex items-center gap-2 mb-3 px-2">
                              <Calculator className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Financial Modeling
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              {topTieringMenuGroups.performance.items.map((item) => {
                                const Icon = item.icon;
                                const style = iconStyleMap[item.iconColor] || iconStyleMap.blue;
                                const itemRoute = routeMap[item.id];
                                const isItemActive = itemRoute && location.pathname === itemRoute;
                                return (
                                  <button
                                    key={item.id}
                                    onClick={() => handleTopTieringClick(item.id)}
                                    className={cn(
                                      "w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                      isItemActive
                                        ? "text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-50 via-emerald-50 to-emerald-50 dark:from-emerald-950/40 dark:via-emerald-950/40 dark:to-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-md shadow-emerald-500/20 dark:shadow-emerald-500/10 scale-[1.02]"
                                        : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-blue-50 hover:via-indigo-50 hover:to-blue-50 dark:hover:from-blue-950/30 dark:hover:via-indigo-950/30 dark:hover:to-blue-950/30 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-md hover:shadow-blue-500/10 dark:hover:shadow-blue-500/5 hover:scale-[1.01] border-transparent"
                                    )}
                                    role="menuitem"
                                  >
                                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300", style.bg, isItemActive && "ring-1 ring-emerald-400/50")}>
                                      <Icon className={cn("w-3.5 h-3.5", style.icon, isItemActive && "scale-110")} />
                                    </div>
                                    <span className="whitespace-nowrap">{item.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
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
                onClick={() => navigate('/my-dashboard')}
                onMouseEnter={() => setHoveredItem('my-workbench')}
                onMouseLeave={() => setHoveredItem(null)}
                className={cn(
                  "relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 group",
                  isActive('/my-dashboard')
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 dark:shadow-emerald-500/20 scale-105"
                    : "text-slate-700 dark:text-slate-300 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50 dark:hover:from-emerald-950/30 dark:hover:to-teal-950/30 hover:text-emerald-700 dark:hover:text-emerald-400 hover:shadow-md hover:shadow-emerald-500/10 dark:hover:shadow-emerald-500/5"
                )}
                aria-label="My Workbench"
              >
                <LayoutDashboard className={cn(
                  "w-4 h-4 transition-all duration-300",
                  isActive('/my-dashboard')
                    ? "text-white"
                    : "text-slate-500 dark:text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:scale-110"
                )} />
                <span>My Workbench</span>
                {isActive('/my-dashboard') && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-white/80 shadow-lg" />
                )}
              </button>

            </div>
          )}

          {/* Right: Actions */}
          <div className="ml-auto flex items-center gap-1.5">
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
              <div className="lg:hidden flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                  {getCurrentPageLabel()}
                </span>
              </div>
            )}

            {/* Tenant Selector - Compact in header (visible for admins) */}
            {isAuthenticated && !isAdminPage && (
              <div className="hidden md:flex items-center">
                <TenantSelector
                  selectedTenantId={selectedTenantId}
                  onTenantChange={setSelectedTenantId}
                  compact={true}
                />
              </div>
            )}

            {/* Channel Selector - Compact in header (hidden on admin pages) */}
            {isAuthenticated && !isAdminPage && (
              <div className="hidden lg:flex items-center">
                <ChannelSelector
                  selectedChannel={selectedChannel}
                  onChannelChange={setSelectedChannel}
                  selectedTenantId={selectedTenantId}
                  compact={true}
                  useChannelGroups={true}
                />
              </div>
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
                onClick={() => navigate('/login')}
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

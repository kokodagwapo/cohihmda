import { Button } from "@/components/ui/button";
import { CoheusLogo } from "@/components/ui/CoheusLogo";
import { ThemeIconToggle } from "@/components/theme-icon-toggle";
import { UserMenu } from "@/components/layout/UserMenu";
import { useAuth } from "@/contexts/AuthContext";
import { Menu, X, TrendingUp, LayoutGrid, LayoutDashboard, ChevronDown, Zap, Newspaper, Trophy, Target, BarChart3, Filter, ClipboardList, ArrowLeftRight, Users, Settings, Calculator, LineChart, Shield, Sparkles } from "lucide-react";
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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

// Reorganized Top Tiering menu structure with better grouping
const topTieringMenuGroups = {
  coreAnalytics: {
    label: 'Core Analytics',
    items: [
      { id: 'loanFunnel', label: 'Loan Funnel', icon: Filter },
      { id: 'creditRiskManagement', label: 'Credit Risk Management', icon: Shield },
      { id: 'companyScorecard', label: 'Company Scorecard', icon: ClipboardList },
    ]
  },
  performance: {
    label: 'Performance',
    items: [
      { id: 'topTieringComparison', label: 'TopTiering Comparison', icon: ArrowLeftRight },
      { id: 'financialModeling', label: 'Financial Modeling Sandbox', icon: Calculator },
    ]
  },
  sales: {
    label: 'Sales',
    icon: Users,
    items: [
      { id: 'salesScorecard', label: 'Scorecard', icon: Target },
      { id: 'salesTrends', label: 'Trends', icon: TrendingUp },
    ]
  },
  operations: {
    label: 'Operations',
    icon: Settings,
    items: [
      { id: 'operationsScorecard', label: 'Scorecard', icon: Target },
      { id: 'operationsTrends', label: 'Trends', icon: LineChart },
    ]
  },
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
  
  const isDashboard = location.pathname === '/insights';
  const isAdminPage = location.pathname.startsWith('/admin');

  // Dropdown state
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [topTieringOpen, setTopTieringOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const insightsRef = useRef<HTMLDivElement>(null);
  const topTieringRef = useRef<HTMLDivElement>(null);
  const insightsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const topTieringTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
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

  const handleTopTieringClick = (itemId: string) => {
    setTopTieringOpen(false);
    setFocusedIndex(-1);
    
    const route = routeMap[itemId];
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
                  aria-label="Top Tiering menu"
                  className={cn(
                    "relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 group",
                    (topTieringOpen || isTopTieringPage)
                      ? "bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-lg shadow-purple-500/30 dark:shadow-purple-500/20 scale-105"
                      : "text-slate-700 dark:text-slate-300 hover:bg-gradient-to-r hover:from-purple-50 hover:to-pink-50 dark:hover:from-purple-950/30 dark:hover:to-pink-950/30 hover:text-purple-700 dark:hover:text-purple-400 hover:shadow-md hover:shadow-purple-500/10 dark:hover:shadow-purple-500/5"
                  )}
                >
                  <TrendingUp className={cn(
                    "w-4 h-4 transition-all duration-300",
                    (topTieringOpen || isTopTieringPage) 
                      ? "text-white" 
                      : "text-slate-500 dark:text-slate-400 group-hover:text-purple-600 dark:group-hover:text-purple-400 group-hover:scale-110"
                  )} />
                  <span>Top Tiering</span>
                  <ChevronDown className={cn(
                    "w-3.5 h-3.5 transition-all duration-300",
                    topTieringOpen && "rotate-180",
                    (topTieringOpen || isTopTieringPage) 
                      ? "text-white" 
                      : "text-slate-400 dark:text-slate-500 group-hover:text-purple-600 dark:group-hover:text-purple-400"
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
                      className="absolute top-full left-0 mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden z-50 min-w-[480px] backdrop-blur-sm"
                      role="menu"
                      aria-label="Top Tiering submenu"
                    >
                      <div className="p-5 space-y-5">
                        {/* Core Analytics */}
                        <div>
                          <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <div className="w-1 h-4 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
                            Core Analytics
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {topTieringMenuGroups.coreAnalytics.items.map((item) => {
                              const Icon = item.icon;
                              const itemRoute = routeMap[item.id];
                              const isItemActive = itemRoute && location.pathname === itemRoute;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleTopTieringClick(item.id)}
                                  className={cn(
                                    "flex flex-col items-center gap-2.5 px-4 py-3.5 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                    isItemActive
                                      ? "text-purple-700 dark:text-purple-300 bg-gradient-to-br from-purple-50 via-pink-50 to-purple-50 dark:from-purple-950/40 dark:via-pink-950/40 dark:to-purple-950/40 border-purple-300 dark:border-purple-700 shadow-lg shadow-purple-500/20 dark:shadow-purple-500/10 scale-105"
                                      : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-br hover:from-purple-50 hover:via-pink-50 hover:to-purple-50 dark:hover:from-purple-950/30 dark:hover:via-pink-950/30 dark:hover:to-purple-950/30 hover:text-purple-700 dark:hover:text-purple-300 hover:border-purple-200 dark:hover:border-purple-800 hover:shadow-lg hover:shadow-purple-500/10 dark:hover:shadow-purple-500/5 hover:scale-105 border-transparent"
                                  )}
                                  role="menuitem"
                                >
                                  <Icon className={cn(
                                    "w-5 h-5 flex-shrink-0 transition-all duration-300",
                                    isItemActive 
                                      ? "text-purple-600 dark:text-purple-400 scale-110" 
                                      : "text-slate-500 dark:text-slate-400 group-hover:text-purple-600 dark:group-hover:text-purple-400 group-hover:scale-110"
                                  )} />
                                  <span className="text-xs text-center leading-tight font-medium">{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Performance */}
                        <div>
                          <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <div className="w-1 h-4 bg-gradient-to-b from-purple-500 to-pink-500 rounded-full" />
                            Performance
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {topTieringMenuGroups.performance.items.map((item) => {
                              const Icon = item.icon;
                              const itemRoute = routeMap[item.id];
                              const isItemActive = itemRoute && location.pathname === itemRoute;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleTopTieringClick(item.id)}
                                  className={cn(
                                    "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                    isItemActive
                                      ? "text-purple-700 dark:text-purple-300 bg-gradient-to-r from-purple-50 via-pink-50 to-purple-50 dark:from-purple-950/40 dark:via-pink-950/40 dark:to-purple-950/40 border-purple-300 dark:border-purple-700 shadow-md shadow-purple-500/20 dark:shadow-purple-500/10 scale-[1.02]"
                                      : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-purple-50 hover:via-pink-50 hover:to-purple-50 dark:hover:from-purple-950/30 dark:hover:via-pink-950/30 dark:hover:to-purple-950/30 hover:text-purple-700 dark:hover:text-purple-300 hover:border-purple-200 dark:hover:border-purple-800 hover:shadow-md hover:shadow-purple-500/10 dark:hover:shadow-purple-500/5 hover:scale-[1.01] border-transparent"
                                  )}
                                  role="menuitem"
                                >
                                  <Icon className={cn(
                                    "w-4 h-4 flex-shrink-0 transition-all duration-300",
                                    isItemActive 
                                      ? "text-purple-600 dark:text-purple-400 scale-110" 
                                      : "text-slate-500 dark:text-slate-400 group-hover:text-purple-600 dark:group-hover:text-purple-400 group-hover:scale-110"
                                  )} />
                                  <span className="whitespace-nowrap text-left">{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Sales & Operations */}
                        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200/80 dark:border-slate-700/80">
                          {/* Sales */}
                          <div>
                            <div className="flex items-center gap-2 mb-3 px-2">
                              <Users className="w-4 h-4 text-slate-400" />
                              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Sales
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              {topTieringMenuGroups.sales.items.map((item) => {
                                const Icon = item.icon;
                                const itemRoute = routeMap[item.id];
                                const isItemActive = itemRoute && location.pathname === itemRoute;
                                return (
                                  <button
                                    key={item.id}
                                    onClick={() => handleTopTieringClick(item.id)}
                                    className={cn(
                                      "w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                      isItemActive
                                        ? "text-purple-700 dark:text-purple-300 bg-gradient-to-r from-purple-50 via-pink-50 to-purple-50 dark:from-purple-950/40 dark:via-pink-950/40 dark:to-purple-950/40 border-purple-300 dark:border-purple-700 shadow-md shadow-purple-500/20 dark:shadow-purple-500/10 scale-[1.02]"
                                        : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-purple-50 hover:via-pink-50 hover:to-purple-50 dark:hover:from-purple-950/30 dark:hover:via-pink-950/30 dark:hover:to-purple-950/30 hover:text-purple-700 dark:hover:text-purple-300 hover:border-purple-200 dark:hover:border-purple-800 hover:shadow-md hover:shadow-purple-500/10 dark:hover:shadow-purple-500/5 hover:scale-[1.01] border-transparent"
                                    )}
                                    role="menuitem"
                                  >
                                    <Icon className={cn(
                                      "w-4 h-4 flex-shrink-0 transition-all duration-300",
                                      isItemActive 
                                        ? "text-purple-600 dark:text-purple-400 scale-110" 
                                        : "text-slate-500 dark:text-slate-400 group-hover:text-purple-600 dark:group-hover:text-purple-400 group-hover:scale-110"
                                    )} />
                                    <span className="whitespace-nowrap">{item.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Operations */}
                          <div>
                            <div className="flex items-center gap-2 mb-3 px-2">
                              <Settings className="w-4 h-4 text-slate-400" />
                              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Operations
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              {topTieringMenuGroups.operations.items.map((item) => {
                                const Icon = item.icon;
                                const itemRoute = routeMap[item.id];
                                const isItemActive = itemRoute && location.pathname === itemRoute;
                                return (
                                  <button
                                    key={item.id}
                                    onClick={() => handleTopTieringClick(item.id)}
                                    className={cn(
                                      "w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 border group relative overflow-hidden",
                                      isItemActive
                                        ? "text-purple-700 dark:text-purple-300 bg-gradient-to-r from-purple-50 via-pink-50 to-purple-50 dark:from-purple-950/40 dark:via-pink-950/40 dark:to-purple-950/40 border-purple-300 dark:border-purple-700 shadow-md shadow-purple-500/20 dark:shadow-purple-500/10 scale-[1.02]"
                                        : "text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-purple-50 hover:via-pink-50 hover:to-purple-50 dark:hover:from-purple-950/30 dark:hover:via-pink-950/30 dark:hover:to-purple-950/30 hover:text-purple-700 dark:hover:text-purple-300 hover:border-purple-200 dark:hover:border-purple-800 hover:shadow-md hover:shadow-purple-500/10 dark:hover:shadow-purple-500/5 hover:scale-[1.01] border-transparent"
                                    )}
                                    role="menuitem"
                                  >
                                    <Icon className={cn(
                                      "w-4 h-4 flex-shrink-0 transition-all duration-300",
                                      isItemActive 
                                        ? "text-purple-600 dark:text-purple-400 scale-110" 
                                        : "text-slate-500 dark:text-slate-400 group-hover:text-purple-600 dark:group-hover:text-purple-400 group-hover:scale-110"
                                    )} />
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

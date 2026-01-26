import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Zap, Newspaper, TrendingUp, BarChart3, Target, Check, GripVertical, Home, Trophy, X } from 'lucide-react';
import { getReportById, ReportData, allReports } from '@/data/reportSimulations';

export interface DashboardVisibility {
  executiveDashboard: boolean;
  industryNews: boolean;
  aletheiaInsights: boolean;
  leaderboard: boolean;
  topTiering: boolean;
  closingFalloutForecast: boolean;
  trends: boolean;
  forecasting: boolean;
  kpiReports: boolean;
}

export type SectionId = keyof DashboardVisibility;

interface ReportsSidebarProps {
  onReportClick: (report: ReportData) => void;
  visibility?: DashboardVisibility;
  onVisibilityChange?: (visibility: DashboardVisibility) => void;
  sectionOrder?: SectionId[];
  onSectionOrderChange?: (order: SectionId[]) => void;
  mobileMenuOpen?: boolean;
  onMobileMenuToggle?: () => void;
  onSectionClick?: (sectionId: string) => void;
}

// Complete realtime data for each report
interface ReportStats {
  primary: { value: string; label: string };
  secondary: { value: string; label: string };
  tertiary?: { value: string; label: string };
  trend: 'up' | 'down' | 'neutral';
  alert: boolean;
  alertMessage?: string;
}

const useRealtimeStats = () => {
  const [stats, setStats] = useState<Record<string, ReportStats>>({
    '1': { 
      primary: { value: '$1.28M', label: 'locked today' },
      secondary: { value: '42', label: 'loans' },
      tertiary: { value: '+8%', label: 'vs yesterday' },
      trend: 'up',
      alert: false 
    },
    '2': { 
      primary: { value: '3', label: 'loans at risk' },
      secondary: { value: '$892K', label: 'exposure' },
      tertiary: { value: '48hrs', label: 'to action' },
      trend: 'up',
      alert: true,
      alertMessage: 'FHA rate locks expiring'
    },
    '3': { 
      primary: { value: '65%', label: 'top tier revenue' },
      secondary: { value: '18', label: 'top performers' },
      tertiary: { value: '3', label: 'need coaching' },
      trend: 'up',
      alert: false 
    },
    '4': { 
      primary: { value: '2.1d', label: 'behind SLA' },
      secondary: { value: '8', label: 'files aging' },
      tertiary: { value: '2', label: 'processors overloaded' },
      trend: 'down',
      alert: true,
      alertMessage: 'Bottleneck in underwriting'
    },
    '5': { 
      primary: { value: '+12bps', label: 'vs market' },
      secondary: { value: '87', label: 'rate score' },
      tertiary: { value: 'Strong', label: 'position' },
      trend: 'up',
      alert: false 
    },
    '6': { 
      primary: { value: '$18.2K', label: 'margin/loan' },
      secondary: { value: '$1.85M', label: 'gross MTD' },
      tertiary: { value: '+14%', label: 'vs target' },
      trend: 'up',
      alert: false 
    },
  });

  useEffect(() => {
    // Simulate realtime updates every 30 seconds
    const interval = setInterval(() => {
      setStats(prev => ({
        ...prev,
        '1': { 
          ...prev['1'], 
          primary: { value: `$${(1.2 + Math.random() * 0.2).toFixed(2)}M`, label: 'locked today' },
          secondary: { value: String(Math.floor(38 + Math.random() * 8)), label: 'loans' },
        },
        '2': { 
          ...prev['2'], 
          primary: { value: String(Math.floor(2 + Math.random() * 4)), label: 'loans at risk' },
          alert: Math.random() > 0.4,
        },
        '4': { 
          ...prev['4'], 
          primary: { value: `${(1.8 + Math.random() * 0.8).toFixed(1)}d`, label: 'behind SLA' },
          secondary: { value: String(Math.floor(6 + Math.random() * 5)), label: 'files aging' },
        },
      }));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return stats;
};

// Executive-focused report configuration
const reportConfig: Record<string, { label: string; question: string }> = {
  'Daily Production Pulse': { label: 'Production', question: 'Are we winning today?' },
  'Fallout and Risk': { label: 'Risk Alert', question: 'What needs attention?' },
  'Loan Officer Top Tiering Performance': { label: 'LO Performance', question: 'Who needs coaching?' },
  'Operations and Speed': { label: 'Operations', question: 'Where are bottlenecks?' },
  'Rate Competitiveness': { label: 'Market Position', question: 'Are we priced right?' },
  'Profitability Snapshot': { label: 'Profitability', question: 'Are we making money?' }
};

const statusConfig = {
  healthy: {
    dot: 'bg-emerald-500',
    bg: 'hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    dot: 'bg-amber-500',
    bg: 'hover:bg-amber-50/50 dark:hover:bg-amber-950/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  critical: {
    dot: 'bg-rose-500',
    bg: 'hover:bg-rose-50/50 dark:hover:bg-rose-950/20',
    text: 'text-rose-600 dark:text-rose-400',
  }
};

// Dashboard section configuration
const dashboardSectionsConfig = [
  { id: 'executiveDashboard' as SectionId, label: 'Business Overview', icon: Target, color: 'text-purple-500' },
  { id: 'industryNews' as SectionId, label: 'Industry News', icon: Newspaper, color: 'text-blue-500' },
  { id: 'aletheiaInsights' as SectionId, label: 'Ailethia Prompts', icon: Zap, color: 'text-emerald-500' },
  { id: 'leaderboard' as SectionId, label: 'Leaderboard', icon: Trophy, color: 'text-amber-500' },
  { id: 'topTiering' as SectionId, label: 'Top Tiering', icon: TrendingUp, color: 'text-amber-500' },
  { id: 'closingFalloutForecast' as SectionId, label: 'Closing & Fallout Forecast', icon: BarChart3, color: 'text-indigo-500' },
];

// Default section order - matches actual display order on /insights page
export const defaultSectionOrder: SectionId[] = [
  'aletheiaInsights',
  'industryNews',
  'executiveDashboard',
  'closingFalloutForecast',
  'topTiering',
  'leaderboard',
];

// Get section config by id
const getSectionConfig = (id: SectionId) => dashboardSectionsConfig.find(s => s.id === id);

// Bypass Landing Page Toggle Component
const BypassLandingToggle = ({ isExpanded, onInteraction }: { isExpanded: boolean; onInteraction?: () => void }) => {
  const [bypassEnabled, setBypassEnabled] = useState(() => {
    const stored = localStorage.getItem('bypass-landing-page');
    return stored === 'true';
  });

  const handleToggle = () => {
    const newValue = !bypassEnabled;
    setBypassEnabled(newValue);
    localStorage.setItem('bypass-landing-page', String(newValue));
    if (onInteraction) onInteraction();
  };

  return (
    <div className={`
      w-full flex items-center rounded-xl transition-all duration-150 group 
      hover:bg-slate-100/80 dark:hover:bg-slate-800/80 
      ${isExpanded ? 'h-11 gap-2 px-2' : 'h-10'}
    `}
    style={{ justifyContent: isExpanded ? 'flex-start' : 'center' }}
    >
      {/* Icon */}
      <button
        onClick={handleToggle}
        className="relative flex-shrink-0"
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors duration-150 ${bypassEnabled ? 'bg-slate-100 dark:bg-slate-800/60' : 'bg-slate-50 dark:bg-slate-800/30'}`}>
          <Home className={`w-4 h-4 ${bypassEnabled ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'}`} />
        </div>
        {/* Checkbox indicator */}
        <div className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all duration-150 ${bypassEnabled ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
          {bypassEnabled && <Check className="w-2 h-2 text-white" strokeWidth={3} />}
        </div>
      </button>
      
      {/* Content - only render when expanded */}
      {isExpanded && (
        <>
          <button
            onClick={handleToggle}
            className="flex-1 min-w-0 text-left overflow-hidden"
          >
            <p className={`text-xs font-semibold truncate leading-tight transition-colors ${bypassEnabled ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
              Bypass Landing Page
            </p>
            <p className={`text-[10px] mt-0.5 ${bypassEnabled ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>
              {bypassEnabled ? 'Go straight to dashboard' : 'Show landing page'}
            </p>
          </button>
          
          {/* Toggle indicator */}
          <button
            onClick={handleToggle}
            className="flex-shrink-0"
          >
            <div className={`w-8 h-5 rounded-full transition-colors duration-150 flex items-center ${bypassEnabled ? 'bg-blue-500 justify-end' : 'bg-slate-300 dark:bg-slate-600 justify-start'}`}>
              <div className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5" />
            </div>
          </button>
        </>
      )}
    </div>
  );
};

export const ReportsSidebar: React.FC<ReportsSidebarProps> = ({ 
  onReportClick, 
  visibility, 
  onVisibilityChange,
  sectionOrder: externalOrder,
  onSectionOrderChange,
  mobileMenuOpen: externalMobileOpen,
  onMobileMenuToggle,
  onSectionClick
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  const isMobileOpen = externalMobileOpen !== undefined ? externalMobileOpen : internalMobileOpen;
  const [hoveredReport, setHoveredReport] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<SectionId | null>(null);
  const [dragOverItem, setDragOverItem] = useState<SectionId | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const realtimeStats = useRealtimeStats();

  // Use external order or load from localStorage
  const [internalOrder, setInternalOrder] = useState<SectionId[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dashboard-section-order');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as SectionId[];
          // Merge with default order to include any new sections
          const newSections = defaultSectionOrder.filter(id => !parsed.includes(id));
          if (newSections.length > 0) {
            const merged = [...parsed, ...newSections];
            localStorage.setItem('dashboard-section-order', JSON.stringify(merged));
            return merged;
          }
          return parsed;
        } catch {
          return defaultSectionOrder;
        }
      }
    }
    return defaultSectionOrder;
  });

  const sectionOrder = externalOrder || internalOrder;

  // Get ordered sections
  const orderedSections = sectionOrder
    .map(id => getSectionConfig(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, sectionId: SectionId) => {
    setDraggedItem(sectionId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sectionId);
    // Add a slight delay to show the dragging state
    setTimeout(() => {
      const target = e.target as HTMLElement;
      target.style.opacity = '0.5';
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    target.style.opacity = '1';
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDragOver = (e: React.DragEvent, sectionId: SectionId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedItem && draggedItem !== sectionId) {
      setDragOverItem(sectionId);
    }
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: SectionId) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain') as SectionId;
    
    if (draggedId && draggedId !== targetId) {
      const newOrder = [...sectionOrder];
      const draggedIndex = newOrder.indexOf(draggedId);
      const targetIndex = newOrder.indexOf(targetId);
      
      // Remove dragged item and insert at new position
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedId);
      
      // Update state
      if (onSectionOrderChange) {
        onSectionOrderChange(newOrder);
      } else {
        setInternalOrder(newOrder);
        localStorage.setItem('dashboard-section-order', JSON.stringify(newOrder));
      }
    }
    
    setDraggedItem(null);
    setDragOverItem(null);
  };

  // Default visibility state
  const defaultVisibility: DashboardVisibility = {
    executiveDashboard: false,
    industryNews: true,
    aletheiaInsights: true,
    leaderboard: true,
    topTiering: true,
    closingFalloutForecast: false,
    trends: false,
    forecasting: false,
    kpiReports: false,
  };

  const currentVisibility = visibility || defaultVisibility;

  const handleToggleSection = (sectionId: keyof DashboardVisibility) => {
    if (onVisibilityChange) {
      onVisibilityChange({
        ...currentVisibility,
        [sectionId]: !currentVisibility[sectionId],
      });
    }
  };

  // Count active sections - only count sections that are in dashboardSectionsConfig
  const activeCount = dashboardSectionsConfig.filter(section => currentVisibility[section.id]).length;

  // Helper function to reset auto-hide timer
  const resetAutoHideTimer = () => {
    if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
    if (isExpanded) {
      autoHideTimeoutRef.current = setTimeout(() => {
        setIsExpanded(false);
      }, 6000);
    }
  };

  const handleMouseEnter = () => {
    // Clear any pending collapse timeouts
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
    
    // Expand immediately
    setIsExpanded(true);
    
    // Set auto-hide after 6 seconds
    autoHideTimeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
    }, 6000);
  };

  const handleMouseLeave = () => {
    // Clear auto-hide timeout since we're leaving
    if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
    
    // Collapse immediately when mouse leaves (no delay)
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsExpanded(false);
  };

  // Handle click outside to close sidebar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Only handle if sidebar is expanded
      if (!isExpanded) return;
      
      // Check if click is outside the sidebar
      const sidebarElement = document.querySelector('[data-sidebar-container]');
      if (sidebarElement && !sidebarElement.contains(event.target as Node)) {
        setIsExpanded(false);
        // Clear any pending timeouts
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
      }
    };

    // Add event listener when sidebar is expanded
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded]);

  const toggleMobile = () => {
    if (onMobileMenuToggle) {
      onMobileMenuToggle();
    } else {
      setInternalMobileOpen(!internalMobileOpen);
    }
  };

  const handleButtonClick = (reportId: string) => {
    const report = getReportById(reportId);
    if (report) {
      onReportClick(report);
    }
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
    };
  }, []);

  // Check if any report has an alert
  const hasActiveAlerts = Object.values(realtimeStats).some(s => s.alert);
  const alertCount = Object.values(realtimeStats).filter(s => s.alert).length;

  return (
    <>
      {/* Mobile: Top slide-down panel */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={toggleMobile}
              className="md:hidden fixed inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ y: '-100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '-100%', opacity: 0 }}
              transition={{ type: 'tween', duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="md:hidden fixed top-16 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shadow-2xl max-h-[calc(100vh-4rem)] overflow-y-auto overscroll-contain"
              style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
            >
              <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-500" />
                  <p className="text-sm font-thin text-slate-800 dark:text-slate-200 tracking-tight">
                    Choose Sections
                  </p>
                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-[10px] font-thin text-slate-600 dark:text-slate-400">
                    {activeCount} of {dashboardSectionsConfig.length}
                  </span>
                </div>
                <button
                  onClick={toggleMobile}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" strokeWidth={2} />
                </button>
              </div>
              
              {/* Quick Actions */}
              <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                <button
                  onClick={() => {
                    const allVisible = activeCount === dashboardSectionsConfig.length;
                    if (onVisibilityChange) {
                      const newVisibility: DashboardVisibility = { ...currentVisibility };
                      orderedSections.forEach(section => {
                        newVisibility[section.id] = !allVisible;
                      });
                      onVisibilityChange(newVisibility);
                    }
                  }}
                  className="flex-1 px-3 py-2 text-xs font-thin rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  {activeCount === dashboardSectionsConfig.length ? 'Hide All' : 'Show All'}
                </button>
              </div>
              
              <div className="p-4 pt-2 space-y-2">
                {orderedSections.map((section, index) => {
                  const Icon = section.icon;
                  const isActive = currentVisibility[section.id];
                  const isDragging = draggedItem === section.id;
                  const isDragOver = dragOverItem === section.id;
                  const isIndustryNews = section.id === 'industryNews';
                  const nextSection = orderedSections[index + 1];
                  const isNextDashboard = nextSection && ['executiveDashboard', 'closingFalloutForecast', 'topTiering', 'leaderboard'].includes(nextSection.id);
                  const showSeparator = isIndustryNews && isNextDashboard;
                  
                  return (
                    <React.Fragment key={section.id}>
                      <div
                        draggable
                        onDragStart={(e) => handleDragStart(e, section.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, section.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, section.id)}
                        onTouchStart={() => {}}
                        className={`
                          w-full flex items-center gap-2 p-3 rounded-xl transition-all duration-150 
                          hover:bg-slate-100/80 dark:hover:bg-slate-800/80
                          ${isDragging ? 'opacity-50 scale-95' : 'opacity-100'}
                          ${isDragOver ? 'ring-2 ring-emerald-500 ring-offset-1 bg-emerald-50 dark:bg-emerald-950/30' : ''}
                          cursor-grab active:cursor-grabbing
                        `}
                      >
                        {/* Drag handle */}
                        <div className="flex-shrink-0 opacity-40">
                          <GripVertical className="w-4 h-4 text-slate-400" />
                        </div>

                        <button
                          onClick={() => handleToggleSection(section.id)}
                          className="relative flex-shrink-0"
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isActive ? 'bg-slate-100 dark:bg-slate-800/60' : 'bg-slate-50 dark:bg-slate-800/30'}`}>
                            <Icon className={`w-5 h-5 ${isActive ? section.color : 'text-slate-400 dark:text-slate-500'}`} />
                          </div>
                          <div className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center transition-all duration-150 ${isActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                            {isActive && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                          </div>
                        </button>
                        <button
                          onClick={() => handleToggleSection(section.id)}
                          className="flex-1 text-left"
                        >
                          <p className={`text-sm font-thin ${isActive ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
                            {section.label}
                          </p>
                          <p className={`text-xs mt-0.5 font-thin ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                            {isActive ? 'Visible' : 'Hidden'}
                          </p>
                        </button>
                        <button
                          onClick={() => handleToggleSection(section.id)}
                          className={`w-10 h-6 rounded-full transition-colors duration-150 flex items-center ${isActive ? 'bg-emerald-500 justify-end' : 'bg-slate-300 dark:bg-slate-600 justify-start'}`}
                        >
                          <div className="w-5 h-5 rounded-full bg-white shadow-sm mx-0.5" />
                        </button>
                      </div>
                      
                      {/* Dashboards Separator - after Industry News */}
                      {showSeparator && (
                        <div className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                            <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              Dashboards
                            </p>
                            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                <p className="text-xs font-thin text-slate-500 dark:text-slate-400 text-center">
                  Toggle to show/hide sections
                </p>
              </div>
              <div className="h-1 bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 opacity-60" />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop: Left sidebar */}
      <motion.div
        initial={false}
        animate={{ width: isExpanded ? 260 : 52 }}
        transition={{ 
          type: 'tween',
          duration: 0.2,
          ease: [0.4, 0, 0.2, 1]
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="hidden md:block fixed left-0 top-[50%] -translate-y-1/2 z-40"
        data-sidebar-container
      >
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-r-2xl border border-l-0 border-slate-200/60 dark:border-slate-700/40 shadow-xl overflow-hidden">
        {/* Header - always visible but content fades */}
        <div className="relative px-2 py-2 bg-gradient-to-r from-slate-50 to-transparent dark:from-slate-800/50 dark:to-transparent border-b border-slate-100 dark:border-slate-800 h-10 flex items-center justify-center">
          {/* Expanded header content */}
          <motion.div
            initial={false}
            animate={{ opacity: isExpanded ? 1 : 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-between w-full px-2"
            style={{ visibility: isExpanded ? 'visible' : 'hidden', position: isExpanded ? 'relative' : 'absolute' }}
          >
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-emerald-500" />
              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                Favorites
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full">
              <span className="text-[9px] font-medium text-slate-600 dark:text-slate-400">{activeCount} of {dashboardSectionsConfig.length}</span>
            </div>
          </motion.div>
          {/* Collapsed: Show count indicator - centered */}
          <motion.div
            initial={false}
            animate={{ opacity: isExpanded ? 0 : 1 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-center"
            style={{ visibility: isExpanded ? 'hidden' : 'visible', position: isExpanded ? 'absolute' : 'relative' }}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white">
              {activeCount}
            </span>
          </motion.div>
        </div>

        {/* Section Toggles - fixed height container */}
        <div className="space-y-1 py-2" style={{ padding: isExpanded ? '0.5rem' : '0.5rem 0.375rem' }}>
          {orderedSections.map((section, index) => {
            const Icon = section.icon;
            const isActive = currentVisibility[section.id];
            const isHoveredItem = hoveredReport === section.id;
            const isDragging = draggedItem === section.id;
            const isDragOver = dragOverItem === section.id;
            const isIndustryNews = section.id === 'industryNews';
            const nextSection = orderedSections[index + 1];
            const isNextDashboard = nextSection && ['executiveDashboard', 'closingFalloutForecast', 'topTiering', 'leaderboard'].includes(nextSection.id);
            const showSeparator = isIndustryNews && isNextDashboard;
            
            return (
              <React.Fragment key={section.id}>
                <div
                  className={`
                    w-full flex items-center rounded-xl transition-all duration-150 group 
                    hover:bg-slate-100/80 dark:hover:bg-slate-800/80 
                    ${isHoveredItem ? 'bg-slate-100/80 dark:bg-slate-800/80 shadow-sm' : ''} 
                    ${isExpanded ? 'h-11 gap-2 px-2' : 'h-10'}
                  `}
                  style={{ justifyContent: isExpanded ? 'flex-start' : 'center' }}
                >

                  {/* Icon with checkbox overlay */}
                  <button
                    onClick={() => {
                      handleToggleSection(section.id);
                      resetAutoHideTimer();
                    }}
                    className="relative flex-shrink-0"
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors duration-150 ${isActive ? 'bg-slate-100 dark:bg-slate-800/60' : 'bg-slate-50 dark:bg-slate-800/30'}`}>
                      <Icon className={`w-4 h-4 ${isActive ? section.color : 'text-slate-400 dark:text-slate-500'}`} />
                    </div>
                    {/* Checkbox indicator on icon */}
                    <div className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all duration-150 ${isActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                      {isActive && <Check className="w-2 h-2 text-white" strokeWidth={3} />}
                    </div>
                  </button>
                  
                  {/* Content - only render when expanded */}
                  {isExpanded && (
                    <>
                      <button
                        onClick={() => {
                          handleToggleSection(section.id);
                          resetAutoHideTimer();
                        }}
                        onMouseEnter={() => {
                          setHoveredReport(section.id);
                          resetAutoHideTimer();
                        }}
                        onMouseLeave={() => setHoveredReport(null)}
                        className="flex-1 min-w-0 text-left overflow-hidden"
                      >
                        {/* Label */}
                        <p className={`text-xs font-semibold truncate leading-tight transition-colors ${isActive ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
                          {section.label}
                        </p>
                        {/* Status text */}
                        <p className={`text-[10px] mt-0.5 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                          {isActive ? 'Visible' : 'Hidden'}
                        </p>
                      </button>
                      
                      {/* Toggle indicator */}
                      <button
                        onClick={() => {
                          handleToggleSection(section.id);
                          resetAutoHideTimer();
                        }}
                        className="flex-shrink-0"
                      >
                        <div className={`w-8 h-5 rounded-full transition-colors duration-150 flex items-center ${isActive ? 'bg-emerald-500 justify-end' : 'bg-slate-300 dark:bg-slate-600 justify-start'}`}>
                          <div className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5" />
                        </div>
                      </button>
                    </>
                  )}
                </div>
                
                {/* Dashboards Separator - after Industry News */}
                {showSeparator && isExpanded && (
                  <div className="px-2 py-2 mt-2 mb-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                      <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Dashboards
                      </p>
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          
          {/* Bypass Landing Page Toggle - Separate from sections */}
          <div className="border-t border-slate-200 dark:border-slate-700 mt-2 pt-2">
            <BypassLandingToggle isExpanded={isExpanded} onInteraction={resetAutoHideTimer} />
          </div>
        </div>

        {/* Info text - fixed height container */}
        <div className={`border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-center ${isExpanded ? 'px-3 py-2 h-8' : 'h-2'}`}>
          <motion.p
            initial={false}
            animate={{ opacity: isExpanded ? 1 : 0, height: isExpanded ? 'auto' : 0 }}
            transition={{ duration: 0.15 }}
            className="text-[9px] text-slate-500 dark:text-slate-400 text-center overflow-hidden"
          >
            Drag to reorder • Toggle to show/hide
          </motion.p>
        </div>

        {/* Footer accent */}
        <div className="h-1 bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 opacity-60" />
      </div>
    </motion.div>
    </>
  );
};

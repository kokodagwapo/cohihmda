import { useState } from 'react';

export interface UseDashboardStateReturn {
  // Basic stats
  stats: {
    callsToday: number;
    documentsVerified: number;
    flaggedCases: number;
  };
  setStats: React.Dispatch<React.SetStateAction<{
    callsToday: number;
    documentsVerified: number;
    flaggedCases: number;
  }>>;
  
  // Recent calls
  recentCalls: any[];
  setRecentCalls: React.Dispatch<React.SetStateAction<any[]>>;
  
  // Animation state
  animationCycle: number;
  setAnimationCycle: React.Dispatch<React.SetStateAction<number>>;
  isAnimating: boolean;
  setIsAnimating: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Leaderboard/Tiering state
  selectedTier: 'top' | 'middle' | 'bottom';
  setSelectedTier: React.Dispatch<React.SetStateAction<'top' | 'middle' | 'bottom'>>;
  visibleCount: number;
  setVisibleCount: React.Dispatch<React.SetStateAction<number>>;
  itemsPerPage: number;
  
  // Mobile menu
  mobileMenuOpen: boolean;
  setMobileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Warning notifications
  currentWarningIndex: number;
  setCurrentWarningIndex: React.Dispatch<React.SetStateAction<number>>;
  visibleWarnings: number[];
  setVisibleWarnings: React.Dispatch<React.SetStateAction<number[]>>;
  showNotifications: boolean;
  setShowNotifications: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Modal states
  contactModal: {
    open: boolean;
    type: 'call' | 'message' | 'share' | null;
    performer: any | null;
  };
  setContactModal: React.Dispatch<React.SetStateAction<{
    open: boolean;
    type: 'call' | 'message' | 'share' | null;
    performer: any | null;
  }>>;
  
  metricModal: {
    open: boolean;
    type: 'score' | 'loans' | 'revenue' | null;
    performer: any | null;
  };
  setMetricModal: React.Dispatch<React.SetStateAction<{
    open: boolean;
    type: 'score' | 'loans' | 'revenue' | null;
    performer: any | null;
  }>>;
  
  falloutModal: {
    open: boolean;
    category: string | null;
    data: any[];
  };
  setFalloutModal: React.Dispatch<React.SetStateAction<{
    open: boolean;
    category: string | null;
    data: any[];
  }>>;
  
  pullThroughModal: {
    open: boolean;
    stage: string | null;
    data: any[];
  };
  setPullThroughModal: React.Dispatch<React.SetStateAction<{
    open: boolean;
    stage: string | null;
    data: any[];
  }>>;
  
  riskModal: {
    open: boolean;
    case: any | null;
  };
  setRiskModal: React.Dispatch<React.SetStateAction<{
    open: boolean;
    case: any | null;
  }>>;
  
  exportModal: boolean;
  setExportModal: React.Dispatch<React.SetStateAction<boolean>>;
  
  shareModal: boolean;
  setShareModal: React.Dispatch<React.SetStateAction<boolean>>;
  
  embedModal: boolean;
  setEmbedModal: React.Dispatch<React.SetStateAction<boolean>>;
  
  // TopTiering modal state
  topTieringModal: boolean;
  setTopTieringModal: React.Dispatch<React.SetStateAction<boolean>>;
  topTieringTab: 'overview' | 'branches' | 'los' | 'trends' | 'funnel';
  setTopTieringTab: React.Dispatch<React.SetStateAction<'overview' | 'branches' | 'los' | 'trends' | 'funnel'>>;
  funnelView: 'funnel' | 'bar' | 'revenue' | 'units' | 'volume' | 'detail';
  setFunnelView: React.Dispatch<React.SetStateAction<'funnel' | 'bar' | 'revenue' | 'units' | 'volume' | 'detail'>>;
  funnelYear: number;
  setFunnelYear: React.Dispatch<React.SetStateAction<number>>;
  selectedBranch: string | null;
  setSelectedBranch: React.Dispatch<React.SetStateAction<string | null>>;
  selectedStaff: {
    name: string;
    role: string;
    branch: string;
  } | null;
  setSelectedStaff: React.Dispatch<React.SetStateAction<{
    name: string;
    role: string;
    branch: string;
  } | null>>;
  staffFilter: 'all' | 'lo' | 'processor' | 'uw' | 'closer';
  setStaffFilter: React.Dispatch<React.SetStateAction<'all' | 'lo' | 'processor' | 'uw' | 'closer'>>;
  
  // Trends and Forecasting modals
  trendsModal: boolean;
  setTrendsModal: React.Dispatch<React.SetStateAction<boolean>>;
  forecastingModal: boolean;
  setForecastingModal: React.Dispatch<React.SetStateAction<boolean>>;
  trendsSelectedMetric: string | null;
  setTrendsSelectedMetric: React.Dispatch<React.SetStateAction<string | null>>;
  forecastSelectedScenario: string | null;
  setForecastSelectedScenario: React.Dispatch<React.SetStateAction<string | null>>;
  
  // Report modal
  selectedReport: ReportData | null;
  setSelectedReport: React.Dispatch<React.SetStateAction<ReportData | null>>;
  reportModalOpen: boolean;
  setReportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

// Import ReportData type
import { ReportData } from '@/data/reportSimulations';

export function useDashboardState(): UseDashboardStateReturn {
  const [stats, setStats] = useState({
    callsToday: 0,
    documentsVerified: 0,
    flaggedCases: 0
  });
  const [recentCalls, setRecentCalls] = useState<any[]>([]);
  const [animationCycle, setAnimationCycle] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedTier, setSelectedTier] = useState<'top' | 'middle' | 'bottom'>('top');
  const [visibleCount, setVisibleCount] = useState(10);
  const itemsPerPage = 10;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Warning notifications state
  const [currentWarningIndex, setCurrentWarningIndex] = useState(0);
  const [visibleWarnings, setVisibleWarnings] = useState<number[]>([0, 1, 2]);
  const [showNotifications, setShowNotifications] = useState(false);

  // Modal states for contact actions
  const [contactModal, setContactModal] = useState<{
    open: boolean;
    type: 'call' | 'message' | 'share' | null;
    performer: any | null;
  }>({
    open: false,
    type: null,
    performer: null
  });

  // Modal states for metric breakdowns
  const [metricModal, setMetricModal] = useState<{
    open: boolean;
    type: 'score' | 'loans' | 'revenue' | null;
    performer: any | null;
  }>({
    open: false,
    type: null,
    performer: null
  });

  // Modal state for fallout breakdown
  const [falloutModal, setFalloutModal] = useState<{
    open: boolean;
    category: string | null;
    data: any[];
  }>({
    open: false,
    category: null,
    data: []
  });

  // Modal state for pull-through breakdown
  const [pullThroughModal, setPullThroughModal] = useState<{
    open: boolean;
    stage: string | null;
    data: any[];
  }>({
    open: false,
    stage: null,
    data: []
  });

  // Modal state for risk case breakdown
  const [riskModal, setRiskModal] = useState<{
    open: boolean;
    case: any | null;
  }>({
    open: false,
    case: null
  });

  // Export and share modal
  const [exportModal, setExportModal] = useState(false);

  // TopTiering Story modal
  const [topTieringModal, setTopTieringModal] = useState(false);
  const [topTieringTab, setTopTieringTab] = useState<'overview' | 'branches' | 'los' | 'trends' | 'funnel'>('funnel');
  const [funnelView, setFunnelView] = useState<'funnel' | 'bar' | 'revenue' | 'units' | 'volume' | 'detail'>('funnel');
  const [funnelYear, setFunnelYear] = useState<number>(2025);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<{
    name: string;
    role: string;
    branch: string;
  } | null>(null);
  const [staffFilter, setStaffFilter] = useState<'all' | 'lo' | 'processor' | 'uw' | 'closer'>('all');

  // Trends and Forecasting modals
  const [trendsModal, setTrendsModal] = useState(false);
  const [forecastingModal, setForecastingModal] = useState(false);
  const [trendsSelectedMetric, setTrendsSelectedMetric] = useState<string | null>(null);
  const [forecastSelectedScenario, setForecastSelectedScenario] = useState<string | null>(null);

  // Report sidebar and modal
  const [shareModal, setShareModal] = useState(false);
  const [embedModal, setEmbedModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ReportData | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  return {
    stats,
    setStats,
    recentCalls,
    setRecentCalls,
    animationCycle,
    setAnimationCycle,
    isAnimating,
    setIsAnimating,
    selectedTier,
    setSelectedTier,
    visibleCount,
    setVisibleCount,
    itemsPerPage,
    mobileMenuOpen,
    setMobileMenuOpen,
    currentWarningIndex,
    setCurrentWarningIndex,
    visibleWarnings,
    setVisibleWarnings,
    showNotifications,
    setShowNotifications,
    contactModal,
    setContactModal,
    metricModal,
    setMetricModal,
    falloutModal,
    setFalloutModal,
    pullThroughModal,
    setPullThroughModal,
    riskModal,
    setRiskModal,
    exportModal,
    setExportModal,
    shareModal,
    setShareModal,
    embedModal,
    setEmbedModal,
    topTieringModal,
    setTopTieringModal,
    topTieringTab,
    setTopTieringTab,
    funnelView,
    setFunnelView,
    funnelYear,
    setFunnelYear,
    selectedBranch,
    setSelectedBranch,
    selectedStaff,
    setSelectedStaff,
    staffFilter,
    setStaffFilter,
    trendsModal,
    setTrendsModal,
    forecastingModal,
    setForecastingModal,
    trendsSelectedMetric,
    setTrendsSelectedMetric,
    forecastSelectedScenario,
    setForecastSelectedScenario,
    selectedReport,
    setSelectedReport,
    reportModalOpen,
    setReportModalOpen
  };
}


import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Filter, X, Calendar, ShieldCheck, TrendingUp, TrendingDown, BarChart3, PieChart, AlertCircle, CheckCircle2, User, Building2, Maximize2, Minimize2, Plus, CheckSquare, Square } from 'lucide-react';
import { KPICard } from '@/components/widgets/components/KPICard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { DASHBOARD_MAIN_CLASSNAME } from '@/components/cohi/pageContentStyles';
import { DashboardPageContent } from '@/components/layout/DashboardPageContent';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringPageFrame } from '@/components/layout/TopTieringPageFrame';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { LoanDrilldownModal } from '@/components/dashboard/LoanDrilldownModal';
import { useTheme } from '@/components/theme-provider';
import { useCreditRiskData, ApplicationType, DistributionBucket, LoanMixRow, calculateLoanMixTotals } from '@/hooks/useCreditRiskData';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';
import { useAuth } from '@/contexts/AuthContext';
import { DatePeriodPicker, useDatePeriodState, computePresetDateRange, type PeriodPreset } from '@/components/ui/DatePeriodPicker';
import { useDashboardInsights, type DashboardInsightItem } from "@/hooks/useDashboardInsights";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";
import { DashboardInsightsStrip } from "@/components/dashboard/DashboardInsightsStrip";

interface Loan {
  id: string;
  loan_number?: string | null;
  borrower: string;
  officer: string;
  amount: string;
  amountValue?: number;
  riskLevel: string;
  riskScore: number;
  reason: string;
  loanType?: string;
  loanPurpose?: string | null;
  channel?: string | null;
  status?: string;
  currentMilestone?: string | null;
  applicationDate?: string | null;
  estimatedClosingDate?: string | null;
  closingDate?: string | null;
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  loPullthroughPct?: number | null;
  activeDays?: number | null;
  category?: string;
  range?: string;
}

export default function CreditRiskManagement() {
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  
  // Application type filter - maps to Qlik's vDateTypeSet
  const [applicationType, setApplicationType] = useState<ApplicationType>('Applications Taken');
  
  // Date selection using reusable hook
  const { year: selectedYear, setYear: setSelectedYear, dateRange, setDateRange, periodSelection, setPeriodSelection } = useDatePeriodState();
  
  // Channel filter from global store (synced with header)
  const { selectedChannel } = useChannelStore();
  
  // Tenant selection from global store (persists across pages)
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  
  // Get tenant_id - prefer global selection (for admins), fall back to user's tenant
  const tenantId = selectedTenantId || user?.tenant_id || null;
  
  // Loan Mix tab state
  const [loanMixTab, setLoanMixTab] = useState<'Loan Type' | 'Loan Purpose' | 'Occupancy'>('Loan Type');
  
  // Per-card date range selection (for future per-chart filtering)
  const [ficoDateRange, setFicoDateRange] = useState<'MTD' | 'YTD' | 'Custom'>('YTD');
  const [ltvDateRange, setLtvDateRange] = useState<'MTD' | 'YTD' | 'Custom'>('YTD');
  const [dtiDateRange, setDtiDateRange] = useState<'MTD' | 'YTD' | 'Custom'>('YTD');
  
  // Multi-select state
  const [selectedRanges, setSelectedRanges] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ card: string; index: number } | null>(null);
  const selectionRef = useRef<HTMLDivElement>(null);

  // Drilldown and selection state
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<{ range: string; type: 'fico' | 'ltv' | 'dti' } | null>(null);
  const [drilldownLoans, setDrilldownLoans] = useState<Loan[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [showDrilldownModal, setShowDrilldownModal] = useState(false);
  const [drilldownTitle, setDrilldownTitle] = useState('');

  // Canvas mode
  const [canvasMode, setCanvasMode] = useState(false);
  const [canvasEntityId, setCanvasEntityId] = useState<string | null>(null);
  const [canvasEntityType, setCanvasEntityType] = useState<'category' | 'range' | null>(null);
  const [canvasEntityName, setCanvasEntityName] = useState<string>('');
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [pendingInsightWidgetId, setPendingInsightWidgetId] = useState<string | null>(null);

  const dashboardInsightFilters = useMemo(() => ({}), []);
  const {
    insights: dashboardInsights,
    generatedAt: dashboardInsightsGeneratedAt,
    loading: dashboardInsightsLoading,
    refresh: refreshDashboardInsights,
  } = useDashboardInsights("credit-risk-management", dashboardInsightFilters, { tenantId });

  // Fetch data using the hook
  const { data, loading, error } = useCreditRiskData({
    applicationType,
    channel: selectedChannel,
    year: selectedYear,
    dateRange,
    tenantId: tenantId
  });

  const creditRiskFilterAnalytics = useMemo(
    () => ({
      application_type: applicationType,
      year: selectedYear,
      date_start: dateRange.start,
      date_end: dateRange.end,
      period_selection_type: periodSelection?.type ?? null,
      loan_mix_tab: loanMixTab,
      fico_card_range: ficoDateRange,
      ltv_card_range: ltvDateRange,
      dti_card_range: dtiDateRange,
      selected_ranges_count: selectedRanges.size,
      selected_channel: selectedChannel ?? "All",
      canvas_mode: canvasMode,
    }),
    [
      applicationType,
      selectedYear,
      dateRange.start,
      dateRange.end,
      periodSelection?.type,
      loanMixTab,
      ficoDateRange,
      ltvDateRange,
      dtiDateRange,
      selectedRanges,
      selectedChannel,
      canvasMode,
    ],
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.credit_risk_management, creditRiskFilterAnalytics);

  const handleGenerateInsights = useCallback(async () => {
    setGenerateLoading(true);
    setGenerateError(null);
    try {
      const tenantParam = selectedTenantId ? `?tenant_id=${encodeURIComponent(selectedTenantId)}` : "";
      await api.request<{
        insights: DashboardInsightItem[];
        count: number;
        pageId: string;
        pageName: string;
        generationBatch: string;
      }>(`/api/dashboard-insights/generate${tenantParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: "credit-risk-management",
          filters: {},
        }),
      });
      await refreshDashboardInsights();
    } catch (err: unknown) {
      setGenerateError(
        err instanceof Error ? err.message : "We couldn't generate insights right now. Please try again later."
      );
    } finally {
      setGenerateLoading(false);
    }
  }, [refreshDashboardInsights, selectedTenantId]);

  const handleShowInsight = useCallback(
    (insight: DashboardInsightItem) => {
      const fc = insight.filter_context ?? {};
      const insightDatePeriodToSelection: Record<string, { type: 'preset'; preset: PeriodPreset } | { type: 'year'; year: number }> = {
        l13m: { type: 'preset', preset: 'rolling-13' },
        l12m: { type: 'preset', preset: 'rolling-12' },
        ytd: { type: 'year', year: new Date().getFullYear() },
      };
      const appType = typeof fc.applicationType === "string" ? fc.applicationType : null;
      const period = typeof fc.datePeriod === "string" ? fc.datePeriod.toLowerCase() : null;
      const primaryRef = insight.evidence_refs?.find((r) => r.role === "primary") ?? insight.evidence_refs?.[0];
      const wid = primaryRef?.widgetId;

      if (appType) {
        const normalized = appType === "Lost Opperturnities" ? "Lost Opportunities" : appType;
        if (
          normalized === "Applications Taken" ||
          normalized === "Funded Production" ||
          normalized === "Lost Opportunities" ||
          normalized === "All Loans"
        ) {
          setApplicationType(normalized);
        }
      }

      if (period) {
        const yKey = period.match(/^y_(\d{4})$/);
        if (yKey) {
          const y = Number(yKey[1]);
          if (!Number.isNaN(y)) {
            setPeriodSelection({
              type: "year",
              year: y,
              dateRange: { start: `${y}-01-01`, end: `${y}-12-31` },
            });
            setSelectedYear(y);
          }
        } else if (period in insightDatePeriodToSelection) {
          const selection = insightDatePeriodToSelection[period];
          if (selection.type === "preset") {
            setPeriodSelection({
              type: "preset",
              preset: selection.preset,
              dateRange: computePresetDateRange(selection.preset),
            });
          } else {
            const y = selection.year;
            setPeriodSelection({
              type: "year",
              year: y,
              dateRange: { start: `${y}-01-01`, end: new Date().toISOString().slice(0, 10) },
            });
            setSelectedYear(y);
          }
        }
      }

      if (wid === "credit-risk-loan-mix-table" && typeof fc.loanMixDimension === "string") {
        if (fc.loanMixDimension === "loan_type") setLoanMixTab("Loan Type");
        if (fc.loanMixDimension === "loan_purpose") setLoanMixTab("Loan Purpose");
        if (fc.loanMixDimension === "occupancy") setLoanMixTab("Occupancy");
      }

      setPendingInsightWidgetId(wid ?? "credit-risk-story-panel");
    },
    [setPeriodSelection, setSelectedYear]
  );

  useEffect(() => {
    if (!pendingInsightWidgetId || loading || typeof document === "undefined") return;
    const el = document.getElementById(pendingInsightWidgetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber-400", "ring-offset-2");
    setTimeout(() => el.classList.remove("ring-2", "ring-amber-400", "ring-offset-2"), 3000);
    setPendingInsightWidgetId(null);
  }, [pendingInsightWidgetId, loading]);

  const formatNumber = (num: number, decimals = 0) => {
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatCurrency = (num: number) => {
    if (num >= 1000000) {
      return `$${(num / 1000000).toFixed(2)}M`;
    }
    return `$${num.toLocaleString()}`;
  };

  const formatPercent = (num: number, decimals = 1) => {
    return `${num.toFixed(decimals)}%`;
  };

  // KPI Cards - use live data from hook
  const kpiCards = useMemo(() => {
    const kpis = data?.kpis || { units: 0, volume: 0, wac: 0, waFico: 0, waLtv: 0, waDti: 0 };
    return [
      { label: 'Units', value: formatNumber(kpis.units), icon: BarChart3, color: 'from-slate-500 to-slate-600' },
      { label: 'Volume', value: formatCurrency(kpis.volume), icon: TrendingUp, color: 'from-blue-500 to-blue-600' },
      { label: 'WAC', value: kpis.wac.toFixed(3), icon: PieChart, color: 'from-purple-500 to-purple-600' },
      { label: 'WA FICO', value: formatNumber(kpis.waFico), icon: ShieldCheck, color: 'from-emerald-500 to-emerald-600' },
      { label: 'WA LTV', value: kpis.waLtv.toFixed(1), icon: AlertCircle, color: 'from-amber-500 to-amber-600' },
      { label: 'WA DTI', value: kpis.waDti.toFixed(1), icon: CheckCircle2, color: 'from-rose-500 to-rose-600' },
    ];
  }, [data?.kpis]);

  const handleRangeClick = async (range: string, type: 'fico' | 'ltv' | 'dti') => {
    setSelectedRange({ range, type });
    setDrilldownLoading(true);
    setShowDrilldownModal(true);
    
    const title = type === 'fico' 
      ? `FICO Range: ${range}`
      : type === 'ltv'
      ? `LTV Range: ${range}`
      : `DTI Range: ${range}`;
    setDrilldownTitle(title);

    try {
      let url = '/api/metrics/credit-risk/loans';
      if (tenantId) url += `?tenant_id=${encodeURIComponent(tenantId)}`;
      const response = await api.request<{ loans: Loan[] }>(url, {
        method: 'POST',
        body: JSON.stringify({
          applicationType,
          dateRange,
          year: selectedYear,
          channel: selectedChannel,
          filterType: type,
          filterValue: range,
        }),
      });
      
      setDrilldownLoans(response?.loans || []);
    } catch (err) {
      console.error('Failed to fetch loans:', err);
      setDrilldownLoans([]);
    } finally {
      setDrilldownLoading(false);
    }
  };

  const handleCategoryClick = async (category: string) => {
    setSelectedCategory(category);
    setDrilldownLoading(true);
    setShowDrilldownModal(true);
    setDrilldownTitle(`${loanMixTab}: ${category}`);

    try {
      let url = '/api/metrics/credit-risk/loans';
      if (tenantId) url += `?tenant_id=${encodeURIComponent(tenantId)}`;
      const response = await api.request<{ loans: Loan[] }>(url, {
        method: 'POST',
        body: JSON.stringify({
          applicationType,
          dateRange,
          year: selectedYear,
          channel: selectedChannel,
          filterType: loanMixTab.toLowerCase().replace(' ', '_'),
          filterValue: category,
        }),
      });
      
      setDrilldownLoans(response?.loans || []);
    } catch (err) {
      console.error('Failed to fetch loans:', err);
      setDrilldownLoans([]);
    } finally {
      setDrilldownLoading(false);
    }
  };

  const enterCanvasMode = (entityId: string, entityType: 'category' | 'range', entityName: string) => {
    setCanvasMode(true);
    setCanvasEntityId(entityId);
    setCanvasEntityType(entityType);
    setCanvasEntityName(entityName);
  };

  const exitCanvas = () => {
    setCanvasMode(false);
    setCanvasEntityId(null);
    setCanvasEntityType(null);
    setCanvasEntityName('');
    setSelectedCategory(null);
    setSelectedRange(null);
  };

  // Selection handlers
  const getRangeKey = (card: string, range: string) => `${card}-${range}`;
  
  const handleRangeToggle = (card: string, range: string, e?: React.MouseEvent) => {
    if (e?.ctrlKey || e?.metaKey || isSelecting) {
      e?.preventDefault();
      setSelectedRanges(prev => {
        const newSet = new Set(prev);
        const key = getRangeKey(card, range);
        if (newSet.has(key)) {
          newSet.delete(key);
        } else {
          newSet.add(key);
        }
        return newSet;
      });
    } else {
      handleRangeClick(range, card as 'fico' | 'ltv' | 'dti');
    }
  };

  const handleMouseDown = (card: string, index: number, e: React.MouseEvent) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setIsSelecting(true);
      setSelectionStart({ card, index });
      const range = card === 'fico' ? data?.ficoDistribution[index]?.range :
                    card === 'ltv' ? data?.ltvDistribution[index]?.range :
                    data?.dtiDistribution[index]?.range;
      if (range) {
        handleRangeToggle(card, range, e);
      }
    }
  };

  const handleMouseEnter = (card: string, index: number, e: React.MouseEvent) => {
    if (isSelecting && selectionStart) {
      const range = card === 'fico' ? data?.ficoDistribution[index]?.range :
                    card === 'ltv' ? data?.ltvDistribution[index]?.range :
                    data?.dtiDistribution[index]?.range;
      if (range) {
        const key = getRangeKey(card, range);
        if (!selectedRanges.has(key)) {
          setSelectedRanges(prev => new Set(prev).add(key));
        }
      }
    }
  };

  useEffect(() => {
    const handleMouseUp = () => {
      setIsSelecting(false);
      setSelectionStart(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const handleAddToDashboard = () => {
    const selectedItems = Array.from(selectedRanges).map(key => {
      const [card, range] = key.split('-');
      const item = card === 'fico' ? data?.ficoDistribution.find(d => d.range === range) :
                   card === 'ltv' ? data?.ltvDistribution.find(d => d.range === range) :
                   data?.dtiDistribution.find(d => d.range === range);
      return { card, range, item };
    }).filter(Boolean);

    toast.success(`Selected ${selectedItems.length} item(s)`);
    setSelectedRanges(new Set());
  };

  const renderHorizontalBar = (item: DistributionBucket, maxUnits: number, color: string, type: 'fico' | 'ltv' | 'dti', index: number) => {
    const width = (item.units / maxUnits) * 100;
    const rangeKey = getRangeKey(type, item.range);
    const isSelected = selectedRanges.has(rangeKey);
    
    return (
      <div 
        ref={index === 0 ? selectionRef : undefined}
        className={cn(
          "mb-4 cursor-pointer group relative transition-all",
          isSelected && "ring-2 ring-teal-500 ring-offset-2 rounded-lg p-1"
        )}
        onClick={(e) => handleRangeToggle(type, item.range, e)}
        onMouseDown={(e) => handleMouseDown(type, index, e)}
        onMouseEnter={(e) => handleMouseEnter(type, index, e)}
      >
        {isSelected && (
          <div className="absolute -top-1 -right-1 z-10 bg-teal-500 text-white rounded-full p-0.5">
            <CheckSquare className="w-3 h-3" />
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <span className={cn(
            "text-xs font-semibold transition-colors",
            isSelected ? "text-teal-600 dark:text-teal-400" : "text-slate-700 dark:text-slate-300 group-hover:text-teal-600 dark:group-hover:text-teal-400"
          )}>{item.range}</span>
          <div className="flex items-center gap-3">
            <span className={cn(
              "text-xs font-bold tabular-nums transition-colors",
              isSelected ? "text-teal-600 dark:text-teal-400" : "text-slate-900 dark:text-white group-hover:text-teal-600 dark:group-hover:text-teal-400"
            )}>{formatNumber(item.units)}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{formatPercent(item.percentage)}</span>
            {!isSelected && <Plus className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />}
          </div>
        </div>
        <div className="relative h-7 bg-slate-100 dark:bg-slate-700/50 rounded-lg overflow-hidden group-hover:shadow-md transition-all">
          <div
            className={cn(
              "h-full rounded-lg transition-all duration-300",
              isSelected ? "ring-2 ring-teal-500" : "group-hover:brightness-110",
              color
            )}
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
    );
  };

  // Calculate max units for distribution charts (for bar width scaling)
  const maxFicoUnits = useMemo(() => {
    const distributions = data?.ficoDistribution || [];
    return distributions.length > 0 ? Math.max(...distributions.map(d => d.units)) : 1;
  }, [data?.ficoDistribution]);
  
  const maxLtvUnits = useMemo(() => {
    const distributions = data?.ltvDistribution || [];
    return distributions.length > 0 ? Math.max(...distributions.map(d => d.units)) : 1;
  }, [data?.ltvDistribution]);
  
  const maxDtiUnits = useMemo(() => {
    const distributions = data?.dtiDistribution || [];
    return distributions.length > 0 ? Math.max(...distributions.map(d => d.units)) : 1;
  }, [data?.dtiDistribution]);

  // Get current loan mix based on selected tab
  const currentLoanMix = useMemo(() => {
    if (!data) return [];
    return loanMixTab === 'Loan Type' 
      ? data.loanMixByType 
      : loanMixTab === 'Loan Purpose' 
      ? data.loanMixByPurpose 
      : data.loanMixByOccupancy;
  }, [data, loanMixTab]);

  // Calculate totals for loan mix table
  const loanMixTotals = useMemo(() => calculateLoanMixTotals(currentLoanMix), [currentLoanMix]);

  const avgWac = loanMixTotals.avgWac;
  const avgFico = loanMixTotals.avgFico;
  const avgLtv = loanMixTotals.avgLtv;
  const avgDti = loanMixTotals.avgDti;

  // Credit Risk Story - Use data from backend API
  // ⚠️ Uses volumePercent NOT unitsPercent - Qlik uses Sum([Loan Amount]) for story items
  const storyData = useMemo(() => {
    if (!data?.creditRiskStory) {
      return {
        largestLoanType: { category: 'N/A', volumePercent: 0 },
        largestLoanPurpose: { category: 'N/A', volumePercent: 0 },
        largestOccupancy: { category: 'N/A', volumePercent: 0 },
        conventionalQualifiedPercent: 0,
        governmentQualifiedPercent: 0
      };
    }
    return data.creditRiskStory;
  }, [data?.creditRiskStory]);

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Credit Risk Management" />}>
        <main className={cn(DASHBOARD_MAIN_CLASSNAME, isDarkMode ? 'bg-slate-900' : 'bg-transparent')}>
        <DashboardPageContent>
        {/* Header Section */}
        <div className="flex flex-col gap-6">
          {/* Canvas Mode Exit Button */}
          {canvasMode && (
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-9 w-9 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                onClick={exitCanvas}
                title="Exit Canvas Mode"
              >
                <Minimize2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              </Button>
            </div>
          )}

          {/* Filters - DatePeriodPicker and Application Type */}
          <div className="bg-white dark:bg-slate-800/50 rounded-xl p-5 border border-slate-200/60 dark:border-slate-700/60 shadow-sm">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-end flex-wrap">
              {/* Application Type */}
              <div className="min-w-[180px]">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 block uppercase tracking-wider">
                  Application Type
                </label>
                <select
                  value={applicationType}
                  onChange={(e) => setApplicationType(e.target.value as ApplicationType)}
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                >
                  <option>Applications Taken</option>
                  <option>Funded Production</option>
                  <option>Lost Opportunities</option>
                  <option>All Loans</option>
                </select>
              </div>
              
              {/* Date Period Picker */}
              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 block uppercase tracking-wider">
                  Date Range
                </label>
                <DatePeriodPicker
                  year={selectedYear}
                  onYearChange={setSelectedYear}
                  onDateRangeChange={setDateRange}
                  onPeriodChange={setPeriodSelection}
                  periodSelectionFromStore={periodSelection}
                  yearsToShow={4}
                  size="default"
                />
              </div>
              
            </div>
            
            {/* Error display */}
            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </p>
              </div>
            )}
          </div>
        </div>

          <DashboardInsightsStrip
            insights={dashboardInsights}
            generatedAt={dashboardInsightsGeneratedAt}
            loading={dashboardInsightsLoading}
            generating={generateLoading}
            generateError={generateError}
            onClearGenerateError={() => setGenerateError(null)}
            onShowInsight={handleShowInsight}
            onGenerate={handleGenerateInsights}
            onRefreshInsights={refreshDashboardInsights}
            showGenerateButton
            showFeedback
            onSubmitFeedback={async (insightId, rating, tags, comment) => {
              try {
                await api.submitDashboardInsightFeedback(insightId, rating, tags, comment, selectedTenantId);
                return true;
              } catch {
                return false;
              }
            }}
            dateFilter="ytd"
            selectedTenantId={selectedTenantId}
          />

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
            <span className="ml-3 text-slate-600">Loading data...</span>
          </div>
        ) : (
          <>
            {/* Credit Risk Story - Full Width, Cleaner Design */}
            <div id="credit-risk-story-panel" className="relative bg-white dark:bg-slate-800/50 rounded-2xl p-8 border border-slate-200/60 dark:border-slate-700/60 shadow-sm overflow-hidden scroll-mt-24">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-purple-100/30 to-transparent rounded-full blur-3xl opacity-50" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-teal-100/30 to-transparent rounded-full blur-2xl opacity-50" />
              
              <div className="relative">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                    <ShieldCheck className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">Credit Risk Story</h2>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      {applicationType} Loan Mix
                    </h3>
                    <ul className="space-y-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                      <li className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-purple-500 mt-2 flex-shrink-0" />
                        <span>
                          <span className="font-semibold text-slate-900 dark:text-white">{storyData.largestLoanType.category}</span> is the largest Loan Type Category with a{' '}
                          <span className="font-bold text-purple-600 dark:text-purple-400">{formatPercent(storyData.largestLoanType.volumePercent, 0)}</span> share.
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-purple-500 mt-2 flex-shrink-0" />
                        <span>
                          <span className="font-semibold text-slate-900 dark:text-white">{storyData.largestLoanPurpose.category}</span> is the largest Loan Purpose Category with a{' '}
                          <span className="font-bold text-purple-600 dark:text-purple-400">{formatPercent(storyData.largestLoanPurpose.volumePercent, 0)}</span> share.
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-purple-500 mt-2 flex-shrink-0" />
                        <span>
                          <span className="font-semibold text-slate-900 dark:text-white">{storyData.largestOccupancy.category}</span> is the largest Occupancy Category with a{' '}
                          <span className="font-bold text-purple-600 dark:text-purple-400">{formatPercent(storyData.largestOccupancy.volumePercent, 0)}</span> share.
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2 flex-shrink-0" />
                        <span>
                          Conventional loans with credit score <span className="font-semibold text-slate-900 dark:text-white">&gt; 680</span>, DTI <span className="font-semibold text-slate-900 dark:text-white">&lt; 43%</span>, LTV <span className="font-semibold text-slate-900 dark:text-white">&lt; 80%</span> ={' '}
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">{storyData.conventionalQualifiedPercent}%</span>.
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                        <span>
                          Government loans with credit score <span className="font-semibold text-slate-900 dark:text-white">&gt; 620</span>, DTI <span className="font-semibold text-slate-900 dark:text-white">&lt; 50%</span>, LTV <span className="font-semibold text-slate-900 dark:text-white">&lt; 100%</span> ={' '}
                          <span className="font-bold text-blue-600 dark:text-blue-400">{storyData.governmentQualifiedPercent}%</span>.
                        </span>
                      </li>
                    </ul>
                  </div>

                  <div className="lg:pl-8 lg:border-l lg:border-slate-200/60 dark:lg:border-slate-700/60">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 uppercase tracking-wider">
                      Portfolio Summary
                    </h3>
                    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                      <div className="flex items-start gap-3 p-3 bg-slate-50/50 dark:bg-slate-800/50 rounded-lg border border-slate-200/50 dark:border-slate-700/30">
                        <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-white">Weighted Average FICO Score:</span>{' '}
                          <span className="font-bold text-blue-600 dark:text-blue-400">{formatNumber(data?.kpis?.waFico || 0)}</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-slate-50/50 dark:bg-slate-800/50 rounded-lg border border-slate-200/50 dark:border-slate-700/30">
                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-white">Weighted Average LTV:</span>{' '}
                          <span className="font-bold text-amber-600 dark:text-amber-400">{(data?.kpis?.waLtv || 0).toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-slate-50/50 dark:bg-slate-800/50 rounded-lg border border-slate-200/50 dark:border-slate-700/30">
                        <CheckCircle2 className="w-5 h-5 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-white">Weighted Average DTI:</span>{' '}
                          <span className="font-bold text-rose-600 dark:text-rose-400">{(data?.kpis?.waDti || 0).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* KPI Cards – shared widget components */}
            <div id="credit-risk-kpi-cards" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 scroll-mt-24">
              {(() => {
                const kpis = data?.kpis || { units: 0, volume: 0, wac: 0, waFico: 0, waLtv: 0, waDti: 0 };
                const kpiItems: Array<{ value: number; label: string; format: 'number' | 'currency' | 'ratio' | 'percent'; color: string }> = [
                  { value: kpis.units, label: 'Units', format: 'number', color: 'blue' },
                  { value: kpis.volume, label: 'Volume', format: 'currency', color: 'emerald' },
                  { value: kpis.wac, label: 'WAC', format: 'ratio', color: 'violet' },
                  { value: kpis.waFico, label: 'WA FICO', format: 'number', color: 'amber' },
                  { value: kpis.waLtv, label: 'WA LTV', format: 'percent', color: 'sky' },
                  { value: kpis.waDti, label: 'WA DTI', format: 'percent', color: 'rose' },
                ];
                return kpiItems.map((item) => (
                  <KPICard
                    key={item.label}
                    data={{ value: item.value, label: item.label, format: item.format }}
                    loading={false}
                    error={null}
                    width={180}
                    height={120}
                    config={{ color: item.color }}
                  />
                ));
              })()}
            </div>

            {/* Charts and Table Section */}
            <div className="space-y-6">
              {/* Distribution Charts - Enhanced Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* FICO Distribution */}
                <div id="credit-risk-fico-distribution" className="bg-white dark:bg-slate-800/50 rounded-xl p-6 border border-slate-200/60 dark:border-slate-700/60 shadow-sm scroll-mt-24">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                      FICO Distribution
                    </h3>
                    <Select value={ficoDateRange} onValueChange={(v: 'MTD' | 'YTD' | 'Custom') => setFicoDateRange(v)}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MTD">MTD</SelectItem>
                        <SelectItem value="YTD">YTD</SelectItem>
                        <SelectItem value="Custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    {(data?.ficoDistribution || []).map((item, idx) => {
                      const colors = [
                        'bg-gradient-to-r from-emerald-500 to-emerald-600',
                        'bg-gradient-to-r from-teal-500 to-teal-600',
                        'bg-gradient-to-r from-cyan-500 to-cyan-600',
                        'bg-gradient-to-r from-blue-500 to-blue-600',
                        'bg-gradient-to-r from-amber-500 to-amber-600',
                        'bg-gradient-to-r from-rose-500 to-rose-600',
                      ];
                      return (
                        <div key={`fico-${item.range}`}>
                          {renderHorizontalBar(item, maxFicoUnits, colors[idx % colors.length], 'fico', idx)}
                        </div>
                      );
                    })}
                    {(!data?.ficoDistribution || data.ficoDistribution.length === 0) && (
                      <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">No FICO data available</div>
                    )}
                  </div>
                </div>

                {/* LTV Distribution */}
                <div id="credit-risk-ltv-distribution" className="bg-white dark:bg-slate-800/50 rounded-xl p-6 border border-slate-200/60 dark:border-slate-700/60 shadow-sm scroll-mt-24">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                      LTV Distribution
                    </h3>
                    <Select value={ltvDateRange} onValueChange={(v: 'MTD' | 'YTD' | 'Custom') => setLtvDateRange(v)}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MTD">MTD</SelectItem>
                        <SelectItem value="YTD">YTD</SelectItem>
                        <SelectItem value="Custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    {(data?.ltvDistribution || []).map((item, idx) => {
                      const colors = [
                        'bg-gradient-to-r from-purple-500 to-purple-600',
                        'bg-gradient-to-r from-indigo-500 to-indigo-600',
                        'bg-gradient-to-r from-blue-500 to-blue-600',
                        'bg-gradient-to-r from-cyan-500 to-cyan-600',
                        'bg-gradient-to-r from-teal-500 to-teal-600',
                        'bg-gradient-to-r from-emerald-500 to-emerald-600',
                      ];
                      return (
                        <div key={`ltv-${item.range}`}>
                          {renderHorizontalBar(item, maxLtvUnits, colors[idx % colors.length], 'ltv', idx)}
                        </div>
                      );
                    })}
                    {(!data?.ltvDistribution || data.ltvDistribution.length === 0) && (
                      <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">No LTV data available</div>
                    )}
                  </div>
                </div>

                {/* DTI Distribution */}
                <div id="credit-risk-dti-distribution" className="bg-white dark:bg-slate-800/50 rounded-xl p-6 border border-slate-200/60 dark:border-slate-700/60 shadow-sm scroll-mt-24">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                      DTI Distribution
                    </h3>
                    <Select value={dtiDateRange} onValueChange={(v: 'MTD' | 'YTD' | 'Custom') => setDtiDateRange(v)}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MTD">MTD</SelectItem>
                        <SelectItem value="YTD">YTD</SelectItem>
                        <SelectItem value="Custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    {(data?.dtiDistribution || []).map((item, idx) => {
                      const colors = [
                        'bg-gradient-to-r from-rose-500 to-rose-600',
                        'bg-gradient-to-r from-pink-500 to-pink-600',
                        'bg-gradient-to-r from-amber-500 to-amber-600',
                        'bg-gradient-to-r from-orange-500 to-orange-600',
                        'bg-gradient-to-r from-red-500 to-red-600',
                        'bg-gradient-to-r from-rose-600 to-rose-700',
                      ];
                      return (
                        <div key={`dti-${item.range}`}>
                          {renderHorizontalBar(item, maxDtiUnits, colors[idx % colors.length], 'dti', idx)}
                        </div>
                      );
                    })}
                    {(!data?.dtiDistribution || data.dtiDistribution.length === 0) && (
                      <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">No DTI data available</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Selection Summary and Actions */}
              {selectedRanges.size > 0 && (
                <div className="bg-gradient-to-r from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20 border border-teal-200 dark:border-teal-800 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckSquare className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {selectedRanges.size} item{selectedRanges.size !== 1 ? 's' : ''} selected
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          {Array.from(selectedRanges).slice(0, 3).map(key => {
                            const [card, range] = key.split('-');
                            return `${card.toUpperCase()} ${range}`;
                          }).join(', ')}
                          {selectedRanges.size > 3 && ` +${selectedRanges.size - 3} more`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedRanges(new Set())}
                        className="text-xs"
                      >
                        <X className="w-3.5 h-3.5 mr-1.5" />
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleAddToDashboard}
                        className="bg-teal-600 hover:bg-teal-700 text-white text-xs"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        Add to Dashboard
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Loan Mix Table - Enhanced Design */}
              <div id="credit-risk-loan-mix-table" className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm overflow-hidden scroll-mt-24">
                <div className="p-6 border-b border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-r from-slate-50/50 to-white dark:from-slate-800/50 dark:to-slate-800/30">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                      Loan Mix
                    </h3>
                    <div className="flex gap-1.5 bg-slate-100/60 dark:bg-slate-700/50 p-1 rounded-lg border border-slate-200/50 dark:border-slate-700/50">
                      {(['Loan Type', 'Loan Purpose', 'Occupancy'] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setLoanMixTab(tab)}
                          className={cn(
                            "px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200",
                            loanMixTab === tab
                              ? "bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-md"
                              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-slate-600/50"
                          )}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gradient-to-r from-slate-50 via-slate-100/50 to-slate-50 dark:from-slate-800/50 dark:via-slate-700/30 dark:to-slate-800/50 border-b border-slate-200/60 dark:border-slate-700/60">
                        <th className="py-4 px-4 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">{loanMixTab}</th>
                        <th className="py-4 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Units</th>
                        <th className="py-4 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Units %</th>
                        <th className="py-4 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Volume</th>
                        <th className="py-4 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Volume %</th>
                        <th className="py-4 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">WAC</th>
                        <th className="py-4 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">WA FICO</th>
                        <th className="py-4 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">WA LTV</th>
                        <th className="py-4 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">WA DTI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentLoanMix.map((row) => {
                        const categoryKey = getRangeKey(loanMixTab.toLowerCase().replace(' ', '-'), row.category);
                        const isRowSelected = selectedRanges.has(categoryKey);
                        return (
                          <tr 
                            key={`${loanMixTab}-${row.category}`}
                            onClick={(e) => {
                              if (e.ctrlKey || e.metaKey) {
                                handleRangeToggle(loanMixTab.toLowerCase().replace(' ', '-'), row.category, e);
                              } else {
                                handleCategoryClick(row.category);
                              }
                            }}
                            className={cn(
                              "border-b border-slate-100/60 dark:border-slate-700/40 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors duration-150 group cursor-pointer",
                              isRowSelected && "bg-teal-50 dark:bg-teal-900/20 ring-2 ring-teal-500"
                            )}
                          >
                          <td className="py-4 px-4 text-left text-sm font-semibold text-slate-900 dark:text-white group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors flex items-center gap-2">
                            {isRowSelected && <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
                            {row.category}
                            {!isRowSelected && <Plus className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />}
                          </td>
                          <td className="py-4 px-4 text-right text-sm font-semibold text-slate-900 dark:text-white tabular-nums">{formatNumber(row.units)}</td>
                          <td className="py-4 px-4 text-right text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums">{formatPercent(row.unitsPercent)}</td>
                          <td className="py-4 px-4 text-right text-sm font-semibold text-slate-900 dark:text-white tabular-nums">{formatCurrency(row.volume)}</td>
                          <td className="py-4 px-4 text-right text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums">{formatPercent(row.volumePercent)}</td>
                          <td className="py-4 px-4 text-right text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums">{row.wac.toFixed(3)}</td>
                          <td className="py-4 px-4 text-right text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums">{formatNumber(row.waFico)}</td>
                          <td className="py-4 px-4 text-right text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums">{row.waLtv.toFixed(1)}</td>
                          <td className="py-4 px-4 text-right text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums">{row.waDti.toFixed(1)}</td>
                        </tr>
                        );
                      })}
                      <tr className="bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-700/30 border-t-2 border-slate-300/50 dark:border-slate-600/50 font-semibold">
                        <td className="py-4 px-4 text-left text-sm text-slate-900 dark:text-white">Totals</td>
                        <td className="py-4 px-4 text-right text-sm text-slate-900 dark:text-white tabular-nums">{formatNumber(loanMixTotals.totalUnits)}</td>
                        <td className="py-4 px-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">100.0%</td>
                        <td className="py-4 px-4 text-right text-sm text-slate-900 dark:text-white tabular-nums">{formatCurrency(loanMixTotals.totalVolume)}</td>
                        <td className="py-4 px-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">100.0%</td>
                        <td className="py-4 px-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">{avgWac.toFixed(3)}</td>
                        <td className="py-4 px-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">{formatNumber(Math.round(avgFico))}</td>
                        <td className="py-4 px-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">{avgLtv.toFixed(1)}</td>
                        <td className="py-4 px-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">{avgDti.toFixed(1)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Canvas Mode Banner */}
        {canvasMode && canvasEntityName && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 bg-gradient-to-r from-teal-500 to-teal-600 text-white px-6 py-3 rounded-xl shadow-xl flex items-center gap-4">
            <Maximize2 className="w-5 h-5" />
            <span className="font-semibold">Canvas Mode: {canvasEntityName}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={exitCanvas}
              className="text-white hover:bg-white/20"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
        </DashboardPageContent>
      </main>
      </TopTieringPageFrame>

      {/* Enhanced Drilldown Modal */}
      <Dialog open={showDrilldownModal} onOpenChange={setShowDrilldownModal}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{drilldownTitle}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {applicationType} • {selectedYear} {dateRange ? `(${dateRange.start} to ${dateRange.end})` : 'YTD'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedRange) {
                      enterCanvasMode(selectedRange.range, 'range', drilldownTitle);
                    } else if (selectedCategory) {
                      enterCanvasMode(selectedCategory, 'category', drilldownTitle);
                    }
                    setShowDrilldownModal(false);
                  }}
                  className="hover:bg-teal-50 dark:hover:bg-teal-950/20"
                >
                  <Maximize2 className="w-4 h-4 mr-2" />
                  Canvas View
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          
          {drilldownLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
              <span className="ml-3 text-slate-600 dark:text-slate-400">Loading loans...</span>
            </div>
          ) : drilldownLoans.length === 0 ? (
            <div className="text-center py-20 text-slate-500 dark:text-slate-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
              <p className="text-lg font-medium mb-2">No loans found</p>
              <p className="text-sm">No loans match the selected criteria.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Statistics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 rounded-xl p-4 border border-blue-200/50 dark:border-blue-800/30">
                  <div className="text-xs font-medium text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-1">Total Loans</div>
                  <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{drilldownLoans.length}</div>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 rounded-xl p-4 border border-emerald-200/50 dark:border-emerald-800/30">
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-1">Total Volume</div>
                  <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                    {formatCurrency(drilldownLoans.reduce((sum, loan) => sum + (loan.amountValue || 0), 0))}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 rounded-xl p-4 border border-purple-200/50 dark:border-purple-800/30">
                  <div className="text-xs font-medium text-purple-700 dark:text-purple-400 uppercase tracking-wider mb-1">Avg FICO</div>
                  <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                    {drilldownLoans.filter(l => l.ficoScore).length > 0
                      ? Math.round(drilldownLoans.reduce((sum, loan) => sum + (loan.ficoScore || 0), 0) / drilldownLoans.filter(l => l.ficoScore).length)
                      : '—'}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/20 rounded-xl p-4 border border-amber-200/50 dark:border-amber-800/30">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1">Risk Score</div>
                  <div className="text-2xl font-bold text-amber-900 dark:text-amber-100">
                    {Math.round(drilldownLoans.reduce((sum, loan) => sum + loan.riskScore, 0) / drilldownLoans.length)}
                  </div>
                </div>
              </div>

              {/* Risk Distribution */}
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200/60 dark:border-slate-700/60">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Risk Distribution</h4>
                <div className="grid grid-cols-3 gap-3">
                  {['Low', 'Medium', 'Very High'].map((level) => {
                    const count = drilldownLoans.filter(l => l.riskLevel === level).length;
                    const percentage = (count / drilldownLoans.length) * 100;
                    const colors = {
                      'Low': 'from-emerald-500 to-emerald-600',
                      'Medium': 'from-amber-500 to-amber-600',
                      'Very High': 'from-rose-500 to-rose-600'
                    };
                    return (
                      <div key={level} className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{level}</span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{count}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full bg-gradient-to-r rounded-full transition-all duration-500", colors[level as keyof typeof colors])}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{percentage.toFixed(1)}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Loans List */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Loan Details ({drilldownLoans.length} {drilldownLoans.length === 1 ? 'loan' : 'loans'})
                  </h4>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Click on a loan to view full details
                  </div>
                </div>
                <div className="grid gap-3 max-h-[400px] overflow-y-auto pr-2">
                  {drilldownLoans.map((loan) => {
                    const ficoStatus = loan.ficoScore 
                      ? (loan.ficoScore < 620 ? 'critical' : loan.ficoScore < 700 ? 'warning' : 'success')
                      : 'neutral';
                    const ltvStatus = loan.ltvRatio
                      ? (loan.ltvRatio > 95 ? 'critical' : loan.ltvRatio > 80 ? 'warning' : 'success')
                      : 'neutral';
                    const dtiStatus = loan.dtiRatio
                      ? (loan.dtiRatio > 43 ? 'critical' : loan.dtiRatio > 36 ? 'warning' : 'success')
                      : 'neutral';

                    const getStatusColor = (status: string) => {
                      if (status === 'critical') return 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/20';
                      if (status === 'warning') return 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20';
                      if (status === 'success') return 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20';
                      return 'text-slate-400 bg-slate-100 dark:text-slate-500 dark:bg-slate-800';
                    };

                    return (
                      <div
                        key={loan.id}
                        onClick={() => {
                          setSelectedLoan(loan);
                          setShowDrilldownModal(false);
                        }}
                        className="p-5 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-lg transition-all cursor-pointer group"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-3">
                            {/* Header */}
                            <div className="flex items-center gap-3">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-semibold text-slate-900 dark:text-white">{loan.id}</span>
                                  {loan.loanType && (
                                    <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 font-medium">
                                      {loan.loanType}
                                    </span>
                                  )}
                                  <span className={cn(
                                    "text-xs px-2 py-0.5 rounded-full font-medium",
                                    loan.riskLevel === 'Very High' && "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400",
                                    loan.riskLevel === 'Medium' && "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
                                    loan.riskLevel === 'Low' && "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                                  )}>
                                    {loan.riskLevel}
                                  </span>
                                </div>
                                <div className="text-sm text-slate-600 dark:text-slate-400">
                                  <span className="font-medium text-slate-900 dark:text-white">{loan.borrower}</span> • {loan.officer}
                                </div>
                              </div>
                            </div>

                            {/* Metrics Grid */}
                            <div className="grid grid-cols-4 gap-2">
                              <div className={cn("p-2.5 rounded-lg text-center", getStatusColor(ficoStatus))}>
                                <div className="text-lg font-bold">{loan.ficoScore || '—'}</div>
                                <div className="text-[10px] uppercase tracking-wider font-medium opacity-70">FICO</div>
                              </div>
                              <div className={cn("p-2.5 rounded-lg text-center", getStatusColor(ltvStatus))}>
                                <div className="text-lg font-bold">{loan.ltvRatio ? `${loan.ltvRatio.toFixed(0)}%` : '—'}</div>
                                <div className="text-[10px] uppercase tracking-wider font-medium opacity-70">LTV</div>
                              </div>
                              <div className={cn("p-2.5 rounded-lg text-center", getStatusColor(dtiStatus))}>
                                <div className="text-lg font-bold">{loan.dtiRatio ? `${loan.dtiRatio.toFixed(0)}%` : '—'}</div>
                                <div className="text-[10px] uppercase tracking-wider font-medium opacity-70">DTI</div>
                              </div>
                              <div className="p-2.5 rounded-lg text-center bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border border-blue-200/50 dark:border-blue-800/30">
                                <div className="text-lg font-bold text-blue-900 dark:text-blue-100">{loan.amount}</div>
                                <div className="text-[10px] uppercase tracking-wider font-medium text-blue-700 dark:text-blue-400 opacity-70">Amount</div>
                              </div>
                            </div>

                            {/* Additional Info */}
                            {loan.status && (
                              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span>Status: <span className="font-medium text-slate-700 dark:text-slate-300">{loan.status}</span></span>
                                {loan.reason && (
                                  <>
                                    <span>•</span>
                                    <span>Reason: <span className="font-medium text-slate-700 dark:text-slate-300">{loan.reason}</span></span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-slate-300 dark:text-slate-600 group-hover:text-teal-500 dark:group-hover:text-teal-400 transition-colors">
                              <ChevronRight className="w-5 h-5" />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Loan Drilldown Modal */}
      {selectedLoan && (
        <LoanDrilldownModal
          loan={selectedLoan}
          isOpen={!!selectedLoan}
          onClose={() => setSelectedLoan(null)}
          isDarkMode={isDarkMode}
          hideRiskScoreAndLabel
        />
      )}
    </TopTieringLayout>
  );
}

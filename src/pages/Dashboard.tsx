// Dashboard main insights page
import { useEffect, useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Phone,
  FileCheck,
  AlertTriangle,
  TrendingUp,
  Users,
  DollarSign,
  Clock,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Target,
  MessageSquare,
  X,
  FileSpreadsheet,
  FileText,
  Presentation,
  Bell,
  BellOff,
  Activity,
  CheckCircle2,
  Info,
  Zap,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Newspaper,
  Building2,
  ExternalLink,
  Pause,
  Play,
  Minimize2,
  Maximize2,
  KeyRound,
  CalendarDays,
  Pin,
  Archive,
  Medal,
  Award,
  Star,
  Crown,
  Rocket,
  Timer,
  ShieldCheck,
  Gauge,
  CircleCheck,
  Settings,
  Check,
  RefreshCw,
  MoreVertical,
  Search,
  Database,
  Loader2,
  ClipboardList,
} from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { SeedDataButton } from "@/components/dashboard/SeedDataButton";
import { useToast } from "@/hooks/use-toast";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { DashboardContainer } from "@/components/dashboard/DashboardContainer";
import { useDashboardState } from "@/hooks/useDashboardState";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { useDashboardVisibility } from "@/hooks/useDashboardVisibility";
import { UsageDisplay } from "@/components/billing/UsageDisplay";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import { Copy, Code2, Sparkles } from "lucide-react";
import { AletheiaVoiceAssistant } from "@/components/aletheia/AletheiaVoiceAssistant";
import { CohiPodcast } from "@/components/cohi/CohiPodcast";
import { motion, AnimatePresence } from "framer-motion";
import { generatePDF } from "@/utils/pdfExport";
import {
  ReportsSidebar,
  DashboardVisibility,
} from "@/components/dashboard/ReportsSidebar";
import { ReportModal } from "@/components/dashboard/ReportModal";
import { ReportData, allReports } from "@/data/reportSimulations";
import { useEdit } from "@/contexts/EditContext";
import { useAuth } from "@/contexts/AuthContext";
import { EditableText, EditableNumber } from "@/components/ui/EditableText";
import {
  LOSFunnelData,
  LOSApiResponse,
  mapLOSDataToUniversalSchema,
} from "@/lib/losSchema";
import { FunnelVisualization } from "@/components/FunnelVisualization";
import { FunnelDataPoint } from "@/types/funnel";
import { useTheme } from "@/components/theme-provider";
import {
  formatCompactNumber,
  formatCompactNumberNoCurrency,
} from "@/utils/formatting";
import {
  getUrgencyColor,
  getUrgencyDot,
  getAnimatedValue,
  getSmoothProgress,
  getFilteredKPI,
} from "@/utils/dashboardHelpers";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { IndustryNewsCard } from "@/components/dashboard/IndustryNewsCard";
import { BusinessDataTable } from "@/components/dashboard/BusinessDataTable";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { DataTable } from "@/components/dashboard/DataTable";
import { ExecutiveDashboard } from "@/components/dashboard/ExecutiveDashboard";
import { AletheiaPromptsCard } from "@/components/dashboard/AletheiaPromptsCard";
import { LeaderBoardSection } from "@/components/dashboard/LeaderBoardSection";
import { LoanFunnelView } from "@/components/views/LoanFunnelView";
import { TopTieringModal } from "@/components/dashboard/modals/TopTieringModal";
import { TrendsModal } from "@/components/dashboard/modals/TrendsModal";
import { ForecastingModal } from "@/components/dashboard/modals/ForecastingModal";
import { ContactModal } from "@/components/dashboard/modals/ContactModal";
import { MetricModal } from "@/components/dashboard/modals/MetricModal";
import { RiskModal } from "@/components/dashboard/modals/RiskModal";
import { PullThroughModal } from "@/components/dashboard/modals/PullThroughModal";
import { ExportModal } from "@/components/dashboard/modals/ExportModal";
import { ShareModal } from "@/components/dashboard/modals/ShareModal";
import { EmbedModal } from "@/components/dashboard/modals/EmbedModal";
import { FalloutModal } from "@/components/dashboard/modals/FalloutModal";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";

// CompanyDetailView, SalesView, and OpsView have been extracted to:
// - src/components/dashboard/views/CompanyDetailView.tsx
// - src/components/dashboard/views/SalesView.tsx
// - src/components/dashboard/views/OpsView.tsx

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  // Use AuthContext for proper authentication (not useEdit)
  const {
    isAuthenticated: authContextAuthenticated,
    user,
    logout: authLogout,
  } = useAuth();
  // Keep useEdit for content editing only (auth properties are deprecated)
  const editContext = useEdit();

  // Use custom hooks for state management
  const dashboardState = useDashboardState();
  const dashboardFilters = useDashboardFilters();
  const { dashboardVisibility, isLoadingVisibility, handleVisibilityChange } =
    useDashboardVisibility();

  // Local state for loading and error handling
  // Note: Authentication is now handled by ProtectedRoute wrapper in App.tsx
  // If we reach this component, user is already authenticated via AuthContext
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<Error | null>(null);

  // Use auth from AuthContext - this component is protected by ProtectedRoute
  const isAuthenticated = authContextAuthenticated;

  // User state for greeting - derive from AuthContext user
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Tenant selection from global store (shared with Navigation header)
  const { selectedTenantId, setSelectedTenantId } = useTenantStore();


  // Track user ID to detect user changes and reset state
  // Initialize with current user ID to avoid resetting on first mount
  const [prevUserId, setPrevUserId] = useState<string | null>(
    () => user?.id || null,
  );

  // Reset tenant selection only when user actually changes (login/logout/switch)
  // This preserves tenant selection during normal navigation
  useEffect(() => {
    const currentUserId = user?.id || null;

    // Only trigger when there's an actual user change (not on first mount)
    // prevUserId being different AND currentUserId being set means user changed
    if (
      prevUserId !== null &&
      currentUserId !== null &&
      currentUserId !== prevUserId
    ) {
      console.log("[Dashboard] User changed, resetting tenant selection", {
        from: prevUserId,
        to: currentUserId,
        newRole: user?.role,
      });

      // Set tenant based on new user's role
      if (user?.role === "tenant_admin" && user?.tenant_id) {
        setSelectedTenantId(user.tenant_id);
      } else {
        // For platform admins, don't reset - let them keep their selection
        // Only reset if switching from one user to another
        setSelectedTenantId(null);
      }
    }

    // Always track current user ID
    if (currentUserId !== prevUserId) {
      setPrevUserId(currentUserId);
    }
  }, [user?.id, user?.role, user?.tenant_id, prevUserId, setSelectedTenantId]);

  // Channel filter state - uses global store (shared with Navigation header)
  const { selectedChannel, setSelectedChannel } = useChannelStore();

  // Briefing context state
  const [briefingContext, setBriefingContext] = useState<{
    dialogues?: Array<{ message: string; type: string; priority: string }>;
    funnelStory?: {
      conversionRates: any;
      falloutData: any;
      lostRevenue: any;
    };
    userName?: string;
  } | null>(null);

  // Catch unhandled errors (ignore third-party lib noise like rrweb MutationObserver errors)
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = event.message || event.error?.message || "";
      if (msg.includes("node.matches is not a function") || msg.includes("rrweb")) {
        event.preventDefault();
        return;
      }
      console.error("Unhandled error:", event.error);
      setPageError(event.error);
    };

    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);

  // Destructure state from hooks for easier access
  const {
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
    setReportModalOpen,
  } = dashboardState;

  const {
    dateFilter,
    setDateFilter,
    customDateRange,
    setCustomDateRange,
    customDateLabel,
    customDatePopoverOpen,
    setCustomDatePopoverOpen,
    currentYear,
    handleCustomRangeSelect,
  } = dashboardFilters;

  // Helper function to get filter-based KPI values for reports
  // Now imported from utils/dashboardHelpers.ts

  // Report sidebar and modal - state is now managed by useDashboardState hook
  const totalEmployees = 100;

  // Tier percentages: Top 20%, Middle 30%, Bottom 50%
  const tierPercentages = {
    top: 20,
    middle: 30,
    bottom: 50,
  };

  // Set up display name from user data
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
  }, [user?.full_name, user?.email]);

  // Authentication is now fully handled by AuthContext and ProtectedRoute
  // This component only renders when user is already authenticated
  // No need to check auth here - just set up the dashboard state
  useEffect(() => {
    if (isAuthenticated) {
      sessionStorage.setItem("dashboard_auth", "authenticated");
    }
  }, [isAuthenticated]);

  // Fetch briefing context data (insights and funnel data)
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || briefingLoading) return;

    const fetchBriefingContext = async () => {
      // Check if user has a valid token before making API calls
      if (!api.hasToken()) {
        // No token - set empty context, briefing will still work
        setBriefingContext({
          dialogues: [],
          funnelStory: null,
          userName: undefined,
        });
        return;
      }

      setBriefingLoading(true);
      setBriefingError(null);

      try {
        // Fetch insights/dialogues with tenant support
        const tenantParam = selectedTenantId
          ? `&tenant_id=${selectedTenantId}`
          : "";
        // Don't send channel filter when "All" is selected
        const channelParam =
          selectedChannel && selectedChannel !== "All"
            ? `&channel_group=${encodeURIComponent(selectedChannel)}`
            : "";
        const insightsData = await api.request<any>(
          `/api/dashboard/insights?dateFilter=${dateFilter}${tenantParam}${channelParam}`,
        );
        const dialogues =
          insightsData?.insights?.map((insight: any) => ({
            message: insight.message || "",
            type: insight.type || "info",
            priority: insight.priority || "standard",
          })) || [];

        // Fetch funnel data with tenant support
        let funnelStory = null;
        try {
          const funnelData = await api.request<any>(
            `/api/loans/funnel?dateFilter=${dateFilter}${tenantParam}`,
          );
          if (funnelData) {
            funnelStory = {
              conversionRates: funnelData.conversionRates || {},
              falloutData: funnelData.falloutData || {},
              lostRevenue: funnelData.lostRevenue || {},
            };
          }
        } catch (error: any) {
          // Handle errors silently - briefing works without funnel data
          if (
            !error.message?.includes("Unauthorized") &&
            !error.message?.includes("401") &&
            !error.message?.includes("timed out") &&
            !error.message?.includes("timeout") &&
            !error.message?.includes("403")
          ) {
            console.warn("Error fetching funnel data for briefing:", error);
          }
        }

        setBriefingContext({
          dialogues,
          funnelStory,
          userName: undefined, // Can be set from user profile if available
        });
      } catch (error: any) {
        // Handle 403 (Forbidden) and 401 (Unauthorized) errors gracefully
        if (
          error.message?.includes("403") ||
          error.message?.includes("Forbidden")
        ) {
          // Tenant context not available - set empty context
          setBriefingContext({
            dialogues: [],
            funnelStory: null,
            userName: undefined,
          });
          setBriefingError("Tenant context not available");
        } else if (
          error.message?.includes("Unauthorized") ||
          error.message?.includes("401")
        ) {
          // User not authenticated - set empty context
          setBriefingContext({
            dialogues: [],
            funnelStory: null,
            userName: undefined,
          });
          setBriefingError("Not authenticated");
        } else if (
          error.message?.includes("timed out") ||
          error.message?.includes("timeout")
        ) {
          // For timeout errors, log as warning since briefing has empty context fallback
          console.warn(
            "Briefing context request timed out, using empty context fallback:",
            error.message,
          );
          setBriefingContext({
            dialogues: [],
            funnelStory: null,
            userName: undefined,
          });
          setBriefingError("Request timed out");
        } else {
          console.error("Error fetching briefing context:", error);
          // Set empty context on error - briefing will still work
          setBriefingContext({
            dialogues: [],
            funnelStory: null,
            userName: undefined,
          });
          setBriefingError(error.message || "Unknown error");
        }
      } finally {
        setBriefingLoading(false);
      }
    };

    fetchBriefingContext();
  }, [isAuthenticated, dateFilter, selectedTenantId]);

  // Animation cycle: 5 seconds animating, 30 seconds pause (35 second loop)
  useEffect(() => {
    if (!isAuthenticated) return;
    let animationInterval: NodeJS.Timeout | null = null;
    let cycleTimeout: NodeJS.Timeout;
    const startAnimationCycle = () => {
      // Start animation
      setIsAnimating(true);
      setAnimationCycle(0);

      // Animation runs for 5 seconds
      animationInterval = setInterval(() => {
        setAnimationCycle((prev) => {
          const newCycle = prev + 0.1;
          if (newCycle >= 5) {
            // Stop animation after 5 seconds
            setIsAnimating(false);
            if (animationInterval) clearInterval(animationInterval);
            return 5;
          }
          return newCycle;
        });
      }, 100);

      // After 5 seconds of animation, wait 30 seconds before restarting
      cycleTimeout = setTimeout(() => {
        startAnimationCycle();
      }, 35000); // 5 sec animation + 30 sec pause = 35 sec total
    };

    // Start the first cycle
    startAnimationCycle();
    return () => {
      if (animationInterval) clearInterval(animationInterval);
      if (cycleTimeout) clearTimeout(cycleTimeout);
    };
  }, [isAuthenticated]);
  // Helper functions now imported from utils/dashboardHelpers.ts

  // PIN authentication removed - auto-authenticate instead
  // const handlePinSubmit = (e: React.FormEvent) => { ... }

  // Empty data arrays - no demo/mock data, real data comes from API
  const realTopPerformers: any[] = [];
  const realMiddlePerformers: any[] = [];
  const realBottomPerformers: any[] = [];
  const branchLOs: any[] = [];
  const realFalloutData: any[] = [];
  const realProfitabilityData: any[] = [];
  const realCycleTimeData: any[] = [];
  const realPullThroughData: any[] = [];

  // Select the correct performer list based on tier (Top 20%, Middle 30%, Bottom 50%)
  const getAllPerformersByTier = () => {
    switch (selectedTier) {
      case "top":
        return realTopPerformers;
      // 20 employees (top 20%)
      case "middle":
        return realMiddlePerformers;
      // 30 employees (middle 30%)
      case "bottom":
        return realBottomPerformers;
      // 50 employees (bottom 50%)
      default:
        return realTopPerformers;
    }
  };
  const allPerformers = getAllPerformersByTier();

  // Reset visible count when tier changes
  useEffect(() => {
    setVisibleCount(10);
  }, [selectedTier]);

  // Get visible performers
  const getVisiblePerformers = () => {
    return allPerformers.slice(0, visibleCount);
  };
  const hasMore = visibleCount < allPerformers.length;

  // Generate employee data for fallout categories
  const getFalloutEmployees = (category: string) => {
    const baseEmployees = [
      ...realTopPerformers.slice(15, 20),
      ...realMiddlePerformers.slice(0, 10),
      ...realBottomPerformers.slice(0, 15),
    ];
    return baseEmployees.slice(0, 10).map((emp, idx) => ({
      ...emp,
      falloutReason:
        category === "Withdrawals"
          ? "Customer withdrew application"
          : category === "Declinations"
            ? "Did not meet underwriting criteria"
            : category === "Rate-Driven"
              ? "Found better rate elsewhere"
              : category === "Ops-Driven"
                ? "Processing delays caused withdrawal"
                : "Changed financing plans",
      daysInPipeline: Math.floor(Math.random() * 30) + 10,
      lastContact: `${Math.floor(Math.random() * 7) + 1} days ago`,
    }));
  };

  // Generate employee data for pull-through stages
  const getPullThroughEmployees = (stage: string, count: number) => {
    const allEmployees = [
      ...realTopPerformers,
      ...realMiddlePerformers,
      ...realBottomPerformers,
    ];
    return allEmployees.slice(0, Math.min(count, 15)).map((emp, idx) => ({
      ...emp,
      stage: stage,
      status:
        stage === "Application"
          ? "New Application"
          : stage === "Processing"
            ? "Documents Under Review"
            : stage === "Underwriting"
              ? "Credit Analysis"
              : stage === "Closing"
                ? "Final Review"
                : "Funded",
      daysInStage: Math.floor(Math.random() * 14) + 1,
      nextAction:
        stage === "Application"
          ? "Await documentation"
          : stage === "Processing"
            ? "Complete verification"
            : stage === "Underwriting"
              ? "Final approval"
              : stage === "Closing"
                ? "Schedule signing"
                : "Disbursement",
    }));
  };

  // Animated data with realistic fluctuations
  const topPerformers = getVisiblePerformers().map((p, idx) => {
    const timeOffset = idx * 200; // Stagger animations
    const baseProgress = getSmoothProgress(animationCycle, isAnimating);
    const variation = Math.sin((animationCycle * 100 + timeOffset) / 300) * 0.1;
    return {
      ...p,
      score: isAnimating
        ? Math.max(
            70,
            Math.min(
              100,
              Math.floor(p.score * (0.75 + baseProgress * 0.25 + variation)),
            ),
          )
        : p.score,
      loans: getAnimatedValue(p.loans, animationCycle, isAnimating, 0.2),
      revenue: getAnimatedValue(
        typeof p.revenue === "number"
          ? p.revenue
          : parseFloat(p.revenue.replace(/[$K,]/g, "")) * 1000,
        animationCycle,
        isAnimating,
        0.15,
      ),
      trend: isAnimating
        ? Math.random() > 0.5
          ? "up"
          : "down" // Randomly flicker during animation
        : p.trend,
    };
  });
  const falloutData = realFalloutData.map((d, idx) => {
    const variation = Math.sin((animationCycle * 100 + idx * 150) / 400) * 0.15;
    const baseProgress = getSmoothProgress(animationCycle, isAnimating);
    return {
      ...d,
      predicted: isAnimating
        ? Math.max(
            0,
            Math.floor(d.predicted * (0.6 + baseProgress * 0.4 + variation)),
          )
        : d.predicted,
      actual: isAnimating
        ? Math.max(
            0,
            Math.floor(d.actual * (0.6 + baseProgress * 0.4 + variation * 0.8)),
          )
        : d.actual,
    };
  });
  const profitabilityData = realProfitabilityData.map((d, idx) => {
    const timeOffset = idx * 100;
    const wave = Math.sin((animationCycle * 100 + timeOffset) / 500) * 0.1;
    const baseProgress = getSmoothProgress(animationCycle, isAnimating);
    return {
      ...d,
      margin: isAnimating
        ? Math.max(0, d.margin * (0.7 + baseProgress * 0.3 + wave))
        : d.margin,
      productivity: isAnimating
        ? Math.max(0, d.productivity * (0.7 + baseProgress * 0.3 + wave))
        : d.productivity,
      revenue: isAnimating
        ? Math.max(0, d.revenue * (0.7 + baseProgress * 0.3 + wave * 0.8))
        : d.revenue,
    };
  });
  const cycleTimeData = realCycleTimeData.map((d, idx) => {
    const variation = Math.sin((animationCycle * 100 + idx * 200) / 400) * 0.1;
    const baseProgress = getSmoothProgress(animationCycle, isAnimating);
    return {
      ...d,
      avgDays: isAnimating
        ? Math.max(0, d.avgDays * (0.8 + baseProgress * 0.2 + variation))
        : d.avgDays,
      targetDays: isAnimating
        ? Math.max(
            0,
            d.targetDays * (0.8 + baseProgress * 0.2 + variation * 0.7),
          )
        : d.targetDays,
      efficiency: isAnimating
        ? Math.max(
            0,
            Math.min(
              100,
              d.efficiency * (0.7 + baseProgress * 0.3 + variation),
            ),
          )
        : d.efficiency,
    };
  });
  const pullThroughData = realPullThroughData.map((d, idx) => {
    const variation = Math.sin((animationCycle * 100 + idx * 180) / 450) * 0.12;
    const baseProgress = getSmoothProgress(animationCycle, isAnimating);
    return {
      ...d,
      count: isAnimating
        ? Math.max(
            0,
            Math.floor(d.count * (0.6 + baseProgress * 0.4 + variation)),
          )
        : d.count,
      percentage: isAnimating
        ? Math.max(
            0,
            Math.min(
              100,
              Math.floor(d.percentage * (0.6 + baseProgress * 0.4 + variation)),
            ),
          )
        : d.percentage,
    };
  });
  const riskCases = [
    {
      id: 1,
      borrower: "John Smith",
      loanAmount: 450000,
      risk: "high",
      reason: "Rate lock expiring",
      daysOverdue: 3,
      breakdown: {
        rateLockExpiry: "2 days remaining",
        currentRate: "6.75%",
        marketRate: "7.25%",
        estimatedLoss: "$45,000",
        actions: [
          "Contact borrower immediately",
          "Expedite underwriting",
          "Prepare rate extension",
        ],
        timeline: [
          {
            date: "3 days ago",
            event: "Application received",
            status: "completed",
          },
          {
            date: "2 days ago",
            event: "Initial docs submitted",
            status: "completed",
          },
          {
            date: "1 day ago",
            event: "Underwriting started",
            status: "in-progress",
          },
          {
            date: "Today",
            event: "Rate lock warning issued",
            status: "flagged",
          },
        ],
      },
    },
    {
      id: 2,
      borrower: "Maria Garcia",
      loanAmount: 320000,
      risk: "medium",
      reason: "Documentation delay",
      daysOverdue: 2,
      breakdown: {
        missingDocs: [
          "W2 (2023)",
          "Bank statements (last 2 months)",
          "Property insurance",
        ],
        lastContact: "2 days ago",
        processorAssigned: "Valentina Rossi",
        estimatedDelay: "5-7 business days",
        actions: [
          "Follow up with borrower",
          "Request doc upload reminder",
          "Consider conditional approval",
        ],
        timeline: [
          {
            date: "5 days ago",
            event: "Application received",
            status: "completed",
          },
          {
            date: "4 days ago",
            event: "Initial review",
            status: "completed",
          },
          {
            date: "2 days ago",
            event: "Documentation requested",
            status: "pending",
          },
          {
            date: "Today",
            event: "Follow-up sent",
            status: "in-progress",
          },
        ],
      },
    },
    {
      id: 3,
      borrower: "Robert Johnson",
      loanAmount: 580000,
      risk: "high",
      reason: "Underwriting review",
      daysOverdue: 5,
      breakdown: {
        issues: [
          "DTI ratio at 48% (target: 43%)",
          "Employment gap 3 months",
          "Credit inquiry spike",
        ],
        underwriterAssigned: "Benjamin Kowalczyk",
        probabilityApproval: "62%",
        estimatedLoss: "$87,000",
        actions: [
          "Request compensating factors",
          "Review credit report with borrower",
          "Consider manual underwrite",
        ],
        timeline: [
          {
            date: "7 days ago",
            event: "Application received",
            status: "completed",
          },
          {
            date: "5 days ago",
            event: "Sent to underwriting",
            status: "completed",
          },
          {
            date: "3 days ago",
            event: "Conditions issued",
            status: "pending",
          },
          {
            date: "Today",
            event: "Escalated to senior UW",
            status: "flagged",
          },
        ],
      },
    },
    {
      id: 4,
      borrower: "Emily Davis",
      loanAmount: 275000,
      risk: "medium",
      reason: "Appraisal pending",
      daysOverdue: 1,
      breakdown: {
        appraiserAssigned: "ABC Appraisal Co.",
        scheduledDate: "Tomorrow",
        propertyType: "Single Family Home",
        estimatedValue: "$290,000",
        actions: [
          "Confirm appraisal appointment",
          "Prepare for potential low appraisal",
          "Review comparable sales",
        ],
        timeline: [
          {
            date: "4 days ago",
            event: "Application received",
            status: "completed",
          },
          {
            date: "3 days ago",
            event: "Appraisal ordered",
            status: "completed",
          },
          {
            date: "1 day ago",
            event: "Appraisal scheduled",
            status: "in-progress",
          },
          {
            date: "Today",
            event: "Reminder sent to borrower",
            status: "pending",
          },
        ],
      },
    },
  ];

  // Generate warnings based on actual dashboard data
  const generateDashboardWarnings = () => {
    const warnings = [];

    // Risk Cases warnings
    if (riskCases.length > 3) {
      warnings.push({
        id: "risk-high",
        message: `${riskCases.length} flagged cases require immediate attention`,
        urgency: "critical",
        code: "RISK-001",
      });
    }
    if (riskCases.filter((c) => c.risk === "high").length > 2) {
      warnings.push({
        id: "risk-critical",
        message: "Multiple high-risk loans pending review",
        urgency: "critical",
        code: "RISK-002",
      });
    }

    // Performance warnings
    const lowPerformers = realBottomPerformers.filter((p) => p.score < 70);
    if (lowPerformers.length > 5) {
      warnings.push({
        id: "perf-low",
        message: "Below-target performance detected across team",
        urgency: "high",
        code: "PERF-001",
      });
    }

    // Cycle time warnings
    const highCycleTime = realCycleTimeData.find(
      (d) => d.avgDays > d.targetDays * 1.3,
    );
    if (highCycleTime) {
      warnings.push({
        id: "cycle-time",
        message: `${highCycleTime.role} exceeding target by ${Math.round(
          (highCycleTime.avgDays / highCycleTime.targetDays - 1) * 100,
        )}%`,
        urgency: "high",
        code: "TIME-001",
      });
    }

    // Fallout warnings
    const highFallout = realFalloutData.filter((d) => d.actual > 15);
    if (highFallout.length > 0) {
      warnings.push({
        id: "fallout-high",
        message: `High fallout in ${highFallout[0].type}: ${highFallout[0].actual}%`,
        urgency: "medium",
        code: "FALL-001",
      });
    }

    // Volume warnings
    if (stats.callsToday > 1500) {
      warnings.push({
        id: "volume-high",
        message:
          "Call volume exceeding capacity - consider staffing adjustment",
        urgency: "medium",
        code: "VOL-001",
      });
    }

    // Compliance warnings (time-based)
    const currentHour = new Date().getHours();
    if (currentHour >= 9 && currentHour <= 17) {
      warnings.push({
        id: "compliance",
        message: "Compliance deadline approaching - quarterly review due",
        urgency: "high",
        code: "COMP-001",
      });
    }
    return warnings.slice(0, 10); // Max 10 warnings
  };
  const managementWarnings = generateDashboardWarnings();

  // Calculate key metrics for Command Center - now using useDashboardMetrics hook

  // Prepare Action Items from warnings and risk cases
  const prepareActionItems = () => {
    const critical: any[] = [];
    const review: any[] = [];

    // Add critical risk cases
    riskCases
      .filter((rc) => rc.risk === "high")
      .slice(0, 3)
      .forEach((rc) => {
        critical.push({
          id: `risk-${rc.id}`,
          title: `${rc.borrower} - ${rc.reason}`,
          description: `$${(rc.loanAmount / 1000).toFixed(0)}K loan, ${
            rc.daysOverdue
          } days overdue`,
          action: "Review case details",
          urgency: "critical",
          data: rc,
        });
      });

    // Add critical warnings
    managementWarnings
      .filter((w) => w.urgency === "critical")
      .slice(0, 3 - critical.length)
      .forEach((w) => {
        critical.push({
          id: w.id,
          title: w.message,
          description: `Code: ${w.code}`,
          action: "Take action",
          urgency: "critical",
          data: w,
        });
      });

    // Add high priority items to review
    managementWarnings
      .filter((w) => w.urgency === "high")
      .slice(0, 5)
      .forEach((w) => {
        review.push({
          id: w.id,
          title: w.message,
          description: `Code: ${w.code}`,
          action: "Review",
          urgency: "high",
          data: w,
        });
      });

    // Add medium risk cases
    riskCases
      .filter((rc) => rc.risk === "medium")
      .slice(0, 5 - review.length)
      .forEach((rc) => {
        review.push({
          id: `risk-${rc.id}`,
          title: `${rc.borrower} - ${rc.reason}`,
          description: `$${(rc.loanAmount / 1000).toFixed(
            0,
          )}K loan needs attention`,
          action: "Review case",
          urgency: "medium",
          data: rc,
        });
      });
    return {
      critical,
      review,
    };
  };
  const actionItems = prepareActionItems();

  // Calculate key metrics using hook (extracted from Dashboard.tsx)
  const { commandMetrics, financialHealth, operationalHealth } =
    useDashboardMetrics({
      realTopPerformers,
      realMiddlePerformers,
      realBottomPerformers,
      topPerformers,
      cycleTimeData,
      pullThroughData,
      managementWarnings,
    });

  // Auto-hide warnings after 10 seconds, cycle every 3 seconds
  useEffect(() => {
    if (
      !isAuthenticated ||
      managementWarnings.length === 0 ||
      !showNotifications
    )
      return;

    // Auto-hide after 10 seconds
    const hideTimer = setTimeout(() => {
      setShowNotifications(false);
    }, 10000);

    // Cycle warnings every 3 seconds - remove top, add new at bottom
    const cycleInterval = setInterval(() => {
      setVisibleWarnings((prev) => {
        if (prev.length === 0) return [0, 1, 2];

        // Get the last warning index and calculate next
        const lastIdx = prev[prev.length - 1];
        const nextIdx = (lastIdx + 1) % managementWarnings.length;

        // Remove first (top), add new at end (bottom) - always keep 3
        const newWarnings = [...prev.slice(1), nextIdx];
        return newWarnings.length > 3 ? newWarnings.slice(-3) : newWarnings;
      });
    }, 3000);
    return () => {
      clearTimeout(hideTimer);
      clearInterval(cycleInterval);
    };
  }, [isAuthenticated, managementWarnings.length, showNotifications]);

  // Auto-hide notifications after 15 seconds
  useEffect(() => {
    if (!showNotifications) return;
    const timer = setTimeout(() => {
      setShowNotifications(false);
    }, 15000);
    return () => clearTimeout(timer);
  }, [showNotifications]);
  // Note: Call sessions feature (/api/calls) not implemented - removed loadDashboardData call
  const handleLogout = async () => {
    await authLogout();
    sessionStorage.removeItem("dashboard_auth");
    toast({
      title: "Logged out",
      description: "Successfully signed out.",
    });
    navigate("/");
  };

  // PIN auto-submit removed - no longer needed

  // PIN authentication screen removed - dashboard is now accessible without PIN

  const handleReportClick = (report: ReportData) => {
    setSelectedReport(report);
    setReportModalOpen(true);
  };

  // Scroll to section handler for sidebar navigation
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      // Account for fixed header (64px = 4rem = pt-16)
      const headerOffset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition =
        elementPosition + window.pageYOffset - headerOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
    }
  };

  return (
    <DashboardContainer
      loading={loading}
      pageError={pageError}
      isAuthenticated={isAuthenticated}
    >
      <DashboardLayout
        isAuthenticated={isAuthenticated}
        mobileMenuOpen={mobileMenuOpen}
        onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
        dashboardVisibility={dashboardVisibility}
        onVisibilityChange={handleVisibilityChange}
        onReportClick={handleReportClick}
        onSectionClick={scrollToSection}
        visitorFirstName={displayName}
      >
        {/* Report Modal */}
        <ReportModal
          open={reportModalOpen}
          onClose={() => {
            setReportModalOpen(false);
            setSelectedReport(null);
          }}
          report={selectedReport}
        />

        {/* TopTiering Story Detail Modal - Enhanced with Drill-Down */}
        <TopTieringModal
          open={topTieringModal}
          onOpenChange={setTopTieringModal}
          selectedBranch={selectedBranch}
          setSelectedBranch={setSelectedBranch}
          selectedStaff={selectedStaff}
          setSelectedStaff={setSelectedStaff}
          topTieringTab={topTieringTab}
          setTopTieringTab={setTopTieringTab}
          staffFilter={staffFilter}
          setStaffFilter={setStaffFilter}
          setTrendsModal={setTrendsModal}
          setForecastingModal={setForecastingModal}
          funnelView={funnelView}
          setFunnelView={setFunnelView}
          funnelYear={funnelYear}
          setFunnelYear={setFunnelYear}
          selectedTier={selectedTier}
          setSelectedTier={setSelectedTier}
          branchLOs={branchLOs}
        />

        {/* Trends Modal with Drill-Down - Enhanced */}
        <TrendsModal
          open={trendsModal}
          onOpenChange={(open) => {
            setTrendsModal(open);
            if (!open) setTrendsSelectedMetric(null);
          }}
          trendsSelectedMetric={trendsSelectedMetric}
          setTrendsSelectedMetric={setTrendsSelectedMetric}
          dateFilter={dateFilter}
          setDateFilter={setDateFilter}
          setTopTieringModal={setTopTieringModal}
          setForecastingModal={setForecastingModal}
        />

        {/* Forecasting Modal with Drill-Down - Modern Minimalist */}
        <ForecastingModal
          open={forecastingModal}
          onOpenChange={(open) => {
            setForecastingModal(open);
            if (!open) setForecastSelectedScenario(null);
          }}
          forecastSelectedScenario={forecastSelectedScenario}
          setForecastSelectedScenario={setForecastSelectedScenario}
          setTopTieringModal={setTopTieringModal}
          setTrendsModal={setTrendsModal}
        />

        <div className="w-full h-full min-w-0 max-w-full overflow-x-hidden px-3 sm:px-6 md:px-8 lg:px-12 pt-4 sm:pt-6 md:pt-8 pb-4 sm:pb-8 md:pb-12 relative z-10">
          {/* Insights Section - Minimalist */}
          {isAuthenticated && (
            <div className="section-insights mb-16 md:mb-20 w-full min-w-0 max-w-full">
              {/* Cohi Insights */}
              {dashboardVisibility.aletheiaInsights && (
                <div
                  id="aletheiaInsights"
                  className="section-aletheia-insights mb-8 md:mb-12"
                >
                  <AletheiaPromptsCard
                    dateFilter={dateFilter}
                    briefingContext={briefingContext || undefined}
                    selectedTenantId={selectedTenantId}
                    selectedChannel={selectedChannel}
                    onOpenCohiPanel={() =>
                      window.dispatchEvent(new Event("cohi-chat-open"))
                    }
                    onDataAvailabilityChange={(hasData) => {
                      if (!hasData && dashboardVisibility.aletheiaInsights) {
                        handleVisibilityChange({
                          ...dashboardVisibility,
                          aletheiaInsights: false,
                        });
                      }
                    }}
                  />
                </div>
              )}

              {/* Mortgage News - Second */}
              {dashboardVisibility.industryNews && (
                <div id="industryNews" className="section-industry-news">
                  <IndustryNewsCard />
                </div>
              )}

              {/* Dashboards Section */}
              <div className="section-dashboards mt-12 sm:mt-16 w-full min-w-0 max-w-full">
                  <h2 className="text-2xl font-semibold mb-6 text-slate-900 dark:text-white">
                    Dashboards
                  </h2>

                  {/* Leaderboard - First under Dashboards heading */}
                  <div id="leaderboard" className="section-leaderboard mb-8">
                    <LeaderBoardSection
                      dateFilter={dateFilter}
                      selectedTenantId={selectedTenantId}
                      selectedChannel={selectedChannel}
                    />
                  </div>

                  {/* Business Overview */}
                  {dashboardVisibility.executiveDashboard && (
                    <div
                      id="executiveDashboard"
                      className="section-business-overview"
                    >
                      <ExecutiveDashboard
                        dateFilter={dateFilter}
                        year={funnelYear}
                        selectedTenantId={selectedTenantId}
                        selectedChannel={selectedChannel}
                      />
                    </div>
                  )}

                </div>
            </div>
          )}
        </div>

        {/* Contact Modal */}
        <ContactModal
          open={contactModal.open}
          type={contactModal.type}
          performer={contactModal.performer}
          onClose={() =>
            setContactModal({ open: false, type: null, performer: null })
          }
        />

        {/* Metric Breakdown Modal */}
        <MetricModal
          open={metricModal.open}
          type={metricModal.type}
          performer={metricModal.performer}
          onClose={() =>
            setMetricModal({ open: false, type: null, performer: null })
          }
        />

        {/* Risk Case Breakdown Modal */}
        <RiskModal
          open={riskModal.open}
          case={riskModal.case}
          onClose={() => setRiskModal({ open: false, case: null })}
        />

        {/* Pull-Through Stage Modal */}
        <PullThroughModal
          open={pullThroughModal.open}
          onOpenChange={(open) =>
            !open &&
            setPullThroughModal({
              open: false,
              stage: null,
              data: [],
            })
          }
          stage={pullThroughModal.stage}
          data={pullThroughModal.data}
        />

        {/* Export to Excel Modal */}
        <ExportModal open={exportModal} onOpenChange={setExportModal} />

        {/* Share via Messenger Modal */}
        <ShareModal open={shareModal} onOpenChange={setShareModal} />

        {/* Embed Code Modal */}
        <EmbedModal open={embedModal} onOpenChange={setEmbedModal} />

        {/* Fallout Analysis Modal */}
        <FalloutModal
          open={falloutModal.open}
          category={falloutModal.category}
          data={falloutModal.data}
          onClose={() =>
            setFalloutModal({ open: false, category: null, data: [] })
          }
        />

        {/* Hidden for now - Cohi Avatar
       <AletheiaVoiceAssistant dashboardContext={{
        stats,
        riskCases,
        topPerformers: topPerformers.slice(0, 5), // Top 5 for context
        cycleTimeData,
        falloutData,
        profitabilityData: profitabilityData[profitabilityData.length - 1] // Latest month
       }} />
       */}
      </DashboardLayout>
    </DashboardContainer>
  );
};
export default Dashboard;

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate, useSearchParams, Outlet } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { EditProvider } from "@/contexts/EditContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AnalyticsWrapper, AnalyticsPageViewTracker } from "@/contexts/AnalyticsContext";
import { DebugModeProvider } from "@/contexts/DebugModeContext";
import { DebugModeIndicator } from "@/components/layout/DebugModeIndicator";
import { UserSettingsProvider } from "@/hooks/useUserSettings";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ScrollToTop } from "@/components/ScrollToTop";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import DashboardLegacy from "./pages/DashboardLegacy";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import SSOCallback from "./pages/SSOCallback";
import UserSettings from "./pages/UserSettings";
import Unsubscribe from "./pages/Unsubscribe";
import Loans from "./pages/Loans";
import MyDashboard from "./pages/MyDashboard";
import MyDashboardLegacy from "./pages/MyDashboardLegacy";
import NotFound from "./pages/NotFound";
import { SubscriptionSuccess } from "./pages/SubscriptionSuccess";
import { SubscriptionCancel } from "./pages/SubscriptionCancel";
// Top Tiering pages (Loan Funnel page hidden – references removed)
// import LoanFunnel from "./pages/LoanFunnel";
import TopTieringComparison from "./pages/TopTieringComparison";
import OperationScorecard from "./pages/OperationScorecard";
import OperationScorecardTrends from "./pages/OperationScorecardTrends";
import FinancialModelingSandbox from "./pages/FinancialModelingSandbox";
import SalesScorecard from "./pages/SalesScorecard";
import SalesTrends from "./pages/SalesTrends";
import SalesScorecardOverview from "./pages/SalesScorecardOverview";
import CompanyScorecard from "./pages/CompanyScorecard";
import HighPerformers from "./pages/HighPerformers";
import CreditRiskManagement from "./pages/CreditRiskManagement";
import LoanDetail from "./pages/LoanDetail";
import WorkflowConversion from "./pages/WorkflowConversion";
// Hidden for now – needs work
// import PricingDashboard from "./pages/PricingDashboard";
import PipelineAnalysisDashboard from "./pages/PipelineAnalysisDashboard";
import Actors from "./pages/Actors";
import { KnowledgeBaseEditor } from "./components/admin/KnowledgeBaseEditor";
import { GlobalCohiChat } from "./components/cohi/GlobalCohiChat";
import { CohiDemoExperience } from "./components/demo/CohiDemoExperience";
import { TutorialProvider } from "@/contexts/TutorialContext";
import { WelcomeTourTrigger } from "@/components/tutorial/WelcomeTourTrigger";
import { ActiveTourRunner } from "@/components/tutorial/ActiveTourRunner";
// Workbench pages
import SharedWithMe from "./pages/workbench/SharedWithMe";
import TeamFolders from "./pages/workbench/TeamFolders";
import Favorites from "./pages/workbench/Favorites";
import Distributions from "./pages/workbench/Distributions";
// Research Lab
import ResearchAnalyst from "./pages/ResearchAnalyst";
// Help Center
import HelpCenter from "./pages/HelpCenter";
import { CanvasOnlyLayout } from "@/components/layout/CanvasOnlyLayout";

const queryClient = new QueryClient();

/**
 * For canvas_only users: only allow /my-dashboard and /my-dashboard/:canvasId; render CanvasOnlyLayout.
 * Otherwise render full app (Outlet).
 */
function AccessModeGate() {
  const { user } = useAuth();
  const location = useLocation();
  if (user?.access_mode === "canvas_only") {
    const onWorkbench = location.pathname === "/my-dashboard" || location.pathname.startsWith("/my-dashboard/");
    if (!onWorkbench) return <Navigate to="/my-dashboard" replace />;
    return <CanvasOnlyLayout />;
  }
  return <Outlet />;
}

// Component to initialize timezone on app load
function TimezoneInitializer() {
  useUserTimezone();
  return null;
}

// Component to handle S3/CloudFront 404 redirects
function Handle404Redirect() {
  const location = useLocation();
  const navigate = useNavigate();
  
  useEffect(() => {
    // Check if we have a stored path from 404.html redirect
    const storedPath = sessionStorage.getItem('react_router_path');
    if (storedPath && location.pathname === '/') {
      sessionStorage.removeItem('react_router_path');
      // Navigate to the stored path
      navigate(storedPath, { replace: true });
    }
  }, [location, navigate]);
  
  return null;
}

/**
 * Redirects /workbench?canvas=xxx to /my-dashboard/xxx (slug-based).
 * Falls back to /my-dashboard if no canvas param is present.
 */
function WorkbenchRedirect() {
  const [searchParams] = useSearchParams();
  const canvasId = searchParams.get('canvas');
  if (canvasId) {
    return <Navigate to={`/my-dashboard/${canvasId}`} replace />;
  }
  return <Navigate to="/my-dashboard" replace />;
}

function RootRoute() {
  const { isAuthenticated, user, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) {
    if (user?.access_mode === "canvas_only") return <Navigate to="/my-dashboard" replace />;
    return <Navigate to="/insights" replace />;
  }
  return <Index />;
}

function FullAccessOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.access_mode === "canvas_only") return null;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <AuthProvider>
        <AnalyticsWrapper>
        <DebugModeProvider>
        <DebugModeIndicator />
        <UserSettingsProvider>
        <TutorialProvider>
        <EditProvider>
          <TooltipProvider>
            <TimezoneInitializer />
            <Toaster />
            <Sonner />
            <Router basename={import.meta.env.BASE_URL}>
              <FullAccessOnly>
                <AnalyticsPageViewTracker />
              </FullAccessOnly>
              <Handle404Redirect />
              <ScrollToTop />
              <Routes>
              {/* Public routes */}
              <Route path="/" element={<RootRoute />} />
              <Route path="/landing" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/auth/sso/callback" element={<SSOCallback />} />
              <Route path="/unsubscribe/:token" element={<Unsubscribe />} />

              {/* Protected routes - require authentication; canvas_only users see only CanvasOnlyLayout on /my-dashboard* */}
              <Route element={<ProtectedRoute><AccessModeGate /></ProtectedRoute>}>
              <Route path="/settings" element={<UserSettings />} />
                <Route path="/insights" element={<Dashboard />} />
                <Route path="/legacy" element={<DashboardLegacy />} />
              <Route path="/loans" element={<Loans />} />
              <Route path="/my-dashboard/:canvasId?" element={<MyDashboard />} />
              <Route path="/my-dashboard-legacy" element={<MyDashboardLegacy />} />
              {/* Redirect /workbench to /my-dashboard (preserves search params like ?canvas=...) */}
              <Route path="/workbench" element={<WorkbenchRedirect />} />
              <Route path="/workbench/shared" element={<SharedWithMe />} />
              <Route path="/workbench/team-folders" element={<TeamFolders />} />
              <Route path="/workbench/favorites" element={<Favorites />} />
              <Route path="/workbench/distributions" element={<Distributions />} />
              
              {/* Research Lab */}
              <Route path="/research" element={<ResearchAnalyst />} />
              
              {/* Top Tiering routes – Loan Funnel page hidden; redirect so bookmarks don't 404 */}
              <Route path="/loan-funnel" element={<Navigate to="/insights" replace />} />
              <Route path="/workflow-conversion" element={<WorkflowConversion />} />
              <Route path="/loan-detail" element={<LoanDetail />} />
              {/* Pricing Dashboard hidden for now – needs work; redirect so bookmarks don't 404 */}
              <Route path="/pricing-dashboard" element={<Navigate to="/insights" replace />} />
              <Route path="/pipeline-analysis" element={<PipelineAnalysisDashboard />} />
              <Route path="/credit-risk-management" element={<CreditRiskManagement />} />
                <Route path="/company-scorecard" element={<CompanyScorecard />} />
              <Route path="/high-performers" element={<HighPerformers />} />
              <Route path="/actors" element={<Actors />} />
              <Route path="/performance/toptiering-comparison" element={<TopTieringComparison />} />
              <Route path="/performance/financial-modeling-sandbox" element={<FinancialModelingSandbox />} />
              <Route path="/sales-scorecard" element={<SalesScorecard />} />
              <Route path="/sales-trends" element={<SalesTrends />} />
              <Route path="/sales-scorecard-overview" element={<SalesScorecardOverview />} />
              <Route path="/performance/operation-scorecard" element={<OperationScorecard />} />
              <Route path="/performance/operation-scorecard-trends" element={<OperationScorecardTrends />} />
              
              {/* Admin route - requires admin role */}
              <Route path="/admin" element={
                <ProtectedRoute adminOnly>
                  <Admin />
                </ProtectedRoute>
              } />
              <Route path="/admin/knowledge-base" element={
                <ProtectedRoute adminOnly>
                  <KnowledgeBaseEditor />
                </ProtectedRoute>
              } />
              
              {/* Subscription routes */}
              <Route path="/subscription/success" element={<SubscriptionSuccess />} />
              <Route path="/subscription/cancel" element={<SubscriptionCancel />} />
              
              {/* Help Center */}
              <Route path="/help/*" element={<HelpCenter />} />
              </Route>
              
              {/* Catch-all route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
              <FullAccessOnly>
                <GlobalCohiChat />
                <CohiDemoExperience />
                <WelcomeTourTrigger />
                <ActiveTourRunner />
              </FullAccessOnly>
          </Router>
        </TooltipProvider>
        </EditProvider>
        </TutorialProvider>
        </UserSettingsProvider>
        </DebugModeProvider>
        </AnalyticsWrapper>
      </AuthProvider>
  </ThemeProvider>
</QueryClientProvider>
);

export default App;

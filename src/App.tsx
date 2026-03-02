import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { EditProvider } from "@/contexts/EditContext";
import { AuthProvider } from "@/contexts/AuthContext";
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
// Top Tiering pages
import LoanFunnel from "./pages/LoanFunnel";
import TopTieringComparison from "./pages/TopTieringComparison";
import OperationScorecard from "./pages/OperationScorecard";
import OperationScorecardTrends from "./pages/OperationScorecardTrends";
import FinancialModelingSandbox from "./pages/FinancialModelingSandbox";
import SalesScorecard from "./pages/SalesScorecard";
import SalesTrends from "./pages/SalesTrends";
import CompanyScorecard from "./pages/CompanyScorecard";
import HighPerformers from "./pages/HighPerformers";
import CreditRiskManagement from "./pages/CreditRiskManagement";
import LoanDetail from "./pages/LoanDetail";
import WorkflowConversion from "./pages/WorkflowConversion";
import PricingDashboard from "./pages/PricingDashboard";
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
// Research Lab
import ResearchAnalyst from "./pages/ResearchAnalyst";
// Help Center
import HelpCenter from "./pages/HelpCenter";

const queryClient = new QueryClient();

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
              <AnalyticsPageViewTracker />
              <Handle404Redirect />
              <ScrollToTop />
              <Routes>
              {/* Public routes */}
              <Route path="/" element={<Navigate to="/insights" replace />} />
              <Route path="/landing" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/auth/sso/callback" element={<SSOCallback />} />
              <Route path="/unsubscribe/:token" element={<Unsubscribe />} />

              {/* Protected routes - require authentication */}
              <Route path="/settings" element={
                <ProtectedRoute>
                  <UserSettings />
                </ProtectedRoute>
              } />
                <Route path="/insights" element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } />
                <Route path="/legacy" element={
                  <ProtectedRoute>
                    <DashboardLegacy />
                  </ProtectedRoute>
                } />
              <Route path="/loans" element={
                <ProtectedRoute>
                  <Loans />
                </ProtectedRoute>
              } />
              <Route path="/my-dashboard/:canvasId?" element={
                <ProtectedRoute>
                  <MyDashboard />
                </ProtectedRoute>
              } />
              <Route path="/my-dashboard-legacy" element={
                <ProtectedRoute>
                  <MyDashboardLegacy />
                </ProtectedRoute>
              } />
              {/* Redirect /workbench to /my-dashboard (preserves search params like ?canvas=...) */}
              <Route path="/workbench" element={<WorkbenchRedirect />} />
              <Route path="/workbench/shared" element={
                <ProtectedRoute>
                  <SharedWithMe />
                </ProtectedRoute>
              } />
              <Route path="/workbench/team-folders" element={
                <ProtectedRoute>
                  <TeamFolders />
                </ProtectedRoute>
              } />
              <Route path="/workbench/favorites" element={
                <ProtectedRoute>
                  <Favorites />
                </ProtectedRoute>
              } />
              
              {/* Research Lab */}
              <Route path="/research" element={
                <ProtectedRoute>
                  <ResearchAnalyst />
                </ProtectedRoute>
              } />
              
              {/* Top Tiering routes */}
              <Route path="/loan-funnel" element={
                <ProtectedRoute>
                  <LoanFunnel />
                </ProtectedRoute>
              } />
              <Route path="/workflow-conversion" element={
                <ProtectedRoute>
                  <WorkflowConversion />
                </ProtectedRoute>
              } />
              <Route path="/loan-detail" element={
                <ProtectedRoute>
                  <LoanDetail />
                </ProtectedRoute>
              } />
              <Route path="/pricing-dashboard" element={
                <ProtectedRoute>
                  <PricingDashboard />
                </ProtectedRoute>
              } />
              <Route path="/pipeline-analysis" element={
                <ProtectedRoute>
                  <PipelineAnalysisDashboard />
                </ProtectedRoute>
              } />
              <Route path="/credit-risk-management" element={
                <ProtectedRoute>
                  <CreditRiskManagement />
                </ProtectedRoute>
              } />
                <Route path="/company-scorecard" element={
                <ProtectedRoute>
                  <CompanyScorecard />
                </ProtectedRoute>
              } />
              <Route path="/high-performers" element={
                <ProtectedRoute>
                  <HighPerformers />
                </ProtectedRoute>
              } />
              <Route path="/actors" element={
                <ProtectedRoute>
                  <Actors />
                </ProtectedRoute>
              } />
              <Route path="/performance/toptiering-comparison" element={
                <ProtectedRoute>
                  <TopTieringComparison />
                </ProtectedRoute>
              } />
              <Route path="/performance/financial-modeling-sandbox" element={
                <ProtectedRoute>
                  <FinancialModelingSandbox />
                </ProtectedRoute>
              } />
              <Route path="/sales-scorecard" element={
                <ProtectedRoute>
                  <SalesScorecard />
                </ProtectedRoute>
              } />
              <Route path="/sales-trends" element={
                <ProtectedRoute>
                  <SalesTrends />
                </ProtectedRoute>
              } />
              <Route path="/performance/operation-scorecard" element={
                <ProtectedRoute>
                  <OperationScorecard />
                </ProtectedRoute>
              } />
              <Route path="/performance/operation-scorecard-trends" element={
                <ProtectedRoute>
                  <OperationScorecardTrends />
                </ProtectedRoute>
              } />
              
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
              <Route path="/subscription/success" element={
                <ProtectedRoute>
                  <SubscriptionSuccess />
                </ProtectedRoute>
              } />
              <Route path="/subscription/cancel" element={
                <ProtectedRoute>
                  <SubscriptionCancel />
                </ProtectedRoute>
              } />
              
              {/* Help Center */}
              <Route path="/help/*" element={
                <ProtectedRoute>
                  <HelpCenter />
                </ProtectedRoute>
              } />
              
              {/* Catch-all route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
              <GlobalCohiChat />
              <CohiDemoExperience />
              <WelcomeTourTrigger />
              <ActiveTourRunner />
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

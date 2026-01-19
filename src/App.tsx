import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { EditProvider } from "@/contexts/EditContext";
import { ScrollToTop } from "@/components/ScrollToTop";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { api } from "@/lib/api";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Agentic from "./pages/Agentic";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import V2 from "./pages/V2";
import CodeRefactor from "./pages/CodeRefactor";
import AgilePlan from "./pages/AgilePlan";
import BackendArchitecture from "./pages/BackendArchitecture";
import CSVEditor from "./pages/CSVEditor";
import RAG from "./pages/RAG";
import CodeReview from "./pages/CodeReview";
import ICEEncompass from "./pages/ICEEncompass";
import Loans from "./pages/Loans";
import QlikMigration from "./pages/QlikMigration";
import NotFound from "./pages/NotFound";
import { SubscriptionSuccess } from "./pages/SubscriptionSuccess";
import { SubscriptionCancel } from "./pages/SubscriptionCancel";

const queryClient = new QueryClient();

// Component to initialize timezone on app load
function TimezoneInitializer() {
  useUserTimezone();
  return null;
}

// Component to auto-authenticate on app load
function AutoAuthenticator() {
  const navigate = useNavigate();
  const location = useLocation();
  const didAutoLoginRef = useRef(false);
  const shouldRedirectHomeToInsightsRef = useRef(false);
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    const autoLogin = async () => {
      try {
        // Check if already authenticated
        const token = localStorage.getItem('auth_token');
        if (token) {
          try {
            await api.getCurrentUser();
            // Already authenticated, no need to login again
            return;
          } catch (error) {
            // Token exists but is invalid, clear it and proceed with auto-login
            api.clearToken();
          }
        }

        // Only redirect after auto-login if the user started on the home route.
        shouldRedirectHomeToInsightsRef.current = pathRef.current === '/';

        // Auto-authenticate with provided credentials
        await api.signIn('admin@ailethia.com', 'admin123');
        didAutoLoginRef.current = true;

        // If we're still on home when login completes, redirect immediately.
        if (shouldRedirectHomeToInsightsRef.current && pathRef.current === '/') {
          didAutoLoginRef.current = false;
          shouldRedirectHomeToInsightsRef.current = false;
          navigate('/insights', { replace: true });
        }
        console.log('Auto-authenticated successfully');
      } catch (error) {
        // Silently fail - user can still login manually
        console.warn('Auto-authentication failed:', error);
      }
    };

    autoLogin();
  }, [navigate]);

  // Handle cases where auto-login completes while router is still settling.
  // Only redirect when the current route is home (/).
  useEffect(() => {
    if (!didAutoLoginRef.current) return;
    if (!shouldRedirectHomeToInsightsRef.current) return;
    if (location.pathname !== '/') return;

    didAutoLoginRef.current = false;
    shouldRedirectHomeToInsightsRef.current = false;
    navigate('/insights', { replace: true });
  }, [location.pathname, navigate]);

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <EditProvider>
        <TooltipProvider>
          <TimezoneInitializer />
          <Toaster />
          <Sonner />
          <Router basename={import.meta.env.BASE_URL}>
            <Handle404Redirect />
            <AutoAuthenticator />
            <ScrollToTop />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/insights" element={<Dashboard />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/agentic" element={<Agentic />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/rag" element={<RAG />} />
              <Route path="/v2" element={<V2 />} />
              <Route path="/code-refactor" element={<CodeRefactor />} />
              <Route path="/v2/agileplan" element={<AgilePlan />} />
              <Route path="/backend-architecture" element={<BackendArchitecture />} />
              <Route path="/csv-editor" element={<CSVEditor />} />
              <Route path="/cr" element={<CodeReview />} />
              <Route path="/ice" element={<ICEEncompass />} />
              <Route path="/loans" element={<Loans />} />
              <Route path="/qlik" element={<QlikMigration />} />
              <Route path="/subscription/success" element={<SubscriptionSuccess />} />
              <Route path="/subscription/cancel" element={<SubscriptionCancel />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Router>
        </TooltipProvider>
      </EditProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

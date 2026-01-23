import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { EditProvider } from "@/contexts/EditContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ScrollToTop } from "@/components/ScrollToTop";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import Loans from "./pages/Loans";
import NotFound from "./pages/NotFound";
import { SubscriptionSuccess } from "./pages/SubscriptionSuccess";
import { SubscriptionCancel } from "./pages/SubscriptionCancel";

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <AuthProvider>
        <EditProvider>
          <TooltipProvider>
            <TimezoneInitializer />
            <Toaster />
            <Sonner />
            <Router basename={import.meta.env.BASE_URL}>
              <Handle404Redirect />
              <ScrollToTop />
              <Routes>
              {/* Public routes */}
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              
              {/* Protected routes - require authentication */}
              <Route path="/insights" element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              } />
              <Route path="/loans" element={
                <ProtectedRoute>
                  <Loans />
                </ProtectedRoute>
              } />
              
              {/* Admin route - requires admin role */}
              <Route path="/admin" element={
                <ProtectedRoute adminOnly>
                  <Admin />
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
              
              {/* Catch-all route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Router>
        </TooltipProvider>
      </EditProvider>
    </AuthProvider>
  </ThemeProvider>
</QueryClientProvider>
);

export default App;

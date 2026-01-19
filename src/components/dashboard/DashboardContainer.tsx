import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface DashboardContainerProps {
  children: React.ReactNode;
  loading: boolean;
  pageError: Error | null;
  isAuthenticated: boolean;
}

export function DashboardContainer({
  children,
  loading,
  pageError,
  isAuthenticated
}: DashboardContainerProps) {
  const navigate = useNavigate();
  const { setTheme } = useTheme();

  // Force light theme on dashboard - always override any stored preference
  useEffect(() => {
    try {
      setTheme('light');
      // Also set it immediately to prevent flash of dark theme
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    } catch (error: any) {
      console.error('Error setting theme:', error);
    }
  }, [setTheme]);

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // Show error state if there's a critical error
  if (pageError) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">Something went wrong</h1>
            <p className="text-slate-600">
              An error occurred while loading the dashboard. Please refresh the page.
            </p>
          </div>
          <div className="space-y-2">
            <Button onClick={() => window.location.reload()} className="w-full">
              Refresh Page
            </Button>
            <Button onClick={() => navigate('/')} variant="outline" className="w-full">
              Go to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}


import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { DashboardVisibility } from '@/components/dashboard/ReportsSidebar';

export interface UseDashboardVisibilityReturn {
  dashboardVisibility: DashboardVisibility;
  isLoadingVisibility: boolean;
  handleVisibilityChange: (newVisibility: DashboardVisibility) => void;
}

const defaultVisibility: DashboardVisibility = {
  executiveDashboard: true,
  industryNews: true,
  aletheiaInsights: true,
  leaderboard: true,
  topTiering: true,
  closingFalloutForecast: true,
  trends: true,
  forecasting: true,
  kpiReports: true
};

export function useDashboardVisibility(): UseDashboardVisibilityReturn {
  const [dashboardVisibility, setDashboardVisibility] = useState<DashboardVisibility>(defaultVisibility);
  const [isLoadingVisibility, setIsLoadingVisibility] = useState(true);

  // Load dashboard visibility preferences from database
  const loadDashboardVisibility = async () => {
    try {
      try {
        const preference = await api.request<{ preference_value: DashboardVisibility }>('/api/user/preferences/dashboardVisibility');
        if (preference?.preference_value) {
          const visibility = {
            ...defaultVisibility,
            ...preference.preference_value
          };
          setDashboardVisibility(visibility);
          localStorage.setItem('dashboardVisibility', JSON.stringify(visibility));
        } else {
          // Fallback to localStorage
          const saved = localStorage.getItem('dashboardVisibility');
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              const visibility = {
                ...defaultVisibility,
                ...parsed
              };
              setDashboardVisibility(visibility);
              // Save to database for future use
              await saveDashboardVisibility(visibility);
            } catch {
              setDashboardVisibility(defaultVisibility);
            }
          } else {
            setDashboardVisibility(defaultVisibility);
          }
        }
      } catch (error: any) {
        // If API call fails, fall through to outer catch
        throw error;
      }
    } catch (error: any) {
      // Handle unauthorized errors silently (user not logged in)
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        // User not authenticated - fallback to localStorage without logging error
      } else if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
        // For timeout errors, log as warning since we have localStorage fallback
        console.warn('Dashboard visibility request timed out, using localStorage fallback:', error.message);
      } else {
        console.error('Error loading dashboard visibility:', error);
      }
      // Fallback to localStorage
      const saved = localStorage.getItem('dashboardVisibility');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setDashboardVisibility({
            ...defaultVisibility,
            ...parsed
          });
        } catch {
          // Use default
        }
      }
    } finally {
      setIsLoadingVisibility(false);
    }
  };

  // Save dashboard visibility to database
  const saveDashboardVisibility = async (visibility: DashboardVisibility) => {
    try {
      // Save to localStorage immediately for instant access
      localStorage.setItem('dashboardVisibility', JSON.stringify(visibility));

      // Save to database via API
      try {
        await api.request('/api/user/preferences/dashboardVisibility', {
          method: 'PUT',
          body: JSON.stringify({ preference_value: visibility }),
        });
      } catch (error: any) {
        // If not authenticated, just use localStorage
        if (error.message?.includes('Unauthorized')) {
          return;
        }
        throw error;
      }
    } catch (error) {
      console.error('Error saving dashboard visibility:', error);
      // Still save to localStorage even if database save fails
      localStorage.setItem('dashboardVisibility', JSON.stringify(visibility));
    }
  };

  // Load visibility preferences on mount
  useEffect(() => {
    loadDashboardVisibility();
  }, []);

  // Persist visibility changes to database and localStorage
  const handleVisibilityChange = (newVisibility: DashboardVisibility) => {
    setDashboardVisibility(newVisibility);
    saveDashboardVisibility(newVisibility);
  };

  return {
    dashboardVisibility,
    isLoadingVisibility,
    handleVisibilityChange
  };
}


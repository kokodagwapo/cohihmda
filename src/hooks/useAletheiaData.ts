import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { CheckCircle2, Info, AlertTriangle } from 'lucide-react';

export interface AletheiaInsight {
  type: 'success' | 'info' | 'warning' | 'error';
  icon: any;
  message: string;
  priority: 'high' | 'medium' | 'standard';
  reasoning?: string;
  source?: string;
}

// Map API insight type to icon
const getIconForType = (type: string) => {
  switch (type) {
    case 'success': return CheckCircle2;
    case 'info': return Info;
    case 'warning': return AlertTriangle;
    case 'error': return AlertTriangle;
    default: return Info;
  }
};

// Demo insights fallback
const getDemoInsights = (): AletheiaInsight[] => [
  {
    type: 'info' as const,
    icon: Info,
    message: 'YTD revenue reached $2.4M, up 18% versus last year — strong momentum continues.',
    priority: 'high' as const,
    reasoning: 'Revenue trajectory shows consistent growth. At current velocity, you\'re positioned for a strong quarter.',
    source: 'business_overview'
  },
  {
    type: 'info' as const,
    icon: Info,
    message: 'Active pipeline: 185 loans, $78.2M in process — strong pipeline depth.',
    priority: 'high' as const,
    reasoning: 'Pipeline volume indicates healthy demand. Monitor conversion rates to optimize throughput.',
    source: 'loan_funnel'
  }
];

export const useAletheiaData = (
  dateFilter: 'today' | 'mtd' | 'ytd' | 'custom',
  onDataAvailabilityChange?: (hasData: boolean) => void,
  selectedTenantId?: string | null
) => {
  const [allInsights, setAllInsights] = useState<AletheiaInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [funnelData, setFunnelData] = useState<any>(null);

  // Fetch dynamic insights from API
  useEffect(() => {
    const fetchInsights = async () => {
      setInsightsLoading(true);
      setInsightsError(null);
      
      // Check if user has a valid token before making API call
      const token = localStorage.getItem('auth_token');
      if (!token) {
        // No token - use demo data directly without making API call
        const demoInsights = getDemoInsights();
        setAllInsights(demoInsights);
        setInsightsError(null);
        onDataAvailabilityChange?.(true);
        setInsightsLoading(false);
        return;
      }
      
      try {
        const tenantParam = selectedTenantId ? `&tenant_id=${selectedTenantId}` : '';
        const data = await api.request<any>(`/api/dashboard/insights?dateFilter=${dateFilter}${tenantParam}`);
        
        if (data.insights && Array.isArray(data.insights) && data.insights.length > 0) {
          // Map API insights to component format with icons, preserving source information
          const mappedInsights: AletheiaInsight[] = data.insights.map((insight: any) => ({
            type: insight.type || 'info',
            icon: getIconForType(insight.type || 'info'),
            message: insight.message || '',
            priority: insight.priority || 'standard',
            reasoning: insight.reasoning || '',
            source: insight.source || 'other', // Preserve source for grouping
          }));
          setAllInsights(mappedInsights);
          onDataAvailabilityChange?.(true);
        } else {
          // If API returns empty or no insights, use demo data
          const demoInsights = getDemoInsights();
          setAllInsights(demoInsights);
          setInsightsError(null);
          onDataAvailabilityChange?.(true);
        }
      } catch (error: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
          // User not authenticated - use demo data without logging error
          const demoInsights = getDemoInsights();
          setAllInsights(demoInsights);
          setInsightsError(null);
          onDataAvailabilityChange?.(true);
        } else if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
          // For timeout errors, log as warning since we have demo data fallback
          console.warn('Insights request timed out, using demo data fallback:', error.message);
          const demoInsights = getDemoInsights();
          setAllInsights(demoInsights);
          setInsightsError(null);
          onDataAvailabilityChange?.(true);
        } else {
          // Other errors - log but still use demo data
          console.error('Error fetching insights:', error);
          setInsightsError(error.message || 'Failed to fetch insights');
          const demoInsights = getDemoInsights();
          setAllInsights(demoInsights);
          onDataAvailabilityChange?.(true);
        }
      } finally {
        setInsightsLoading(false);
      }
    };

    fetchInsights();
  }, [dateFilter, selectedTenantId, onDataAvailabilityChange]);

  // Fetch funnel data for briefing context
  useEffect(() => {
    const fetchFunnelData = async () => {
      // Check if user has a valid token before making API call
      const token = localStorage.getItem('auth_token');
      if (!token) {
        // No token - skip API call, briefing will work without funnel data
        return;
      }
      
      try {
        const tenantParam = selectedTenantId ? `&tenant_id=${selectedTenantId}` : '';
        const data = await api.request<any>(`/api/loans/funnel?dateFilter=${dateFilter}${tenantParam}`);
        setFunnelData(data);
      } catch (error: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
          // User not authenticated - continue without funnel data
          return;
        }
        // For timeout errors, log as warning since briefing works without funnel data
        if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
          console.warn('Funnel data request timed out, continuing without it:', error.message);
        } else {
          console.error('Error fetching funnel data:', error);
        }
        // Continue without funnel data - briefing will work without it
      }
    };

    fetchFunnelData();
  }, [dateFilter, selectedTenantId]);

  // Handle error state and set demo insights if needed
  useEffect(() => {
    if (insightsError && allInsights.length === 0 && !insightsLoading) {
      // Fallback to demo insights if API fails
      const demoInsights = getDemoInsights();
      setAllInsights(demoInsights);
      onDataAvailabilityChange?.(true);
    }
  }, [insightsError, allInsights.length, insightsLoading, onDataAvailabilityChange]);

  return {
    allInsights,
    insightsLoading,
    insightsError,
    funnelData
  };
};


/**
 * useMetrics Hook
 * React hook for querying metrics from the metrics catalog
 * Converts period strings to date ranges using getPeriodRange()
 */

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getPeriodRange, PeriodValue } from '@/utils/closingFalloutFilters';

export interface MetricResult {
  metricId: string;
  value: number | string;
  unit?: string;
  metadata?: Record<string, any>;
}

export interface DateRange {
  start: string | null; // ISO date string (YYYY-MM-DD)
  end: string | null;   // ISO date string (YYYY-MM-DD)
}

export const useMetrics = (selectedTenantId?: string | null, year?: number) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert period to date range
  const periodToDateRange = useCallback((period: PeriodValue): DateRange => {
    const range = getPeriodRange(period, new Date(), year);
    return {
      start: range.start ? range.start.toISOString().split('T')[0] : null,
      end: range.end ? range.end.toISOString().split('T')[0] : null
    };
  }, [year]);

  // Query a single metric
  const queryMetric = useCallback(async (
    metricId: string,
    period: PeriodValue = 'ytd',
    dateField?: string
  ): Promise<MetricResult> => {
    setLoading(true);
    setError(null);
    try {
      const dateRange = periodToDateRange(period);
      const params = new URLSearchParams();
      if (dateRange.start) params.append('startDate', dateRange.start);
      if (dateRange.end) params.append('endDate', dateRange.end);
      if (dateField) params.append('dateField', dateField);
      if (selectedTenantId) params.append('tenant_id', selectedTenantId);
      
      const result = await api.request<MetricResult>(
        `/api/metrics/${metricId}?${params.toString()}`
      );
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [periodToDateRange, selectedTenantId]);

  // Query multiple metrics
  const queryMetrics = useCallback(async (
    metricIds: string[],
    period: PeriodValue = 'ytd',
    dateField?: string
  ): Promise<Record<string, MetricResult>> => {
    setLoading(true);
    setError(null);
    try {
      const dateRange = periodToDateRange(period);
      const queryParams = new URLSearchParams();
      if (selectedTenantId) queryParams.append('tenant_id', selectedTenantId);
      const url = `/api/metrics/query${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const result = await api.request<{ metrics: Record<string, MetricResult> }>(
        url,
        {
          method: 'POST',
          body: JSON.stringify({ 
            metricIds, 
            dateRange: {
              start: dateRange.start,
              end: dateRange.end
            },
            dateField
          })
        }
      );
      return result.metrics;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [periodToDateRange, selectedTenantId]);

  // Query with custom date range (for custom date picker)
  const queryMetricsWithDateRange = useCallback(async (
    metricIds: string[],
    startDate: Date | null,
    endDate: Date | null,
    dateField?: string
  ): Promise<Record<string, MetricResult>> => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      if (selectedTenantId) queryParams.append('tenant_id', selectedTenantId);
      const url = `/api/metrics/query${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const result = await api.request<{ metrics: Record<string, MetricResult> }>(
        url,
        {
          method: 'POST',
          body: JSON.stringify({ 
            metricIds, 
            dateRange: {
              start: startDate ? startDate.toISOString().split('T')[0] : null,
              end: endDate ? endDate.toISOString().split('T')[0] : null
            },
            dateField
          })
        }
      );
      return result.metrics;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  // Get metrics catalog
  const getCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.request<{ metrics: any[] }>('/api/metrics/catalog');
      return result.metrics;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    queryMetric,
    queryMetrics,
    queryMetricsWithDateRange,
    getCatalog,
    loading,
    error
  };
};

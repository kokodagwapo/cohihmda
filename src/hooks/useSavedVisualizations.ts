/**
 * Saved Visualizations Hook
 * Manages saved visualizations for the custom dashboard
 */

import { useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api';
import { VisualizationConfig } from './useDataChat';

// ============================================================================
// Types
// ============================================================================

export interface SavedVisualization {
  id: string;
  title: string;
  description?: string;
  question: string;
  visualizationType: string;
  visualizationConfig: VisualizationConfig;
  queryConfig: any;
  dataSnapshot?: any[];
  position: number;
  width: number;
  height: number;
  isPinned: boolean;
  refreshInterval?: number;
  createdAt: string;
  updatedAt: string;
}

export interface UseSavedVisualizationsOptions {
  tenantId?: string;
  autoLoad?: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export function useSavedVisualizations(options: UseSavedVisualizationsOptions = {}) {
  const { tenantId, autoLoad = true } = options;
  
  const [visualizations, setVisualizations] = useState<SavedVisualization[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load saved visualizations
   */
  const loadVisualizations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await api.request<{ visualizations: SavedVisualization[] }>(
        `/api/data-chat/saved-visualizations${tenantId ? `?tenant_id=${tenantId}` : ''}`
      );
      setVisualizations(response.visualizations || []);
    } catch (err: any) {
      console.error('[SavedViz] Error loading visualizations:', err);
      setError(err.message || 'Failed to load visualizations');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      loadVisualizations();
    }
  }, [autoLoad, loadVisualizations]);

  /**
   * Save a new visualization
   */
  const saveVisualization = useCallback(async (
    visualization: VisualizationConfig,
    question: string,
    title?: string,
    description?: string
  ): Promise<SavedVisualization | null> => {
    try {
      const response = await api.request<{ success: boolean; visualization: SavedVisualization }>(
        '/api/data-chat/save-visualization',
        {
          method: 'POST',
          body: JSON.stringify({
            title: title || visualization.title,
            description,
            question,
            visualization,
            queryConfig: {},
            position: visualizations.length,
            tenant_id: tenantId,
          }),
        }
      );
      
      if (response.success && response.visualization) {
        // Reload to get full visualization data
        await loadVisualizations();
        return response.visualization;
      }
      return null;
    } catch (err: any) {
      console.error('[SavedViz] Error saving visualization:', err);
      throw err;
    }
  }, [loadVisualizations, tenantId, visualizations.length]);

  /**
   * Update a visualization
   */
  const updateVisualization = useCallback(async (
    id: string,
    updates: Partial<Pick<SavedVisualization, 'title' | 'description' | 'position' | 'width' | 'height' | 'isPinned' | 'refreshInterval'>>
  ): Promise<boolean> => {
    try {
      const response = await api.request<{ success: boolean }>(
        `/api/data-chat/saved-visualizations/${id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            ...updates,
            tenant_id: tenantId,
          }),
        }
      );
      
      if (response.success) {
        // Update local state
        setVisualizations(prev => 
          prev.map(v => v.id === id ? { ...v, ...updates, updatedAt: new Date().toISOString() } : v)
        );
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('[SavedViz] Error updating visualization:', err);
      throw err;
    }
  }, [tenantId]);

  /**
   * Delete a visualization
   */
  const deleteVisualization = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await api.request<{ success: boolean }>(
        `/api/data-chat/saved-visualizations/${id}${tenantId ? `?tenant_id=${tenantId}` : ''}`,
        {
          method: 'DELETE',
        }
      );
      
      if (response.success) {
        setVisualizations(prev => prev.filter(v => v.id !== id));
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('[SavedViz] Error deleting visualization:', err);
      throw err;
    }
  }, [tenantId]);

  /**
   * Refresh a visualization with fresh data
   */
  const refreshVisualization = useCallback(async (id: string): Promise<VisualizationConfig | null> => {
    try {
      const response = await api.request<{ success: boolean; visualization: VisualizationConfig; data: any[] }>(
        `/api/data-chat/refresh-visualization/${id}`,
        {
          method: 'POST',
          body: JSON.stringify({ tenant_id: tenantId }),
        }
      );
      
      if (response.success && response.visualization) {
        // Update local state with new data
        setVisualizations(prev => 
          prev.map(v => v.id === id 
            ? { 
                ...v, 
                visualizationConfig: response.visualization,
                dataSnapshot: response.data,
                updatedAt: new Date().toISOString() 
              } 
            : v
          )
        );
        return response.visualization;
      }
      return null;
    } catch (err: any) {
      console.error('[SavedViz] Error refreshing visualization:', err);
      throw err;
    }
  }, [tenantId]);

  /**
   * Reorder visualizations
   */
  const reorderVisualizations = useCallback(async (newOrder: string[]) => {
    // Update local state immediately
    const reordered = newOrder
      .map((id, index) => {
        const viz = visualizations.find(v => v.id === id);
        return viz ? { ...viz, position: index } : null;
      })
      .filter((v): v is SavedVisualization => v !== null);
    
    setVisualizations(reordered);

    // Persist to backend
    try {
      await Promise.all(
        newOrder.map((id, index) => 
          api.request(`/api/data-chat/saved-visualizations/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
              position: index,
              tenant_id: tenantId,
            }),
          })
        )
      );
    } catch (err) {
      console.error('[SavedViz] Error persisting reorder:', err);
      // Reload to get correct order
      await loadVisualizations();
    }
  }, [loadVisualizations, tenantId, visualizations]);

  return {
    visualizations,
    isLoading,
    error,
    loadVisualizations,
    saveVisualization,
    updateVisualization,
    deleteVisualization,
    refreshVisualization,
    reorderVisualizations,
  };
}

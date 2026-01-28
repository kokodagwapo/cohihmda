import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export interface KnowledgeBaseEntry {
  id: string;
  tenant_id?: string;
  title: string;
  category: string;
  priority: number;
  content: string;
  keywords?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
  created_by_email?: string;
  updated_by_email?: string;
  tenant_name?: string;
}

export interface UseKnowledgeBaseReturn {
  entries: KnowledgeBaseEntry[];
  categories: string[];
  loading: boolean;
  error: Error | null;
  fetchEntries: (filters?: { category?: string; search?: string }) => Promise<void>;
  fetchCategories: () => Promise<void>;
  createEntry: (entry: Omit<KnowledgeBaseEntry, 'id' | 'created_at' | 'updated_at'>) => Promise<KnowledgeBaseEntry>;
  updateEntry: (id: string, updates: Partial<KnowledgeBaseEntry>) => Promise<KnowledgeBaseEntry>;
  deleteEntry: (id: string) => Promise<void>;
  getEntry: (id: string) => Promise<KnowledgeBaseEntry>;
}

export function useKnowledgeBase(): UseKnowledgeBaseReturn {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  const fetchEntries = useCallback(async (filters?: { category?: string; search?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters?.category) params.append('category', filters.category);
      if (filters?.search) params.append('search', filters.search);

      const response = await api.request<{ entries: KnowledgeBaseEntry[] }>(
        `/api/rag/knowledge-base?${params.toString()}`
      );
      setEntries(response.entries);
    } catch (err: any) {
      const error = new Error(err.message || 'Failed to fetch knowledge base entries');
      setError(error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await api.request<{ categories: string[] }>(
        '/api/rag/knowledge-base/categories'
      );
      setCategories(response.categories);
    } catch (err: any) {
      console.error('Failed to fetch categories:', err);
    }
  }, []);

  const createEntry = useCallback(async (
    entry: Omit<KnowledgeBaseEntry, 'id' | 'created_at' | 'updated_at'>
  ): Promise<KnowledgeBaseEntry> => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.request<{ entry: KnowledgeBaseEntry }>(
        '/api/rag/knowledge-base',
        {
          method: 'POST',
          body: JSON.stringify(entry),
        }
      );
      setEntries(prev => [response.entry, ...prev]);
      toast({
        title: 'Success',
        description: 'Knowledge base entry created successfully',
      });
      return response.entry;
    } catch (err: any) {
      const error = new Error(err.message || 'Failed to create knowledge base entry');
      setError(error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const updateEntry = useCallback(async (
    id: string,
    updates: Partial<KnowledgeBaseEntry>
  ): Promise<KnowledgeBaseEntry> => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.request<{ entry: KnowledgeBaseEntry }>(
        `/api/rag/knowledge-base/${id}`,
        {
          method: 'PUT',
          body: JSON.stringify(updates),
        }
      );
      setEntries(prev => prev.map(entry => entry.id === id ? response.entry : entry));
      toast({
        title: 'Success',
        description: 'Knowledge base entry updated successfully',
      });
      return response.entry;
    } catch (err: any) {
      const error = new Error(err.message || 'Failed to update knowledge base entry');
      setError(error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const deleteEntry = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.request(`/api/rag/knowledge-base/${id}`, {
        method: 'DELETE',
      });
      setEntries(prev => prev.filter(entry => entry.id !== id));
      toast({
        title: 'Success',
        description: 'Knowledge base entry deleted successfully',
      });
    } catch (err: any) {
      const error = new Error(err.message || 'Failed to delete knowledge base entry');
      setError(error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const getEntry = useCallback(async (id: string): Promise<KnowledgeBaseEntry> => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.request<{ entry: KnowledgeBaseEntry }>(
        `/api/rag/knowledge-base/${id}`
      );
      return response.entry;
    } catch (err: any) {
      const error = new Error(err.message || 'Failed to fetch knowledge base entry');
      setError(error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Initial fetch
  useEffect(() => {
    fetchEntries();
    fetchCategories();
  }, [fetchEntries, fetchCategories]);

  return {
    entries,
    categories,
    loading,
    error,
    fetchEntries,
    fetchCategories,
    createEntry,
    updateEntry,
    deleteEntry,
    getEntry,
  };
}

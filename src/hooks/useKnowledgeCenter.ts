/**
 * Hook for tenant knowledge center
 * Used by tenant admins to view global docs and manage tenant-specific docs
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface KnowledgeDocument {
  id: string;
  title: string;
  filename: string | null;
  file_type: string | null;
  category: string | null;
  tags: string[];
  is_global: boolean;
  global_doc_id: string | null;
  global_version: number | null;
  chunk_count: number;
  token_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeUpdate {
  id: string;
  global_doc_id: string;
  title: string;
  category: string | null;
  action: "added" | "updated" | "removed";
  version: number | null;
  change_summary: string | null;
  synced_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  acknowledged_by_email: string | null;
}

export interface SearchResult {
  chunk_id: string;
  chunk_text: string;
  chunk_index: number;
  document_id: string;
  title: string;
  filename: string | null;
  category: string | null;
  is_global: boolean;
  similarity: number;
}

export function useKnowledgeCenter(tenantId?: string) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [updates, setUpdates] = useState<KnowledgeUpdate[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [categories, setCategories] = useState<
    Array<{ category: string; doc_count: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
  });

  // Build tenant query param
  const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";

  // Fetch documents
  const fetchDocuments = useCallback(
    async (
      params: {
        category?: string;
        search?: string;
        is_global?: boolean;
        limit?: number;
        offset?: number;
      } = {}
    ) => {
      try {
        setLoading(true);
        setError(null);

        const queryParams = new URLSearchParams();
        if (tenantId) queryParams.append("tenant_id", tenantId);
        if (params.category) queryParams.append("category", params.category);
        if (params.search) queryParams.append("search", params.search);
        if (params.is_global !== undefined)
          queryParams.append("is_global", String(params.is_global));
        queryParams.append("limit", String(params.limit || 50));
        queryParams.append("offset", String(params.offset || 0));

        const response = await api.request<{
          documents: KnowledgeDocument[];
          pagination: typeof pagination;
        }>(`/api/knowledge-center/documents?${queryParams.toString()}`);

        setDocuments(response.documents);
        setPagination(response.pagination);
      } catch (err: any) {
        setError(err.message || "Failed to fetch documents");
        console.error("Error fetching documents:", err);
      } finally {
        setLoading(false);
      }
    },
    [tenantId]
  );

  // Fetch updates
  const fetchUpdates = useCallback(
    async (acknowledged?: boolean, limit?: number) => {
      try {
        const queryParams = new URLSearchParams();
        if (tenantId) queryParams.append("tenant_id", tenantId);
        if (acknowledged !== undefined)
          queryParams.append("acknowledged", String(acknowledged));
        if (limit) queryParams.append("limit", String(limit));

        const response = await api.request<{
          updates: KnowledgeUpdate[];
          unreadCount: number;
        }>(`/api/knowledge-center/updates?${queryParams.toString()}`);

        setUpdates(response.updates);
        setUnreadCount(response.unreadCount);
      } catch (err: any) {
        console.error("Error fetching updates:", err);
      }
    },
    [tenantId]
  );

  // Fetch categories
  const fetchCategories = useCallback(async () => {
    try {
      const response = await api.request<{
        categories: Array<{ category: string; doc_count: number }>;
      }>(`/api/knowledge-center/categories${tenantParam}`);
      setCategories(response.categories);
    } catch (err: any) {
      console.error("Error fetching categories:", err);
    }
  }, [tenantParam]);

  // Get single document
  const getDocument = useCallback(
    async (id: string): Promise<KnowledgeDocument | null> => {
      try {
        const response = await api.request<{ document: KnowledgeDocument }>(
          `/api/knowledge-center/documents/${id}${tenantParam}`
        );
        return response.document;
      } catch (err: any) {
        console.error("Error fetching document:", err);
        return null;
      }
    },
    [tenantParam]
  );

  // Upload tenant document
  const uploadDocument = useCallback(
    async (
      file: File,
      metadata: { title?: string; category?: string; tags?: string[] }
    ): Promise<KnowledgeDocument | null> => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        if (metadata.title) formData.append("title", metadata.title);
        if (metadata.category) formData.append("category", metadata.category);
        if (metadata.tags)
          formData.append("tags", JSON.stringify(metadata.tags));

        const url = tenantId
          ? `/api/knowledge-center/documents/upload?tenant_id=${tenantId}`
          : "/api/knowledge-center/documents/upload";

        const response = await api.fetchWithAuth(url, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to upload document");
        }

        const data = await response.json();
        await fetchDocuments();
        return data.document;
      } catch (err: any) {
        console.error("Error uploading document:", err);
        throw err;
      }
    },
    [tenantId, fetchDocuments]
  );

  // Delete tenant document
  const deleteDocument = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await api.request(
          `/api/knowledge-center/documents/${id}${tenantParam}`,
          {
            method: "DELETE",
          }
        );
        await fetchDocuments();
        return true;
      } catch (err: any) {
        console.error("Error deleting document:", err);
        throw err;
      }
    },
    [tenantParam, fetchDocuments]
  );

  // Acknowledge update
  const acknowledgeUpdate = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await api.request(
          `/api/knowledge-center/updates/${id}/acknowledge${tenantParam}`,
          { method: "POST" }
        );
        await fetchUpdates();
        return true;
      } catch (err: any) {
        console.error("Error acknowledging update:", err);
        return false;
      }
    },
    [tenantParam, fetchUpdates]
  );

  // Acknowledge all updates
  const acknowledgeAllUpdates = useCallback(async (): Promise<number> => {
    try {
      const response = await api.request<{ count: number }>(
        `/api/knowledge-center/updates/acknowledge-all${tenantParam}`,
        { method: "POST" }
      );
      await fetchUpdates();
      return response.count;
    } catch (err: any) {
      console.error("Error acknowledging all updates:", err);
      return 0;
    }
  }, [tenantParam, fetchUpdates]);

  // Search knowledge
  const searchKnowledge = useCallback(
    async (
      query: string,
      options: { top_k?: number; threshold?: number } = {}
    ): Promise<SearchResult[]> => {
      try {
        const response = await api.request<{ results: SearchResult[] }>(
          `/api/knowledge-center/search${tenantParam}`,
          {
            method: "POST",
            body: JSON.stringify({
              query,
              top_k: options.top_k || 10,
              threshold: options.threshold || 0.7,
            }),
          }
        );
        return response.results;
      } catch (err: any) {
        console.error("Error searching knowledge:", err);
        return [];
      }
    },
    [tenantParam]
  );

  // Initial fetch
  useEffect(() => {
    fetchDocuments();
    fetchUpdates(false); // Fetch unacknowledged by default
    fetchCategories();
  }, [fetchDocuments, fetchUpdates, fetchCategories]);

  return {
    documents,
    updates,
    unreadCount,
    categories,
    loading,
    error,
    pagination,
    fetchDocuments,
    fetchUpdates,
    fetchCategories,
    getDocument,
    uploadDocument,
    deleteDocument,
    acknowledgeUpdate,
    acknowledgeAllUpdates,
    searchKnowledge,
  };
}
